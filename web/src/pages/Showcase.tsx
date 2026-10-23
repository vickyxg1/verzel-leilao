import { useEffect, useState } from 'react'
import { api, type Showcase as ShowcaseData } from '../api'
import LotCard from '../components/LotCard'

const SECTIONS = [
  ['live', 'Ao vivo'],
  ['scheduled', 'Agendados'],
  ['ended', 'Encerrados'],
] as const

export default function Showcase() {
  const [data, setData] = useState<ShowcaseData | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      api<ShowcaseData>(`/lots${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setData).catch((e) => setError(e.message))
    }, 250)
    return () => clearTimeout(t)
  }, [q])

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
