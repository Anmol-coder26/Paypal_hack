# PunchPay 2.1 — 3-Minute Guided Demo Script

**Core story:** *Every fix has its own payment. Review the work. Decide what gets paid.* A homeowner creates **Kitchen Renovation Closeout ($50)** across two independent repairs (**Painting — $30** and **Tile Repair — $20**). PunchPay keeps payment mode explicitly visible (**PayPal Sandbox · Test transactions** when configured, or **Simulation · No money moved** offline).

## Shot-by-Shot Storyboard (3:00)

1. **0:00 – 0:25 · Landing & Overview (`/`, `/login`, `/dashboard`)**
   - Open `/` (*"Pay for the work that's done. Not the work that isn't."*) and click **Start a Project** → **Demo Homeowner**.
   - Highlight the top bar's restrained environment badge (`Simulation · No money moved` or `PayPal Sandbox · Test transactions`) and structured **Repair Projects** table.

2. **0:25 – 0:55 · Create Kitchen Closeout & Authorize Independent Holds**
   - Click **Continue Guided Demo ($50)** (creates *Kitchen Renovation Closeout*: **Painting $30.00** + **Tile Repair $20.00**).
   - Authorize **Painting ($30.00)** and **Tile Repair ($20.00)** independently (via PayPal Sandbox popup when live credentials are configured, or via the 2-step **Simulated Checkout** approval flow offline).
   - Point out the compact **Created → Buyer Approved → Authorized Hold → Captured / Voided** lifecycle on each task card.

3. **0:55 – 1:35 · Contractor Evidence Upload & Inspection**
   - Click **Switch to Demo Contractor** in the sidebar.
   - In **Contractor Workspace**, select **Painting**, click **Load Sample Before** and **Load Sample After** (processed cleanly through `sharp` magic-byte sanitization), and run **Run AI Inspection** (uses local Ollama `qwen2.5vl:3b` or Gemini/Claude when active; clearly shows **Manual Checklist Mode** if offline).
   - Select **Tile Repair**, load **Sample Before** (cracked tile) + **Sample After** (misaligned tile with open dark grout gap), optionally drop a Before/After inspection pin (`#1`/`#2`), and submit.

4. **1:35 – 2:25 · Homeowner Evidence Review, Q&A & Independent Settlement**
   - Click **Switch to Demo Homeowner** and open **Kitchen Renovation Closeout**.
   - Open **Painting (`/tasks/[id]`)**: drag the **Before ⟷ After** wipe slider (`2×` zoom + synchronized pins), inspect **Assessment / What the photos show / Acceptance criteria / Limitations**, ask **"What happens if I reject this repair?"** in **Ask about this inspection**, then click **Accept & Capture $30.00**.
   - Open **Tile Repair (`/tasks/[id]`)**: examine the open right-edge grout gap, ask **"Which acceptance criteria are still unmet?"**, and click **Reject & Void Hold** ($20.00 hold released without charging).

5. **2:25 – 3:00 · Settlement Statement, Ledger & Fault-Recovery Proof**
   - Return to `/projects/[id]` to show the **Final Settlement Statement** (`$50.00` Agreed · `$30.00` Captured · `$20.00` Voided) with explicit `Source` and reference IDs.
   - Open `/ledger`, press **Reload (`F5`)** to prove SQLite/Supabase persistence, open the **Transaction Record Drawer**, and click **Export CSV**.
   - Briefly show `/playground` (PayPal Fault-Recovery Lab) to demonstrate safe timeout recovery via `GET` reconciliation.
