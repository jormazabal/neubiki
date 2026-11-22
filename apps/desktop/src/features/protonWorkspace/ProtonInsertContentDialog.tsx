import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { relativeAssetPath } from "./protonImages";

type Props = {
  kind: "link" | "image";
  initialValue?: string;
  initialAlt?: string;
  upload?: (file: File) => Promise<string>;
  onClose: () => void;
  onSubmit: (source: string, alt: string) => boolean;
  onDelete?: () => boolean;
};

function validLink(source: string) {
  if (!source || /[\u0000-\u0020\u007F]/.test(source)) return false;
  try {
    return ["http:", "https:", "mailto:", "tel:"].includes(new URL(source, "https://neubiki.invalid").protocol);
  } catch {
    return false;
  }
}

export function ProtonInsertContentDialog({ kind, initialValue = "", initialAlt = "", upload, onClose, onSubmit, onDelete }: Props) {
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
          if (mounted.current) setError(cause instanceof Error ? cause.message : "No se pudo confirmar la imagen en Proton.");
          return;
        } finally {
          pending.current = false;
          if (mounted.current) setBusy(false);
        }
      }
    }
    if (image ? !relativeAssetPath(reference) && (!initialValue || reference !== initialValue) : !validLink(reference)) {
      setError(image ? "Indica una ruta de imagen relativa al documento." : "Escribe una dirección de enlace válida.");
      return;
    }
    if (onSubmit(reference, alt.trim())) onClose();
    else setError("El documento cambió o no está disponible. Cierra esta ventana y vuelve a intentarlo.");
  }

  return <ModalFrame label={title} onClose={close}>
    <form onSubmit={submit} className="proton-content-dialog">
      <header>
        <h3>{title}</h3>
        <button type="button" aria-label="Cerrar" onClick={close} disabled={busy}><X size={18} /></button>
      </header>
      {image && upload && <label>Archivo de imagen
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={event => {
          setFile(event.target.files?.[0] ?? null);
          setConfirmedPath("");
        }} />
      </label>}
      <label>{image ? "Ruta relativa en Proton Drive" : "Dirección del enlace"}
        <input data-autofocus={!image || undefined} type="text" inputMode={image ? "text" : "url"} value={source}
          disabled={Boolean(file) || busy} onChange={event => setSource(event.target.value)} placeholder={image ? "assets/imagen.png" : "https://"} />
      </label>
      {image && <label>Texto alternativo<input value={alt} disabled={busy} onChange={event => setAlt(event.target.value)} /></label>}
      {error && <p role="alert">{error}</p>}
      {confirmedPath && <p className="break-all text-ink-secondary">Imagen en Proton Drive · {confirmedPath}</p>}
      <footer>
        {onDelete && <button type="button" className="proton-document-action mr-auto" disabled={busy} onClick={() => {
          if (onDelete()) onClose();
          else setError("El documento cambió o no está disponible.");
        }}>Eliminar imagen</button>}
        <button type="button" className="proton-document-action" onClick={close} disabled={busy}>Cancelar</button>
        <button type="submit" className="proton-document-action proton-document-primary" disabled={busy || (!file && !source.trim())}>
          {busy ? "Guardando imagen…" : onDelete ? "Aplicar cambios" : "Insertar"}
        </button>
      </footer>
    </form>
  </ModalFrame>;
}
