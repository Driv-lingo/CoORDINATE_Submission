import { ArrowRight, BookOpen, Compass, HandHeart, LayoutDashboard, Package, PlayCircle, Radio, Route, Siren, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/AppHeader";

const PATH_EXAMPLES = [
  { icon: <BookOpen className="h-4 w-4" />, need: "“Can FEMA help with the damage?”", path: "Trusted information & referral", note: "With the declaration condition stated honestly" },
  { icon: <Siren className="h-4 w-4" />, need: "“The wires are sparking in the yard”", path: "Professional emergency response", note: "No community mission is created" },
  { icon: <UserRound className="h-4 w-4" />, need: "“We lost everything and don't know where to start”", path: "Human escalation", note: "A caseworker gets a handoff summary" },
  { icon: <Users className="h-4 w-4" />, need: "“Food for my homebound neighbor”", path: "Community mission", note: "Qualified, verified volunteers — if requested" },
  { icon: <Package className="h-4 w-4" />, need: "“The shelter needs a generator connected”", path: "Resource transfer", note: "Equipment + a licensed electrician" },
  { icon: <Radio className="h-4 w-4" />, need: "“Water is over Riverland Rd”", path: "Situational awareness", note: "Restricts routes once corroborated" },
];

export default function Home() {
  return (
    <div>
      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-[1.25fr_1fr] md:py-16">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#7cc4ff]">
              <Logo className="h-6 w-6" /> Disaster Assistance Navigator · Microsoft &amp; CCI Innovation Challenge for Virginia
            </div>
            <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight md:text-5xl">
              CoORDINATE
              <br />
              <span className="text-[#7cc4ff]">From chaos to coordinated action.</span>
            </h1>
            <p className="mt-4 max-w-xl text-lg text-slate-200">
              CoORDINATE combines real-time disaster conditions, trusted assistance, community needs, and available capabilities to help people understand what to do
              next—and coordinate the right response when community action is appropriate.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/request" className="inline-flex items-center gap-2 rounded-md bg-[#f5b400] px-5 py-3 font-bold text-ink hover:bg-amber-400">
                <Compass className="h-5 w-5" /> GET HELP
              </Link>
              <Link href="/volunteer" className="inline-flex items-center gap-2 rounded-md border border-white/30 px-5 py-3 font-semibold hover:bg-white/10">
                <HandHeart className="h-5 w-5" /> OFFER HELP OR RESOURCES
              </Link>
              <Link href="/ops" className="inline-flex items-center gap-2 rounded-md border border-white/30 px-5 py-3 font-semibold hover:bg-white/10">
                <LayoutDashboard className="h-5 w-5" /> OPEN OPERATIONS
              </Link>
            </div>
            <Link href="/demo" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#7cc4ff] hover:underline">
              <PlayCircle className="h-4 w-4" /> Guided judge demo (under 3 minutes)
            </Link>
          </div>
          <div className="space-y-3 self-center rounded-xl bg-ink-2 p-5 ring-1 ring-white/10">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-400">One request, start to finish</div>
            {[
              { i: <Compass className="h-4 w-4" />, t: "Navigate the person", s: "Understand the situation, put safety first, give trusted guidance and services with their sources" },
              { i: <Route className="h-4 w-4" />, t: "Resolve each need", s: "Every need gets a path: information, referral, a human handoff, professional response — or community action" },
              { i: <Users className="h-4 w-4" />, t: "Coordinate the response", s: "Only where appropriate and requested: capability-matched teams, routed and continuously reassessed" },
            ].map((x, idx) => (
              <div key={x.t} className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white">{x.i}</span>
                <div>
                  <div className="font-semibold">
                    {idx + 1}. {x.t}
                  </div>
                  <div className="text-sm text-slate-300">{x.s}</div>
                </div>
              </div>
            ))}
            <p className="rounded-md bg-white/5 px-3 py-2 text-xs text-slate-300 ring-1 ring-white/10">
              Azure AI Foundry understands the words. Deterministic rules decide what happens. People make the calls — CoORDINATE never contacts 911 or dispatches anyone on its own.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="text-2xl font-bold text-ink">Not every need should become a dispatch</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-line bg-white p-5">
            <div className="text-xs font-bold uppercase tracking-wide text-muted">A traditional assistance navigator</div>
            <p className="mt-2 font-mono text-sm text-ink">Need → information / resource recommendation</p>
            <p className="mt-2 text-sm text-muted">Tells people where help might be. The person still has to make it happen.</p>
          </div>
          <div className="rounded-lg border-2 border-brand bg-brand-soft p-5">
            <div className="text-xs font-bold uppercase tracking-wide text-brand">CoORDINATE</div>
            <p className="mt-2 font-mono text-sm leading-relaxed text-ink">
              Need → trusted guidance → the right resolution path → referral / human escalation / professional response / capability-matched community action →
              continuous operational reassessment
            </p>
            <p className="mt-2 text-sm text-ink">Tells people what to do — and, where community resources are the right answer, safely makes it happen.</p>
          </div>
        </div>

        <h3 className="mt-8 text-lg font-bold text-ink">Every need gets its own resolution path</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PATH_EXAMPLES.map((p) => (
            <div key={p.path} className="rounded-lg border border-line bg-white p-4">
              <p className="text-sm text-ink">{p.need}</p>
              <p className="mt-1 flex items-center gap-1.5 font-semibold text-brand">
                {p.icon} {p.path}
              </p>
              <p className="text-xs text-muted">{p.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-4 rounded-lg border border-line bg-white p-5 text-sm md:grid-cols-4">
          <div>
            <div className="font-bold text-ink">Innovation</div>
            <p className="text-muted">Navigator → orchestrator: need decomposition, resolution paths and capability-aware team formation — not a chatbot.</p>
          </div>
          <div>
            <div className="font-bold text-ink">Performance</div>
            <p className="text-muted">Guidance in seconds; request → verified mission in minutes, re-planned as roads close and warnings arrive.</p>
          </div>
          <div>
            <div className="font-bold text-ink">Economic &amp; societal value</div>
            <p className="text-muted">Sends needs to existing programs first, and mobilizes idle community capacity where they fall short.</p>
          </div>
          <div>
            <div className="font-bold text-ink">Feasibility</div>
            <p className="text-muted">Deterministic safety rules, sourced directory, Azure-native deployment, honest simulation labels.</p>
          </div>
        </div>
        <p className="mt-6 text-sm text-muted">
          Want the details?{" "}
          <Link href="/how-it-works" className="font-semibold text-brand underline">
            See exactly how AI and rules share the work
          </Link>{" "}
          <ArrowRight className="inline h-3.5 w-3.5" />
        </p>
      </section>
    </div>
  );
}
