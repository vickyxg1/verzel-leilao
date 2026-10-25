// Execução como servidor contínuo (local / Docker). Na Vercel o encerramento vem do pg_cron.
import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { config } from './config.ts';
import { settleDue } from './lots.ts';
import { migrate } from './migrate.ts';

await migrate();

const server = createServer(createApp());
server.listen(config.port, () => console.log(`API ouvindo em http://localhost:${config.port}`));

// Encerramento periódico de lotes vencidos (mesma função SQL idempotente do pg_cron).
setInterval(() => {
  settleDue().catch((err) => console.error('falha ao liquidar lotes', err));
}, 5_000);
