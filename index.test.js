import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'

import { createClient, verifyWebhook, VoybitError } from './index.js'

test('createPayment posts the gateway request once', async () => {
  let calls = 0
  let seen
  const client = createClient({
    apiKey: 'vb_test_example_secret',
    baseURL: 'https://payments.test/api/v1',
    fetch: async (url, options) => {
      calls += 1
      seen = { url, options }
      return jsonResponse(201, {
        id: 'pay_1',
        status: 'pending',
        checkout_url: 'https://voybit.com/pay/pub_1',
      }, { 'idempotency-replayed': 'false', 'x-request-id': 'req_1' })
    },
  })

  const created = await client.createPayment({
    asset_id: 'asset',
    crypto_amount: '25.0000',
    amount_minor: 2500,
    fiat_currency: 'USD',
  }, 'order:1001:attempt:1')

  assert.equal(calls, 1)
  assert.equal(created.payment.checkout_url, 'https://voybit.com/pay/pub_1')
  assert.equal(created.replayed, false)
  assert.equal(seen.url, 'https://payments.test/api/v1/gateway/payments')
  assert.equal(seen.options.headers['X-Voybit-Api-Key'], 'vb_test_example_secret')
  assert.equal(seen.options.redirect, 'error')
})

test('createPayment does not retry a validation error', async () => {
  let calls = 0
  const client = createClient({
    apiKey: 'vb_test_example_secret',
    fetch: async () => {
      calls += 1
      return jsonResponse(422, { error: { code: 'asset_unavailable', message: 'That asset is not enabled for this gateway.' } })
    },
  })
  await assert.rejects(
    () => client.createPayment({ asset_id: 'asset' }, 'order:1001:attempt:1'),
    (error) => error instanceof VoybitError && error.code === 'asset_unavailable' && calls === 1,
  )
})

test('createCheckoutSession posts only hosted checkout fields', async () => {
  let seen
  const client = createClient({
    apiKey: 'vb_test_example_secret',
    baseURL: 'https://payments.test/api/v1',
    fetch: async (url, options) => {
      seen = { url, options }
      return jsonResponse(201, {
        session_id: '7155d76a-9f81-40eb-9233-878aac50eb20',
        public_id: 'nYVvXxsYGr5LZk8Dn7hU0Q',
        checkout_url: 'https://voybit.com/pay/nYVvXxsYGr5LZk8Dn7hU0Q',
        status: 'open',
      }, { 'x-request-id': 'req_session_1' })
    },
  })

  const created = await client.createCheckoutSession({
    fiat_amount: '25.00',
    fiat_currency: 'USD',
    description: 'Order 1001',
    metadata: { order_id: '1001' },
    payment_window_seconds: 1800,
    asset_id: 'must-not-be-sent',
    crypto_amount: '25',
  }, 'order:1001:attempt:1')

  assert.equal(seen.url, 'https://payments.test/api/v1/gateway/checkout-sessions')
  assert.deepEqual(JSON.parse(seen.options.body), {
    fiat_amount: '25.00',
    fiat_currency: 'USD',
    description: 'Order 1001',
    metadata: { order_id: '1001' },
    payment_window_seconds: 1800,
  })
  assert.equal(created.checkoutSession.status, 'open')
  assert.equal(created.checkoutSession.session_id, '7155d76a-9f81-40eb-9233-878aac50eb20')
  assert.equal(created.requestId, 'req_session_1')
})

test('createCheckoutSession validates amount, currency, and idempotency', async () => {
  const client = createClient({ apiKey: 'vb_test_example_secret', fetch: async () => jsonResponse(201, {}) })
  await assert.rejects(
    () => client.createCheckoutSession({ fiat_amount: '0', fiat_currency: 'USD' }, 'order:1001:attempt:1'),
    /positive decimal/,
  )
  await assert.rejects(
    () => client.createCheckoutSession({ fiat_amount: '10.00', fiat_currency: 'usd' }, 'order:1001:attempt:1'),
    /three-letter/,
  )
  await assert.rejects(
    () => client.createCheckoutSession({ fiat_amount: '10.00', fiat_currency: 'USD' }, 'short'),
    /Idempotency-Key/,
  )
})

test('verifyWebhook accepts the raw body and rejects a change', () => {
  const raw = Buffer.from('{"type":"payment.paid","status":"paid"}')
  const now = new Date('2026-10-07T16:00:00Z')
  const timestamp = String(Math.floor(now.getTime() / 1000))
  const signature = `v1=${createHmac('sha256', 'whsec_example').update(`delivery-1.${timestamp}.`).update(raw).digest('hex')}`
  const event = verifyWebhook({ secret: 'whsec_example', id: 'delivery-1', timestamp, signature, rawBody: raw, now })
  assert.equal(event.status, 'paid')
  assert.throws(
    () => verifyWebhook({ secret: 'whsec_example', id: 'delivery-1', timestamp, signature, rawBody: Buffer.from(`${raw} `), now }),
    /does not match/,
  )
})

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || '' },
    text: async () => JSON.stringify(body),
  }
}
