import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../../server.js';

test('Auth: Register new merchant with valid data', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email: `valid_${Date.now()}@testmerchant.com`,
      password: 'SecurePassword123!',
      business_name: 'Valid Merchant Ltd'
    });

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.message, 'Registration successful');
  assert.ok(res.body.token);
  assert.strictEqual(res.body.user.business_name, 'Valid Merchant Ltd');
});

test('Bug C: Should reject email without TLD (e.g. user@domain)', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'user@domain',
      password: 'SecurePassword123!',
      business_name: 'No TLD Business'
    });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'Invalid email format');
});

test('Bug C: Should reject invalid email formats missing domain or @', async () => {
  const res1 = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'notanemail',
      password: 'SecurePassword123!',
      business_name: 'Invalid Email Business'
    });
  assert.strictEqual(res1.status, 400);

  const res2 = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'test@.com',
      password: 'SecurePassword123!',
      business_name: 'Invalid Email Business'
    });
  assert.strictEqual(res2.status, 400);
});

test('Auth: Should reject registration with short password (< 8 chars)', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email: `shortpass_${Date.now()}@merchant.com`,
      password: '123',
      business_name: 'Short Pass Inc'
    });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'Password must be at least 8 characters');
});

test('Auth: Should reject duplicate email registration with 409', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'merchant@test.com', // Already seeded in database
      password: 'Test123!password',
      business_name: 'Duplicate Merchant'
    });

  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error, 'Email already registered');
});

test('Auth: Login with valid credentials returns JWT token', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'merchant@test.com',
      password: 'Test123!'
    });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.message, 'Login successful');
  assert.ok(res.body.token);
  assert.strictEqual(res.body.user.email, 'merchant@test.com');
});

test('Auth: Login with invalid credentials returns 401', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'merchant@test.com',
      password: 'WrongPassword!'
    });

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'Invalid credentials');
});
