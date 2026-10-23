import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, brl, dateTime } from '../api'

type ReceiptData = {
  token: string
  lot_id: number
  title: string
  artist: string | null
  amount_cents: number
  final_bid_seq: number
  final_hash: string
  settled_at: string
  winner_alias: string
  seller_alias: string
  imageUrl: string
  auditUrl: string
}

export default function Receipt() {
  const { token } = useParams()
  const [r, setR] = useState<ReceiptData | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api<ReceiptData>(`/receipts/${token}`).then(setR).catch((e) => setError(e.message))
  }, [token])

  if (error) return <p className="error">{error}</p>
  if (!r) return <p className="muted">Carregando…</p>

  const copy = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
  }

  return (
    <article className="card receipt stack">
      <p className="muted">Comprovante de arremate</p>
      <img src={r.imageUrl} alt={r.title} />
      <h1>{r.title}</h1>
      {r.artist && <p className="muted">{r.artist}</p>}
      <dl className="attrs">
        <dt>Valor arrematado</dt><dd><strong>{brl(r.amount_cents)}</strong></dd>
        <dt>Arrematante</dt><dd>{r.winner_alias}</dd>
        <dt>Leiloeiro</dt><dd>{r.seller_alias}</dd>
        <dt>Liquidado em</dt><dd>{dateTime(r.settled_at)}</dd>
        <dt>Lance vencedor</dt><dd>#{r.final_bid_seq}</dd>
        <dt>Hash final</dt><dd><code className="break">{r.final_hash}</code></dd>
        <dt>Código</dt><dd><code className="break">{r.token}</code></dd>
      </dl>
      <div className="row">
        <button onClick={copy}>{copied ? 'Link copiado!' : 'Copiar link de compartilhamento'}</button>
        <Link to={r.auditUrl}>Verificar histórico na auditoria pública</Link>
      </div>
    </article>
  )
}
