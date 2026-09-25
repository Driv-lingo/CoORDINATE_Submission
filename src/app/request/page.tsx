import type { Metadata } from "next";
import ResidentRequest from "./ResidentRequest";

export const metadata: Metadata = { title: "Get help" };

export default function RequestPage() {
  return <ResidentRequest />;
}
