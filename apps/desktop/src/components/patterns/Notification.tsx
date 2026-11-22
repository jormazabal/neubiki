import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../ui/Button";
import { ProgressBar } from "../ui/ProgressBar";
import { StatusIcon, type StatusTone } from "../ui/StatusTag";

export function Notification({ tone, title, message, progress, action, onClose, closeLabel }: {
  tone: StatusTone;
  title: string;
  message?: string;
  progress?: { value?: number };
  action?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
}) {
  return <div className="ui-notification" data-ui-tone={tone}>
    <div className="ui-notification-row">
      <StatusIcon tone={tone} activity={progress ? "working" : undefined} />
      <div className="ui-feedback-copy" role={tone === "error" ? "alert" : "status"}>
        <p className="font-semibold">{title}</p>
        {message && <p title={message}>{message}</p>}
      </div>
      {action}
      {onClose && <Button variant="quiet" size="icon" onClick={onClose} aria-label={closeLabel ?? "Cerrar aviso"}>
        <X aria-hidden="true" size={16} />
      </Button>}
    </div>
    {progress && <ProgressBar label={title} value={progress.value} />}
  </div>;
}
