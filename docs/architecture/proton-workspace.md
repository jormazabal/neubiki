# Espacio Proton de Neubiki

La aplicación toma como espacio una carpeta existente de Mis archivos. La selección se guarda en el dispositivo con la identidad de la cuenta y el identificador de la carpeta. Proton sigue siendo el origen de la jerarquía y del contenido. El árbol carga las carpetas al abrirlas. El cursor de eventos de Proton invalida las ramas cargadas cuando cambia el volumen o se pierde la continuidad. La aplicación vuelve a consultar Proton al abrir o actualizar una vista.

La lectura devuelve el identificador de archivo y el identificador de la revisión que se descargó y verificó. Las imágenes relativas se resuelven desde la carpeta del documento dentro de la raíz elegida. Los límites de esta versión son 64 MiB para la transferencia nativa, 8 MiB para una imagen relativa y 4 MiB para un borrador Markdown. Las imágenes relativas admiten PNG, JPEG, GIF y WebP. La interfaz conserva las vistas abiertas en memoria.

## Guardado y recuperación

El runtime utiliza el cargador de revisiones del SDK anclado a `05c9115955589d9f6ab7392a36f8f0cb39327133`. Comprueba que el archivo sigue en la carpeta seleccionada y compara la revisión activa con la revisión base del borrador. La subida se dirige al mismo archivo y usa la revisión base. La operación de revisión usa la ruta regular del SDK. Su proveedor de flags conserva los demás flags y desactiva solo `DriveSmallFileUpload` para este guardado. El SDK conserva su transporte autenticado y sus políticas internas de reintento.

Se registra un borrador privado por cuenta, raíz y archivo. Antes de la subida, una escritura local atómica registra la generación, la revisión base, el identificador de operación y la huella del contenido que se envía. Neubiki procesa una confirmación de Proton para la generación correspondiente. Si hubo una edición posterior, conserva ese texto y actualiza su revisión base. Guarda una confirmación local mínima que permite repetir la consulta del resultado sin duplicar la subida.

Cuando no se recibe confirmación o no se puede registrar, la operación queda pendiente de comprobar. La conciliación descarga la revisión activa. Si su contenido coincide, informa que el contenido se observó en Proton. El resultado permanece incierto si el contenido activo es distinto, incluso si el archivo todavía está en la revisión anterior. Un conflicto o un guardado incierto conserva el borrador para revisión. El descarte requiere la generación vigente y no modifica Proton.

La capacidad de edición está controlada por el runtime. La habilitación requiere probar la protección ante una base obsoleta y una subida en curso, con el mismo pin y la misma ruta de subida usada por la aplicación.

La prueba real del 15 de noviembre de 2026 estableció la capacidad en Windows x64. Proton rechazó las bases obsoletas para documentos cortos y de más de 256 KiB, mantuvo un único ganador con dos clientes y devolvió el contenido esperado al leer después de perder una confirmación. La prueba instalada en Android ARM64 comprobó guardado, conflicto con otro cliente y recuperación de borradores en el emulador. La edición usa la misma vía regular de revisiones en ambas arquitecturas.

La historia y la restauración quedan fuera de este contrato.

### Recuperación privada y resolución de conflictos

`recovery-list` consulta por páginas los borradores y las copias de resolución de este dispositivo sin contactar con Proton. `recovery-read` y la exportación validan cuenta, raíz, nodo, generación y tipo de copia. Los borradores de formato anterior se pueden identificar a partir de la revisión base y la raíz seleccionada si su huella coincide. Los registros que no se pueden identificar o leer se conservan y la vista informa de cobertura parcial. El selector nativo crea un archivo nuevo en Markdown o `.nbnote` según el contenido.

`conflict-review` devuelve la versión remota actual y el borrador. `conflict-resolve` vuelve a leer la revisión y comprueba la generación revisada. Guarda la resolución como borrador y conserva las dos entradas originales en el mismo diario privado. Solo **Guardar en Proton** publica el nuevo borrador mediante la escritura condicionada habitual. La copia anterior y la revisión remota consultada siguen disponibles en Recuperación hasta que se retiren juntas mediante confirmación explícita. Un guardado incierto debe comprobarse antes de preparar una resolución.

### Referencias salientes y entrantes

`references` vuelve a leer la revisión Markdown guardada y enumera hasta 100 destinos mediante el analizador Markdown. Los destinos relativos se resuelven con la cadena verificada de carpetas de Proton. No se descarga el contenido de los destinos. El panel distingue referencias disponibles, ausentes, fuera del ámbito o sin comprobar. Identifica enlaces externos y anclas para consulta. Una revisión distinta exige volver a leer la nota y reiniciar la comprobación.

`incoming-references` reutiliza el analizador y el resolvedor acotado para comparar el nodo de destino dentro de la raíz. Lee hasta 16 documentos Markdown de 16 carpetas y procesa hasta 2 MiB. Valida la ruta y revisión de cada origen y verifica la revisión de destino antes y después. Devuelve el origen, su ruta, línea y cobertura. El panel abre el archivo de origen.

### Búsqueda y reemplazo entre documentos

La sugerencia de reemplazo con IA es optativa. Requiere un Markdown activo y dos o tres resultados guardados distintos de ese documento. Rust lee las revisiones elegidas, protege destinos de enlaces y prepara hasta tres fragmentos cercanos a coincidencias literales por fuente. Antes de enviar se muestran nombres, modelo y estimación. El resultado propone una sola frase, que se puede llevar al campo de reemplazo. El flujo de revisión existente conserva la autoridad para generar el antes y el después de cada borrador privado. El uso de la sugerencia no realiza escrituras.

`search` admite nombres y contenido guardado. La extracción se conserva en memoria durante diez minutos, identificada por cuenta, raíz, nodo y revisión, con límites de 128 documentos y 32 MiB. La búsqueda consulta hasta 48 carpetas, lee hasta 32 documentos y devuelve la primera ubicación por archivo con un máximo de 100 resultados. Cada carga está ligada a la revisión enumerada y admite hasta 8 MiB. El conjunto admite hasta 32 MiB de contenido devuelto por lectura. Cuando el margen baja de 8 MiB se pueden seguir leyendo archivos de hasta 2 MiB y reutilizando las extracciones vigentes. Un archivo que supera 8 MiB figura en el aviso de cobertura parcial.

PDF usa la capa de texto y las notas manuscritas usan el texto reconocido ya guardado de las páginas existentes. La extracción estructurada conserva su límite de 2 MiB de texto y los límites de páginas, componentes y celdas de cada formato. La apertura desde un resultado queda sujeta al límite del editor o visor del formato.

`replacement-review` congela el Markdown original y propuesto de hasta 16 archivos. `replacement-apply` comprueba revisión, generación y contenido del borrador antes de preparar cada copia privada. El recibo impide repetir un intento total o parcialmente aplicado. `replacement-status` solo consulta ese recibo. Las revisiones privadas caducan a las 24 horas. Los documentos abiertos se recargan sin cambiar de pestaña. Si falla la recarga, la vista requiere volver a leer antes de permitir editar o guardar.

Desde nombres o contenido de búsqueda, **Editar documentos con IA** permite mejorar la redacción o traducir a español, inglés, euskera o francés. La selección es de dos o tres Markdown guardados, de hasta 4 KiB cada uno, bajo un documento activo y un proyecto con escritura. Rust comprueba la revisión de origen, el permiso de edición, el modelo y el presupuesto. La estimación vence en cinco minutos y el usuario confirma antes del envío. Cada revisión de coste admite un solo inicio. El proveedor recibe los textos bajo identificadores de posición, con destinos protegidos. Rust restaura los enlaces y descarta propuestas incompatibles con la estructura Markdown. El usuario elige las propuestas que quiere comparar y confirma qué borradores preparar. La preparación vuelve a leer las revisiones elegidas y comprueba el contenido. Aplicar reutiliza `replacement-apply` y exige que el permiso de edición siga activo. Los documentos se guardan individualmente desde el editor cuando el usuario lo decida.

## Acciones del árbol

`POST /api/proton/workspace/tree-edit` comprueba la cuenta y la raíz elegida. El puente usa la API pública del SDK para crear, renombrar, mover o enviar a la papelera. Comprueba la ubicación y el nombre de origen antes de modificarlo y verifica que el destino de un movimiento esté dentro del espacio. La duplicación de Markdown carga la revisión guardada y crea otro documento en la misma carpeta. Un resultado incierto refresca el árbol para revisión y carece de reenvío automático.

Antes de cambiar el árbol, la interfaz protege el borrador abierto. Renombrar conserva el identificador de la pestaña y mover actualiza su ubicación en memoria. Enviar una carpeta a la papelera cierra las pestañas de sus archivos abiertos y conserva sus borradores locales.

`trash-list` devuelve los elementos cuyo padre original sigue bajo la raíz elegida y marca la lista como parcial si alcanza el límite de consulta. `trash-restore` vuelve a comprobar identidad, fecha de retirada, nombre, ubicación y colisión, y registra la operación localmente antes de solicitar la restauración al SDK. El SDK restaura a la ubicación original. Una consulta separada verifica que el mismo elemento vuelve a aparecer en el padre y con el nombre esperados. Cuando esa verificación queda pendiente, **Comprobar** consulta el registro sin solicitar otra restauración. Si un padre también está en la papelera, hay que restaurarlo antes de consultar sus hijos.

### Visores de referencia

El visor PDF descarga hasta 12 MiB y renderiza una página cada vez. La búsqueda de PDF abarca la página visible. TXT, CSV, TSV, LOG y JSON se muestran como texto UTF-8, hasta 1 MiB. Para DOCX y XLSX, la apertura inicial obtiene metadatos y `office-preview` verifica la revisión antes de descargar hasta 8 MiB y extraer las partes necesarias en Rust. Word ofrece texto de lectura. Excel muestra los valores guardados de la hoja elegida y declara la cobertura parcial al superar los límites de la vista. La extracción no ejecuta fórmulas.

### Notas manuscritas

El árbol crea archivos `.nbnote` con el esquema estructurado de Neubiki. La lectura y la escritura admiten también los nombres `.knote` originales. Rust valida el esquema y el tipo de contenido antes de proteger un borrador o enviarlo al puente. El diario conserva páginas y trazos en la misma unidad que la generación, la revisión base y el intento de guardado. El puente escribe únicamente contra la revisión abierta y comprueba que el formato coincida con el nombre actual.

## Editor, propuestas y recursos en 0.7.0

La aplicación conecta las herramientas de Milkdown con el borrador de Proton. Una propuesta de IA, traducción o imagen captura cuenta, carpeta, documento, revisión base, contenido y destino del editor. Solo se aplica a ese estado y genera cambios en el borrador. La escritura en Drive requiere el guardado condicionado del documento.

Los comandos de IA se ejecutan en Rust con la clave protegida y la política de permisos y presupuesto de Neubiki. Rápido y Razonar envían una petición de texto estructurada, con el esfuerzo mínimo y medio del catálogo respectivamente. Si la persona lo selecciona, la petición incluye la última consulta y respuesta de esa nota y revisión como contexto. El runtime comprueba el tamaño y protege los destinos de enlace de los campos enviados. La traducción valida el resultado contra la estructura del Markdown antes de mostrar la propuesta. Los intercambios temporales se manejan en memoria y el historial privado exige confirmación por petición.

El runtime sube imágenes junto al documento bajo `assets/` y asigna un nombre derivado de la huella de los bytes. Acepta PNG, JPEG, GIF y WebP de hasta 8 MiB. Una subida repetida con los mismos bytes conserva el mismo recurso. Antes de devolver el enlace, el runtime verifica el archivo por su ruta relativa dentro de la raíz. Si se pierde la confirmación, la vista previa de la imagen generada se conserva en el panel para reintentar durante la sesión.

## Exportación y configuración

Al elegir un formato, la interfaz captura el Markdown del editor junto con la identidad de la cuenta, raíz y documento. `POST /api/proton/export` publica el archivo en el destino elegido en Windows y `POST /api/proton/export/content` entrega el contenido al selector de Android mediante `export_document_mobile`. Ambas rutas comparten la cola de transferencias y el conversor nativo. PDF y DOCX leen la plantilla guardada en el dispositivo y solo obtienen imágenes relativas a través del acceso de Proton acotado a la raíz. La exportación de Markdown entrega el texto capturado directamente.

Si el dispositivo tiene perfiles guardados, el selector de exportación permite aplicarlos a PDF y Word. El runtime comprueba la revisión del catálogo y utiliza el estilo seleccionado, incluidas las opciones de portada e índice. La resolución de los diagramas se toma de ese mismo perfil. Guardar un archivo Markdown entrega el borrador original.

En Configuración → Exportación, **Perfiles de exportación** permite guardar la plantilla confirmada como un perfil con nombre y opciones de portada e índice. La eliminación pide confirmación. Ante un resultado incierto, la interfaz consulta la identidad del cambio antes de permitir otra modificación. El formulario conserva sus campos al cambiar de apartado y participa en la protección de cambios pendientes al salir o actualizar.

### Documentos desde plantillas

El diálogo de creación consulta las plantillas iniciales de Neubiki y la biblioteca del dispositivo. `POST /api/proton/templates/preview` verifica la cuenta y raíz seleccionadas, la revisión de la plantilla y los valores aportados. Aplica las variables una vez y devuelve un Markdown revisable. El título, la fecha local y el nombre del proyecto se completan desde el contexto de creación. **Crear en Proton** utiliza la importación sin reemplazo en la carpeta elegida. Una plantilla con adjuntos prepara una carpeta nueva y verifica cada archivo antes de abrir el documento. Un resultado incierto conserva la revisión visible y pide comprobar la carpeta antes de otra creación.

Los apartados de Configuración reutilizan `/api/config/ai` y `/api/config/export-template`. Los cambios de cada grupo permanecen en memoria hasta confirmar su guardado. La clave de OpenAI sigue el flujo independiente de credenciales protegidas. El cambio de configuración confirmada actualiza el estado que consulta el asistente.

## Prueba reproducible en una cuenta autorizada

Compila el puente y la biblioteca criptográfica con los artefactos fijados del SDK. Usa un directorio privado de prueba nuevo y la ruta absoluta a la DLL de Neubiki. Ejecuta desde la raíz del proyecto.

```powershell
$bridge = 'C:\ruta\neubiki_proton.dll'
$vault = 'C:\ruta\vault-de-prueba'
$manifest = 'apps/desktop/src-tauri/Cargo.toml'
cargo run --locked --manifest-path $manifest -p neubiki-proton --example revision_probe -- $bridge $vault start
cargo run --locked --manifest-path $manifest -p neubiki-proton --example revision_probe -- $bridge $vault poll
cargo run --locked --manifest-path $manifest -p neubiki-proton --example revision_probe -- $bridge $vault probe --synthetic-fixture
```

Completa el inicio de sesión en Edge antes de consultar el intento con `poll`. El programa crea una carpeta identificable con datos sintéticos, un Markdown con una imagen relativa y dos documentos para las pruebas de revisiones. Comprueba el rechazo de una base antigua con contenido corto y con contenido de más de 256 KiB. Para la carrera, pausa la primera subida después de la creación del borrador y deja actuar a un segundo cliente con la misma base. La prueba conserva la carpeta sintética para la campaña nativa.

Si una ejecución se interrumpe, el comando `inspect` recibe el nombre de la carpeta sintética que mostró el programa. Lee sus archivos de revisión y muestra las etapas observadas, con los identificadores y contenidos excluidos de la salida. Una nueva ejecución de `probe` usa una carpeta sintética nueva.
En otro guardado del mismo archivo de prueba, el puente espera la confirmación del SDK y devuelve un error sintético. El programa verifica que la revisión activa tiene los bytes esperados. Esta inyección comprueba la pérdida de una respuesta entre el SDK y Rust. Las pruebas Rust cubren la persistencia y conciliación del resultado incierto al reconstruir el servicio, el rechazo de un reenvío y la conservación de una edición posterior.

```powershell
cargo test --locked --manifest-path $manifest -p neubiki-storage --lib proton_workspace
```

## Importación mediante el árbol

El gesto interno reutiliza `tree-edit` con el padre esperado y la carpeta elegida. El gesto externo captura los objetos `File` y entradas del navegador. El flujo confirma el alcance antes de crear carpetas y enviar un archivo por operación al runtime. `import-file` comprueba la carpeta raíz seleccionada, el nombre, el límite de tamaño y el resultado del conector. El SDK valida que el padre pertenece al espacio y crea un archivo nuevo. La interfaz actualiza el árbol tras el lote y muestra cuántos elementos se confirmaron si se detiene antes de completarlo.

## Publicación de reuniones

Desde una transcripción o un resumen guardado, la persona elige carpeta y nombre del archivo. `meeting-publish-review` prepara un Markdown a partir de la transcripción confirmada o de la revisión guardada del resumen. Conserva los identificadores de fragmento y sus intervalos, y marca el contenido parcial. `meeting-publish` revalida la fuente y la huella revisada antes de registrar el intento y crear el archivo sin reemplazo. `meeting-publish-check` consulta la misma operación. Ante una respuesta perdida, el runtime verifica el archivo en la carpeta elegida por su contenido y el identificador incluido al publicar. Una consulta nunca vuelve a crear el documento. El audio, el texto transcrito y el resumen local se conservan con su política propia.

## Favoritos y fuentes del asistente

Los favoritos de archivo se guardan en el archivo interno reservado `.neubiki-favorites.json` de la raíz. El runtime valida el esquema, la cuenta, la raíz y la pertenencia de cada archivo añadido. Cada escritura usa la revisión anterior del archivo interno o una creación sin reemplazo. Una consulta comprueba el intento por identificador y contenido sin repetir la escritura. Si Proton sigue sin confirmarlo, el usuario puede revisar la lista guardada y elegir **Continuar con la lista de Proton**. `favorites-check` vuelve a leer el estado y solo cierra el intento local si coinciden la identidad de la operación, el nodo de metadatos y la revisión revisada. El dispositivo guarda un recibo antes de retirar el pendiente y recupera ese cierre al reiniciar. El aviso distingue el cierre local de la confirmación en Proton porque un cambio en curso aún podría aparecer. La vista obtiene nombre y estado por páginas de veinte mediante metadatos del SDK.

El asistente puede recibir hasta tres fuentes guardadas seleccionadas explícitamente desde un explorador de carpetas o el índice de contenido del proyecto. Rust comprueba la revisión y ascendencia de cada archivo y excluye los archivos internos. El texto de cada fuente admite 24 KiB y comparte el límite total de 96 KiB con documento y conversación. Adjuntar una imagen usa Visión y limita la salida a una sola propuesta estructurada. Las fuentes seleccionadas y hasta tres intercambios anteriores se incluyen mediante consentimiento en la interfaz y se manejan como contexto temporal. El dictado captura hasta un minuto de audio local y requiere pulsar Enviar para transcribir. La transcripción se revisa antes de incorporarla a la consulta o al editor.

La investigación revisa la pregunta pública, el modelo y la estimación en euros. La primera etapa envía la pregunta a una sola llamada de búsqueda. Deja en la sesión el informe público y las citas anotadas por el proveedor. Cuando se eligen fuentes guardadas, la segunda etapa recibe texto acotado del informe y los extractos seleccionados mediante el modelo de texto sin herramientas. Se validan las revisiones, los permisos y el presupuesto antes de cada envío. Un fallo posterior conserva lo que se obtuvo de la búsqueda y presenta el estado de la síntesis. [Contrato Responses de OpenAI](https://developers.openai.com/api/reference/resources/responses/methods/create)

## Paquetes y copias programadas

La exportación por lotes congela revisiones guardadas y prepara un ZIP reutilizable con resultado por archivo. Los paquetes de proyecto comparten la validación de archivo portable. La restauración revisa rutas y hashes antes de elegir un destino y registra la creación de cada entrada en una carpeta nueva. En una respuesta perdida, la comprobación busca evidencia del mismo efecto. Las creaciones que no se puedan atribuir con seguridad quedan pendientes de revisión.

La frecuencia de copias es privada y optativa por cuenta y raíz. El frontend consulta vencimientos mientras el espacio de trabajo está visible y conectado. El runtime vuelve a validar el ámbito y conserva la fecha siguiente antes de preparar un paquete. Una copia pendiente de revisar aplaza la creación automática de otra. Las copias se preparan en el dispositivo para su revisión y entrega mediante las rutas nativas.

## Lotes de exportación de versiones guardadas

`proton_export_batch` prepara 1–32 documentos del ámbito de cuenta/raíz seleccionado. Cada captura nativa vuelve a leer la revisión indicada; excluye diarios y borradores privados. Markdown admite 4 MiB y manuscrito 8 MiB. PDF/Word reutilizan `render_proton_export`; el perfil se comprueba por revisión antes y después de convertir. Un archivo fallido queda como omisión, nunca como un archivo vacío. El contenido convertido y recursos acumulados se limita a 128 MiB.

`POST /api/proton/export-batches/prepare` devuelve revisión congelada y resultados por archivo. El ZIP y manifiesto se conservan en el diario `export-batches`, asociado a una identidad hash de cuenta/raíz sin registro de proyecto local. `POST /api/proton/export-batches/catalog` recupera los lotes del ámbito abierto. La entrega usa el comando nativo existente y journal picking/saved/cancelled/uncertain; una entrega picking tras reinicio se observa como uncertain y no se repite. La retirada mantiene el recibo. Los bytes ZIP no atraviesan WebView.

Markdown reescribe imágenes relativas verificadas a `_assets/<sha256>.<ext>` dentro de la carpeta de cada documento. Los enlaces entre documentos conservan sus destinos originales: este incremento exporta documentos, no un paquete portable de proyecto completo. Preparación, destino y retirada comparten la cola de transferencias; las esperas remotas no toman el bloqueo global de ediciones.

## Copias portables y restauración como copia

`project_transfer::proton_package` convierte una captura de originales guardados de la raíz Proton abierta al formato existente `neubiki.project` (schema1). Conserva bytes y estructura, incluidas carpetas vacías. Límites:32 archivos,32 carpetas,12 niveles,8MiB por archivo y128MiB de contenido. Se excluyen rutas privadas/reservadas y formatos fuera del catálogo. Una lectura fallida queda como exclusión explícita; la interfaz exige aceptar una copia parcial. El ZIP se vuelve a validar con `archive::inspect` y no incluye cuenta del dispositivo, borradores, conversación, grabaciones, ajustes ni claves. El catálogo y la entrega repiten la validación; un paquete no verificable aparece sin confirmar y no se entrega.

El selector nativo de paquetes y el validador/extractor existente preparan una importación privada. La restauración Proton nunca ejecuta el commit de proyecto local: `project_transfer::proton_restore` comprueba el hash de ese paquete y el manifiesto, y delega una nueva carpeta raíz a `proton_workspace::package_restore`. Se admite el mismo alcance acotado y paquetes sin suplemento privado. No se fusiona con carpetas existentes ni se incorporan ajustes.

`POST /api/proton/packages/restore/review` revisa nombre y colisiones antes de crear nada. El diario `proton-restore.json` vive dentro del transfer preparado; identifica cuenta, raíz, paquete, revisión de revisión y cada entrada. `apply` requiere esa revisión y aceptación explícita. Escribe pending antes de cada creación, conserva el acuse y verifica identidad, ubicación y bytes antes de marcar confirmado. Una creación desconocida detiene el plan y no se repite. `status` recupera el estado local; `check` observa una creación de archivo por contenido exacto, o verifica una carpeta cuyo ID ya consta en el acuse. Una carpeta sin acuse no se atribuye por su nombre: queda sin confirmar. Los siguientes elementos solo se procesan al continuar explícitamente desde un estado sin operaciones desconocidas.

`cancel` registra una detención persistente fuera de la cola de transferencias; se aplica en el siguiente límite seguro y conserva el resultado parcial. Un proceso cerrado entre operaciones se expone como interrumpido/sin confirmar, sin replay. Antes de retirar staging se archiva un recibo JSON inmutable en la familia existente export-batches (phase discarded, format restore, sin payload); si el archivo del recibo falla, no se borra la preparación. `restore/history` recupera esos resultados por ámbito. La UI mantiene el bloqueo de cierre después de perder la respuesta de apply hasta consultar el estado nativo.

La copia programada con la aplicación abierta debe reutilizar `prepare_proton_package`, aplicar deduplicación persistente por cuenta/raíz/ventana y limitar copias pendientes. La aplicación cerrada, el trabajo del sistema operativo y los destinos automáticos persistentes no se asumen por este contrato. La configuración opt-in y su política de ejecución pertenecen al incremento de programación.

## Plantillas con adjuntos

El preview Proton verifica la revisión del catálogo, aplica campos una sola vez y devuelve digest del Markdown final y resumen de adjuntos. Los tokens privados de recurso se reescriben a `_template-resources/<sha256>/<nombre-codificado>`; los archivos físicos mantienen el nombre Unicode original. `POST /api/proton/templates/package` vuelve a renderizar la plantilla guardada y comprueba el digest revisado, verifica cada adjunto y prepara un import staging `neubiki.project` sin crear documentos en Proton. Se reutilizan los límites de la biblioteca (hasta8 adjuntos explícitos de1MiB) y el validador portable.

La creación se confirma mediante el mismo restore-as-copy, con parentId explícito, nombre de carpeta libre, diario por entrada y verificación de bytes. El documento se abre solo cuando todos los elementos quedan confirmados; no se publica un Markdown con adjuntos pendientes como resultado completo. La revisión conservada expone también el padre y nombre destino para reabrirse con el contexto correcto. Las plantillas de texto siguen creando un único archivo por el protocolo existente. La captura desde un documento Proton guardado se integra por el contrato descrito a continuación; no requiere un proyecto local ni Git.

## Perfiles de exportación compartidos

El catálogo `.neubiki-export-profiles.json` está reservado en la raíz activa. Las operaciones dedicadas `drive.workspaceProfilesRead/Write` comprueban propietario `neubiki`, kind `export-profiles`, schema1, raíz, identidad del archivo y revisión base. Reutilizan creación sin colisión y `UploadRevision(baseRevision)` con subida regular. Se rechazan colisiones de nombre/tipo/esquema; una lectura posterior comprueba revisión, bytes y SHA-256. Máximo32 perfiles y1MiB; el catálogo normal, la búsqueda y las acciones de archivos ocultan o rechazan ese nombre.

`POST /api/proton/workspace/profiles-read`, `profiles-publish` y `profiles-check` mantienen ámbito cuenta/raíz. Publicar requiere confirmación del catálogo completo guardado en el dispositivo, hash local y nodo/revisión compartidos observados. El runtime toma esa copia y valida el estilo contra los campos escalares conocidos; elimina nombre técnico/fecha del dispositivo y rechaza claves desconocidas, recursos, fuentes con rutas, URLs y nombres de perfil con separadores de ruta. No se incluyen credenciales, procedencia de archivos ni configuración activa. No se modifica la plantilla del dispositivo.

Antes del SDK se persiste un intento privado en `<Workspace.directory>/shared-profile-attempts/<hash(cuenta,raíz)>.json`, limitado a8KiB y sin estilos ni contenido: operación y digest de perfiles. Una respuesta incierta bloquea otra publicación. Consultar solo lee y reconcilia el mismo operationId/digest; una base sin cambios no prueba ausencia de una operación tardía. Confirmar o recibir rechazo CAS probado retira el intento.

La exportación individual y por lotes recibe `profileSource:project`, `profileId` y `profileRevision` de la selección explícita. PDF/Word de Markdown verifica el perfil antes y después de convertir. El lote reutiliza una copia inmutable de ese perfil entre dos comprobaciones del catálogo; evita una descarga por documento y aborta el congelado si cambió la revisión. Su recibo conserva origen, ID y revisión seleccionados. Markdown ignora perfiles; las notas manuscritas conservan su formato propio. Las fuentes tipográficas admitidas deben poder resolverse en cada plataforma; no se comparten archivos de fuentes o plantillas con recursos mediante este catálogo.

## Captura de la revisión guardada como plantilla

`POST /api/proton/templates/source/prepare` recibe cuenta, raíz, nodo y revisión. El runtime lee solo la versión guardada, nunca un diario/borrador; admite Markdown de hasta1MiB y128 referencias. Los recursos relativos se resuelven mediante `drive.workspaceAsset` dentro de la raíz seleccionada. La decodificación de ruta es estricta por segmento: preserva signos + y Unicode, rechaza separadores codificados, escapes incompletos y UTF-8 inválido. No descarga imágenes remotas ni omite silenciosamente un recurso incompatible.

La captura mantiene los límites del constructor heredado:16 imágenes diferentes PNG/JPEG/WebP de hasta512KiB y16 millones de píxeles, y8 adjuntos PDF/DOCX/XLSX/TXT/CSV explícitos de hasta1MiB. Las imágenes se decodifican con memoria acotada y se incrustan con sus bytes exactos; los adjuntos reutilizan validación de formato/hash y tokens portables con fragmentos/consultas. Texto e imágenes incrustadas finales no superan1MiB. Se vuelven a leer recursos (identidad, revisión, nombre y bytes) y documento antes de aceptar la revisión. Un digest liga cuenta/raíz/nodo/revisión y recursos; el límite de lectura global es60s entre llamadas SDK, con timeout propio del SDK para la llamada en curso.

`POST /api/proton/templates/capture` recibe esa identidad, digest, operationId, nombre, descripción y acknowledge. Vuelve a verificar la fuente y recursos incluso para un no-op; después crea un registro con identidad determinista en la biblioteca privada existente, sin escribir en Proton. Un mutex corto serializa capturas/importaciones/retiradas del catálogo y sus presupuestos. El campo opcional privado captureDigest permite comprobar el resultado; los registros anteriores siguen siendo compatibles y el export portable excluye ese campo.

`POST /api/proton/templates/capture/check` consulta solo el registro local de la misma operación: saved, not-recorded o retired. No afirma que la fuente remota actual siga igual. Las tres operaciones comparten cola Transfer, por lo que comprobar espera a que termine un guardado previo y no interpreta una operación en curso como ausente. Una plantilla retirada conserva su identidad archivada y no se vuelve a crear con la misma operación; se comprueban hasta4096 recibos retirados y se falla cerrado si ese inventario no es verificable. La UI conserva operación/revisión y la guardia de cierre tras una respuesta perdida; nunca repite automáticamente.

`ProtonTemplateCaptureDialog` recibe solo clave/revisión/nombre del documento activo y estado del ámbito/conexión. El texto del editor no forma parte de su contrato. Capturar la versión guardada funciona también con acceso de solo lectura a Proton; únicamente la biblioteca del dispositivo se modifica tras revisión y confirmación. Enlaces web y variables existentes se conservan. Enlaces locales a formatos fuera del catálogo (por ejemplo otra nota Markdown) e imágenes remotas bloquean la captura y requieren adaptar el documento o usar una copia portable, conservando el original.
