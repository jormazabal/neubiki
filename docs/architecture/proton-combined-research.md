# Investigación pública y síntesis con fuentes privadas

`ProtonResearchDialog` conserva la investigación pública como primer resultado. El asistente puede entregarle las referencias de las fuentes de texto que el usuario ya adjuntó al documento activo. El diálogo captura esos descriptores al abrirse, excluye imágenes y muestra sus nombres con una casilla inicialmente desmarcada. No abre otro selector ni incluye el documento activo automáticamente.

## Consentimiento y contrato

La pregunta debe ser apta para una búsqueda pública. Solo esa pregunta se usa en la búsqueda web. Si el usuario marca **Combinar el informe público con estas fuentes privadas**, la segunda fase utiliza sus revisiones guardadas para una síntesis separada en OpenAI, sin herramienta web. La UI explica este envío antes de revisar el coste.

Los contratos `research-review` y `research-run` reciben el ámbito del documento, la revisión de origen y la pregunta pública. `sources` admite `{nodeId, revisionId}` para cada fuente privada elegida. `retainPublicReport` se envía únicamente al marcar **Conservar el informe público durante siete días en este dispositivo**. La API frontend descarta los demás datos del editor y las fuentes.

El runtime revisa las fuentes guardadas antes de cotizar. Devuelve `quoteId`, `attemptId` y `synthesis`, y vincula la cotización al contenido público, a las revisiones exactas, al modelo, al coste y a las opciones de privacidad. Cambiar la pregunta o cualquiera de las casillas descarta la cotización. La confirmación conserva la misma petición y ambos identificadores. La cotización caduca a los quince minutos.

## Resultados independientes

La respuesta original mantiene `report`, las citas públicas, la cobertura y el registro de consumo. Añade opcionalmente `synthesis`, `synthesisStatus` y `sourceNames`. `receiptSaved` indica si se confirmó el estado actualizado del recibo. `publicReportSaved` indica si se confirmó la copia del informe público.

El informe público y sus citas se muestran cuando están disponibles. La síntesis se presenta en su propio panel y ofrece copiar el texto confirmado. Si la síntesis quedó sin confirmar o se omitió, el diálogo indica ese estado y mantiene el informe público. Cada resultado tiene su propia acción de copia.

La espera frontend admite 120 segundos para investigación pública y 240 segundos si se solicitaron fuentes. Durante el envío, el diálogo bloquea otro envío y el cierre ordinario. Si la respuesta se pierde, **Comprobar este intento** solicita el recibo de ese envío. Al reabrir el diálogo, **Consultar intentos recientes** lista los recibos del documento abierto. Abrir un recibo recupera la copia pública si se conservó. Cuando falta la configuración de IA para un nuevo envío, el asistente ofrece **Intentos de investigación** para consultar el recibo del documento abierto sin acceder a su contenido editable.

## Recibo local y recuperación

El runtime crea de forma atómica el recibo del intento antes de contactar con OpenAI y rechaza una segunda creación para el mismo identificador. Después de la búsqueda escribe su resultado y el estado del consumo antes de preparar la síntesis. Si se optó por conservar el informe, este punto de control incluye el texto público y sus citas. La síntesis comprueba configuración, presupuesto, permisos y revisiones antes de enviarse. El runtime la omite si falla el punto de control necesario para identificar el intento.

`POST /api/proton/ai/research-status` recibe `accountId`, `rootId`, `nodeId` y un `attemptId` opcional. Comprueba que la cuenta conserva su sesión local y que la carpeta sigue seleccionada. Devuelve `attempts`, con fecha de inicio, estado de cada fase y confirmación independiente del consumo. `null` indica que todavía no se conoce si hubo registro. La lista devuelve solo metadatos. Consultar un identificador añade `publicReport` si existe una copia. La ruta lee datos locales y permite consultar el punto de control mientras una fase continúa o cuando se perdió su respuesta.

Los recibos se conservan en el directorio privado de Neubiki en este dispositivo, hasta siete días y con un máximo de 64 intentos. El ámbito se guarda como identificador derivado. El esquema excluye los campos de pregunta, referencias y nombres de fuentes privadas, borrador y texto de síntesis. La copia pública opcional suprime enlaces incrustados y conserva citas HTTPS sin parámetros ni fragmentos. La fecha de caducidad se mantiene al consultar el recibo. La aplicación elimina los archivos caducados al iniciar, durante el mantenimiento periódico y al admitir nuevos intentos.

**Eliminar copia local** abre una confirmación en el detalle del recibo. `POST /api/proton/ai/research-report-delete` requiere el ámbito, `attemptId` y `confirmed: true`. Elimina la copia del informe y sus citas mediante un reemplazo atómico. El recibo conserva la información de estado y consumo, y sigue bloqueando el reenvío del mismo intento. Una marca local impide que una síntesis aún en curso reponga la copia eliminada. Repetir la eliminación devuelve el estado vigente del mismo recibo.

## Verificación y límites

Las pruebas del diálogo y la API cubren consentimiento, invalidación de la cotización, serialización acotada, recuperación local tras la pérdida de respuesta y confirmación de la eliminación. Las pruebas nativas cubren la reapertura del recibo, el aislamiento por documento y cuenta, la caducidad, el límite de espacio y la eliminación idempotente ante nuevos puntos de control. Las pruebas usan resultados simulados. La aceptación instalada Windows y Android se registra por separado.
