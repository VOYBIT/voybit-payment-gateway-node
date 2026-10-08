# Voybit payment gateway for Node.js

## Get an API key

1. Create an account at [dashboard.voybit.com](https://dashboard.voybit.com).
2. Open **Gateways**, create a payment gateway, enable the assets customers may choose, and store its webhook secret as `VOYBIT_WEBHOOK_SECRET`.
3. Open **API keys**, choose **Create secret key**, and bind it to that gateway. Copy the full `vb_live_…` value once and store it as `VOYBIT_API_KEY` on your server.

Create a payment and verify its webhook. Keep the API key and webhook secret on your server.

```js
import { createClient, verifyWebhook } from 'voybit-payment-gateway'
```

TypeScript declarations are included.

## Create a buyer-choice checkout

`POST https://api.voybit.com/api/v1/gateway/checkout-sessions`

| Header | |
| --- | --- |
| `X-Voybit-Api-Key` | Gateway API key. |
| `Idempotency-Key` | 8–128 characters: letters, digits, `.` `_` `:` `-`. Reuse it only with the same body. |

| Field | |
| --- | --- |
| `fiat_amount` | Required positive decimal string, such as `25.00`. |
| `fiat_currency` | Required: `USD`, `EUR`, or `GBP`. |
| `payment_window_seconds` | Optional. 300–86400. Default 900. |
| `description` | Optional. Maximum 500 characters. |
| `metadata` | Optional object. Maximum 16 KiB. |

A new payment returns `201`. The same key and body return `200`. A different body returns `409`.

Send the payer to `checkout_url`. The payer chooses from the gateway’s enabled assets, reviews a live conversion, and confirms before Voybit creates the address and QR. Fulfil an order only when `status` is `paid` or `overpaid`.

```js
const voybit = createClient({ apiKey: process.env.VOYBIT_API_KEY })
const created = await voybit.createCheckoutSession({
  fiat_amount: '25.00',
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
