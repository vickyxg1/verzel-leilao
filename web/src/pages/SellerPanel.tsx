import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, brl, dateTime, STATUS_LABEL, type Lot, type SearchItem } from '../api'

// "2026-10-23T14:30" no fuso local, formato do <input type="datetime-local">
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const toCents = (reais: string) => Math.round(Number(reais) * 100)

function CreateLot({ onCreated }: { onCreated: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchItem[]>([])
  const [picked, setPicked] = useState<SearchItem | null>(null)
  const [form, setForm] = useState(() => ({
    start: '100', increment: '10',
    startsAt: localInput(new Date(Date.now() + 2 * 60_000)),
    endsAt: localInput(new Date(Date.now() + 60 * 60_000)),
  }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const search = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      setResults(await api<SearchItem[]>(`/items/search?q=${encodeURIComponent(q)}`))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!picked) return
    setBusy(true)
    setError('')
    try {
      await api('/lots', {
        method: 'POST',
        body: {
          externalId: picked.externalId,
          startingPriceCents: toCents(form.start),
          minIncrementCents: toCents(form.increment),
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
        },
      })
      setPicked(null)
      setResults([])
      onCreated()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  return (
    <section className="card stack">
      <h2>Novo lote</h2>
      <form onSubmit={search} className="row">
        <input placeholder="Buscar obra no acervo (ex.: monet)" value={q} onChange={(e) => setQ(e.target.value)} minLength={2} required />
        <button disabled={busy}>Buscar</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {!picked && results.length > 0 && (
        <div className="grid small">
          {results.map((item) => (
            <button key={item.externalId} type="button" className="pick card" onClick={() => setPicked(item)}>
              <img src={item.thumbUrl} alt="" loading="lazy" />
              <strong>{item.title}</strong>
              <span className="muted">{item.artist}</span>
            </button>
          ))}
        </div>
      )}
      {picked && (
        <form onSubmit={create} className="stack">
          <p>Item: <strong>{picked.title}</strong> <button type="button" className="link" onClick={() => setPicked(null)}>trocar</button></p>
          <div className="row">
            <label>Lance inicial (R$)<input type="number" min="0.01" step="0.01" required value={form.start} onChange={set('start')} /></label>
            <label>Incremento mínimo (R$)<input type="number" min="0.01" step="0.01" required value={form.increment} onChange={set('increment')} /></label>
          </div>
          <div className="row">
            <label>Início<input type="datetime-local" required value={form.startsAt} onChange={set('startsAt')} /></label>
            <label>Fim<input type="datetime-local" required value={form.endsAt} onChange={set('endsAt')} /></label>
          </div>
          <button disabled={busy}>Criar lote</button>
        </form>
      )}
    </section>
  )
}

export default function SellerPanel() {
  const [lots, setLots] = useState<Lot[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  const load = () => api<{ lots: Lot[]; total_received_cents: number }>('/lots/mine')
    .then((d) => { setLots(d.lots); setTotal(d.total_received_cents) })
    .catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const cancel = async (lot: Lot) => {
    if (!confirm(`Cancelar o lote "${lot.title}"?`)) return
    try {
      await api(`/lots/${lot.id}/cancel`, { method: 'POST' })
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="stack">
      <CreateLot onCreated={load} />
      <section className="card">
        <h2>Meus lotes</h2>
        <p>Total recebido em lotes arrematados: <strong className="ok">{brl(total)}</strong></p>
        {error && <p className="error">{error}</p>}
        {lots?.length === 0 && <p className="muted">Nenhum lote ainda.</p>}
        <table className="table">
          <tbody>
            {lots?.map((lot) => (
              <tr key={lot.id}>
                <td><Link to={`/lotes/${lot.id}`}>{lot.title}</Link></td>
                <td><span className={`badge ${lot.status}`}>{STATUS_LABEL[lot.status]}</span></td>
                <td>
                  {lot.status === 'ENDED'
                    ? lot.settled_at == null ? 'Encerrando…'
                      : lot.winner_alias ? `Arrematado por ${brl(lot.final_amount_cents!)} (${lot.winner_alias})` : 'Encerrado sem lances'
                    : lot.current_bid_cents == null ? 'Sem lances' : brl(lot.current_bid_cents)}
                </td>
                <td className="muted">{dateTime(lot.starts_at)} → {dateTime(lot.ends_at)}</td>
                <td>
                  {lot.bid_count === 0 && (lot.status === 'SCHEDULED' || lot.status === 'LIVE') && (
                    <button className="link danger" onClick={() => cancel(lot)}>Cancelar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
