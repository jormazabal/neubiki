import { X } from "lucide-react";
import { Button } from "../ui/Button";

export function DialogHeading({ title, onClose, closeLabel, busy = false }: {
  title: string;
  onClose?: () => void;
  closeLabel?: string;
  busy?: boolean;
}) {
  return <header className="ui-dialog-heading">
    <h2>{title}</h2>
    {onClose && <Button variant="quiet" size="icon" onClick={onClose} disabled={busy} aria-label={closeLabel ?? "Cerrar"}>
      <X size={18} aria-hidden="true" />
    </Button>}
  </header>;
}
