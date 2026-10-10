# EU Pay QA Engineer Assignment — Submission Summary

## Approach Overview

For this technical assessment, I adopted a test-driven QA engineering methodology by first conducting an architectural audit and developing automated regression tests using Node.js's native test runner (`node:test`) and `supertest` to reliably reproduce all 7 intentional bugs. 

Minimal, production-grade fixes were implemented across authentication, payment processing, webhook HMAC verification and idempotency, table orders, and B2B e-invoicing without modifying public API contracts. 

The complete automated test suite (27 tests across 5 test suites covering happy paths, negative boundaries, concurrency, and security scenarios) passes with 100% success (`27/27 passed`), and the built-in bug verification script confirms 0/7 bugs remaining. 

Comprehensive documentation has been authored in `bug-reports.md`, `fixes.md`, and an end-to-end `test-plan.md` addressing webhook security, idempotency, edge cases, and risk mitigation strategies.
