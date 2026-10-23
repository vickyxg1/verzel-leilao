import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, brl, dateTime, type Bid } from '../api'

type AuditResult = {
  lot_id: number
  status: 'INTEGRO' | 'ADULTERADO' | 'NAO_CONFIRMADO'
  issues: { severity: 'ADULTERACAO' | 'ALERTA'; seq: number | null; message: string }[]
  checked_at: string
  anchor_available: boolean
  bids: (Bid & { anchored: boolean })[]
}

const VERDICT = {
  INTEGRO: { cls: 'winning', text: 'Histórico íntegro: nenhuma adulteração detectada' },
  ADULTERADO: { cls: 'losing', text: 'Histórico ADULTERADO' },
  NAO_CONFIRMADO: { cls: 'warning', text: 'Integridade não confirmada' },
}

export default function Audit() {
  const { id } = useParams()
  const [data, setData] = useState<AuditResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<AuditResult>(`/lots/${id}/audit`).then(setData).catch((e) => setError(e.message))
  }, [id])

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Verificando…</p>
  const verdict = VERDICT[data.status]

  return (
    <div className="stack">
      <h1>Auditoria do <Link to={`/lotes/${data.lot_id}`}>lote #{data.lot_id}</Link></h1>
      <p className={`status-banner ${verdict.cls}`}>{verdict.text}</p>
      {data.issues.length > 0 && (
        <ul className="card">
          {data.issues.map((i, k) => <li key={k} className={i.severity === 'ADULTERACAO' ? 'error' : ''}>{i.message}</li>)}
        </ul>
      )}
      <p className="muted">Verificado em {dateTime(data.checked_at)}.</p>
      <section className="card">
        <h2>Histórico completo</h2>
        {data.bids.length === 0 ? <p className="muted">Nenhum lance.</p> : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>#</th><th>Licitante</th><th>Valor</th><th>Horário</th><th>Hash</th><th>Âncora</th></tr></thead>
              <tbody>
                {data.bids.map((b) => (
                  <tr key={b.seq}>
                    <td>{b.seq}</td>
                    <td>{b.bidder_alias}</td>
                    <td>{brl(b.amount_cents)}</td>
                    <td className="muted">{new Date(b.created_at).toLocaleString('pt-BR')}</td>
                    <td><code title={`anterior: ${b.prev_hash}`}>{b.hash.slice(0, 12)}…</code></td>
                    <td>{b.anchored ? '✔' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card">
        <h2>Como a verificação funciona</h2>
        <ol>
          <li>Cada lance guarda o hash SHA-256 de (lote, sequência, pseudônimo, valor, horário, hash do lance anterior). Alterar, remover ou inserir um lance quebra a cadeia.</li>
          <li>No momento em que o lance é aceito, o par (sequência, hash) também é gravado em uma <strong>âncora independente</strong>: um banco de dados separado, somente inserção. Mesmo quem reescreve toda a cadeia no banco principal não consegue fazê-la bater com a âncora.</li>
          <li>O lance vencedor do lote e o comprovante de arremate precisam corresponder ao último lance do histórico.</li>
        </ol>
        <p className="muted">Limite: quem controlar ao mesmo tempo o banco principal, o banco da âncora e o servidor consegue forjar o histórico. Pseudônimos protegem a identidade dos licitantes.</p>
      </section>
    </div>
  )
}
