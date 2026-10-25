import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { api, brl, dateTime, STATUS_LABEL, type Bid, type Lot } from '../api'
import { useAuth } from '../auth'
import Countdown from '../components/Countdown'
import { useLive } from '../realtime'

function BidBox({ lot, history, onBid }: { lot: Lot; history: Bid[]; onBid: () => void }) {
  const { me } = useAuth()
  const [amount, setAmount] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  if (!me) return <p><Link to="/login">Entre</Link> como licitante para dar lances.</p>
  if (me.role !== 'BIDDER') return <p className="muted">Leiloeiros não dão lances.</p>

  const participated = history.some((b) => b.bidder_alias === me.alias)
  const leading = lot.leader_alias === me.alias
  // posição = colocação do melhor lance do usuário entre os licitantes distintos
  const ranking = [...new Set(history.map((b) => b.bidder_alias))]
  const position = ranking.indexOf(me.alias) + 1

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      await api(`/lots/${lot.id}/bids`, { method: 'POST', body: { amountCents: Math.round(Number(amount) * 100) } })
      setMsg({ ok: true, text: 'Lance aceito!' })
      setAmount('')
      onBid()
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      {participated && (
        <p className={`status-banner ${leading ? 'winning' : 'losing'}`}>
          {lot.status === 'CANCELLED'
            ? leading ? `Lote cancelado: sua reserva de ${brl(lot.current_bid_cents!)} foi estornada` : 'Lote cancelado: nenhum valor seu ficou reservado'
            : lot.status === 'ENDED'
            ? leading ? 'Você arrematou este lote!' : `Lote encerrado: você ficou em ${position}º`
            : leading ? 'Você está ganhando!' : `Você foi superado (sua posição: ${position}º)`}
        </p>
      )}
      {lot.status === 'LIVE' && (
        <form onSubmit={submit} className="row">
          <label>Seu lance (mín. {brl(lot.next_min_cents)})
            <input type="number" step="0.01" min="0.01" required value={amount} placeholder={(lot.next_min_cents / 100).toFixed(2)} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <button disabled={busy}>Dar lance</button>
        </form>
      )}
      {msg && <p className={msg.ok ? 'ok' : 'error'} role="alert">{msg.text}</p>}
    </div>
  )
}

export default function LotPage() {
  const { id } = useParams()
  const [lot, setLot] = useState<Lot | null>(null)
  const [history, setHistory] = useState<Bid[]>([])
  const [error, setError] = useState('')

  const load = useCallback(() => {
    Promise.all([api<Lot>(`/lots/${id}`), api<Bid[]>(`/lots/${id}/bids`)])
      .then(([l, h]) => { setLot(l); setHistory(h); setError('') })
      .catch((e) => setError(e.message))
  }, [id])
  useEffect(load, [load])
  // lances de outros usuários, prorrogação e cancelamento chegam sem refresh
  useLive(`lot:${id}`, load)

  if (error && !lot) return <p className="error">{error}</p>
  if (!lot) return <p className="muted">Carregando…</p>
  const extended = lot.ends_at !== lot.original_ends_at

  return (
    <div className="lot-page">
      <div className="stack">
        <img src={lot.imageUrl} alt={lot.title} className="lot-image" />
        <dl className="attrs card">
          {lot.artist && <><dt>Artista</dt><dd>{lot.artist}</dd></>}
          {lot.date && <><dt>Data</dt><dd>{lot.date}</dd></>}
          {lot.medium && <><dt>Técnica</dt><dd>{lot.medium}</dd></>}
          {lot.origin && <><dt>Origem</dt><dd>{lot.origin}</dd></>}
          <dt>Leiloeiro</dt><dd>{lot.seller_alias}</dd>
          <dt>Lance inicial</dt><dd>{brl(lot.starting_price_cents)}</dd>
          <dt>Incremento mínimo</dt><dd>{brl(lot.min_increment_cents)}</dd>
          <dt>Início</dt><dd>{dateTime(lot.starts_at)}</dd>
        </dl>
        {lot.sourceUrl && <p className="muted">Fonte: <a href={lot.sourceUrl} target="_blank" rel="noreferrer">Art Institute of Chicago</a></p>}
      </div>
      <div className="stack">
        <div className="card stack">
          <span className={`badge ${lot.status}`}>{STATUS_LABEL[lot.status]}</span>
          <h1>{lot.title}</h1>
          <p className="big">{lot.current_bid_cents == null ? 'Sem lances' : brl(lot.current_bid_cents)}</p>
          {lot.status === 'ENDED' ? (
            <p>{lot.winner_alias ? `Arrematado por ${lot.winner_alias} em ${dateTime(lot.ends_at)}` : `Encerrado sem lances em ${dateTime(lot.ends_at)}`}</p>
          ) : lot.status === 'LIVE' ? (
            <p>
              Encerra em <Countdown target={lot.ends_at} serverNow={lot.server_now} onZero={load} />{' '}
              <span className="muted">({dateTime(lot.ends_at)}{extended && ', prorrogado por lance nos últimos 2 min'})</span>
            </p>
          ) : lot.status === 'SCHEDULED' ? (
            <p>
              Começa em <Countdown target={lot.starts_at} serverNow={lot.server_now} onZero={load} />{' '}
              <span className="muted">({dateTime(lot.starts_at)})</span>
            </p>
          ) : (
            <p className="muted">Lote cancelado pelo leiloeiro.</p>
          )}
          {error && <p className="error">Sem conexão com o servidor; tentando de novo…</p>}
          <BidBox lot={lot} history={history} onBid={load} />
        </div>
        <section className="card">
          <h2>Histórico de lances</h2>
          <p><Link to={`/auditoria/${lot.id}`}>Auditar integridade deste histórico</Link></p>
          {history.length === 0 ? <p className="muted">Nenhum lance ainda.</p> : (
            <table className="table">
              <tbody>
                {history.map((b) => (
                  <tr key={b.seq}>
                    <td>#{b.seq}</td>
                    <td>{b.bidder_alias}</td>
                    <td><strong>{brl(b.amount_cents)}</strong></td>
                    <td className="muted">{dateTime(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
