# Instantáneas de plantillas compartidas en Proton

## Decisión y experiencia

La biblioteca compartida se intercambia mediante archivos nuevos `*.neubiki-templates.json` en la raíz del proyecto abierto. Cada archivo es una instantánea inmutable para Neubiki: no se actualiza ni sustituye un catálogo existente. La publicación mantiene los permisos que ya tenga esa raíz en Proton y no crea enlaces públicos ni cambia permisos. Para publicar una versión posterior se elige otro nombre y se repite su revisión explícita.

El diálogo **Plantillas compartidas** permite seleccionar entre una y 32 plantillas personales guardadas en este dispositivo, revisar su contenido visual y recursos y confirmar la publicación. Las plantillas de serie, ajustes del dispositivo, identidad privada de captura y borradores quedan fuera. La lectura de la raíz se solicita expresamente; abrir el diálogo solo consulta la biblioteca y los recibos locales.

La importación es una copia a la biblioteca de este dispositivo. Se elige una instantánea, su revisión exacta, cada plantilla y su nombre local. La revisión nativa muestra nuevas entradas, contenido existente, conflictos y límites. Hace falta confirmar recursos y selección antes de guardar. Un nombre ocupado por contenido distinto se conserva y requiere otro nombre. Este flujo no crea notas ni adjuntos en Proton; la aplicación posterior reutiliza el renderizador y materializador de plantillas existentes.

No se ofrece edición colaborativa del catálogo, sincronización automática de bibliotecas, importación de configuración ni descubrimiento fuera de la raíz. Las imágenes externas no se descargan para la vista previa. Los enlaces y recursos originales permanecen literales; los recursos compatibles y las imágenes incrustadas ya validadas forman parte del formato portable existente.

## Contrato nativo

`proton_workspace::shared_templates` implementa `LocalApi::proton_shared_templates(action, body)`. El adaptador registra POST `/api/proton/templates/shared/{list,publish-review,publish,publish-check,import-review,import,import-check}` en la vía de transferencia.

- Todas las operaciones comprueban cuenta y raíz seleccionadas. La publicación exige escritura. Importar permite un proyecto de solo lectura.
- `list` consulta recibos privados paginados de 20 en 20. `readRemote:true` añade metadatos de hasta 200 archivos de la raíz cuyo nombre termina en el sufijo reservado. Declara cobertura parcial cuando corresponda.
- `publish-review` recibe nombre nuevo y parejas `id/revision` de plantillas locales. Reutiliza la exportación e inspección del catálogo portable y calcula `digest` y `reviewDigest` con ámbito, nombre y selección.
- `publish` exige esos digests, `operationId` y confirmación. Vuelve a validar las revisiones locales y colisiones de nombre antes de registrar intención. Ejecuta una única creación `drive.workspaceTreeEdit/import-file`, con padre igual a la raíz. No utiliza escritura genérica ni sobrescritura.
- Incluso con respuesta positiva del proveedor, se vuelve a listar y leer el archivo. Solo confirma identidad, nombre, revisión, pertenencia directa a la raíz y hash exacto de los bytes. `publish-check` realiza esta observación sin repetir la creación. La ausencia actual del archivo no demuestra que una subida sin respuesta no pueda terminar después.
- `import-review` recibe identidad/revisión de la instantánea y selección opcional `index/name`. Descarga esa revisión exacta con el límite acotado existente, valida raíz directa y catálogo portable completo, y prepara los resultados nativos. Una selección vacía permite inspeccionar sin guardar.
- `import` exige selección, `digest`, `reviewDigest`, `operationId`, `acknowledge:true` y `reviewedResources:true`. Vuelve a leer y revisar antes de incorporar entradas con el servicio existente, sin sobrescribir.
- `import-check` comprueba recibos pendientes/parciales contra huellas de nombre, Markdown, descripción y recursos de la biblioteca local; funciona sin descargar de nuevo. Nunca repite una creación.

El transporte reutiliza `neubiki.document-template-catalog`, versiones 1 y 2, y la validación portable ya existente para cada plantilla/recurso. El archivo compartido está limitado a **8 MiB** y **32 plantillas**. Se mantienen los límites existentes de Markdown, adjuntos compatibles y biblioteca local. No se amplía el runtime C# ni se introduce otro formato de recursos.

## Recuperación y concurrencia

Antes de cada mutación se escribe un recibo privado en `shared-template-intents`, separado por propósito, cuenta, raíz y operación. Contiene hashes, identidad, nombres, plan y resultados compactos, sin Markdown ni bytes de adjuntos. Se limita a 64 KiB por recibo, 2048 recibos y 32 MiB retenidos. Alcanzar el límite conserva los existentes y rechaza otra operación.

La reserva nativa impide concurrencia del mismo intento; el mismo identificador con otra intención se rechaza y una intención ya registrada devuelve el recibo sin reproducirla. Una respuesta de transporte perdida protege el cierre del diálogo hasta consultar el mismo intento. Una operación pendiente ya registrada puede cerrarse cuando el runtime confirma que no está activa; su recibo sigue consultable al reiniciar. Los resultados parciales permanecen visibles por plantilla.

La raíz y el estado del proveedor pueden cambiar mientras se trabaja. La verificación posterior detecta contenido o ámbito discordantes y evita afirmar guardado confirmado. No se atribuye propiedad por coincidencia de nombre solamente: se comprueban revisión, bytes exactos y ámbito. Un archivo idéntico observado tras perder la respuesta se presenta como contenido observado, sin afirmar autoría de la subida.

## UI y validación

Propietarios: `features/protonWorkspace/ProtonSharedTemplatesDialog.tsx`, `protonSharedTemplatesCopy.ts`, `lib/api/protonSharedTemplates.ts`, `types/protonSharedTemplates.ts` y el servicio Rust citado. Reutiliza `ModalFrame`, encabezado, botones, avisos y Milkdown de solo lectura cargado bajo demanda. Las listas se desplazan dentro del modal y las acciones se adaptan al ancho Windows/Android. Escape, Back y cierre pasan por el guard de operación; el foco vuelve al invocador. Controles ES/EN sin traducir contenido o nombres.

Siete pruebas frontend dirigidas cubren ámbito/revisión/límites, petición sin bytes del cliente, selección y consentimiento, permiso de solo lectura, invalidación de revisión, respuesta perdida sin repetición, recibo anterior sin conexión y respuesta tardía tras cambiar proyecto. Cuatro fixtures Rust ejercitan creación única con pérdida de respuesta, comprobación fresca de ámbito/revisión/bytes, importación local y reconciliación sin replay. Las compilaciones/pruebas nativas se agrupan con el hito de integración. La aceptación instalada y el recorrido con Proton real en Windows/Android siguen pendientes; no se han hecho mutaciones remotas para desarrollar este incremento.
