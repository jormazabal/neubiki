import { useRef, useState, type FormEvent } from "react";
import { getApiErrorMessage } from "../../lib/api/client";
import { generateProtonImage, uploadProtonImageContent, type ProtonGeneratedImage } from "../../lib/api/protonImageAssets";
import type { ProtonDocumentToolProps, ProtonToolTarget } from "./protonToolTypes";

const button = "min-h-10 rounded-md border border-line px-3 text-sm hover:bg-brand-hover disabled:opacity-50";
const primary = "min-h-10 rounded-md bg-brand-orange px-3 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50";

type Preview = { image: ProtonGeneratedImage; target: ProtonToolTarget };

function sameDocumentVersion(target: ProtonToolTarget, current: ProtonToolTarget | null) {
  return current !== null
    && target.address.accountId === current.address.accountId
    && target.address.rootId === current.address.rootId
    && target.address.nodeId === current.address.nodeId
    && target.editorKey === current.editorKey
    && target.baseRevisionId === current.baseRevisionId
    && target.markdown === current.markdown;
}

export function ProtonImagesTool({ available, capture, apply }: ProtonDocumentToolProps) {
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"generating" | "uploading" | null>(null);
  const [message, setMessage] = useState("");
  const [stale, setStale] = useState(false);
  const pending = useRef(false);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !available || !prompt.trim()) return;
    const target = capture();
    if (!target) return;
    pending.current = true;
    setBusy("generating");
    setMessage("");
    try {
      const image = await generateProtonImage(target.address, target.baseRevisionId, prompt.trim());
      setPreview({ image, target });
      setStale(false);
      if (!image.usageRecorded) setMessage("La imagen está lista. El registro de consumo quedó sin confirmar.");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "No se confirmó la generación de la imagen."));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  async function insert(useCurrent: boolean) {
    if (pending.current || !available || !preview) return;
    const current = capture();
    const target = useCurrent ? current : preview.target;
    if (!target || !sameDocumentVersion(target, current)) {
      setStale(true);
      setMessage("El documento cambió. Selecciona el punto de inserción y usa el destino actual.");
      return;
    }
    pending.current = true;
    setBusy("uploading");
    setMessage("");
    try {
      const path = await uploadProtonImageContent(target.address, preview.image.contentBase64);
      if (!apply(target, { kind: "insert_at", markdown: `![Imagen generada](${path})` })) {
        setStale(true);
        setMessage("La imagen está en Proton. El documento cambió antes de insertarla.");
        return;
      }
      setPreview(null);
      setStale(false);
      setMessage("Imagen insertada en el borrador. Guarda el documento para compartirla.");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "No se confirmó la subida. La imagen se conserva para reintentar."));
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  return <div className="space-y-3 p-3">
    <form className="space-y-2" onSubmit={event => void generate(event)}>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Describe la imagen
        <textarea className="min-h-20 rounded-lg border border-line p-2 text-sm" value={prompt} rows={3} maxLength={4000} onChange={event => setPrompt(event.target.value)} />
      </label>
      <button className={primary} type="submit" disabled={!available || !prompt.trim() || busy !== null}>
        {busy === "generating" ? "Generando…" : "Generar imagen"}
      </button>
    </form>
    {preview && <div className="space-y-2">
      <img className="max-h-64 w-full rounded-lg border border-line object-contain" alt="Vista previa de la imagen generada"
        src={`data:${preview.image.contentType};base64,${preview.image.contentBase64}`} />
      <button className={button} type="button" disabled={!available || busy !== null} onClick={() => void insert(stale)}>
        {busy === "uploading" ? "Subiendo…" : stale ? "Insertar en el destino actual" : "Subir e insertar"}
      </button>
    </div>}
    {message && <p role="status" className="text-sm text-ink-secondary">{message}</p>}
  </div>;
}
