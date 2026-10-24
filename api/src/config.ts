function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ${name} não definida (veja .env.example)`);
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  anchorDatabaseUrl: required('ANCHOR_DATABASE_URL'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  jwtSecret: required('JWT_SECRET'),
  // Opcionais: sem eles o tempo real fica desligado no servidor.
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
  port: Number(process.env.PORT ?? 3000),
  production: process.env.NODE_ENV === 'production',
};
