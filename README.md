# Voybit payment gateway for Node.js

Create a hosted crypto payment and verify the webhook that reports its result.

Repository: [github.com/VOYBIT/voybit-payment-gateway-node](https://github.com/VOYBIT/voybit-payment-gateway-node)

```js
import { createClient, verifyWebhook } from 'voybit-payment-gateway'
```

Keep `VOYBIT_API_KEY` and `VOYBIT_WEBHOOK_SECRET` on the server. Do not send either one to the browser.

## Create a payment

`POST https://api.voybit.com/api/v1/gateway/payments`

| Header | Required | Meaning |
| --- | --- | --- |
| `X-Voybit-Api-Key` | yes | Secret key from the dashboard. It starts with `vb_test_` or `vb_live_`. |
| `Idempotency-Key` | yes | 8 to 128 characters. Starts with a letter or digit. The rest may be letters, digits, `.`, `_`, `:`, or `-`. Reuse it only for the same request. |
| `Content-Type` | yes | `application/json` |

| Field | Required | Meaning |
| --- | --- | --- |
| `asset_id` | yes | Asset enabled on the gateway. Copy it from the gateway in the dashboard. |
| `crypto_amount` | yes | Exact amount the customer sends, as a decimal string. At most 4 decimal places for TRX, USDT, and USDC, 8 for BTC, and 5 for other assets. |
| `amount_minor` | yes | Fiat amount in minor units. `2500` with `USD` is $25.00. |
| `fiat_currency` | yes | Three-letter code, such as `USD`. |
| `gateway_id` | no | Gateway id. Omit it when the API key is already limited to one gateway. |
| `expires_in_seconds` | no | `300` to `86400`. Voybit uses `900` when this is omitted. |
| `description` | no | Text on hosted checkout, up to 500 characters. |
| `metadata` | no | Your own object, up to 16 KiB. It is not shown to the payer. |

A new payment returns `201`. The same key and the same body return `200` and `Idempotency-Replayed: true`. A reused key with a different body returns `409 idempotency_conflict`.

| Response field | Meaning |
| --- | --- |
| `id` | Payment id. |
| `public_id` | Public id used in the checkout link. |
| `checkout_url` | Hosted checkout page. Send the customer here. |
| `status` | `pending`, `confirming`, `paid`, `overpaid`, `expired`, `underpaid`, `late`, `cancelled`, or `failed`. |
| `expected_amount` | Amount the customer must send. |
| `received_amount` | Amount seen on the network so far. |
| `crypto_asset` | Asset ticker, such as `USDT`. |
| `crypto_network` | Network name, such as `tron`. |
| `deposit_instructions` | Address and exact amount while the invoice can be paid. |
| `expires_at` | When the invoice stops accepting payment. |

Only `paid` and `overpaid` mean the invoice is fully confirmed.

```js
const voybit = createClient({ apiKey: process.env.VOYBIT_API_KEY })
const created = await voybit.createPayment({
  asset_id: process.env.VOYBIT_ASSET_ID,
  crypto_amount: '25.0000',
  amount_minor: 2500,
  fiat_currency: 'USD',
  expires_in_seconds: 1800,
  description: 'Order #1001',
  metadata: { order_id: '1001' },
}, 'order:1001:attempt:1')
```

## Verify a webhook

| Header | Meaning |
| --- | --- |
| `Voybit-Webhook-Id` | Delivery id. Store it and ignore a repeat. |
| `Voybit-Webhook-Timestamp` | Unix seconds. Reject anything older or newer than 5 minutes. |
| `Voybit-Webhook-Signature` | `v1=` plus a hex HMAC-SHA256 of `<id>.<timestamp>.<raw body>`. |

The body field `type` is `payment.` plus the status, for example `payment.created` or `payment.paid`.

```js
const event = await verifyWebhook({
  secret: process.env.VOYBIT_WEBHOOK_SECRET,
  id: request.headers['voybit-webhook-id'],
  timestamp: request.headers['voybit-webhook-timestamp'],
  signature: request.headers['voybit-webhook-signature'],
  rawBody: request.rawBody,
})
```
