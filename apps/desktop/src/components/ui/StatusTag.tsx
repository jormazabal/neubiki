import { AlertTriangle, CircleCheck, CircleX, Clock, Cloud, FileText, LoaderCircle, type LucideIcon } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type StatusTone = "neutral" | "connection" | "success" | "warning" | "error";
export type StatusActivity = "waiting" | "working";

const symbols: Record<StatusTone, LucideIcon> = {
  neutral: FileText,
  connection: Cloud,
  success: CircleCheck,
  warning: AlertTriangle,
  error: CircleX,
};

export function StatusIcon({ tone, activity }: { tone: StatusTone; activity?: StatusActivity }) {
  const Icon = activity === "working" ? LoaderCircle : activity === "waiting" ? Clock : symbols[tone];
  return <Icon aria-hidden="true" size={16} className={activity === "working" ? "ui-status-icon motion-safe:animate-spin" : "ui-status-icon"} />;
}

type Props = ComponentPropsWithoutRef<"span"> & {
  tone?: StatusTone;
  activity?: StatusActivity;
  children: ReactNode;
};

export function StatusTag({ tone = "neutral", activity, children, className = "", ...props }: Props) {
  return <span {...props} className={`ui-status-tag ${className}`} data-ui-tone={tone}>
    <StatusIcon tone={tone} activity={activity} />
    <span>{children}</span>
  </span>;
}
