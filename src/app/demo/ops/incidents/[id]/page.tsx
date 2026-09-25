import type { Metadata } from "next";
import IncidentWorkbench from "@/app/ops/incidents/[id]/IncidentWorkbench";

export const metadata: Metadata = { title: "Incident workbench (exercise)" };

export default async function DemoIncidentPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <IncidentWorkbench id={id} />;
}
