# Búsqueda por significado en Proton Drive

El asistente del documento activo ofrece búsqueda por significado en fuentes elegidas o en el proyecto abierto. El alcance Proyecto descubre candidatos guardados en la raíz y sus subcarpetas. El modelo de texto configurado propone su relevancia. El mismo documento activo puede aparecer como candidato por su revisión guardada. Los borradores y las selecciones del editor quedan fuera de ambos ámbitos.

## Selección y consentimiento

`ProtonSemanticSearchDialog` recibe `target`, `root`, fuentes inicialmente disponibles y `onClose`. El destino captura cuenta, raíz, documento, revisión y editor. Cambiar su identidad retira la vista anterior. La integración del asistente exige que coincidan el documento y la revisión activos, capacidad de consulta y clave configurada.

Fuentes elegidas conserva el selector textual para hasta tres archivos guardados distintos del documento activo. Proyecto recorre Proton Drive con un máximo de 48 carpetas, profundidad 32, 10.000 nodos y 32 intentos de lectura de archivos. El presupuesto de recorrido de 25 segundos se comprueba entre operaciones de Proton. Se recorren las carpetas por niveles con orden estable dentro de cada carpeta. Se incluye todo texto compatible y verificable que entre en estos límites, independientemente de que contenga los términos de la consulta.

Cada lectura admite hasta 2 MiB por archivo y 24 KiB de texto extraído. El ámbito Proyecto incluye el texto íntegro cuando cabe en 3 KiB de contexto por archivo. Para textos mayores utiliza tres pasajes de hasta 1 KiB del inicio, del centro y del final. La revisión muestra las revisiones exactas, qué archivos se incluirán como extractos y si la cobertura es completa o parcial. Las cifras recogen carpetas revisadas, archivos de texto detectados, formatos fuera del alcance, archivos que no se pudieron incluir y límites alcanzados. Cualquier fragmento o fuente compatible omitidos impide presentar cobertura completa.

La persona escribe qué quiere encontrar y revisa las fuentes, el modelo y el coste estimado. La casilla de consentimiento está desmarcada al mostrar una cotización. OpenAI recibe la consulta y el texto revisado después de la confirmación explícita. Cambiar la consulta, el ámbito o la selección descarta la cotización. Esta caduca a los cinco minutos.

## Contrato nativo

Los `POST /api/proton/ai/semantic-review` y `semantic-run` reciben cuenta, raíz, nodo y revisión base del documento y `query`. Fuentes elegidas envía `sources:[{nodeId,revisionId}]` en ambas llamadas. Proyecto añade `scope:"project"` y usa un array vacío en la revisión. La revisión devuelve `{quoteId,issuedAt,expiresAt,model,estimatedEur,sourceCount}` y para Proyecto añade `project:{coverage,complete,excerptedFiles,sources}`. Al confirmar, la API obtiene las referencias de los candidatos del objeto revisado y añade `quoteId`, `issuedAt` y `confirmed:true`. Los nombres y el texto del editor quedan fuera de la petición del frontend.

`proton_semantic.rs` usa los lectores de fuentes guardadas y valida la raíz y la revisión activas antes de cotizar y de enviar. La ejecución vuelve a leer las revisiones incluidas y verifica su pertenencia a la raíz. Rechaza cambios en el documento activo, en las fuentes, en el contenido autorizado o en las condiciones de coste. La cotización vincula la consulta, los pasajes, las referencias, el ámbito y las condiciones de coste por su huella. Al proveedor llegan identificadores efímeros, nombres y texto o pasajes verificados y la consulta. Se enmascaran destinos de enlaces y se excluyen los candidatos con la clave configurada. El presupuesto, la tarifa, el cambio de divisa y el límite por solicitud se comprueban dos veces.

La respuesta del modelo usa candidatos permitidos, relevancia `high|medium|low|none`, explicación breve y cita opcional. Rust exige cada candidato exactamente una vez, rechaza identidades y campos inventados, y comprueba cada cita como subcadena literal de uno de los pasajes transmitidos. Ordena las categorías de relevancia y reconstruye nombres, nodos y revisiones a partir de los datos verificados.

## Persistencia, repetición y límites

Las cotizaciones viven en memoria y contienen únicamente una huella y su hora. El consumo conserva sus metadatos habituales. Antes de llamar al proveedor se crea un marcador privado con la huella y la hora para impedir repetir un envío tras perder el acuse. Hay como máximo 64 cotizaciones y 64 marcadores vigentes. En `semantic-attempts` se retiran los marcadores caducados al iniciar otro envío. Al reiniciar Neubiki se vuelve a revisar antes de enviar. El cuerpo de las consultas, los textos, los resultados y los marcadores de contexto quedan en memoria durante la operación. La búsqueda literal y su índice local siguen disponibles de forma independiente.

Una respuesta incompleta se muestra como no confirmada. Cada nueva clasificación requiere otra revisión y consentimiento. La relevancia propuesta sigue siendo una interpretación del modelo, también cuando la cobertura es completa.

## Verificación

Las pruebas sintéticas cubren consentimiento, alcance, caducidad, referencias exactas, recorrido de subcarpetas y archivos omitidos, citas, extractos Unicode y marcadores de repetición. La aceptación instalada en Windows y Android con un proyecto autorizado queda pendiente.
