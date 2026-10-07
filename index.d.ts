export const DEFAULT_BASE_URL: string

export class VoybitError extends Error {
  status: number
  code: string
  requestId: string
  constructor(status: number, code: string, message: string, requestId?: string)
}

export interface CreatePaymentRequest {
  asset_id: string
  crypto_amount: string
  amount_minor: number
  fiat_currency: string
  gateway_id?: string
  expires_in_seconds?: number
  description?: string
  metadata?: Record<string, unknown>
}

export interface Payment {
  id?: string
  public_id?: string
  status?: string
  checkout_url?: string
  amount_minor?: number
  fiat_currency?: string
  crypto_asset?: string
  crypto_network?: string
  expected_amount?: string
  received_amount?: string
  deposit_instructions?: {
    status?: string
    address?: string
    payment_uri?: string
    amount?: string
    asset?: string
    network?: string
    message?: string
  }
  [key: string]: unknown
}

export interface CreatedPayment {
  payment: Payment
  replayed: boolean
  requestId: string
}

export interface PaymentGatewayClient {
  createPayment(request: CreatePaymentRequest, idempotencyKey: string): Promise<CreatedPayment>
}

export function createClient(options: {
  apiKey: string
  baseURL?: string
  fetch?: typeof fetch
}): PaymentGatewayClient

export function verifyWebhook(input: {
  secret: string
  id: string
  timestamp: string
  signature: string
  rawBody: Uint8Array | string
  now?: Date
}): Payment
