import { ProtonAssistant } from "../assistant/ProtonAssistant";
import { ProtonTranslation } from "../assistant/ProtonTranslation";
import { ProtonImagesTool } from "./ProtonImagesTool";
import type { ProtonDocumentTool } from "./protonToolTypes";

export const protonTools: readonly ProtonDocumentTool[] = [
  { id: "assistant", label: "IA", panel: ProtonAssistant },
  { id: "translation", label: "Traducir", panel: ProtonTranslation },
  { id: "images", label: "Imágenes", panel: ProtonImagesTool },
];
