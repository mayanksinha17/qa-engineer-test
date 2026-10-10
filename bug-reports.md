# Bug Reports — EU Pay QA Engineering Test

This document details all 7 intentional bugs identified, reproduced, and documented within the EU Pay API codebase.

---

## Bug A: Payment Amount Returned as String Instead of Number

**Location:** `src/routes/payment.routes.js` (lines 16, 52)  
**Severity:** Medium  
**Component:** Payment API  

### How to Reproduce
1. Start the server: `npm start`
2. Authenticate to obtain a JWT token:
   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"merchant@test.com","password":"Test123!"}'
   ```
3. Fetch merchant payments with the Bearer token:
   ```bash
   curl http://localhost:3000/api/payments \
     -H "Authorization: Bearer <TOKEN>"
   ```
4. Fetch single payment:
   ```bash
   curl http://localhost:3000/api/payments/1 \
     -H "Authorization: Bearer <TOKEN>"
   ```
5. Inspect the data type of the `amount` field in the response JSON.

### Expected Behavior
The `amount` property should be returned as a numeric type (e.g. `25.5`) in accordance with the API schema and standard financial payload conventions.

### Actual Behavior
The API explicitly casts numeric values to strings: `"amount": "25.5"`.

### Impact
Client applications (such as frontend checkouts or mobile apps) expecting numeric fields will encounter runtime type mismatches, unintended string concatenation errors (e.g., `"25.5" + 5 = "25.55"` instead of `30.5`), or `NaN` errors in calculations.

### Root Cause
In `src/routes/payment.routes.js`:
- Line 16: `amount: p.amount.toString()`
- Line 52: `amount: payment.amount.toString()`
The route handlers explicitly invoked `.toString()` on the stored floating-point values before serialization.

### Suggested Fix
Use `parseFloat(p.amount)` or retain `p.amount` as a number:
```javascript
amount: parseFloat(p.amount)
```

---

## Bug B: Missing Maximum Transaction Amount Validation

**Location:** `src/routes/payment.routes.js` (lines 71-78)  
**Severity:** High  
**Component:** Payment API  

### How to Reproduce
1. Authenticate to acquire a JWT token.
2. Submit a payment creation request with an exorbitant amount:
   ```bash
   curl -X POST http://localhost:3000/api/payments \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"amount": 999999999, "currency": "EUR", "customer_email": "customer@example.com"}'
   ```
3. Observe the response status and payload.

### Expected Behavior
The API should reject transactions exceeding the maximum business ceiling (e.g. €50,000 per transaction limit) with HTTP `400 Bad Request` and an error indicating that the maximum transaction threshold has been exceeded.

### Actual Behavior
The request succeeds with HTTP `201 Created`, storing and creating a payment for €999,999,999.00.

### Impact
Failure to enforce transaction upper limits exposes the payment gateway to catastrophic fraud, money laundering compliance violations, accidental duplicate merchant billing, and uncollateralized chargeback liability.

### Root Cause
The validation block in `POST /api/payments` checks only `amount <= 0` and `isNaN(amount)`, with no boundary check against maximum acceptable transaction values.

### Suggested Fix
Add an explicit upper threshold validation:
```javascript
if (amount > 50000) {
  return res.status(400).json({ error: 'Amount exceeds maximum limit of €50,000' });
}
```

---

## Bug C: Permissive Email Validation Regex Allows Missing TLD

**Location:** `src/routes/auth.routes.js` (lines 10-14)  
**Severity:** Medium  
**Component:** Auth API  

### How to Reproduce
1. Submit a registration request using an email without a Top-Level Domain (TLD) or domain suffix:
   ```bash
   curl -X POST http://localhost:3000/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"user@domain","password":"SecurePassword123!","business_name":"Acme Corp"}'
   ```
2. Observe the HTTP status code.

### Expected Behavior
The registration handler should reject malformed email addresses that lack a valid top-level domain with HTTP `400 Bad Request` (`{"error": "Invalid email format"}`).

### Actual Behavior
The registration succeeds with HTTP `201 Created` and issues an active JWT authentication token.

### Impact
Merchants can register with invalid or unreachable email addresses, resulting in undeliverable transactional receipts, failed password resets, account takeover risks, and corrupted merchant databases.

### Root Cause
`validateEmail()` uses the regular expression `/^[^\s@]+@[^\s@]+$/`. This regex only checks for an `@` character between non-whitespace characters, permitting addresses like `user@domain`, `user@localhost`, or `a@b`.

### Suggested Fix
Update the regex to enforce a domain dot and valid TLD format:
```javascript
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
```

---

## Bug D: Missing Webhook Signature Verification

**Location:** `src/routes/webhook.routes.js` (lines 21-33)  
**Severity:** Critical  
**Component:** Webhook API  

### How to Reproduce
1. Send a payment status webhook request without the `x-webhook-signature` header or with an invalid forged signature:
   ```bash
   curl -X POST http://localhost:3000/api/webhooks/payment-status \
     -H "Content-Type: application/json" \
     -H "x-webhook-signature: forged_signature_123" \
     -d '{"payment_id":"1","status":"completed","event_id":"evt_spoof_1"}'
   ```
2. Observe the HTTP response code and payment record status.

### Expected Behavior
The server must compute the HMAC-SHA256 signature using `WEBHOOK_SECRET` over the serialized payload, compare it with the `x-webhook-signature` header, and reject invalid or missing signatures with HTTP `401 Unauthorized`.

### Actual Behavior
The server responds with HTTP `200 Webhook processed` and updates payment status in the database without any authenticity or integrity verification.

### Impact
Any unauthenticated attacker can forge payment status events, marking arbitrary unpaid orders as `"completed"`, allowing massive theft of goods/services without payment settlement.

### Root Cause
The HMAC verification block in `src/routes/webhook.routes.js` was entirely commented out.

### Suggested Fix
Uncomment and enforce HMAC-SHA256 verification:
```javascript
const expectedSignature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(JSON.stringify(req.body))
  .digest('hex');

if (signature !== expectedSignature) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

---

## Bug E: Missing Webhook Idempotency Check

**Location:** `src/routes/webhook.routes.js` (lines 38-44, 56-57)  
**Severity:** High  
**Component:** Webhook API  

### How to Reproduce
1. Compute a valid signature for a webhook event payload containing an `event_id`.
2. Dispatch the webhook to `POST /api/webhooks/payment-status`.
3. Immediately send the exact same webhook payload and signature a second time.
4. Inspect the HTTP response and payment metadata.

### Expected Behavior
The first request processes the state transition. The second duplicate delivery should be recognized as already processed, returning HTTP `200 OK` with `{ "message": "Already processed" }` without re-triggering business logic.

### Actual Behavior
The second request re-processes the event as a new update, returning `{"message": "Webhook processed"}` and overwriting `payment.webhook_received_at`.

### Impact
External payment processors (e.g., Powens, Stripe, Adyen) employ automatic retry policies upon network latency. Without idempotency, duplicate webhook deliveries can trigger multiple merchant balance credits, double-refunds, duplicate ledger mutations, or redundant event emissions.

### Root Cause
Checking `db.processed_webhooks.includes(event_id)` and recording `db.processed_webhooks.push(event_id)` were both commented out.

### Suggested Fix
Track and verify processed event IDs:
```javascript
if (!db.processed_webhooks) db.processed_webhooks = [];
if (event_id && db.processed_webhooks.includes(event_id)) {
  return res.status(200).json({ message: 'Already processed' });
}
// After processing:
if (event_id) {
  db.processed_webhooks.push(event_id);
}
```

---

## Bug F: Missing Duplicate Table Order Prevention

**Location:** `src/routes/table-order.routes.js` (lines 44-55)  
**Severity:** Medium  
**Component:** Table Orders API  

### How to Reproduce
1. Submit a table order for Table 5 under Merchant 1:
   ```bash
   curl -X POST http://localhost:3000/api/table-orders \
     -H "Content-Type: application/json" \
     -d '{"merchant_id":"1","table_number":5,"items":[{"name":"Steak","price":25,"quantity":1}]}'
   ```
2. Submit a second table order for Table 5 before the first order is fulfilled or confirmed:
   ```bash
   curl -X POST http://localhost:3000/api/table-orders \
     -H "Content-Type: application/json" \
     -d '{"merchant_id":"1","table_number":5,"items":[{"name":"Wine","price":8,"quantity":1}]}'
   ```
3. Observe the response.

### Expected Behavior
If an active order for the same merchant and table number is currently in `'pending'` status, the API should reject duplicate creation with HTTP `409 Conflict` (`{"error": "Table already has a pending order"}`).

### Actual Behavior
The endpoint accepts the second request with HTTP `201 Created`, resulting in multiple simultaneous conflicting pending orders for the same physical restaurant table.

### Impact
Causes duplicate meal preparation in the kitchen, inventory discrepancies, staff confusion, billing conflicts, and customer disputes.

### Root Cause
The validation querying `db.table_orders` for an existing pending order for that table and merchant was commented out.

### Suggested Fix
Uncomment and enforce active pending order checking:
```javascript
const existingOrder = (db.table_orders || []).find(
  o => o.merchant_id === merchant_id && 
       o.table_number === table_number && 
       o.status === 'pending'
);
if (existingOrder) {
  return res.status(409).json({ error: 'Table already has a pending order' });
}
```

---

## Bug G: Missing Duplicate E-Invoice Submission Prevention

**Location:** `src/routes/einvoice.routes.js` (lines 50-58)  
**Severity:** Medium  
**Component:** E-Invoicing API  

### How to Reproduce
1. Submit an invoice to the tax authority via `POST /api/einvoice/submit` with a valid 14-digit SIRET.
2. Submit the same `invoice_id` a second time to `POST /api/einvoice/submit`.
3. Check the response status and status query `GET /api/einvoice/status/:invoice_id`.

### Expected Behavior
If an invoice has already been submitted or accepted by the tax platform (`status === 'submitted' || status === 'accepted'`), duplicate submissions must be rejected with HTTP `409 Conflict` (`{"error": "Invoice already submitted to tax authority"}`).

### Actual Behavior
The request is accepted with HTTP `200 OK`, generating a new submission ID (`SUB-...`) and updating `submitted_at`, allowing arbitrary re-submissions.

### Impact
Submitting identical commercial invoices multiple times to governmental tax authorities (such as the French Chorus Pro / Seqino PDP under B2B e-invoicing mandates) results in tax penalty fees, duplicate VAT declarations, audit rejections, and legal compliance non-conformity.

### Root Cause
The check `if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted')` was commented out.

### Suggested Fix
Uncomment and enforce status verification:
```javascript
if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
  return res.status(409).json({ 
    error: 'Invoice already submitted to tax authority' 
  });
}
```
