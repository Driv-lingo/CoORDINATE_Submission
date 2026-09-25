import type { Metadata } from "next";
import ResidentStatus from "@/app/request/[id]/ResidentStatus";

export const metadata: Metadata = { title: "Your request (exercise)" };

export default async function DemoRequestStatus(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <ResidentStatus id={id} />;
}
