// Build para a Vercel no formato Build Output API (.vercel/output):
// - static/: build do React servido pela CDN;
// - functions/api.func/: o Express empacotado num arquivo só (esbuild), atendendo /api/*.
// Uso (na raiz do repositório): node server/scripts/vercel-build.ts
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = root + '.vercel/output/';
const func = out + 'functions/api.func/';

execSync('pnpm --filter web build', { cwd: root, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(func, { recursive: true });
cpSync(root + 'web/dist', out + 'static', { recursive: true });

await build({
  entryPoints: [root + 'server/src/vercel.ts'],
  outfile: func + 'index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['pg-native'], // dependência opcional do pg, não usada
  // dependências CommonJS (express, pg) chamam require() dentro do bundle ESM
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

writeFileSync(func + '.vc-config.json', JSON.stringify({
  runtime: 'nodejs24.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  regions: ['iad1'], // mesma região do Supabase (us-east-1)
  maxDuration: 30,
  // só na função: no painel afetaria o build (pnpm pularia as devDependencies). Liga cookie Secure.
  environment: { NODE_ENV: 'production' },
}, null, 2));

writeFileSync(out + 'config.json', JSON.stringify({
  version: 3,
  routes: [
    // arquivos do Vite têm hash no nome: cache longo
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { handle: 'filesystem' },
    // a função recebe o caminho original (/api/lots/1...) e o Express roteia
    { src: '^/api(/.*)?$', dest: '/api' },
    // SPA: qualquer outra rota cai no index.html e o React Router resolve
    { src: '^/(.*)$', dest: '/index.html' },
  ],
}, null, 2));

console.log('build da Vercel pronto em .vercel/output');
