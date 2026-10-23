import pg from 'pg';
import { config } from './config.ts';

// BIGINT (centavos) chega como string por padrão; converte para number.
// Seguro até 2^53 centavos (~90 trilhões de reais).
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // Limitação: TLS sem validar certificado (Supabase usa CA própria); fixar CA se o modelo de ameaça exigir.
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

export type Db = pg.PoolClient | pg.Pool;

// Executa fn numa transação; rollback em qualquer erro.
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
