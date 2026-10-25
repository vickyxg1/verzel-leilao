import { useCallback, useEffect, useState } from 'react'
import { api, type Showcase as ShowcaseData } from '../api'
import LotCard from '../components/LotCard'
import { useLive } from '../realtime'

const SECTIONS = [
  ['live', 'Ao vivo'],
  ['scheduled', 'Agendados'],
  ['ended', 'Encerrados'],
] as const

export default function Showcase() {
  const [data, setData] = useState<ShowcaseData | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  const load = useCallback(() => {
    api<ShowcaseData>(`/lots${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((d) => { setData(d); setError('') }).catch((e) => setError(e.message))
  }, [q])
  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])
  // novos lances, lotes criados e cancelados aparecem sem refresh; mudança de seção pelo relógio, a cada 30 s
  useLive('lots', load, 30_000)

  return (
    <>
      <input className="search" placeholder="Buscar por obra ou artista" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar lotes" />
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Carregando…</p>}
      {data && SECTIONS.map(([key, label]) => (
        <section key={key}>
          <h2>{label} <span className="muted">({data[key].length})</span></h2>
          {data[key].length === 0 ? <p className="muted">Nenhum lote.</p> : (
            <div className="grid">{data[key].map((lot) => <LotCard key={lot.id} lot={lot} />)}</div>
          )}
        </section>
      ))}
    </>
  )
}
