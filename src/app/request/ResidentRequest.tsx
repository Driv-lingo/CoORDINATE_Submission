"use client";

import { HeartHandshake } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { IntakeForm } from "@/components/IntakeForm";
import { useSystem, useModeHref } from "@/components/SystemProvider";
import { Card } from "@/components/ui";
import { api } from "@/lib/api";
import { EXAMPLES } from "@/lib/examples";

export default function ResidentRequest() {
  const mh = useModeHref();
  const router = useRouter();
  const sys = useSystem();
  // Exercise: the resident page acts as the resident persona (simulated sign-in). The live operation
  // keeps whoever is signed in (a coordinator may file on someone's behalf).
  useEffect(() => {
    if (sys.mode === "demo" && sys.persona.kind !== "resident") void api("/api/persona", { body: { persona: "resident" } }).then(() => router.refresh());
  }, [sys.mode, sys.persona.kind, router]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-lg bg-brand p-2 text-white">
          <HeartHandshake className="h-6 w-6" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink">Get help</h1>
          <p className="text-muted">
            Tell us what&apos;s happening in your own words. You&apos;ll get clear next steps right away, trusted services near you, and — when community help is right for your situation — the option to ask for it.
          </p>
        </div>
      </div>
      <Card className="p-4 sm:p-6">
        <IntakeForm examples={sys.mode === "demo" ? EXAMPLES : []} onSubmitted={(i) => router.push(mh(`/request/${i.id}`))} />
      </Card>
    </div>
  );
}
