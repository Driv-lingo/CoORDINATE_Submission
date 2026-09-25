import type { Metadata } from "next";
import Preparedness from "./Preparedness";

export const metadata: Metadata = { title: "Preparedness" };

export default function PreparednessPage() {
  return <Preparedness />;
}
