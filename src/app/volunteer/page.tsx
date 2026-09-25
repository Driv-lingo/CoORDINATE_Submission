import type { Metadata } from "next";
import VolunteerDashboard from "./VolunteerDashboard";

export const metadata: Metadata = { title: "Volunteer dashboard" };

export default function VolunteerPage() {
  return <VolunteerDashboard />;
}
