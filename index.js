const DEFAULT_BASE_URL = 'https://api.voybit.com/api/v1'
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504])
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const TOLERANCE_SECONDS = 5 * 60

export class VoybitError extends Error {
  constructor(status, code, message, requestId) {
    super(message || `Voybit payment gateway returned HTTP ${status}`)
    this.name = 'VoybitError'
    this.status = status
    this.code = code || 'unknown_error'
    this.requestId = requestId || ''
  }
}

export function createClient({ apiKey, baseURL = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('Voybit payment gateway API key is required')
  const endpoint = `${baseURL.replace(/\/$/, '')}/gateway/payments`

  return {
    async createPayment(request, idempotencyKey) {
      if (!IDEMPOTENCY.test(idempotencyKey)) {
        throw new Error('idempotency key must contain 8 to 128 URL-safe characters')
      }
      const body = JSON.stringify(request)
      let lastError
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 20_000)
        try {
          const response = await fetchImpl(endpoint, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'X-Voybit-Api-Key': apiKey,
              'Idempotency-Key': idempotencyKey,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body,
          })
          const raw = await response.text()
          const decoded = raw ? JSON.parse(raw) : {}
          const requestId = response.headers.get('x-request-id') || ''
          if (response.ok) {
            return {
              payment: decoded,
              replayed: response.headers.get('idempotency-replayed') === 'true',
              requestId,
            }
          }
          const error = new VoybitError(response.status, decoded?.error?.code, decoded?.error?.message, requestId)
          if (!RETRYABLE.has(response.status) || attempt === 3) throw error
          lastError = error
          await sleep(retryDelay(response, attempt))
        } catch (error) {
          if (error instanceof VoybitError) throw error
          if (attempt === 3) throw error
          lastError = error
          await sleep(Math.min(500 * (2 ** attempt), 8000))
        } finally {
          clearTimeout(timeout)
        }
      }
      throw lastError
    },
  }
}

export async function verifyWebhook({ secret, id, timestamp, signature, rawBody, now = new Date() }) {
  const { createHmac, timingSafeEqual } = await import('node:crypto')
  if (!secret || !id || !timestamp || !signature?.startsWith('v1=')) {
    throw new Error('webhook signature is invalid')
  }
  const supplied = Buffer.from(signature.slice(3), 'hex')
  const seconds = Number(timestamp)
  const age = Math.abs(Math.floor(now.getTime() / 1000) - seconds)
  if (!Number.isInteger(seconds) || supplied.length !== 32 || age > TOLERANCE_SECONDS) {
    throw new Error('webhook signature is invalid')
  }
  const expected = createHmac('sha256', secret).update(`${id}.${timestamp}.`).update(rawBody).digest()
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error('webhook signature does not match')
  }
  return JSON.parse(rawBody.toString('utf8'))
}

function retryDelay(response, attempt) {
  const seconds = Number(response.headers.get('retry-after'))
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000
  return Math.min(500 * (2 ** attempt), 8000)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
