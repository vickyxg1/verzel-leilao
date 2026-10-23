export type Role = 'AUCTIONEER' | 'BIDDER'
export type Me = { id: number; email: string; role: Role; name: string; alias: string }

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// fetch JSON com cookie de sessão; erros da API viram ApiError com a mensagem do servidor.
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.code ?? 'ERROR', data.message ?? 'Falha na requisição')
  return data as T
}

export type LotStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
export type Lot = {
  id: number
  status: LotStatus
  title: string
  artist: string | null
  date: string | null
  medium: string | null
  origin: string | null
  sourceUrl: string | null
  imageUrl: string
  starting_price_cents: number
  min_increment_cents: number
  current_bid_cents: number | null
  next_min_cents: number
  bid_count: number
  starts_at: string
  ends_at: string
  seller_alias: string
  leader_alias: string | null
  server_now: string
}
export type Bid = { seq: number; bidder_alias: string; amount_cents: number; created_at: string; prev_hash: string; hash: string }
export type Showcase = { live: Lot[]; scheduled: Lot[]; ended: Lot[] }
export type SearchItem = { externalId: string; title: string; artist: string | null; date: string | null; medium: string | null; thumbUrl: string }

export const STATUS_LABEL: Record<LotStatus, string> = {
  SCHEDULED: 'Agendado',
  LIVE: 'Ao vivo',
  ENDED: 'Encerrado',
  CANCELLED: 'Cancelado',
}

export const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
