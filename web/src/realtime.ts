import { RealtimeClient } from '@supabase/realtime-js'
import { useEffect } from 'react'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
// Só o cliente de Realtime (não o supabase-js inteiro): o front não acessa o banco do Supabase.
const supabase = url && key ? new RealtimeClient(`${url}/realtime/v1`, { params: { apikey: key } }) : null

// Chama onChange quando a API avisa que o tópico mudou (Supabase Broadcast).
// O evento não traz dados: a tela relê da API, então um aviso perdido não deixa estado errado.
// Ressincroniza ao (re)conectar e ao voltar para a aba. Sem Supabase configurado, consulta a cada 3 s.
// everyMs: releitura periódica para mudanças sem evento (lote mudando de estado pelo relógio, encerramento pelo pg_cron).
export function useLive(topic: string, onChange: () => void, everyMs?: number) {
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') onChange() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = !supabase ? setInterval(onChange, 3000) : everyMs ? setInterval(onChange, everyMs) : undefined
    const channel = supabase
      ?.channel(topic)
      .on('broadcast', { event: 'changed' }, onChange)
      .subscribe((status) => { if (status === 'SUBSCRIBED') onChange() })
    return () => {
      clearInterval(timer)
      if (channel) supabase!.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [topic, onChange, everyMs])
}
