import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { Button } from "../../components/ui/Button";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { relativeAssetPath } from "./protonImages";
import { useHandwrittenCopy } from "../../lib/i18n/handwrittenCopy";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";

type Props = {
  kind: "link" | "image";
  initialValue?: string;
  initialAlt?: string;
  upload?: (file: File) => Promise<string>;
  onClose: () => void;
  onSubmit: (source: string, alt: string) => boolean;
  onDelete?: () => boolean;
  onInsertNotePage?: () => void;
};

function validLink(source: string) {
  if (!source || /[\u0000-\u0020\u007F]/.test(source)) return false;
  try {
    return ["http:", "https:", "mailto:", "tel:"].includes(new URL(source, "https://neubiki.invalid").protocol);
  } catch {
    return false;
  }
}

export function ProtonInsertContentDialog({ kind, initialValue = "", initialAlt = "", upload, onClose, onSubmit, onDelete, onInsertNotePage }: Props) {
  const noteCopy = useHandwrittenCopy().embed;
  const english = useUiLocale() === "en";
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const image = kind === "image";
  const title = image ? onDelete ? "Editar imagen" : "Insertar imagen" : "Insertar enlace";
  const [source, setSource] = useState(initialValue);
  const [alt, setAlt] = useState(initialAlt);
  const [file, setFile] = useState<File | null>(null);
  const [confirmedPath, setConfirmedPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function close() {
    if (!pending.current) onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    setError("");
    let reference = source.trim();
    if (file && upload) {
      if (confirmedPath) reference = confirmedPath;
      else {
        pending.current = true;
        setBusy(true);
        try {
          reference = await upload(file);
          if (!mounted.current) return;
          setConfirmedPath(reference);
        } catch (cause) {
          if (mounted.current) setError(runtimeErrorMessage(cause, english
            ? "The image could not be confirmed in Proton. Check the destination."
            : "No se pudo confirmar la imagen en Proton. Comprueba el destino."));
          return;
        } finally {
          pending.current = false;
          if (mounted.current) setBusy(false);
        }
      }
    }
    if (image ? !relativeAssetPath(reference) && (!initialValue || reference !== initialValue) : !validLink(reference)) {
      setError(image
        ? english ? "Enter an image path relative to the document." : "Indica una ruta de imagen relativa al documento."
        : english ? "Enter a valid link address." : "Escribe una dirección de enlace válida.");
      return;
    }
    if (onSubmit(reference, alt.trim())) onClose();
    else setError(english ? "The document changed or is unavailable. Close this dialog and check the document."
      : "El documento cambió o no está disponible. Cierra esta ventana y comprueba el documento.");
  }

  return createPortal(<ModalFrame label={title} onClose={close}>
    <form onSubmit={submit} className="proton-content-dialog">
      <DialogHeading title={title} onClose={close} busy={busy} />
      {image && !onDelete && onInsertNotePage && <Button variant="quiet" disabled={busy} onClick={onInsertNotePage}>{noteCopy.title}</Button>}
      {image && upload && <label>Archivo de imagen
        <input data-autofocus className="ui-field" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={event => {
          setFile(event.target.files?.[0] ?? null);
          setConfirmedPath("");
        }} />
      </label>}
      <label>{image ? "Ruta relativa en Proton Drive" : "Dirección del enlace"}
        <input data-autofocus={(!image || !upload) || undefined} className="ui-field" type="text" inputMode={image ? "text" : "url"} value={source}
          disabled={Boolean(file) || busy} onChange={event => setSource(event.target.value)} placeholder={image ? "assets/imagen.png" : "https://"} />
      </label>
      {image && <label>Texto alternativo<input className="ui-field" value={alt} disabled={busy} onChange={event => setAlt(event.target.value)} /></label>}
      {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
      {confirmedPath && <p className="break-all text-ink-secondary">Imagen en Proton Drive · {confirmedPath}</p>}
      <footer>
        {onDelete && <Button variant="danger" className="mr-auto" disabled={busy} onClick={() => {
          if (onDelete()) onClose();
          else setError(english ? "The document changed or is unavailable." : "El documento cambió o no está disponible.");
        }}>Eliminar imagen</Button>}
        <Button onClick={close} disabled={busy}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={busy || (!file && !source.trim())}>
          {busy ? "Guardando imagen…" : onDelete ? "Aplicar cambios" : "Insertar"}
        </Button>
      </footer>
    </form>
  </ModalFrame>, document.body);
}
