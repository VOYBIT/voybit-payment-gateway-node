# Voybit payment gateway for Node.js

Create a payment and verify its webhook. Keep the API key and webhook secret on your server.

```js
import { createClient, verifyWebhook } from 'voybit-payment-gateway'
```

## Create a payment

`POST https://api.voybit.com/api/v1/gateway/payments`

| Header | |
| --- | --- |
| `X-Voybit-Api-Key` | Gateway API key. |
| `Idempotency-Key` | 8–128 characters: letters, digits, `.` `_` `:` `-`. Reuse it only with the same body. |

| Field | |
| --- | --- |
| `asset_id` | Required. Asset enabled on the gateway. |
| `crypto_amount` | Required. Decimal string, not a JSON number. |
| `amount_minor` | Required. Fiat amount in minor units. `2500` is 25.00. |
| `fiat_currency` | Required. Three letters, such as `USD`. |
| `gateway_id` | Optional. Omit it when the key is already scoped to one gateway. |
| `expires_in_seconds` | Optional. 300–86400. Default 900. |
| `description` | Optional. Maximum 500 characters. |
| `metadata` | Optional object. Maximum 16 KiB. |

A new payment returns `201`. The same key and body return `200`. A different body returns `409`.

Send the payer to `checkout_url`. Fulfil an order only when `status` is `paid` or `overpaid`.

```js
const voybit = createClient({ apiKey: process.env.VOYBIT_API_KEY })
const created = await voybit.createPayment({
  asset_id: process.env.VOYBIT_ASSET_ID,
  crypto_amount: '25.0000',
  amount_minor: 2500,
  fiat_currency: 'USD',
  description: 'Order 1001',
  metadata: { order_id: '1001' },
}, 'order:1001:attempt:1')
```

## Webhook

Read the raw body and verify it before parsing. The signature is `v1=` plus HMAC-SHA256 of `<id>.<timestamp>.<raw body>`, using the gateway webhook secret.

| Header | |
| --- | --- |
| `Voybit-Webhook-Id` | Delivery id. Ignore a repeat. |
| `Voybit-Webhook-Timestamp` | Unix seconds. Reject values outside 5 minutes. |
| `Voybit-Webhook-Signature` | `v1=` and the hex signature. |

`type` is `payment.` plus the status, for example `payment.paid`.

```js
const event = await verifyWebhook({
  secret: process.env.VOYBIT_WEBHOOK_SECRET,
  id: request.headers['voybit-webhook-id'],
  timestamp: request.headers['voybit-webhook-timestamp'],
  signature: request.headers['voybit-webhook-signature'],
  rawBody: request.rawBody,
})
```
