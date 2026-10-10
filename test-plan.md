# Test Plan: Webhook Payment Flow

## 1. Test Scope

### In Scope
- End-to-end payment status webhook lifecycle (`POST /api/webhooks/payment-status`).
- Cryptographic signature generation and verification using HMAC-SHA256.
- Idempotency mechanisms and duplicate event handling (`event_id` tracking).
- Payload schema validation, required fields, and data hygiene.
- Payment entity status transitions (`pending` → `completed` / `failed` / `refunded`).
- Security testing: Signature spoofing, timing attacks, replay attacks, payload injections (SQLi, XSS).
- Concurrency and race conditions for simultaneous webhook deliveries.
- Database state persistence and real-time Socket.IO notification triggers.

### Out of Scope
- Frontend user interfaces and checkout widgets.
- Third-party payment provider dashboard internals (Powens, Bridge, Stripe sandbox UI).
- Large-scale volumetric stress/load testing (> 10,000 req/sec).
- Banking settlement networks (SEPA, SWIFT protocol level).

---

## 2. Test Environment

- **Target Application:** Node.js Express API (`http://localhost:3000`).
- **Webhook Simulator:** Automated Node.js test harness (`node:test`, `supertest`), `curl`, and Postman (`postman-collection.json`).
- **Database:** In-memory transactional datastore (`src/db/database.js`), reset per test run to guarantee isolation.
- **Shared Secrets:** `WEBHOOK_SECRET = "test-webhook-secret-key"`.
- **Real-Time Client:** Socket.IO v4 test client (`socket.io-client`).

---

## 3. Test Scenarios (Matrix of 13 Core Scenarios)

| ID | Scenario | Preconditions | Input Data | Expected Result | Priority | Execution Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-WH-01** | Valid webhook with correct signature | Payment `id: 1` in `pending` status | Valid HMAC header, `{ "payment_id": "1", "status": "completed", "event_id": "evt_001" }` | HTTP 200 `{ "success": true }`, payment status updated to `completed` in DB | P0 | **PASS (Automated)** |
| **TC-WH-02** | Webhook with invalid signature | Payment `id: 1` exists | Invalid header `x-webhook-signature: bad_sig`, valid JSON payload | HTTP 401 `{ "error": "Invalid signature" }`, payment status unchanged | P0 | **PASS (Automated)** |
| **TC-WH-03** | Webhook with missing signature header | Payment `id: 1` exists | No `x-webhook-signature` header provided | HTTP 401 `{ "error": "Invalid signature" }`, payment status unchanged | P0 | **PASS (Automated)** |
| **TC-WH-04** | Duplicate webhook (same `event_id`) | First webhook processed successfully | Exact duplicate payload and signature sent again | HTTP 200 `{ "message": "Already processed" }`, no secondary side effects | P1 | **PASS (Automated)** |
| **TC-WH-05** | Webhook for non-existent payment | Payment ID `99999` not in DB | Valid signature, `{ "payment_id": "99999", "status": "completed", "event_id": "evt_005" }` | HTTP 404 `{ "error": "Payment not found" }` | P1 | **PASS (Automated)** |
| **TC-WH-06** | Webhook arrives before payment created | Payment creation pending in async queue | Valid signature, payment_id not yet committed | HTTP 404 or queued for retry until payment record exists | P2 | **NOT RUN (Design/Manual)** |
| **TC-WH-07** | Multiple webhooks for same payment | Payment `id: 1` exists | Webhook 1: `status: "processing"`, Webhook 2: `status: "completed"` | First webhook sets `processing` (200), second sets `completed` (200) | P1 | **NOT RUN (Design/Manual)** |
| **TC-WH-08** | Webhook with missing required fields | Payment exists | Valid signature, body `{ "event_id": "evt_008" }` (missing `payment_id`, `status`) | HTTP 400 `{ "error": "payment_id and status required" }` | P1 | **PASS (Automated)** |
| **TC-WH-09** | Webhook with malformed JSON syntax | Server running | Broken JSON syntax payload | HTTP 400 or HTTP 500 handled gracefully without server crash | P1 | **NOT RUN (Design/Manual)** |
| **TC-WH-10** | Concurrent webhooks (Race condition) | Payment exists | 10 identical webhook requests dispatched simultaneously in parallel | Exactly 1 request executes full update (200), others return "Already processed" | P1 | **NOT RUN (Design/Manual)** |
| **TC-WH-11** | SQL injection in `payment_id` | Payment exists | `payment_id: "1' OR '1'='1"`, valid HMAC | Handled safely as non-existent payment (404), no injection vulnerability | P0 | **NOT RUN (Design/Manual)** |
| **TC-WH-12** | Webhook signature timing attack | Secret configured | Signatures with varying character similarity matching prefix | Constant-time comparison ensures no timing leak in signature check | P1 | **NOT RUN (Design/Manual)** |
| **TC-WH-13** | Webhook replay attack with old event | Payment exists | Valid signature on historical event delivered hours/days later | Rejected if timestamp verification window (>5 mins) is enforced | P2 | **NOT RUN (Design/Manual)** |

---

## 4. Security Tests

### 4.1 Signature Verification (HMAC-SHA256)
- **Objective:** Ensure all inbound webhooks are signed using the shared secret and that tampering with any field in the request body invalidates the signature.
- **Method:**
  - Compute `crypto.createHmac('sha256', secret).update(body).digest('hex')`.
  - Mutate one byte of the payload after signing (e.g. changing `"amount": 10` to `"amount": 100`).
  - Verify server rejects the payload with HTTP 401.

### 4.2 Replay Attack Prevention
- **Objective:** Prevent malicious actors from intercepting and replaying valid past webhooks.
- **Method:**
  - Combine event ID tracking with timestamp assertions (e.g., `x-webhook-timestamp` header).
  - Verify events older than 300 seconds are rejected even if the signature is mathematically valid.

### 4.3 Injection Resistance (SQLi & XSS)
- **Objective:** Protect persistence tier and client dashboards from malicious payloads.
- **Method:**
  - Test `payment_id` payloads containing `' OR 1=1 --`, `DROP TABLE payments;`.
  - Test `status` field containing `<script>alert('xss')</script>`.
  - Confirm inputs are treated as literal strings and properly sanitized upon rendering.

### 4.4 Constant-Time Signature Comparison
- **Objective:** Prevent side-channel timing attacks where attackers infer bytes of the signature based on response latency.
- **Method:**
  - Recommend `crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))` for production deployments.

---

## 5. Edge Cases

1. **Extremely Large `payment_id`:** String length > 10,000 characters to test buffer overflow and JSON parser memory limits.
2. **Unicode & Special Characters:** `status` or metadata containing UTF-8 emojis (`"status": "completed 💶✅"`), null bytes (`\0`), or RTL override characters.
3. **Null / Empty `event_id`:** Webhook delivered with `event_id: null` or `event_id: ""` — ensure system rejects or handles idempotency gracefully without storing `null` keys.
4. **Future Timestamps:** Payloads containing timestamps from the year 2099 to ensure timestamp validation does not accept future-dated events.

---

## 6. Integration Tests

### 6.1 Webhook → Database Persistence Flow
1. Verify initial database payment record: `id: "2"`, `status: "pending"`.
2. Post valid webhook with `status: "completed"`.
3. Read database record directly or via `GET /api/payments/2`.
4. Assert status is `"completed"` and `webhook_received_at` is a valid ISO date.

### 6.2 Webhook → Socket.IO Real-Time Notification Flow
1. Connect Socket.IO test client and join merchant room `merchant_1`.
2. Send webhook updating payment for merchant 1.
3. Verify client receives `payment_updated` / `order_status_changed` event with updated status payload within 500ms.

### 6.3 Retry Logic & Delivery Failure
1. Simulate 500 Internal Server Error (e.g. database down).
2. Validate webhook receiver responds with HTTP 500/503 so upstream provider enters exponential backoff retry.
3. Restore database and verify eventual consistent recovery on subsequent retry.

---

## 7. Risk Assessment & Mitigation

| Production Risk | Likelihood | Impact | Detection Mechanism | Mitigation Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **Spoofed Webhook Attacks** | Medium | Critical | Alert on spikes of HTTP 401 webhook responses | Strict HMAC-SHA256 signature verification; IP allowlisting for payment provider CIDR blocks |
| **Duplicate Payment Crediting** | High | High | Audit logs showing multiple balance updates for single transaction | Event ID idempotency table with unique database constraint (`UNIQUE(event_id)`) |
| **Webhook Delivery Race Conditions** | Medium | Medium | Inconsistent status logs (e.g. `completed` before `created`) | Optimistic locking, version numbers on payment entities, FIFO message queues (AWS SQS FIFO) |
| **Unprocessed Webhook Backlog** | Low | High | CloudWatch metric for webhook processing latency & dead-letter queue (DLQ) depth | Asynchronous webhook ingestion: ack quickly with 202, process via background worker queue |

---

## 8. Architectural & Concurrency Limitations (Disclosure)

The current implementation in `src/routes/webhook.routes.js` operates against the project's educational in-memory store (`db.processed_webhooks`). The following architectural boundaries and concurrency limitations are explicitly noted:

1. **Non-Durable Idempotency State:** Idempotency history is held in a volatile Node.js JavaScript array (`db.processed_webhooks = []`). When the Node.js server process restarts, crashes, or deploys a new revision, all previously processed `event_id` records are erased. An upstream webhook redelivery arriving post-restart will be re-processed.
2. **Lack of Distributed State:** In a production architecture featuring horizontal scaling (such as multiple containers behind an AWS ALB), each container maintains an isolated memory heap. An event processed on instance A would not be recognized by instance B, permitting duplicate processing across instances.
3. **Concurrency Race Conditions (Check-Then-Act):** The code inspects `db.processed_webhooks.includes(event_id)` and later executes `db.processed_webhooks.push(event_id)`. Because this check-then-act sequence is not wrapped in an atomic compare-and-swap or transactional mutex, concurrent requests for the exact same event received in parallel could both pass the initial check before either record is appended.
4. **Production Recommendation:** A production financial gateway requires an external transactional store (e.g., PostgreSQL table with `UNIQUE(event_id)` constraint or Redis `SET event_id <val> NX EX 86400`) providing atomic check-and-set semantics and multi-region durability.
