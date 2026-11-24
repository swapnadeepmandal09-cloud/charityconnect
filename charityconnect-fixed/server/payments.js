import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

/** Demo provider: NOTHING here moves money. Everything it creates is flagged simulated. */
export class DemoProvider {
  name = 'demo';
  simulated = true;
  async createSession({ orderId }) {
    return {
      providerReference: 'demo_' + randomUUID(), status: 'PENDING',
      paymentInstructions: { simulated: true, upiId: 'demo@charityconnect', orderId,
        note: 'SIMULATED PAYMENT - no real money is transferred. Use the demo buttons to choose an outcome.' },
    };
  }
  async getPaymentStatus() { return { status: 'PENDING' }; }
}

/**
 * YouPI-PG adapter. Webhook verification is implemented against the contract in the repo README.
 * Session creation is intentionally NOT implemented: the REST endpoints live in openapi.yaml, which was
 * not reviewed, and endpoints must not be invented. See docs/PAYMENT_ASSESSMENT.md.
 */
export class YoupiProvider {
  name = 'youpi';
  simulated = false;
  async createSession() {
    const e = new Error('YouPI-PG session creation is not wired: review openapi.yaml and implement apps/payment-api calls first.');
    e.code = 'PROVIDER_NOT_READY'; throw e;
  }
  async getPaymentStatus() { return { status: 'PENDING' }; }
}

export const getProvider = (mode) => (mode === 'youpi' ? new YoupiProvider() : new DemoProvider());

/** HMAC-SHA256 over the RAW body, constant-time compare. header format: "sha256=<hex>" */
export function verifySignature(rawBody, header, secret) {
  if (!secret || !header) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(String(header)), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const TRANSITIONS = {
  PENDING: ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED', 'UNDER_REVIEW'],
  UNDER_REVIEW: ['SUCCESS', 'FAILED'],
  SUCCESS: ['REFUNDED'],
  FAILED: [], CANCELLED: [], EXPIRED: [], REFUNDED: [],
};
