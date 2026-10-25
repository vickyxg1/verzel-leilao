import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

// Erro de negócio com código estável (o front traduz/exibe a mensagem).
export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ code: err.code, message: err.message });
  } else if (err instanceof ZodError) {
    res.status(400).json({ code: 'VALIDATION', message: 'Dados inválidos', issues: err.issues });
  } else if (err?.code === '40P01' || err?.code === '40001') {
    // deadlock/serialização: transação desfeita por inteiro, cliente pode repetir
    res.status(409).json({ code: 'CONCURRENCY_RETRY', message: 'Muitas operações simultâneas. Tente novamente.' });
  } else if (err?.code === '23505') {
    res.status(409).json({ code: 'CONFLICT', message: 'Registro duplicado' });
  } else if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ code: 'VALIDATION', message: 'JSON inválido' });
  } else {
    console.error(err);
    res.status(500).json({ code: 'INTERNAL', message: 'Erro interno' });
  }
};
