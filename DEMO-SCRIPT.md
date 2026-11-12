# PunchPay 2.1 — 3-Minute Demo Storyboard

**Core Narrative:** *Every fix has its own payment. Review the work. Decide what gets paid.*
A homeowner creates **Kitchen Renovation Closeout ($50.00)** across two independent tasks (**Painting — $30.00** and **Tile Repair — $20.00**). Gemini Vision supports the homeowner's review, while only the homeowner executes settlement decisions through PayPal Sandbox (`AUTHORIZE -> CAPTURE / VOID`) or clearly labeled offline Simulation.

---

## Storyboard (3:00 Total)

### 0:00 – 0:25 · Landing, Mode Banner & Project Setup (`/`, `/login`, `/dashboard`)
1. Open `/` and highlight the header environment indicator (`PayPal Sandbox · Test transactions` when `.env.local` has Sandbox credentials, or `Simulation · No money moved` offline).
2. Click **Start a Project** -> sign in as **Demo Homeowner** (`/login`).
3. Show the **Repair Projects** ledger table and launch **Continue Guided Demo ($50)** (`Kitchen Renovation Closeout`).

### 0:25 – 0:55 · Two Independent Authorizations (`/projects/[id]`, `/payments`)
1. On `/projects/[id]`, point out the two separate **$30.00 Painting** and **$20.00 Tile Repair** task cards and their prominent 4-step **Payment Lifecycle Timeline** (`Order Created -> Buyer Approved -> Authorized Hold -> Captured / Voided`).
2. Authorize **Painting ($30.00)** and **Tile Repair ($20.00)** independently via the PayPal Sandbox buyer popup (creating distinct `paypal_order_id` and `paypal_authorization_id` holds—never combined in a single capture).

### 0:55 – 1:35 · Contractor Evidence Upload & Gemini Vision Inspection (`/contractor`, `/tasks/[id]`)
1. Click **Switch to Demo Contractor** in the sidebar.
2. Select **Painting**: load **Sample Before** (scuffed wall by window) and **Sample After** (`public/demo-kit/painting-after.png`, cleanly and evenly repainted wall), then click **Run AI Inspection**.
   - Gemini (`gemini-3.5-flash`) evaluates the photos honestly against the painting acceptance criteria (`Coverage looks uniform`, `No obvious unpainted patches`, `Edges appear clean`).
3. Select **Tile Repair**: load **Sample Before** (cracked backsplash tile) and **Sample After** (`public/demo-kit/tile-after-issue.png`, new uncracked tile visibly tilted with an open dark grout gap), optionally drop Before/After pins, and trigger inspection.
   - Gemini (`gemini-3.5-flash`) notes the cracked tile was replaced while flagging misalignment and incomplete grouting.

### 1:35 – 2:25 · Homeowner Decision & Independent PayPal Capture / Void (`/tasks/[id]`)
1. Click **Switch to Demo Homeowner** and open **Painting (`/tasks/[id]`)**:
   - Inspect Before vs. After with **Side by side / Wipe / Overlay / 2× Zoom**.
   - Ask a follow-up question in **Ask about this inspection** (e.g., *"What happens if I accept this repair?"*).
   - Click **Accept & Capture $30.00** -> confirm in the modal -> shows `CAPTURED` with `paypal_capture_id`.
2. Open **Tile Repair (`/tasks/[id]`)**:
   - Review the flagged open right-edge grout gap and tilted replacement tile.
   - Click **Reject & Void Hold** -> confirm explicitly in the modal -> shows `VOIDED` (`$20.00` authorization released without charging the buyer).

### 2:25 – 3:00 · Settlement Statement, Ledger & GET Reconciliation (`/projects/[id]`, `/ledger`, `/playground`)
1. Return to `/projects/[id]` to show the **Final Settlement Statement**: **$50.00 Agreed · $30.00 Captured · $20.00 Voided** with separate PayPal Order / Authorization / Capture IDs.
2. Open `/ledger`, press **Reload (`F5`)** to verify SQLite/Supabase persistence, open the **Transaction Record Drawer**, click **Reconcile Status** (runs PayPal `GET` verification), and export CSV.
3. Briefly show `/playground` (PayPal Fault-Recovery Lab) or `/settings` (3-Tier AI Readiness & Encrypted Vault) to wrap up.
