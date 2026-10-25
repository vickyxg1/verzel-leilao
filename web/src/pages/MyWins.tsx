import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, brl, STATUS_LABEL, type LotStatus } from '../api'
import { useLive } from '../realtime'

type Participation = {
  id: number
  title: string
  status: LotStatus
  ends_at: string
  current_bid_cents: number
  my_best_cents: number
  my_bids: number
  leading: boolean
  won: boolean
  receipt_token: string | null
}

function result(p: Participation) {
  if (p.won) return <span className="ok">Arrematado</span>
  if (p.status === 'LIVE') return p.leading ? <span className="ok">Ganhando</span> : <span className="error">Superado</span>
  if (p.status === 'ENDED') return p.leading ? <span className="muted">Encerrando…</span> : <span className="muted">Não arrematado</span>
  return <span className="muted">{STATUS_LABEL[p.status]}</span>
}

export default function MyWins() {
  const [items, setItems] = useState<Participation[] | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Participation[]>('/me/participations').then(setItems).catch((e) => setError(e.message))
  }, [])
  useEffect(load, [load])
  useLive('lots', load, 15_000)

  const copyLink = async (token: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/comprovantes/${token}`)
    setCopied(token)
  }

  const won = items?.filter((p) => p.won) ?? []

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      <section className="card">
        <h2>Lotes arrematados</h2>
        {won.length === 0 ? <p className="muted">Você ainda não arrematou nenhum lote.</p> : (
          <table className="table"><tbody>
            {won.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/lotes/${p.id}`}>{p.title}</Link></td>
                <td><strong>{brl(p.current_bid_cents)}</strong></td>
                <td><Link to={`/comprovantes/${p.receipt_token}`}>Ver comprovante</Link></td>
                <td>
                  <button className="link" onClick={() => copyLink(p.receipt_token!)}>
                    {copied === p.receipt_token ? 'Link copiado!' : 'Copiar link'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody></table>
        )}
      </section>
      <section className="card">
        <h2>Lotes em que dei lance</h2>
        {items?.length === 0 && <p className="muted">Nenhum lance ainda.</p>}
        <table className="table"><tbody>
          {items?.map((p) => (
            <tr key={p.id}>
              <td><Link to={`/lotes/${p.id}`}>{p.title}</Link></td>
              <td>Meu maior lance: {brl(p.my_best_cents)} <span className="muted">({p.my_bids} lance(s))</span></td>
              <td>{result(p)}</td>
            </tr>
          ))}
        </tbody></table>
      </section>
    </div>
  )
}
