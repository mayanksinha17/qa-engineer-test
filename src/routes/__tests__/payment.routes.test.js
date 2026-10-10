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

test('Bug A: GET /api/payments returns amount as a number', async () => {
  const token = await getAuthToken();
  const res = await request(app)
    .get('/api/payments')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.data.length > 0);
  assert.strictEqual(typeof res.body.data[0].amount, 'number', 'amount must be of type number');
  assert.strictEqual(res.body.data[0].amount, 25.5);
});

test('Bug A: GET /api/payments/:id returns amount as a number', async () => {
  const token = await getAuthToken();
  const res = await request(app)
    .get('/api/payments/1')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(typeof res.body.data.amount, 'number', 'amount must be of type number');
  assert.strictEqual(res.body.data.amount, 25.5);
});

test('Bug B: POST /api/payments should reject amount over €50,000 with 400', async () => {
  const token = await getAuthToken();
  const res = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 999999999,
      currency: 'EUR',
      customer_email: 'customer@example.com'
    });

  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error, 'Should return error property');
  assert.ok(res.body.error.toLowerCase().includes('maximum'), 'Error should mention maximum amount');
});

test('Payment: POST /api/payments creates payment with valid amount <= 50,000', async () => {
  const token = await getAuthToken();
  const res = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 49.99,
      currency: 'EUR',
      customer_email: 'newcustomer@test.com'
    });

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(typeof res.body.data.amount, 'number');
  assert.strictEqual(res.body.data.amount, 49.99);
});

test('Payment: POST /api/payments rejects non-positive amount', async () => {
  const token = await getAuthToken();
  const resZero = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 0,
      currency: 'EUR',
      customer_email: 'customer@example.com'
    });
  assert.strictEqual(resZero.status, 400);

  const resNeg = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: -25,
      currency: 'EUR',
      customer_email: 'customer@example.com'
    });
  assert.strictEqual(resNeg.status, 400);
});

test('Payment: GET /api/payments requires authentication', async () => {
  const res = await request(app).get('/api/payments');
  assert.strictEqual(res.status, 401);
});
