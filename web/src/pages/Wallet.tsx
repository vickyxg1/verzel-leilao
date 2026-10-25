import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, brl, dateTime } from '../api'
import { useLive } from '../realtime'

type WalletData = {
  balance_cents: number
  committed_cents: number
  available_cents: number
  entries: { id: number; kind: string; amount_cents: number; lot_id: number | null; created_at: string }[]
}

const KIND: Record<string, string> = {
  DEPOSIT: 'Depósito',
  SETTLEMENT_DEBIT: 'Arremate (débito)',
  SETTLEMENT_CREDIT: 'Venda (crédito)',
  CANCEL_RELEASE: 'Estorno de reserva (lote cancelado)',
}

export default function Wallet() {
  const [data, setData] = useState<WalletData | null>(null)
  const [amount, setAmount] = useState('500')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<WalletData>('/wallet').then(setData).catch((e) => setError(e.message))
  }, [])
  useEffect(load, [load])
  // ser superado libera reserva (evento de lance); débito do arremate vem do pg_cron, sem evento: relê a cada 15 s
  useLive('lots', load, 15_000)

  const depositSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      // chave nova por envio: retry/duplo clique do mesmo envio não duplica
      setData(await api<WalletData>('/wallet/deposit', {
        method: 'POST',
        body: { amountCents: Math.round(Number(amount) * 100), idempotencyKey: crypto.randomUUID() },
      }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div className="stats">
        <div className="card"><span className="muted">Saldo total</span><strong>{data ? brl(data.balance_cents) : '—'}</strong></div>
        <div className="card"><span className="muted">Comprometido em lances</span><strong>{data ? brl(data.committed_cents) : '—'}</strong></div>
        <div className="card"><span className="muted">Disponível</span><strong className="ok">{data ? brl(data.available_cents) : '—'}</strong></div>
      </div>
      <form className="card row" onSubmit={depositSubmit}>
        <label>Depósito simulado (R$)<input type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <button disabled={busy}>Depositar</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <section className="card">
        <h2>Movimentações</h2>
        {data?.entries.length === 0 && <p className="muted">Nenhuma movimentação.</p>}
        <table className="table">
          <tbody>
            {data?.entries.map((e) => (
              <tr key={e.id}>
                <td>{KIND[e.kind] ?? e.kind}</td>
                <td className={e.amount_cents > 0 ? 'ok' : 'error'}>{brl(e.amount_cents)}</td>
                <td className="muted">{dateTime(e.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
