"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { notifyChanged } from "@/lib/api";
import { signInAs } from "@/lib/persona";
import { useSystem } from "./SystemProvider";
import { Button, Callout } from "./ui";

/**
 * Coordinator pages: a resident persona is switched automatically (a resident
 * would never be on the EOC dashboard); a volunteer persona sees a read-only
 * notice with a one-click switch.
 */
export function CoordinatorOnlyNotice({ what }: { what: string }) {
  const sys = useSystem();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const switchTo = async () => {
    setBusy(true);
    try {
      if (await signInAs("coordinator")) {
        router.refresh();
        notifyChanged();
      }
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (sys.persona.kind !== "resident") return;
    // Silent: in a shared operation this needs a passcode, so the notice's button is used instead.
    void signInAs("coordinator", { silent: true }).then((ok) => {
      if (!ok) return;
      router.refresh();
      notifyChanged();
    });
  }, [sys.persona.kind, router]);

  if (sys.persona.kind === "coordinator") return null;
  return (
    <Callout tone="info">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          You are acting as <strong>{sys.persona.name}</strong>. {what} are coordinator-only (rule R-D02).
        </span>
        <Button size="sm" variant="secondary" busy={busy} onClick={() => void switchTo()}>
          Act as coordinator
        </Button>
      </div>
    </Callout>
  );
}
