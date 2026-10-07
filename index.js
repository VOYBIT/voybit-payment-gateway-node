import { createHmac, timingSafeEqual } from 'node:crypto'

export const DEFAULT_BASE_URL = 'https://api.voybit.com/api/v1'

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504])
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const TOLERANCE_SECONDS = 300
const USER_AGENT = 'voybit-payment-gateway-node/0.1.0'

export class VoybitError extends Error {
  constructor(status, code, message, requestId = '') {
    super(message || `payment gateway returned HTTP ${status}`)
    this.name = 'VoybitError'
    this.status = status
    this.code = code || 'unknown_error'
    this.requestId = requestId
    this.retryAfterMs = 0
  }
}

export function createClient({ apiKey, baseURL = DEFAULT_BASE_URL, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new TypeError('API key is required')
  const endpoint = `${String(baseURL).replace(/\/$/, '')}/gateway/payments`

  return {
    async createPayment(request, idempotencyKey) {
      if (!IDEMPOTENCY.test(idempotencyKey ?? '')) {
        throw new TypeError('Idempotency-Key must be 8 to 128 URL-safe characters')
      }
      const body = JSON.stringify(request ?? {})
      let lastError
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          return await postPayment(fetchImpl, endpoint, apiKey, idempotencyKey, body)
        } catch (error) {
          const canRetry = !(error instanceof VoybitError) || RETRYABLE.has(error.status)
          if (!canRetry || attempt === 3) throw error
          lastError = error
          await sleep(delayFor(error, attempt))
        }
      }
      throw lastError
    },
  }
}

async function postPayment(fetchImpl, endpoint, apiKey, idempotencyKey, body) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'X-Voybit-Api-Key': apiKey,
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body,
    })
    const raw = await response.text()
    const requestId = response.headers.get('x-request-id') || ''
    const decoded = decodeJSON(raw, response.status, requestId)
    if (response.ok) {
      return {
        payment: decoded,
        replayed: response.headers.get('idempotency-replayed') === 'true',
        requestId,
      }
    }
    const error = new VoybitError(response.status, decoded?.error?.code, decoded?.error?.message, requestId)
    error.retryAfterMs = retryAfterMs(response)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function decodeJSON(raw, status, requestId) {
  if (!raw) return {}
  try {
    const decoded = JSON.parse(raw)
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new VoybitError(status, 'invalid_response', 'response was not a JSON object', requestId)
    }
    return decoded
  } catch (error) {
    if (error instanceof VoybitError) throw error
    throw new VoybitError(status, 'invalid_response', 'response was not JSON', requestId)
  }
}

export function verifyWebhook({ secret, id, timestamp, signature, rawBody, now = new Date() }) {
  const hex = typeof signature === 'string' && signature.startsWith('v1=') ? signature.slice(3) : ''
  if (!secret || !id || !/^\d+$/.test(String(timestamp ?? '')) || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('webhook signature is invalid')
  }
  const seconds = Number(timestamp)
  const age = Math.abs(Math.floor(now.getTime() / 1000) - seconds)
  if (age > TOLERANCE_SECONDS) throw new Error('webhook timestamp is outside the 5 minute window')
  const supplied = Buffer.from(hex, 'hex')
  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''))
  const expected = createHmac('sha256', secret).update(`${id}.${timestamp}.`).update(payload).digest()
  if (!timingSafeEqual(expected, supplied)) throw new Error('webhook signature does not match')
  return JSON.parse(payload.toString('utf8'))
}

function retryAfterMs(response) {
  const seconds = Number(response.headers.get('retry-after'))
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 30) * 1000
  return 0
}

function delayFor(error, attempt) {
  if (error instanceof VoybitError && error.retryAfterMs > 0) return error.retryAfterMs
  return Math.min(500 * (2 ** attempt), 8000)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
