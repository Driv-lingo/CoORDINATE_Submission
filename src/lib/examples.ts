import type { IntakeValues } from "@/components/IntakeForm";

/** Example requests used by the resident page and the guided demo. */
export const EXAMPLES: { key: string; label: string; values: Partial<IntakeValues>; tone?: "danger" }[] = [
  {
    key: "tree",
    label: "Tree, power out, nowhere to stay",
    values: {
      text: "A tree fell across our driveway and the power is out. Nobody is hurt, but we can't get out and my mother uses a wheelchair. We don't know where we can stay tonight or whether FEMA can help with the damage.",
      locationText: "Cave Spring, Roanoke County",
      peopleAffected: "2",
      reporterName: "Denise",
      reporterRelation: "SELF",
    },
  },
  {
    key: "powerline",
    label: "Sparking power line",
    tone: "danger",
    values: {
      text: "There is a sparking power line down in our front yard after the storm. A tree is on it. We are inside and nobody is hurt.",
      locationText: "Raleigh Court, Roanoke",
      peopleAffected: "3",
      reporterRelation: "SELF",
    },
  },
  {
    key: "basement",
    label: "Flooded basement, father can't use stairs",
    values: {
      text: "My basement is flooding and my father can't walk up the stairs.",
      locationText: "Garden City, Roanoke",
      peopleAffected: "2",
      reporterRelation: "FAMILY",
    },
  },
  {
    key: "recovery",
    label: "Lost everything",
    values: {
      text: "Our apartment was destroyed and we lost everything. I don't know where to start and I'm so overwhelmed.",
      locationText: "Salem",
      peopleAffected: "3",
      reporterRelation: "SELF",
    },
  },
];
