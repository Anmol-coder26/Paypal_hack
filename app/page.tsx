import Link from "next/link";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  CreditCard,
  FileCheck2,
  Lock,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0b1324] text-white">
              <ShieldCheck className="h-4 w-4 text-blue-400" />
            </span>
            <span className="text-base font-semibold tracking-tight text-slate-900">
              PunchPay
            </span>
            <span className="hidden sm:inline-block rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              PayPal Sandbox
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#problem" className="hover:text-slate-900">
              Why PunchPay
            </a>
            <a href="#how-it-works" className="hover:text-slate-900">
              How It Works
            </a>
            <a href="#preview" className="hover:text-slate-900">
              Architecture
            </a>
          </nav>

          <div className="flex items-center gap-2.5">
            <Link
              href="/login"
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Sign In
            </Link>
            <Link
              href="/login?demo=1"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-blue-700"
            >
              Start a Project
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                <span className="h-2 w-2 rounded-full bg-blue-600" />
                Every fix has its own payment. Every payment has a reason.
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl leading-[1.1]">
                Pay for the work that&apos;s done.{" "}
                <span className="text-blue-600">Not the work that isn&apos;t.</span>
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
                PunchPay combines AI-powered repair evidence reviews with PayPal&apos;s
                Orders and Payments infrastructure, helping homeowners and contractors
                authorize, verify, and settle each repair task independently.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  href="/login?demo=1"
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
                >
                  Start a Project
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Explore How It Works
                </a>
              </div>
              <p className="text-xs text-slate-500">
                Built on PayPal Sandbox Orders v2 (AUTHORIZE) &amp; Payments v2
                (Capture / Void). Temporary payment holds — not escrow.
              </p>
            </div>

            {/* Live Component Preview Card */}
            <div className="lg:col-span-5" id="preview">
              <div className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-xl">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-400">
                      Split-Task Settlement Model
                    </p>
                    <p className="text-sm font-semibold text-white">
                      Oak Street Closeout · $50.00 Authorized
                    </p>
                  </div>
                  <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-mono-code text-slate-300">
                    2 PayPal Holds
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">
                        1. Painting Touch-Up
                      </span>
                      <span className="font-mono-code text-sm font-semibold text-emerald-300">
                        $30.00
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-300">
                      AI Evidence Review: All 3 criteria supported in before/after photos
                    </p>
                    <div className="mt-2.5 flex items-center justify-between text-[11px]">
                      <span className="inline-flex items-center gap-1 text-emerald-300 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Homeowner Accepted → Captured
                      </span>
                      <span className="font-mono-code text-slate-400">PAYPAL CAPTURE</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">
                        2. Kitchen Tile Repair
                      </span>
                      <span className="font-mono-code text-sm font-semibold text-slate-200">
                        $20.00
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-300">
                      AI Evidence Review: Alignment offset &amp; visible grout gap detected
                    </p>
                    <div className="mt-2.5 flex items-center justify-between text-[11px]">
                      <span className="inline-flex items-center gap-1 text-red-300 font-medium">
                        <XCircle className="h-3.5 w-3.5" />
                        Homeowner Rejected → Voided
                      </span>
                      <span className="font-mono-code text-slate-400">PAYPAL VOID</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem vs Solution */}
      <section id="problem" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-red-600">
              The Problem
            </p>
            <h2 className="mt-2 text-xl font-bold text-slate-900">
              All-or-nothing lump sums create disputes
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              When a contractor finishes painting properly ($30) but leaves a cracked or
              misaligned kitchen tile ($20), a single $50 invoice forces an unfair choice:
              overpay for unfinished work or withhold everything from the contractor.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
              The PunchPay Architecture
            </p>
            <h2 className="mt-2 text-xl font-bold text-slate-900">
              Task-level PayPal authorizations + human authority
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Each punch-list fix receives its own PayPal Orders v2 authorization hold.
              Multimodal AI inspects submitted before-and-after photos strictly against
              agreed criteria — and the homeowner retains 100% control over capture or void.
            </p>
          </div>
        </div>
      </section>

      {/* Three-Step Workflow */}
      <section
        id="how-it-works"
        className="border-t border-slate-200 bg-white py-16 px-4 sm:px-6"
      >
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
              Authorize → Verify → Settle
            </p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">
              Three steps from punch list to verified settlement
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              {
                icon: CreditCard,
                step: "01 · Authorize",
                title: "Separate PayPal holds per task",
                desc: "Homeowner creates repair tasks with exact USD amounts and approves individual PayPal sandbox authorizations (up to 29-day validity, 3-day honor period).",
              },
              {
                icon: Camera,
                step: "02 · Verify",
                title: "Photo evidence + AI inspection",
                desc: "Contractor submits stripped, verified before-and-after photos. Multimodal AI checks visible criteria and explicitly highlights uncertainty or missing views.",
              },
              {
                icon: FileCheck2,
                step: "03 · Settle",
                title: "Independent capture or void",
                desc: "Homeowner accepts completed fixes to capture via PayPal Payments v2, requests corrections without moving money, or rejects to void the hold.",
              },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.step}
                  className="rounded-2xl border border-slate-200 bg-slate-50/70 p-6"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-blue-600">
                    {card.step}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {card.desc}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-12 flex flex-col items-start justify-between gap-4 rounded-2xl bg-[#0b1324] p-8 text-white sm:flex-row sm:items-center">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-300">
                <Sparkles className="h-3.5 w-3.5" />
                Ready to run the live workflow
              </div>
              <h3 className="text-xl font-bold">
                Launch the Homeowner or Contractor Console
              </h3>
              <p className="text-sm text-slate-300">
                Sign in with our sandbox demonstration accounts or create your own project.
              </p>
            </div>
            <Link
              href="/login?demo=1"
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500 shrink-0"
            >
              <Lock className="h-4 w-4" />
              Enter Sandbox Console
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-slate-50 py-8 px-4 text-center text-xs text-slate-500">
        PunchPay 2.0 · PayPal AI Hackathon · Uses PayPal Sandbox APIs only — temporary
        authorizations, not escrow or live money movement.
      </footer>
    </div>
  );
}
