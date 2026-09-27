import { describe, expect, it } from 'vitest';
import { verifyStripeSignature } from '../../src/routes/billing';

const SECRET = 'whsec_test';
const PAYLOAD = '{"id":"evt_1","type":"customer.subscription.updated"}';

async function sign(timestamp: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${PAYLOAD}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

describe('verifyStripeSignature', () => {
  const now = 1_780_000_000;

  it('accepts a fresh, correctly signed event', async () => {
    expect(await verifyStripeSignature(PAYLOAD, await sign(now - 10), SECRET, now)).toBe(true);
  });

  it('rejects a correctly signed event replayed after the tolerance window', async () => {
    expect(await verifyStripeSignature(PAYLOAD, await sign(now - 3600), SECRET, now)).toBe(false);
  });

  it('rejects a tampered payload', async () => {
    expect(await verifyStripeSignature(`${PAYLOAD} `, await sign(now), SECRET, now)).toBe(false);
  });
});
