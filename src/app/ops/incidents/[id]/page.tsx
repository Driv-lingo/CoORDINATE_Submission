import type { Metadata } from "next";
import IncidentWorkbench from "./IncidentWorkbench";

export const metadata: Metadata = { title: "Incident workbench" };

export default async function IncidentPage(props: PageProps<"/ops/incidents/[id]">) {
  const { id } = await props.params;
  return <IncidentWorkbench id={id} />;
}
