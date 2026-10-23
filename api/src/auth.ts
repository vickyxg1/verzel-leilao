import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router, type RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from './config.ts';
import { pool, tx, type Db } from './db.ts';
import { AppError } from './errors.ts';

export type Role = 'AUCTIONEER' | 'BIDDER';
export type AuthUser = { id: number; role: Role };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const COOKIE = 'token';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export async function createUser(db: Db, input: { email: string; password: string; name: string; role: Role }) {
  const alias = `${input.role === 'BIDDER' ? 'Licitante' : 'Leiloeiro'} #${randomBytes(3).toString('hex').toUpperCase()}`;
  const hash = await bcrypt.hash(input.password, 10);
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, role, display_name, public_alias)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.email.toLowerCase(), hash, input.role, input.name, alias],
  );
  await db.query('INSERT INTO wallets (user_id) VALUES ($1)', [rows[0].id]);
  return rows[0].id as number;
}

// Lê o JWT do cookie, se houver. Rotas protegidas usam requireRole.
export const authenticate: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret) as { sub: string; role: Role };
      req.user = { id: Number(payload.sub), role: payload.role };
    } catch {
      // token inválido/expirado: segue como anônimo
    }
  }
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Faça login para continuar');
    if (roles.length && !roles.includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Seu perfil não tem permissão para esta ação');
    }
    next();
  };
}

const credentials = z.object({ email: z.email(), password: z.string().min(8).max(100) });
const registration = credentials.extend({
  name: z.string().trim().min(2).max(80),
  role: z.enum(['AUCTIONEER', 'BIDDER']),
});

function setSession(res: Parameters<RequestHandler>[1], user: AuthUser) {
  const token = jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, { expiresIn: MAX_AGE_MS / 1000 });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.production, maxAge: MAX_AGE_MS });
}

export async function getMe(userId: number) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role, u.display_name AS name, u.public_alias AS alias
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  return rows[0];
}

export const authRouter = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

authRouter.post('/register', loginLimiter, async (req, res) => {
  const input = registration.parse(req.body);
  const id = await tx(async (c) => {
    const exists = await c.query('SELECT 1 FROM users WHERE email = $1', [input.email.toLowerCase()]);
    if (exists.rowCount) throw new AppError(409, 'EMAIL_TAKEN', 'E-mail já cadastrado');
    return createUser(c, input);
  });
  setSession(res, { id, role: input.role });
  res.status(201).json(await getMe(id));
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const { rows } = await pool.query('SELECT id, role, password_hash FROM users WHERE email = $1', [email.toLowerCase()]);
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos');
  }
  setSession(res, { id: rows[0].id, role: rows[0].role });
  res.json(await getMe(rows[0].id));
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE);
  res.status(204).end();
});

authRouter.get('/me', requireRole(), async (req, res) => {
  res.json(await getMe(req.user!.id));
});
