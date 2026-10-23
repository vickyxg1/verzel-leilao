// Postgres local sem Docker (binário nativo via embedded-postgres). Mesma porta/credenciais do docker-compose.
// Uso: pnpm db:local  (fica rodando; Ctrl+C para parar)
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dataDir = fileURLToPath(new URL('../.pgdata', import.meta.url));
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'leilao', password: 'leilao', port: 5433, persistent: true });

if (!existsSync(dataDir)) await pg.initialise();
await pg.start();
for (const db of ['leilao', 'leilao_test', 'anchor', 'anchor_test']) {
  await pg.createDatabase(db).catch(() => {}); // já existe
}
console.log('Postgres local em postgres://leilao:leilao@localhost:5433 (Ctrl+C para parar)');

process.on('SIGINT', async () => {
  await pg.stop();
  process.exit(0);
});
