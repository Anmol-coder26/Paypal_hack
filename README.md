# PunchPay 2.1

**Every fix has its own payment.** *Review the work. Decide what gets paid.*

PunchPay is an AI-assisted repair-evidence verification and **PayPal task-level payment settlement** workspace built for the PayPal AI Hackathon 2026. Homeowners fund independent PayPal Orders v2 authorizations (`intent: "AUTHORIZE"`) per repair task, contractors submit before-and-after photographic evidence, multimodal Vision AI provides advisory findings against agreed criteria, and homeowners explicitly trigger PayPal Payments v2 **Capture** or **Void** decisions.

> **PayPal Authorization Disclosure:** PunchPay uses **PayPal Sandbox** temporary payment authorizations (up to 29-day validity with an initial 3-day honor period). PunchPay is **not** an escrow service. Local **Simulation mode** runs strictly offline when PayPal Sandbox keys are absent and never moves real money.

---

## PayPal Settlement Lifecycle (Task-Scoped & Verified)

Every repair task maintains an isolated financial state machine paired with direct PayPal v2 API verification:

```text
[1. Order Created] ──▶ [2. Buyer Approved] ──▶ [3. Authorized Hold] ──┬──▶ Accept & Capture ($30.00) ──▶ CAPTURED
 POST /v2/checkout/orders   PayPal Checkout Popup   POST .../authorize │    POST /v2/payments/authorizations/{id}/capture
 (intent: "AUTHORIZE",      (Personal Sandbox Acct)                    │
  payee: PAYPAL_MERCHANT_ID)                                           └──▶ Reject & Void ($20.00) ────▶ VOIDED
                                                                            POST /v2/payments/authorizations/{id}/void

                         ▲ GET Reconciliation & Proof ▲
  GET /v2/checkout/orders/{id} · GET /v2/payments/authorizations/{id} · GET /v2/payments/captures/{id}
```

- **Payee & Currency Guards:** Every order, authorization, capture, and void checks `PAYPAL_MERCHANT_ID`, `currency_code === "USD"`, integer minor-unit totals, and parent-order/authorization linkage (`lib/payments/paypal-client.ts`).
- **Idempotency & Crash Recovery:** Every mutating PayPal call uses stable `PayPal-Request-Id` keys recorded in `idempotency_operations`. Dropped requests enter `RECONCILIATION_REQUIRED` and resolve via `GET` reconciliation (`/api/tasks/[id]/reconcile`).
- **Visible Provenance:** Every task card (`/projects/[id]`), `/payments` panel, `/tasks/[id]` detail view, and `/ledger` row displays the 4-step `PaymentLifecycleTimeline`, exact provider IDs (`paypal_order_id`, `paypal_authorization_id`, `paypal_capture_id`), and `PayPal Sandbox` vs. `Simulation · No money moved` badges.

---

## Core Architecture & Capabilities

- **3-Tier Advisory AI Inspection (`lib/ai/provider.ts`)**:
  1. **Gemini Live Vision (`gemini-3.5-flash`)** — Server-side multimodal before/after image comparison, Zod-validated 9-part structured findings, explicit limitations, and contextual Q&A (`/api/tasks/[id]/ask`).
  2. **Local Ollama Vision (`OLLAMA_MODEL`, e.g. `qwen2.5vl:3b`)** — Automatic offline fallback when a local Ollama vision daemon is reachable at `OLLAMA_BASE_URL`.
  3. **Guided Review Checklist (`POST /api/tasks/[id]/guided-review`)** — Honest human-authored structured checklist fallback when no vision model is available; never claims AI inspected photos.
- **Encrypted Admin AI Vault (`/settings`, `lib/security/secrets-vault.ts`)**: Admin-only workspace storing Gemini keys encrypted at rest with AES-256-GCM (`.data/.vault/credential-master.key` or `PUNCHPAY_CREDENTIAL_ENCRYPTION_KEY`); plaintext secrets never return to browser clients.
- **Role-Based Auth & Private Evidence (`/login`, `/api/evidence/[id]`)**: HMAC-SHA256 HTTP-only cookie sessions with scrypt password hashing across Homeowner, Contractor, and System Administrator roles. Uploaded photos are validated via `sharp`, EXIF-stripped, stored outside `public/`, and compared side-by-side with click-to-drop synchronized pins, wipe slider, onion-skin overlay, and `2×` zoom.
- **PayPal Fault-Recovery Lab (`/playground`)**: Separated simulator demonstrating split settlement, network timeout recovery (`RECONCILIATION_REQUIRED` -> `GET` reconcile), double-click idempotency, and payee mismatch guards.
- **Dual Persistence (`lib/db/`)**: Zero-config local SQLite (`node:sqlite` at `.data/punchpay.db`) or optional Supabase PostgreSQL + private Storage (`supabase/migrations/`).

---

## Quick Local Setup & Real PayPal Sandbox Configuration

```bash
npm install
cp .env.example .env.local
```

### 1. Configure PayPal Sandbox (`.env.local`)
Create a **Sandbox Business** account (contractor/payee) and **Sandbox Personal** account (homeowner/payer) in [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/), then set in `.env.local` (gitignored):

```ini
PAYMENT_MODE=paypal_sandbox
PAYPAL_CLIENT_ID=<sandbox_rest_app_client_id>
PAYPAL_CLIENT_SECRET=<sandbox_rest_app_secret>
NEXT_PUBLIC_PAYPAL_CLIENT_ID=<sandbox_rest_app_client_id>
PAYPAL_MERCHANT_ID=<sandbox_business_account_merchant_id>
# Optional for webhook signature verification:
PAYPAL_WEBHOOK_ID=<sandbox_webhook_id>
```

### 2. Configure Gemini AI Credentials (Recommended: Encrypted Admin Vault)
Sign in as **System Administrator** on `/login`, open **Settings (`/settings`)**, paste a valid Google AI Studio `GEMINI_API_KEY`, select `gemini-3.5-flash`, and click **Test Connection**. *(Alternatively set `GEMINI_API_KEY` and `GEMINI_MODEL=gemini-3.5-flash` in `.env.local`.)*

### 3. Run & Verify

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run dev
```

Open `http://localhost:3000`. Optional PayPal CLI smoke verification (`GET`-verified `$30` capture + `$20` void):

```bash
npm run sandbox:create
# Open both printed PayPal approval URLs and approve with your Sandbox Personal buyer account
npm run sandbox:settle
npm run sandbox:verify
```

---

## Documentation

- [Setup & Migration Guide](docs/SETUP.md)
- [Architecture Overview](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [3-Minute Demo Script](DEMO-SCRIPT.md)
- [License (MIT)](LICENSE)

---

## Verification Status

| Area | Check / Mode | Result | Evidence |
|---|---|---|---|
| **Lint & TypeScript** | `npm run lint`, `npm run typecheck` | **PASS** | `eslint .` (0 errors), `tsc --noEmit` |
| **Unit & Integration Suite** | `npm test` (mocked PayPal HTTP) | **PASS (21/21 across 6 files)** | `tests/*.test.ts` |
| **Security Boundary Probes** | `security-probe.mjs` | **PASS (6/6)** | Hosted fail-closed, RBAC, EXIF/magic-byte check, webhook `503` guard |
| **Playwright Browser E2E** | `npm run test:e2e` (Desktop + Mobile) | **PASS (4/4)** | `e2e/punchpay.spec.ts`, `docs/screenshots/` |
| **Live Gemini Vision (`gemini-3.5-flash`)** | Multimodal inspection & Q&A | **PASS (verified via Admin Vault)** | Live before/after analysis + Q&A persisted in SQLite (`07`–`09` screenshots); rotated key replacement pending user |
| **Live PayPal Sandbox End-to-End** | Real `/v2/checkout/orders` & `payments` | **Pending Sandbox Keys** | `.env.local` PayPal variables currently empty |
