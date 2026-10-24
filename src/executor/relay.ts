import { config } from '../config.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Klien Relay (https://relay.link) — bridge dengan eksekusi call di chain tujuan.
 * Endpoint diverifikasi live: POST /quote/v2 (EXACT_OUTPUT + `txs` untuk 1-tx
 * bridge+mint; EXACT_INPUT polos untuk bridge biasa). Status: GET /intents/status/v3.
 * Tanpa API key (key opsional cuma buat rate limit lebih tinggi).
 */
export interface RelayDepositTx {
  to: string
  data: string
  value: string
  gas?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
  chainId?: number
}

export interface RelayQuote {
  requestId: string
  deposit: RelayDepositTx
  statusUrl: string
  feeUsd: number
  inSym: string
  outSym: string
  inAmount: string
  outAmount: string
  /** jumlah minimum yang nyampe setelah fee + slippage buffer relayer */
  outMin: string
  /** gap estimasi rute vs nilai kirim (ratio USD Relay); negatif = terima lebih kecil */
  gapPct: number | null
  /** worst case tambahan dari minimumAmount vs amount (buffer slippage) */
  gapMinPct: number | null
}

interface RelayCurrencyValue {
  amount?: string
  amountUsd?: string
  currency?: { symbol?: string }
}

interface RelayQuoteResponse {
  requestId?: string
  message?: string
  errorCode?: string
  steps?: Array<{
    id?: string
    kind?: string
    items?: Array<{
      status?: string
      data?: RelayDepositTx
      check?: { endpoint?: string }
    }>
  }>
  fees?: Record<string, { amountUsd?: string }>
  details?: {
    currencyIn?: RelayCurrencyValue
    currencyOut?: RelayCurrencyValue & { minimumAmount?: string }
  }
}

export async function relayQuote(body: Record<string, unknown>): Promise<RelayQuote> {
  const res = await fetch(`${config.relayApi}/quote/v2`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const json = (await res.json()) as RelayQuoteResponse
  if (!res.ok || json.message || json.errorCode) {
    throw new Error(`Relay quote ditolak: ${json.errorCode ?? json.message ?? `HTTP ${res.status}`}`)
  }
  const step =
    json.steps?.find((s) => s.kind === 'transaction' && s.id === 'deposit') ?? json.steps?.[0]
  const item = step?.items?.[0]
  if (!item?.data?.to) throw new Error('Relay quote tidak punya deposit tx')
  const endpoint = item.check?.endpoint ?? `/intents/status/v3?requestId=${json.requestId}`
  const feeUsd = Object.values(json.fees ?? {}).reduce((acc, f) => acc + Number(f.amountUsd ?? 0), 0)
  const ci = json.details?.currencyIn
  const co = json.details?.currencyOut
  const inUsd = Number(ci?.amountUsd ?? NaN)
  const outUsd = Number(co?.amountUsd ?? NaN)
  const gapPct =
    Number.isFinite(inUsd) && inUsd > 0 && Number.isFinite(outUsd) ? (outUsd / inUsd - 1) * 100 : null
  let gapMinPct: number | null = null
  if (co?.amount && co.minimumAmount) {
    gapMinPct = (Number(co.minimumAmount) / Number(co.amount) - 1) * 100
  }
  return {
    requestId: json.requestId ?? '',
    deposit: item.data,
    statusUrl: `${config.relayApi}${endpoint}`,
    feeUsd,
    inSym: ci?.currency?.symbol ?? '?',
    outSym: co?.currency?.symbol ?? '?',
    inAmount: ci?.amount ?? '',
    outAmount: co?.amount ?? '',
    outMin: co?.minimumAmount ?? co?.amount ?? '',
    gapPct,
    gapMinPct,
  }
}

export async function relayStatus(quote: RelayQuote): Promise<'waiting' | 'success' | 'failed'> {
  const res = await fetch(quote.statusUrl, { signal: AbortSignal.timeout(10_000) })
  const json = (await res.json()) as { status?: string }
  const s = (json.status ?? '').toLowerCase()
  if (['success', 'completed', 'complete', 'filled'].includes(s)) return 'success'
  if (['failure', 'failed', 'refund', 'refunded', 'error', 'expired'].includes(s)) return 'failed'
  return 'waiting'
}

export function pollRelayStatus(quote: RelayQuote, maxMs: number): Promise<'success' | 'failed' | 'timeout'> {
  const deadline = Date.now() + maxMs
  return new Promise((resolve) => {
    const tick = async () => {
      try {
        const st = await relayStatus(quote)
        if (st !== 'waiting') {
          resolve(st)
          return
        }
      } catch {
        // network hiccup → lanjut poll
      }
      if (Date.now() > deadline) {
        resolve('timeout')
        return
      }
      setTimeout(() => void tick(), 8000).unref()
    }
    void tick()
  })
}

export { ZERO_ADDRESS }
