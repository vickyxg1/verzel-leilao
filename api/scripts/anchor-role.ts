// Cria na âncora o usuário que a API usa em produção: só SELECT e INSERT em bid_anchors.
// Uso: ANCHOR_DATABASE_URL=<url do dono> ANCHOR_APP_PASSWORD=<senha> node api/scripts/anchor-role.ts
import pg from 'pg';

const password = process.env.ANCHOR_APP_PASSWORD;
if (!password || !/^[A-Za-z0-9]{24,}$/.test(password)) throw new Error('ANCHOR_APP_PASSWORD: 24+ letras/números');

const client = new pg.Client({ connectionString: process.env.ANCHOR_DATABASE_URL });
await client.connect();
await client.query(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anchor_app') THEN CREATE ROLE anchor_app LOGIN; END IF;
END $$`);
await client.query(`ALTER ROLE anchor_app WITH LOGIN PASSWORD '${password}'`);
await client.query('REVOKE ALL ON bid_anchors FROM anchor_app');
await client.query('GRANT USAGE ON SCHEMA public TO anchor_app');
await client.query('GRANT SELECT, INSERT ON bid_anchors TO anchor_app');
console.log('anchor_app pronto (SELECT, INSERT em bid_anchors)');
await client.end();
