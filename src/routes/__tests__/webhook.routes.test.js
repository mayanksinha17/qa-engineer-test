import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import request from 'supertest';
import app from '../../server.js';

const WEBHOOK_SECRET = 'test-webhook-secret-key';

function generateSignature(body) {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
}

test('Bug D: Webhook should reject request with missing signature header', async () => {
  const payload = {
    payment_id: '1',
    status: 'completed',
    event_id: 'evt_no_sig_1'
  };

  const res = await request(app)
    .post('/api/webhooks/payment-status')
    .send(payload);

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'Invalid signature');
});

test('Bug D: Webhook should reject request with invalid signature', async () => {
  const payload = {
    payment_id: '1',
    status: 'completed',
    event_id: 'evt_bad_sig_1'
  };

  const res = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', 'invalid-tampered-signature')
    .send(payload);

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'Invalid signature');
});

test('Bug D: Webhook processes successfully when signature is valid', async () => {
  const payload = {
    payment_id: '1',
    status: 'completed',
    event_id: `evt_valid_${Date.now()}`
  };
  const signature = generateSignature(payload);

  const res = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.message, 'Webhook processed');
});

test('Bug E: Webhook idempotency - duplicate event_id returns "Already processed"', async () => {
  const eventId = `evt_idempotent_${Date.now()}`;
  const payload = {
    payment_id: '1',
    status: 'completed',
    event_id: eventId
  };
  const signature = generateSignature(payload);

  // First call: Should succeed
  const res1 = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(res1.status, 200);
  assert.strictEqual(res1.body.message, 'Webhook processed');

  // Second call with same event_id: Should recognize as duplicate
  const res2 = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(res2.status, 200);
  assert.strictEqual(res2.body.message, 'Already processed');
});

test('Webhook: Non-existent payment returns 404', async () => {
  const payload = {
    payment_id: '999999',
    status: 'completed',
    event_id: `evt_404_${Date.now()}`
  };
  const signature = generateSignature(payload);

  const res = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error, 'Payment not found');
});

test('Webhook: Missing required fields returns 400', async () => {
  const payload = {
    event_id: `evt_missing_${Date.now()}`
  };
  const signature = generateSignature(payload);

  const res = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(res.status, 400);
});
