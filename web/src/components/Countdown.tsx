import { useEffect, useRef, useState } from 'react'

const pad = (n: number) => String(n).padStart(2, '0')

function format(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const d = Math.floor(s / 86400)
  const hms = `${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
  return d > 0 ? `${d}d ${hms}` : hms
}

// Contagem até `target` pelo relógio do SERVIDOR: a diferença server_now - relógio local é corrigida,
// então um PC com hora errada não mostra tempo errado. Ao zerar chama onZero (a tela relê o lote).
export default function Countdown({ target, serverNow, onZero }: { target: string; serverNow: string; onZero: () => void }) {
  const offset = useRef(0)
  const [left, setLeft] = useState(() => new Date(target).getTime() - new Date(serverNow).getTime())

  useEffect(() => {
    offset.current = new Date(serverNow).getTime() - Date.now()
    let fired = false
    const tick = () => {
      const ms = new Date(target).getTime() - (Date.now() + offset.current)
      setLeft(ms)
      // pequena folga para o servidor já considerar o lote encerrado/iniciado quando a tela reler
      if (ms <= -500 && !fired) { fired = true; onZero() }
    }
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [target, serverNow, onZero])

  return <span className={left <= 120_000 ? 'countdown urgent' : 'countdown'}>{format(left)}</span>
}
