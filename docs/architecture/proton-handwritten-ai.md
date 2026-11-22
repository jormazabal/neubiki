# IA revisada por página de una nota manuscrita

El editor de Proton conserva el formato nativo `.nbnote` y permite editar originales `.knote` con su nombre existente. `ProtonHandwrittenEditor` compone el editor manuscrito heredado con `ProtonPageAiDialog`; el estado del documento y su borrador sigue perteneciendo a `useProtonDocument`.

## Operaciones

- **Reconocer texto manuscrito** captura una imagen de la página seleccionada en Rust. Envía esa página al modelo de visión configurado tras confirmación, permite corregir el texto y exige una revisión explícita para incorporarlo al borrador.
- **Dibujar con IA** envía la descripción y el tamaño de página. El modelo propone una escena estructurada; el motor determinista valida la ruta, los elementos y los trazos resultantes. La revisión muestra la página con los nuevos trazos. La aplicación añade trazos editables y conserva los anteriores.
- **Dictar texto a la página** reutiliza `ProtonAudioCapture`. El micrófono captura PCM local y prepara un WAV mono, 24 kHz y 16 bits al detenerse o alcanzar 60 segundos. Grabar no llama al proveedor. Un envío confirmado usa el servicio Rust de transcripción y prepara una propuesta que añade el dictado al texto anterior de la página. La revisión permite corregir todo el texto antes de aplicarlo.

Ninguna de estas operaciones guarda directamente en Proton. Tras aplicar, el pie del documento indica el borrador y conserva el guardado remoto explícito condicionado a su revisión base.

## Combinar páginas de un conflicto

`ProtonConflictDialog` permite mantener una versión completa o combinar páginas. `ProtonHandwrittenMergeReview` reutiliza `handwrittenMerge`: exige elegir la fuente de datos generales y orden, y decidir para cada página distinta entre borrador, Proton o ambas. Elegir una versión donde la página no existe la omite; debe quedar al menos una página. Conservar ambas mantiene la página local y asigna una identidad nueva a la remota, trasladando su texto de página y evitando colisiones con identidades y claves de texto existentes.

La vista previa y el envío contienen la nota resultante y `handwrittenMerge:{general,choices:[{pageId,choice}]}`. Rust compone de nuevo el resultado a partir de las dos versiones capturadas y rechaza elecciones desconocidas, duplicadas o incompletas y contenido distinto al resultado validado. El contrato existente comprueba revisión remota y generación local, conserva ambas versiones originales en Recuperación y prepara un borrador privado. No publica automáticamente el resultado. El flujo está acotado a 1000 páginas por versión.

## Insertar una página en Markdown

La acción **Insertar imagen → Insertar página manuscrita** abre `ProtonNoteEmbedDialog` y captura la revisión, el editor y el punto de inserción del documento Markdown. Permite elegir una nota del catálogo de la cuenta y raíz actuales y una página de su versión guardada. Los borradores privados de origen no se incluyen.

`POST /api/proton/workspace/note-page-render` verifica la revisión base del destino y la revisión solicitada de la nota, valida el formato y la identidad de página y confirma sus rutas mediante el catálogo acotado. Devuelve una captura PNG y un enlace relativo normal al archivo original, con los segmentos del nombre codificados. Rechaza rutas fuera de la raíz y revisiones cambiadas; no escribe en Proton. La UI muestra destino y captura y exige revisión explícita antes de usar el contrato existente `upload-image`.

Solo una imagen observada byte a byte en su ruta por contenido se inserta junto al enlace de origen. El editor vuelve a validarse antes y después de subir; si cambió, conserva la ruta confirmada y no inserta en otro documento. Una subida incierta se muestra sin repetirla automáticamente. La captura es PNG; el SVG sigue disponible mediante la exportación nativa, y no se amplía la aceptación de archivos SVG en el servicio de imágenes.

## Contrato nativo

`POST /api/proton/handwritten/{ocr|drawing|transcription}` recibe cuenta, raíz, nodo, `pageId`, `baseRevisionId`, `expectedGeneration`, `attemptId` y `confirmed:true`. El dibujo añade `prompt`; el dictado añade un único archivo multipart `file` WAV compatible. Se verifican selección, cuenta, raíz, tipo nativo, permisos, modelo, clave protegida y presupuesto. Todas las llamadas al proveedor ocurren en el carril de trabajo de IA, fuera del hilo de UI.

`note-ai.rs` escribe una identidad durable antes de llamar al proveedor. Repetir esa identidad observa el recibo existente y no vuelve a generar. Una respuesta interrumpida se consulta con `POST /api/proton/workspace/note-ai-check`; el catálogo por documento usa `note-ai-catalog` y devuelve únicamente metadatos. Otro envío requiere una nueva identidad y confirmación; la UI advierte si existe un intento sin confirmar.

`POST /api/proton/workspace/note-ai-apply` exige confirmación y la generación actual del borrador. Relee el archivo dentro de la raíz seleccionada y verifica la revisión base, la identidad y huella de la página y el texto de origen. Permite conservar cambios de otras páginas si no alteran el destino y se proporciona su generación actual. Si la página cambió, conserva la propuesta y rechaza la aplicación.

La aplicación registra primero la generación y huella previstas, después escribe el borrador privado. Consultar un resultado interrumpido permite reconocer una aplicación ya realizada sin repetirla. El hook frontend solo adopta el resultado si el editor y su contenido siguen coincidiendo con la captura; de lo contrario bloquea la edición y requiere releer el borrador conservado.

## Privacidad y límites

Las propuestas y las imágenes de origen permanecen en el dispositivo hasta siete días desde su creación. El audio del dictado permanece únicamente en memoria de la captura y la petición; no se almacena en el catálogo de propuestas. Al caducar se eliminan imagen, texto y trazos de propuesta; un recibo mínimo impide reutilizar automáticamente la identidad. El barrido se ejecuta al iniciar, periódicamente y antes de generar, consultar o aplicar.

El almacén privado admite como máximo 256 identidades, 16 MiB por registro y 64 MiB en conjunto. La imagen original admite 4 MiB; el texto revisado 64 000 caracteres y 256 KiB, con 512 KiB de texto agregado por nota. Una escena admite 32 elementos y la propuesta 5 000 trazos. La nota final pasa la validación de esquema y el límite nativo de 8 MiB. Se rechazan enlaces de sistema de archivos y registros incompatibles.

## Interacción y comprobación

El diálogo reutiliza `ModalFrame`, `DialogHeading`, `Button`, `InlineNotice` y `StatusTag`. Aísla el editor del fondo, retiene el foco, admite Escape cuando no hay una operación pendiente y pide confirmar el descarte de audio preparado o correcciones sin aplicar. Los campos y listas fluyen en una columna desplazable en ventanas estrechas. Los errores conservan la identidad del intento y no repiten llamadas automáticamente.

Los controles, ayudas y nombres accesibles de las propuestas, inserción, combinación, conflicto, vista previa y exportación usan `handwrittenCopy` en ES/EN según el proveedor de idioma de la interfaz. La captura local comparte esta adaptación. Se conserva español por defecto. Los mensajes originales del runtime y proveedor se muestran sin sustituir frases, y el cambio de idioma no transforma títulos, texto reconocido, prompts, nombres de archivos ni los pies y enlaces generados en Markdown.

Las pruebas de componentes cubren consentimiento, corrección y revisión de OCR, consulta tras respuesta interrumpida y captura de audio antes del envío. Las pruebas del hook cubren la protección y adopción de notas. La prueba Rust `proton_note_ai_ocr_keeps_other_pages_and_reconciles_an_applied_receipt` usa proveedores sintéticos y cubre repetición, conservación de otra página, consulta de aplicación, caducidad, texto de dictado y rechazo por cambio del destino.

Las pruebas de combinación cubren elecciones completas, identidades nuevas, texto de ambas páginas, rechazo por contenido distinto y conservación de originales. La inserción cubre revisión previa, enlace original, subida interrumpida sin repetición y render nativo de una revisión capturada sin escrituras remotas.

Quedan pendientes la aceptación instalada con micrófono y lápiz en Windows/Android y una campaña real de proveedores expresamente autorizada. El reconocimiento de todas las páginas en lote y el dictado continuo son recorridos adicionales; el flujo actual es explícito por página.
