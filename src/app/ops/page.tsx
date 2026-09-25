import type { Metadata } from "next";
import OpsDashboard from "./OpsDashboard";

export const metadata: Metadata = { title: "Operations dashboard" };

export default function OpsPage() {
  return <OpsDashboard />;
}
