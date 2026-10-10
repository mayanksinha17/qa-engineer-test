import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../../server.js';

let authToken;

async function getAuthToken() {
  if (authToken) return authToken;
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'merchant@test.com',
      password: 'Test123!'
    });
  authToken = res.body.token;
  return authToken;
}

test('E-Invoice: Submit invoice successfully with valid SIRET', async () => {
  const token = await getAuthToken();
  const invoiceId = `inv_valid_${Date.now()}`;

  const res = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: '12345678901234'
    });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.invoice_id, invoiceId);
  assert.strictEqual(res.body.data.status, 'submitted');
  assert.ok(res.body.data.submission_id);
});

test('Bug G: Prevent duplicate submission of already submitted invoice', async () => {
  const token = await getAuthToken();
  const invoiceId = `inv_dup_${Date.now()}`;

  // First submission: Succeeds
  const res1 = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: '12345678901234'
    });
  assert.strictEqual(res1.status, 200);

  // Second submission: Should be rejected with 409 Conflict
  const res2 = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: '12345678901234'
    });

  assert.strictEqual(res2.status, 409);
  assert.strictEqual(res2.body.error, 'Invoice already submitted to tax authority');
});

test('E-Invoice: Reject submission with invalid SIRET length (must be 14 digits)', async () => {
  const token = await getAuthToken();
  const res = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: `inv_bad_siret_${Date.now()}`,
      customer_siret: '12345'
    });

  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error.includes('SIRET'));
});

test('E-Invoice: GET /api/einvoice/status/:invoice_id returns status', async () => {
  const token = await getAuthToken();
  const invoiceId = `inv_status_check_${Date.now()}`;

  // Submit invoice
  await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: '12345678901234'
    });

  // Query status
  const res = await request(app)
    .get(`/api/einvoice/status/${invoiceId}`)
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.invoice_id, invoiceId);
  assert.strictEqual(res.body.data.einvoice_status, 'submitted');
});
