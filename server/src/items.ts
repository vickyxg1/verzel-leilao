// Cliente da API pública do Art Institute of Chicago (https://api.artic.edu/docs/).
// Só é usada para BUSCAR e CRIAR lote; depois disso o lote vive do snapshot local.
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from './auth.ts';
import { AppError } from './errors.ts';

const API = 'https://api.artic.edu/api/v1';
const IIIF = 'https://www.artic.edu/iiif/2';
// Sem identificação a AIC (Cloudflare) devolve desafio HTML em vez de JSON.
const HEADERS = { 'AIC-User-Agent': 'verzel-leilao-demo', 'User-Agent': 'verzel-leilao-demo/1.0' };
const TIMEOUT_MS = 6000;
const MAX_IMAGE_BYTES = 2_000_000;
const FIELDS = 'id,title,artist_display,date_display,medium_display,place_of_origin,image_id,is_public_domain';

type Artwork = {
  id: number;
  title: string;
  artist_display?: string;
  date_display?: string;
  medium_display?: string;
  place_of_origin?: string;
  image_id: string | null;
};

async function aicFetch(url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') {
      throw new AppError(504, 'EXTERNAL_TIMEOUT', 'O acervo externo demorou demais para responder. Tente novamente.');
    }
    throw new AppError(502, 'EXTERNAL_UNAVAILABLE', 'Acervo externo indisponível no momento.');
  }
  if (res.status === 429) throw new AppError(503, 'EXTERNAL_RATE_LIMIT', 'Limite de consultas ao acervo atingido. Aguarde um minuto.');
  if (!res.ok) throw new AppError(502, 'EXTERNAL_UNAVAILABLE', 'Acervo externo indisponível no momento.');
  return res;
}

async function aicJson<T>(url: string): Promise<T> {
  const res = await aicFetch(url);
  try {
    return (await res.json()) as T;
  } catch {
    // ex.: página de desafio do Cloudflare em vez de JSON
    throw new AppError(502, 'EXTERNAL_UNAVAILABLE', 'Acervo externo devolveu resposta inválida.');
  }
}

const thumb = (imageId: string) => `${IIIF}/${imageId}/full/200,/0/default.jpg`;

// Limitação: cache em memória por instância; perde-se em cold start, suficiente para aliviar rate limit.
const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_MS = 5 * 60_000;

export async function searchArtworks(q: string) {
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const params = new URLSearchParams({ q, limit: '20', fields: FIELDS, 'query[term][is_public_domain]': 'true' });
  const body = await aicJson<{ data: Artwork[] }>(`${API}/artworks/search?${params}`);
  const data = body.data
    .filter((a) => a.image_id)
    .map((a) => ({
      externalId: String(a.id),
      title: a.title,
      artist: a.artist_display ?? null,
      date: a.date_display ?? null,
      medium: a.medium_display ?? null,
      thumbUrl: thumb(a.image_id!),
    }));
  cache.set(key, { at: Date.now(), data });
  return data;
}

// Dados completos + bytes da imagem, buscados no servidor (nunca confiar em snapshot vindo do cliente).
export async function fetchArtworkSnapshot(externalId: string) {
  const { data: a } = await aicJson<{ data: Artwork }>(`${API}/artworks/${encodeURIComponent(externalId)}?fields=${FIELDS}`);
  if (!a?.image_id) throw new AppError(422, 'ITEM_WITHOUT_IMAGE', 'Item sem imagem disponível no acervo.');
  const img = await aicFetch(`${IIIF}/${a.image_id}/full/600,/0/default.jpg`);
  const mime = img.headers.get('content-type') ?? '';
  const bytes = Buffer.from(await img.arrayBuffer());
  if (!mime.startsWith('image/') || bytes.length > MAX_IMAGE_BYTES) {
    throw new AppError(502, 'EXTERNAL_UNAVAILABLE', 'Imagem do acervo inválida.');
  }
  return {
    source: 'AIC',
    externalId: String(a.id),
    title: a.title,
    attributes: {
      artist: a.artist_display ?? null,
      date: a.date_display ?? null,
      medium: a.medium_display ?? null,
      origin: a.place_of_origin ?? null,
    },
    imageBytes: bytes,
    imageMime: mime,
    sourceUrl: `https://www.artic.edu/artworks/${a.id}`,
  };
}

export const itemsRouter = Router();

itemsRouter.get('/search', requireRole('AUCTIONEER'), async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(2).max(100) }).parse(req.query);
  res.json(await searchArtworks(q));
});
