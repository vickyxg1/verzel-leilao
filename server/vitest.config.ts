import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Banco de teste dedicado (criado por docker/init-db.sql). Arquivos em série: compartilham o banco.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://leilao:leilao@localhost:5433/leilao_test',
      ANCHOR_DATABASE_URL: process.env.TEST_ANCHOR_DATABASE_URL ?? 'postgres://leilao:leilao@localhost:5433/anchor_test',
      JWT_SECRET: 'test-secret',
    },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
