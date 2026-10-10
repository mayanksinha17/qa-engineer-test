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

test('Table Order: Create new table order successfully', async () => {
  const tableNum = 101;
  const res = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNum,
      items: [
        { name: 'Pasta Carbonara', price: 14.5, quantity: 2 },
        { name: 'Sparkling Water', price: 3.0, quantity: 1 }
      ],
      customer_name: 'John Doe',
      order_type: 'dine_in'
    });

  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.data.table_number, tableNum);
  assert.strictEqual(res.body.data.status, 'pending');
  assert.strictEqual(res.body.data.total, 32.0);
});

test('Bug F: Prevent duplicate pending order for the same table', async () => {
  const tableNum = 202;

  // First order: Creates pending order
  const res1 = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNum,
      items: [{ name: 'Pizza Margherita', price: 12.0, quantity: 1 }],
      customer_name: 'Table User 1'
    });
  assert.strictEqual(res1.status, 201);

  // Second order while first is still pending: Should be rejected with 409 Conflict
  const res2 = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNum,
      items: [{ name: 'Espresso', price: 2.5, quantity: 1 }],
      customer_name: 'Table User 2'
    });

  assert.strictEqual(res2.status, 409);
  assert.strictEqual(res2.body.error, 'Table already has a pending order');
});

test('Table Order: Empty items array rejected with 400', async () => {
  const res = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: 303,
      items: []
    });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'Order must have at least one item');
});

test('Table Order: Update order status to confirmed allows new pending order', async () => {
  const token = await getAuthToken();
  const tableNum = 404;

  // Create initial order
  const resOrder = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNum,
      items: [{ name: 'Burger', price: 15.0, quantity: 1 }]
    });
  assert.strictEqual(resOrder.status, 201);
  const orderId = resOrder.body.data.id;

  // Transition initial order to 'confirmed'
  const resPatch = await request(app)
    .patch(`/api/table-orders/${orderId}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'confirmed' });
  assert.strictEqual(resPatch.status, 200);
  assert.strictEqual(resPatch.body.data.status, 'confirmed');

  // Now a new order for the same table should be allowed
  const resNewOrder = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNum,
      items: [{ name: 'Dessert', price: 6.0, quantity: 1 }]
    });
  assert.strictEqual(resNewOrder.status, 201);
});
