import type { Metadata } from "next";
import LiveDashboard from "./LiveDashboard";

export const metadata: Metadata = { title: "Live Virginia" };

/** /live — real Virginia feeds only (NWS first). The simulated exercise lives at /demo. */
export default function LivePage() {
  return <LiveDashboard />;
}
