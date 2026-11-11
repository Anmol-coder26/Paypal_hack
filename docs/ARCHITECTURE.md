# PunchPay 2.0 Architecture

PunchPay separates **work completion tracking** from **PayPal payment settlement** at the individual repair-task level.

## System Components

1. **Next.js App Router Frontend & API (`app/`)**
   - Server-backed session authentication (`punchpay_session` HMAC-SHA256 HTTP-only cookie bound to `sessions` table).
   - Separate role-enforced workspaces for **Homeowner** (`/dashboard`, `/projects/new`, `/projects/[id]`, `/payments`, `/reviews`, `/ledger`) and **Contractor** (`/contractor`, `/tasks/[id]`).
   - Private evidence streaming route (`/api/evidence/[id]`) enforcing project membership before returning image bytes.

2. **Financial State Machine (`lib/payments/state-machine.ts`)**
   - Payment lifecycle: `DRAFT -> ORDER_CREATED / BUYER_APPROVAL_PENDING -> AUTHORIZED -> CAPTURE_PENDING -> CAPTURED` (or `VOID_PENDING -> VOIDED`, plus `AUTHORIZATION_EXPIRED`, `PAYMENT_FAILED`, `RECONCILIATION_REQUIRED`).
   - Work lifecycle (tracked independently): `PENDING_EVIDENCE -> BEFORE_SUBMITTED -> EVIDENCE_SUBMITTED -> AI_REVIEWED -> CORRECTIONS_REQUESTED -> ACCEPTED | REJECTED`.

3. **PayPal Sandbox Integration (`lib/payments/paypal-client.ts`, `lib/payments/service.ts`)**
   - Strictly pinned to `https://api-m.sandbox.paypal.com`.
   - Orders v2 (`intent: "AUTHORIZE"`) with explicit `payee.merchant_id` validation against `PAYPAL_MERCHANT_ID`.
   - Payments v2 (`authorizations/{id}/capture`, `authorizations/{id}/void`) protected by persistent `idempotency_operations` and stable `PayPal-Request-Id` headers.
   - GET-based status reconciliation (`POST /api/tasks/[id]/reconcile`) and verified PayPal webhook handler (`POST /api/webhooks/paypal`).

4. **Multimodal AI Inspection (`lib/ai/provider.ts`)**
   - Server-side integration supporting **Google Gemini** (`GEMINI_API_KEY`) and **Anthropic Claude** (`ANTHROPIC_API_KEY`) with strict Zod schema output validation.
   - Evaluates submitted before/after image bytes against agreed acceptance criteria and surfaces explicit limitations/uncertainty.
   - AI output is strictly advisory; AI never triggers PayPal captures or voids.

5. **Dual Persistence Layer (`lib/db/`)**
   - Automatically selects **Supabase PostgreSQL + Private Storage** (`supabase/migrations/20261111000000_punchpay_v2.sql`) when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present.
   - Falls back cleanly to zero-config local **SQLite (`node:sqlite` at `.data/punchpay.db`)** + private `.data/evidence/` storage so projects, tasks, uploads, and sessions persist across refreshes during local evaluation.
