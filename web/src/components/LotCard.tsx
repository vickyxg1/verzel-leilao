import { Link } from 'react-router'
import { brl, dateTime, STATUS_LABEL, type Lot } from '../api'

export default function LotCard({ lot }: { lot: Lot }) {
  const price = lot.current_bid_cents ?? lot.starting_price_cents
  return (
    <Link to={`/lotes/${lot.id}`} className="lot-card card">
      <img src={lot.imageUrl} alt={lot.title} loading="lazy" />
      <div>
        <span className={`badge ${lot.status}`}>{STATUS_LABEL[lot.status]}</span>
        <h3>{lot.title}</h3>
        {lot.artist && <p className="muted">{lot.artist}</p>}
        <p>
          <strong>{brl(price)}</strong>{' '}
          <span className="muted">{lot.current_bid_cents == null ? 'lance inicial' : `${lot.bid_count} lance(s)`}</span>
        </p>
        <p className="muted">
          {lot.status === 'SCHEDULED' ? `Começa ${dateTime(lot.starts_at)}` : lot.status === 'LIVE' ? `Termina ${dateTime(lot.ends_at)}` : `Encerrou ${dateTime(lot.ends_at)}`}
        </p>
      </div>
    </Link>
  )
}
