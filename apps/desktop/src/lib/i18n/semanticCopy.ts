import {useUiLocale} from "./UiLocale";
const es={title:"Buscar por significado en fuentes elegidas",close:"Cerrar",purpose:"Qué quieres encontrar",scope:"Solo se clasificarán los archivos guardados que elijas: hasta tres fuentes textuales dentro de esta carpeta. No es una búsqueda de todo el proyecto.",choose:"Elegir fuentes",selected:"Fuentes elegidas",noneSelected:"Elige al menos una fuente textual guardada.",privacy:"Al confirmar se enviarán a OpenAI tu consulta y el texto verificado de esas fuentes con el modelo configurado. El índice de texto permanece local. No se guarda un corpus, consulta ni embeddings para esta función.",review:"Revisar selección y coste",confirm:"Confirmar envío y clasificación",consent:"Confirmo el propósito, estas fuentes y el coste estimado",reviewError:"No se pudo verificar la selección y revisar el coste.",runError:"El resultado no se confirmó. Este envío no se repetirá automáticamente; revisa su consumo antes de preparar otro.",working:"Comprobando fuentes y presupuesto…",running:"Clasificando las fuentes elegidas…",model:"Modelo",cost:"Coste estimado",count:"Fuentes verificadas",expires:"Revisión válida hasta",expired:"La revisión caducó. Revisa de nuevo la selección y el coste.",bounded:"Resultados limitados a las fuentes y revisiones indicadas. El modelo propone su relevancia; revisa las explicaciones y las citas antes de usarlas.",unconfirmed:"No se confirmó una clasificación válida. Las fuentes originales se conservan y no se repetirá el envío.",usage:"Falta confirmar el registro de consumo.",evidence:"Cita comprobada en la fuente",revision:"Revisión comprobada al enviar",high:"Relevancia alta",medium:"Relevancia media",low:"Relevancia baja",none:"Sin relevancia identificada",noEvidence:"Sin cita de apoyo confirmada.",textOnly:"Selecciona únicamente fuentes de texto guardadas. Las imágenes quedan fuera de esta clasificación."};
const en:Record<keyof typeof es,string>={title:"Search selected sources by meaning",close:"Close",purpose:"What you want to find",scope:"Only your selected saved files will be ranked: up to three text sources inside this workspace folder. This is not a search of the entire project.",choose:"Choose sources",selected:"Selected sources",noneSelected:"Choose at least one saved text source.",privacy:"After confirmation, your query and verified text from those sources will be sent to OpenAI using the configured model. The text index stays local. No corpus, query or embeddings are stored for this feature.",review:"Review selection and cost",confirm:"Confirm send and ranking",consent:"I confirm the purpose, these sources and the estimated cost",reviewError:"The selection could not be verified and its cost reviewed.",runError:"The result was not confirmed. This send will not be repeated automatically; review usage before preparing another.",working:"Checking sources and budget…",running:"Ranking selected sources…",model:"Model",cost:"Estimated cost",count:"Verified sources",expires:"Review valid until",expired:"The review expired. Review selection and cost again.",bounded:"Results cover only the listed sources and revisions. The model proposes relevance; review explanations and quotes before using them.",unconfirmed:"A valid ranking was not confirmed. Original sources are preserved and the send will not be repeated.",usage:"The usage record still needs confirmation.",evidence:"Quote verified in the source",revision:"Revision verified when sent",high:"High relevance",medium:"Medium relevance",low:"Low relevance",none:"No relevance identified",noEvidence:"No supporting quote confirmed.",textOnly:"Select saved text sources only. Images are excluded from this ranking."};
const projectEs={
  scopeLabel:"Ámbito de búsqueda",selectedScope:"Fuentes elegidas",projectScope:"Proyecto",
  title:"Buscar por significado en el proyecto",intro:"Revisa el texto guardado de la carpeta del proyecto y sus subcarpetas.",
  privacy:"Primero verás la cobertura, las revisiones y el coste estimado. Si confirmas, OpenAI recibirá tu consulta y el texto o los extractos verificados de la lista.",
  review:"Revisar cobertura y coste",scanning:"Recorriendo el proyecto y verificando revisiones…",
  preparingError:"No se pudo verificar la cobertura del proyecto y su coste.",ranking:"Clasificando las fuentes revisadas…",
  complete:"Cobertura completa del texto compatible guardado en el proyecto.",
  partial:"Cobertura parcial. Puede haber coincidencias en archivos o fragmentos que quedaron fuera de la revisión.",
  folders:"Carpetas revisadas",eligible:"Archivos de texto detectados",unsupported:"Archivos con formato fuera del alcance",
  unavailable:"Archivos que no pudieron incluirse",omitted:"Archivos fuera del límite de revisión",
  failed:"Carpetas que no se pudieron revisar",excerpted:"Archivos que se enviarán como extractos",
  limited:"El recorrido alcanzó un límite de revisión.",sources:"Revisiones incluidas en el envío",revision:"Revisión verificada",
  fullText:"Texto completo",excerpt:"Extractos",results:"Clasificación de las revisiones del proyecto incluidas en la revisión.",
};
const projectEn:Record<keyof typeof projectEs,string>={
  scopeLabel:"Search scope",selectedScope:"Selected sources",projectScope:"Project",
  title:"Search the project by meaning",intro:"Review saved text in the project folder and its subfolders.",
  privacy:"Review coverage, revisions and estimated cost first. If you confirm, OpenAI will receive your query and verified text or passages from the list.",
  review:"Review coverage and cost",scanning:"Scanning the project and verifying revisions…",
  preparingError:"Project coverage and estimated cost could not be verified.",ranking:"Ranking reviewed sources…",
  complete:"Complete coverage of supported saved text in the project.",
  partial:"Partial coverage. Files or passages outside this review may contain other matches.",
  folders:"Folders reviewed",eligible:"Text files found",unsupported:"Files outside supported formats",
  unavailable:"Files that could not be included",omitted:"Files beyond the review limit",
  failed:"Folders that could not be reviewed",excerpted:"Files to be sent as excerpts",
  limited:"The scan reached a review limit.",sources:"Revisions included in the send",revision:"Verified revision",
  fullText:"Full text",excerpt:"Excerpts",results:"Ranking of the reviewed project revisions.",
};
export const semanticCopy={es,en};
export function useSemanticCopy(){return semanticCopy[useUiLocale()];}
export const semanticProjectCopy={es:projectEs,en:projectEn};
