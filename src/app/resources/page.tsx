import type { Metadata } from "next";
import ResourcesBoard from "./ResourcesBoard";

export const metadata: Metadata = { title: "Community capacity" };

export default function ResourcesPage() {
  return <ResourcesBoard />;
}
