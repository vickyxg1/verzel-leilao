import { config } from './config.ts';

// Avisa os navegadores pelo Supabase Realtime (Broadcast), sempre DEPOIS do commit.
// O evento só diz "o lote X mudou"; o navegador relê o estado na API, que continua sendo a fonte de verdade.
// Sem Supabase configurado (dev local/testes) não faz nada: o front cai no polling.
export async function publishLotChanged(lotId: number) {
  if (!config.supabaseUrl || !config.supabaseSecretKey) return;
  const payload = { lotId };
  try {
    const res = await fetch(`${config.supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.supabaseSecretKey },
      body: JSON.stringify({
        messages: [
          { topic: `lot:${lotId}`, event: 'changed', payload },
          { topic: 'lots', event: 'changed', payload },
        ],
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) console.error(`realtime: broadcast do lote ${lotId} falhou (${res.status})`);
  } catch (err) {
    // Falha no aviso não desfaz o lance: os navegadores ressincronizam ao reconectar ou ao voltar à aba.
    console.error(`realtime: broadcast do lote ${lotId} falhou`, err);
  }
}
