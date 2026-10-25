import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import { authenticate, authRouter } from './auth.ts';
import { auditRouter } from './audit.ts';
import { bidsRouter } from './bids.ts';
import { participationsRouter, receiptsRouter } from './receipts.ts';
import { walletRouter } from './wallet.ts';
import { pool } from './db.ts';
import { errorHandler } from './errors.ts';
import { itemsRouter } from './items.ts';
import { lotsRouter } from './lots.ts';

const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // atrás do proxy da Vercel: IP real para rate limit
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(authenticate);

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/items', itemsRouter);
  app.use('/api/lots/:id/bids', bidsRouter);
  app.use('/api/lots/:id/audit', auditRouter);
  app.use('/api/receipts', receiptsRouter);
  app.use('/api/me/participations', participationsRouter);
  app.use('/api/lots', lotsRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Rota não encontrada' });
  });

  // Em produção a própria API serve o build do React (uma URL, sem CORS).
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('/{*path}', (_req, res) => res.sendFile(webDist + 'index.html'));
  }

  app.use(errorHandler);
  return app;
}
