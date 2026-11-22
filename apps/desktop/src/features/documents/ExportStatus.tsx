import { exportCopy } from "../../lib/i18n/exportCopy";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { Notification } from "../../components/patterns/Notification";
import { Button } from "../../components/ui/Button";

type Props = {
  progress: string | null;
  saved: { exportId?: string; fileName: string } | null;
  opening: boolean;
  onOpen: () => void;
  onClose: () => void;
};

export function ExportStatus({ progress, saved, opening, onOpen, onClose }: Props) {
  const c = exportCopy[useUiLocale()];
  if (!progress && !saved) return null;
  return <div className="neubiki-export-status fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-[75] md:left-auto md:right-4 md:max-w-sm">
    {progress
      ? <Notification tone="neutral" title={c.preparing} message={progress} progress={{}} />
      : saved && <Notification tone="success"
        title={saved.exportId ? c.exported : c.exportedFile(saved.fileName)}
        message={saved.exportId ? saved.fileName : undefined}
        action={saved.exportId && <Button variant="primary" size="compact" disabled={opening} onClick={onOpen}>{c.open}</Button>}
        closeLabel={c.closeNotice} onClose={onClose} />}
  </div>;
}
