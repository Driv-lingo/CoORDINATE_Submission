import type { Metadata } from "next";
import GuidedDemo from "./GuidedDemo";

export const metadata: Metadata = { title: "Guided demo" };

export default function DemoPage() {
  return <GuidedDemo />;
}
