import type { Metadata } from "next";
import ResidentStatus from "./ResidentStatus";

export const metadata: Metadata = { title: "Your request" };

export default async function Page(props: PageProps<"/request/[id]">) {
  const { id } = await props.params;
  return <ResidentStatus id={id} />;
}
