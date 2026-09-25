import type { Metadata, Viewport } from "next";
import { AppHeader, type PersonaOption } from "@/components/AppHeader";
import { RealtimeBridge } from "@/components/RealtimeBridge";
import { SiteFooter } from "@/components/SiteFooter";
import { SystemProvider, type SystemBundle } from "@/components/SystemProvider";
import { SCENARIO, seedResponders } from "@/data/seed";
import { LIVE_WS } from "@/data/mode";
import { browserSandbox, getCtx, getCtxFor } from "@/server/context";
import { coordinatorPasscodeConfigured } from "@/server/session";
import { providerStatus } from "@/server/views";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CoORDINATE — From chaos to coordinated action", template: "%s · CoORDINATE" },
  description:
    "CoORDINATE combines real-time disaster conditions, community needs, and available capabilities to turn requests for help into safe, coordinated response missions. Disaster Assistance Navigator prototype — Microsoft & CCI Innovation Challenge for Virginia.",
};

export const viewport: Viewport = { themeColor: "#0b1f33", width: "device-width", initialScale: 1 };

const PERSONAS: PersonaOption[] = [
  { value: "coordinator", label: `${SCENARIO.coordinator.name} (EOC)`, group: "Coordinator" },
  { value: "resident", label: SCENARIO.resident.name, group: "Resident" },
  ...seedResponders(new Date())
    .filter((r) => r.kind === "PERSON")
    .map((r) => ({ value: r.id, label: r.name, group: "Volunteers" as const })),
];

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Both modes' sign-in state: the root layout persists across client navigation between /demo and the live pages.
  const current = await getCtx();
  const sandbox = await browserSandbox();
  const [demo, live] = await Promise.all([
    current.ws === LIVE_WS ? getCtxFor(sandbox, { ensure: false }) : current,
    current.ws === LIVE_WS ? current : getCtxFor(LIVE_WS),
  ]);
  const own = (await live.repo.listResponders(LIVE_WS)).find((r) => r.ownerKey === sandbox);
  const sys: SystemBundle = {
    demo: { ...providerStatus(demo.ws), persona: demo.persona },
    live: {
      ...providerStatus(LIVE_WS),
      persona: live.persona,
      passcodeRequired: coordinatorPasscodeConfigured(),
      ownVolunteer: own ? { id: own.id, name: own.name } : undefined,
    },
  };
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <SystemProvider value={sys}>
          <AppHeader personas={PERSONAS} />
          <RealtimeBridge />
          <main id="main" tabIndex={-1} className="outline-none">
            {children}
          </main>
          <SiteFooter />
        </SystemProvider>
      </body>
    </html>
  );
}
