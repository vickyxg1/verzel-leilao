// Entrada da função serverless na Vercel: só o Express.
// Sem migrations (rodam por script, ver README) e sem intervalo de encerramento (vem do pg_cron no Supabase).
import { createApp } from './app.ts';

export default createApp();
