import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api, brl, dateTime, STATUS_LABEL, type Lot } from '../api'

export default function LotPage() {
  const { id } = useParams()
  const [lot, setLot] = useState<Lot | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<Lot>(`/lots/${id}`).then(setLot).catch((e) => setError(e.message))
  }, [id])

  if (error) return <p className="error">{error}</p>
  if (!lot) return <p className="muted">Carregando…</p>

  return (
    <div className="lot-page">
      <img src={lot.imageUrl} alt={lot.title} className="lot-image" />
      <div className="card">
        <span className={`badge ${lot.status}`}>{STATUS_LABEL[lot.status]}</span>
        <h1>{lot.title}</h1>
        <dl className="attrs">
          {lot.artist && <><dt>Artista</dt><dd>{lot.artist}</dd></>}
          {lot.date && <><dt>Data</dt><dd>{lot.date}</dd></>}
          {lot.medium && <><dt>Técnica</dt><dd>{lot.medium}</dd></>}
          {lot.origin && <><dt>Origem</dt><dd>{lot.origin}</dd></>}
          <dt>Leiloeiro</dt><dd>{lot.seller_alias}</dd>
          <dt>Lance inicial</dt><dd>{brl(lot.starting_price_cents)}</dd>
          <dt>Incremento mínimo</dt><dd>{brl(lot.min_increment_cents)}</dd>
          <dt>Início</dt><dd>{dateTime(lot.starts_at)}</dd>
          <dt>Fim</dt><dd>{dateTime(lot.ends_at)}</dd>
          <dt>Lance atual</dt><dd>{lot.current_bid_cents == null ? 'Sem lances' : `${brl(lot.current_bid_cents)} (${lot.leader_alias})`}</dd>
        </dl>
        {lot.sourceUrl && <p className="muted">Fonte: <a href={lot.sourceUrl} target="_blank" rel="noreferrer">Art Institute of Chicago</a></p>}
      </div>
    </div>
  )
}
