# PunchPay — Final 3-Minute Interactive Demo Script

**Active Demo Configuration:** `PUNCHPAY_DEMO_MODE=true` · `PAYMENT_MODE=simulation` · `AI_PROVIDER=demo`  
**Local URL:** `http://localhost:3000`

---

## 0:00 – 0:25 | Positioning & Calm Fintech Overview
1. Open `http://localhost:3000` (`/`).
2. Point out the tagline: **"Pay for the work that's done. Not the work that isn't."** and the 2-task split-settlement preview (`$30.00 Painting` vs `$20.00 Tile Repair`).
3. Click **Start a Project** (or go to `/login`) and click **Demo Homeowner** (Elena Vance).
4. Highlight the persistent header badges in the workspace:
   - **Demo environment · Payments simulated**
   - **Sample inspection · Prepared + Guided**

---

## 0:25 – 1:05 | Authorize Two Independent Payment Holds (`Kitchen Renovation Closeout`)
1. From `/dashboard`, click **Continue Guided Demo** (or **Reset Demo** if you want a clean starting state; note **Reset Demo** only resets guided demo data and preserves custom projects).
2. Open **Kitchen Renovation Closeout** (`$50.00` across `$30.00 Painting` + `$20.00 Tile Repair`).
3. Click **Authorize $30.00** on **Painting**:
   - Point out the buyer-approval confirmation panel (**Repair Task**, **Contractor**, **Hold Amount**, **What authorization means**).
   - Click **Create $30.00 Demo Order** (`DEMO-ORD-*` appears), then click **Confirm Buyer Approval ($30.00 Hold)** (`DEMO-AUTH-*` appears).
4. Repeat on **Tile Repair ($20.00)** so both holds are independently authorized.

---

## 1:05 – 1:45 | Contractor Evidence Upload & Interactive Comparison
1. Click **Switch to Demo Contractor** (Marcus Rivera) in the sidebar.
2. Select **Painting · Kitchen Renovation Closeout**:
   - In **Demo Photo Kit**, click **Load Sample Before** and **Load Sample After**.
   - Click **Drop Pin** on the before/after images to add visual callout pins (e.g., `#1 Original scuff documented`, `#2 Uniform repaint verified`).
   - Switch between **Side by side**, **Wipe**, **Overlay**, and **2×** zoom to inspect alignment.
3. Select **Tile Repair · Kitchen Renovation Closeout**:
   - Click **Load Sample Before** and **Load Sample After** (cracked backsplash before -> aligned tile with minor visible grout gap concern after).

---

## 1:45 – 2:35 | Homeowner Inspection, Prepared Demo + Guided Fallback & Settlement
1. Click **Switch to Demo Homeowner** -> open **Kitchen Renovation Closeout**.
2. Open **Painting ($30.00)** -> click **Run Inspection**:
   - Show the **Sample inspection · Prepared findings** badge (clearly non-live prepared findings, 0 external API calls).
   - Click a quick question (e.g., *"What happens if I reject this repair?"*) to see honest simulation guidance.
   - Click **Accept & Capture $30.00** -> confirm capture -> `DEMO-CAP-*` is recorded.
3. Return to the project -> open **Tile Repair ($20.00)** -> click **Run Inspection**:
   - Prepared findings highlight the visible corner/grout gap concern against the agreed criteria.
   - Click **Reject & Void Hold** -> confirm void -> `DEMO-VOID-*` releases the `$20.00` hold cleanly.
4. *(Optional arbitrary-photo demonstration)*: Upload any non-kit PNG on a custom project task and run inspection to show PunchPay rejecting unverified canned verdicts and switching cleanly to **Guided Review — Visual assessment by homeowner** with the 4-prompt domain checklist.

---

## 2:35 – 3:00 | Final Settlement Statement, Ledger & Architecture Transparency
1. Back on **Kitchen Renovation Closeout**, show the **Final Settlement Statement**:
   - **Total Agreed:** `$50.00` | **Demo Captured:** `$30.00` | **Demo Voided:** `$20.00` | **Outstanding Authorized:** `$0.00`.
2. Open **Settlement Ledger** (`/ledger`) to show persistent `Simulation` rows (`DEMO-CAP-*`, `DEMO-VOID-*`) and **Export CSV**.
3. Open **Settings** (`/settings`) to show the active diagnostics (`Simulation Mode`, `Mode C · Prepared Demo & Guided`, local SQLite, and preserved Mode A/B/PayPal live configuration standby).
