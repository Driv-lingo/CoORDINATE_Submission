import {
  AlertOctagon,
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  CircleDot,
  Compass,
  Clock,
  HardHat,
  Info,
  Loader,
  ShieldAlert,
  Truck,
  Users,
} from "lucide-react";
import { HAZARD_LABELS, INCIDENT_STATUS_LABELS, MISSION_STATUS_LABELS, PRIORITY_LABELS, TRIAGE_LABELS } from "@/domain/catalog";
import type { DisplayStatus } from "@/domain/dto";
import type { Hazard, MissionStatus, PriorityLevel, TriageLevel } from "@/domain/types";
import { cn } from "@/lib/format";
import { Pill } from "./ui";

export const PRIORITY_STYLE: Record<PriorityLevel, string> = {
  P1: "bg-life text-white",
  P2: "bg-pro text-white",
  P3: "bg-trained-soft text-trained ring-1 ring-trained/30",
  P4: "bg-slate-100 text-slate-700 ring-1 ring-slate-300",
};

export function PriorityBadge({ level, className }: { level: PriorityLevel; className?: string }) {
  return (
    <Pill className={cn(PRIORITY_STYLE[level], "font-bold", className)} title={`Priority ${level} — ${PRIORITY_LABELS[level]}`}>
      {level}
      <span className="sr-only"> — {PRIORITY_LABELS[level]}</span>
    </Pill>
  );
}

export const TRIAGE_STYLE: Record<TriageLevel, { cls: string; dot: string; hex: string }> = {
  LIFE_SAFETY_EMERGENCY: { cls: "bg-life-soft text-life ring-1 ring-life/30", dot: "bg-life", hex: "#b42318" },
  PROFESSIONAL_RESPONSE_REQUIRED: { cls: "bg-pro-soft text-pro ring-1 ring-pro/30", dot: "bg-pro", hex: "#c2410c" },
  SPECIALIZED_VOLUNTEER_ELIGIBLE: { cls: "bg-forming-soft text-forming ring-1 ring-forming/30", dot: "bg-forming", hex: "#6d28d9" },
  TRAINED_VOLUNTEER_ELIGIBLE: { cls: "bg-trained-soft text-trained ring-1 ring-trained/30", dot: "bg-trained", hex: "#a15c07" },
  GENERAL_VOLUNTEER_ELIGIBLE: { cls: "bg-general-soft text-general ring-1 ring-general/30", dot: "bg-general", hex: "#1d4ed8" },
  INFORMATION_ONLY: { cls: "bg-slate-100 text-slate-700 ring-1 ring-slate-300", dot: "bg-slate-400", hex: "#64748b" },
};

const TRIAGE_ICON: Record<TriageLevel, typeof Users> = {
  LIFE_SAFETY_EMERGENCY: AlertOctagon,
  PROFESSIONAL_RESPONSE_REQUIRED: ShieldAlert,
  SPECIALIZED_VOLUNTEER_ELIGIBLE: BadgeCheck,
  TRAINED_VOLUNTEER_ELIGIBLE: HardHat,
  GENERAL_VOLUNTEER_ELIGIBLE: Users,
  INFORMATION_ONLY: Info,
};

export function TriageBadge({ level, full }: { level: TriageLevel; full?: boolean }) {
  const Icon = TRIAGE_ICON[level];
  return (
    <Pill className={TRIAGE_STYLE[level].cls} title={TRIAGE_LABELS[level].description}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {full ? TRIAGE_LABELS[level].label : TRIAGE_LABELS[level].short}
    </Pill>
  );
}

export const STATUS_STYLE: Record<DisplayStatus, { cls: string; hex: string }> = {
  OPEN: { cls: "bg-general-soft text-general", hex: "#1d4ed8" },
  AWAITING_RESOURCES: { cls: "bg-trained-soft text-trained", hex: "#a15c07" },
  TEAM_FORMING: { cls: "bg-forming-soft text-forming", hex: "#6d28d9" },
  ACTIVE: { cls: "bg-active-soft text-active", hex: "#0f766e" },
  RESOLVED: { cls: "bg-done-soft text-done", hex: "#15803d" },
  ESCALATED: { cls: "bg-life-soft text-life", hex: "#b42318" },
  LOGGED: { cls: "bg-slate-100 text-slate-700", hex: "#64748b" },
  GUIDED: { cls: "bg-brand-soft text-brand", hex: "#0f5fbf" },
  CANCELLED: { cls: "bg-slate-100 text-slate-600", hex: "#64748b" },
};

export function StatusIcon({ status, className = "h-3.5 w-3.5" }: { status: DisplayStatus; className?: string }) {
  const Icon = {
    OPEN: CircleDot,
    AWAITING_RESOURCES: Clock,
    TEAM_FORMING: Users,
    ACTIVE: Truck,
    RESOLVED: CheckCircle2,
    ESCALATED: AlertTriangle,
    LOGGED: Info,
    GUIDED: Compass,
    CANCELLED: Loader,
  }[status];
  return <Icon className={className} aria-hidden />;
}

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <Pill className={STATUS_STYLE[status].cls}>
      <StatusIcon status={status} />
      {INCIDENT_STATUS_LABELS[status]}
    </Pill>
  );
}

export function MissionStatusBadge({ status }: { status: MissionStatus }) {
  const cls: Record<MissionStatus, string> = {
    PROPOSED: "bg-forming-soft text-forming",
    DISPATCHED: "bg-active-soft text-active",
    REROUTING: "bg-trained text-white",
    ON_HOLD: "bg-life text-white",
    IN_PROGRESS: "bg-active-soft text-active",
    COMPLETED: "bg-done-soft text-done",
    VERIFIED: "bg-done text-white",
    CANCELLED: "bg-slate-100 text-slate-600",
  };
  return <Pill className={cls[status]}>{MISSION_STATUS_LABELS[status]}</Pill>;
}

export function HazardChip({ hazard, cleared }: { hazard: Hazard; cleared?: boolean }) {
  return (
    <Pill className={cleared ? "bg-slate-100 text-slate-500 line-through" : "bg-life text-white"}>
      <AlertTriangle className="h-3 w-3" aria-hidden />
      {HAZARD_LABELS[hazard]}
      {cleared ? <span className="sr-only"> (cleared)</span> : null}
    </Pill>
  );
}
