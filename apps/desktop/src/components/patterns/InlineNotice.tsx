import type { ReactNode } from "react";
import { StatusIcon, type StatusActivity, type StatusTone } from "../ui/StatusTag";

export function InlineNotice({ tone, children, action, activity, announce }: {
  tone: StatusTone;
  children: ReactNode;
  action?: ReactNode;
  activity?: StatusActivity;
  announce?: "status" | "alert";
}) {
  return <div className="ui-inline-notice" data-ui-tone={tone}>
    <StatusIcon tone={tone} activity={activity} />
    <div className="ui-feedback-copy" role={announce}>{children}</div>
    {action}
  </div>;
}
