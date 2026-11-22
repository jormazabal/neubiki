# Evolución del sistema de diseño

La versión del sistema de diseño es independiente de la versión de Neubiki. Este registro acompaña cambios en reglas, vistas, componentes y contratos. Git conserva los detalles de la implementación y las entregas registran el despliegue y la aceptación.

Incrementar el primer número cuando un cambio compartido requiera migrar consumidores, el segundo al añadir un patrón o variante compatible y el tercero para correcciones compatibles. Mantener la versión en el índice y la entrada correspondiente en este historial.

## 1.3.0 · 18 de noviembre de 2026

- `DATA-10` añade edición asistida de varios documentos desde la búsqueda. Compone `ModalFrame`, `DialogHeading`, `InlineNotice`, casillas y el diálogo de comparación de `DATA-07`. Incorpora revisión de coste y de cada propuesta, manteniendo el mismo criterio de guardado privado y confirmación.
- `TOOL-08` añade el alcance Proyecto. La interfaz explica cobertura, revisiones y coste en español e inglés. La lista permanece desplazable y mantiene controles de selección utilizables en pantalla estrecha.
- Investigación permite abrir recibos locales desde el mismo documento y confirmar la eliminación de su informe público. El diálogo distingue la copia borrada del recibo que todavía se puede consultar.
- `DOC-02` y `DOC-10` amplían la localización a la barra de Milkdown, paleta contextual y controles del editor manuscrito, incluidas etiquetas de accesibilidad, menús y controles táctiles. `DOC-13` añade revisión de la lista actual antes de cerrar un intento de favoritos sin confirmación.
- Las pruebas enfocadas cubren teclado y ancho estrecho en navegador con datos controlados. La aceptación instalada se documenta por plataforma. [Lista de aceptación](../../development/manual-test-checklist.md).

## 1.2.0 · 17 de noviembre de 2026

- `DOC-10` integra el editor manuscrito con el pie de guardado, la revisión del conflicto y Recuperación. El formato editable se ofrece como nota manuscrita de Neubiki.
- `DATA-01` amplía los filtros y la cobertura de archivos. `DATA-07` añade revisión literal de Original y Propuesta, selección de documento y resultado por archivo.
- `TOOL-01` reutiliza el control segmentado Rápido y Razonar y la selección explícita de contexto anterior.
- `OVR-04` se reutiliza para confirmar la creación desde una plantilla de texto. La configuración de exportación agrupa los perfiles del dispositivo con portada e índice.
- Las pruebas dirigidas de interfaz usan datos controlados. La validación instalada cubre foco y teclado en Windows, además de toque, lápiz y Atrás en Android. [Lista de aceptación](../../development/manual-test-checklist.md).

## 1.1.0 · 16 de noviembre de 2026

| Referencia | Diferencia observada | Aplicación en el espacio de Proton |
| --- | --- | --- |
| 01 y 02 · Fundamentos y distribución | Se repetía el nombre del archivo y las herramientas ocupaban una fila del editor en vertical. | El nombre se conserva en la pestaña y como encabezado accesible. El editor y las herramientas usan superficies redondeadas. En móvil, Herramientas abre una vista de tarea y Volver recupera el documento y su borrador. La selección de archivos y ajustes usa relleno. |
| 03 · Edición y revisión | El editor heredaba el subrayado de H1 y la propuesta se mostraba sola. | Se usa la escala de Notas, con H1 inicial de 22 px, tareas con acento y jerarquía por espaciado. La revisión conserva el documento y alcance de origen y permite comparar original y propuesta. |
| 04 y 05 · Controles e interacción | Los diálogos y acciones repetían estilos de botón. El tooltip compartido quedaba fuera del punto de entrada activo. | Botones, cabeceras de diálogo y campos con los roles de Apariencia. Ayuda visual y accesible en controles con tooltip. Los interruptores se aplican a los permisos de guardado inmediato. El progreso de exportación e IA es indeterminado mientras el runtime carece de un total. |
| 06 · Datos y búsqueda | La búsqueda dificultaba limpiar y volver a la coincidencia. Las estadísticas presentaban filas con el formato de la interfaz anterior. | Campo con borrado, navegación por teclado y vuelta a la coincidencia en móvil. Estadísticas con agrupación, tabla semántica ordenable y barras proporcionales al número real de interacciones de cada fila. |
| 07 · Estados y color | El borrador aparecía con variantes distintas de la paleta. Los avisos y los resultados de exportación tenían representaciones distintas. | Etiquetas con icono y tono común. Borrador local neutro, comprobación pendiente en aviso, revisión confirmada en éxito. Exportación presenta progreso y confirmación en una notificación. |

La revisión de la interfaz cubre los recorridos disponibles en Proton. La búsqueda global y la evolución temporal del consumo se mantienen en la especificación de producto hasta disponer del flujo o de los datos correspondientes. Los formatos de exportación conservan el acceso directo al selector del sistema.

Se comprobó en la ventana nativa de desarrollo de Windows con un área de 1280 × 672 y en el APK de prueba instalado en un emulador Android API 36 con un área de 412 × 839. Se usaron datos sintéticos para abrir el editor, recorrer los apartados de Configuración, buscar en una nota, abrir traducción e imágenes, revisar una propuesta, abrir la exportación y ordenar el consumo de IA. Se comprobó el editor y sus estados en Clásico al 100 % y Nocturno al 125 %. En Android, el diálogo de renombrado mantuvo el campo enfocado y las acciones dentro del área visible con el teclado abierto. La aceptación con operaciones reales de Proton se registra por separado.

## 1.0.0 · 16 de noviembre de 2026

| Decisión | Motivo y alcance |
| --- | --- |
| Siete láminas como referencia de Neubiki | Reúnen fundamentos, espacio de trabajo, edición, controles, interacción, datos y estados. Se archivan con el sistema para que una referencia sea recuperable desde Git. |
| Redondeo pronunciado, densidad operativa y fondo continuo | 22 px en superficies principales, cápsulas para acciones y etiquetas. La columna izquierda comparte fondo con el marco. La selección de Configuración usa relleno, icono y texto. |
| Aspecto de nota ajustable e independiente | H1 parte de 22 px y el cuerpo de 16 px. La escala de interfaz, el zoom de nota y la plantilla de exportación siguen sus propios contratos. |
| Color semántico separado del acento | La lámina 07 fija las variantes. El borrador local recuperable usa neutro. La confirmación pendiente usa aviso ámbar y acción Comprobar. La tabla de Apariencia fija los colores. |
| Catálogo ampliado para tareas reales | Incorpora tooltip, notificación, progreso, interruptor, desplegable de acciones, segmentado, gráfico, tabla ordenable, búsqueda, filtros, paginación y estado vacío. Define también familias heredadas de KnowNext y dependencias de integración. |
| Extensión por composición y revisión | La arquitectura, instrucciones del repositorio y plantilla de PR fijan el proceso de incorporación. Una prueba verifica la dirección de dependencias de las capas compartidas. |

La revisión define patrones de destino para búsqueda global, gráficos, controles nuevos y recorridos aún por adaptar. El atajo global `Ctrl+K` y el paso adicional de revisión de exportación que aparecen en las láminas entran en el flujo cuando se validen para su necesidad concreta. La exportación individual actual abre el selector del sistema al elegir el formato. [Especificación de interfaz](interfaz.md) · [Catálogo](componentes.md).

## Registrar una evolución

En cada nueva entrada incluir fecha y versión, vista e identificadores afectados, necesidad y decisión, referencia visual validada, cambios de contrato, consumidores y verificaciones en Windows y Android según alcance. Para deprecaciones registrar sucesor, consumidores pendientes y retirada. Los cambios compartidos que alteran los contratos existentes requieren documentar su compatibilidad o migración.

### Incremento de referencias · 17 de noviembre de 2026

`DOC-09`, `DOC-11` y `DATA-01` componen el visor existente con reproducción nativa limitada a contenedores admitidos, salto Excel a hoja/celda con ventana acotada y apertura explícita de fuente a línea guardada. Los controles conservan el desplazamiento horizontal en Android y el foco indica el destino. Se verificaron 13 pruebas frontend centradas en búsqueda, medios, visores y referencias; la aceptación instalada de Windows/Android y de sus códecs queda pendiente. No se añaden escrituras ni apertura de enlaces externos.

### Exportación por lotes de Proton · 17 de noviembre de 2026

`DOC-07` compone `ModalFrame`, `DialogHeading`, `Button`, `InlineNotice` y `ProgressBar` en `ProtonBatchExportDialog`. Mantiene selección de 1–32 documentos entre carpetas, formato y perfil, revisión por archivo y confirmación explícita de omisiones antes de entregar un ZIP. El foco y Escape pertenecen al diálogo; durante preparación/entrega no se cierra. En Android conserva el selector nativo de destino y el contenido desplazable. Los lotes privados reaparecen por cuenta y raíz al volver a abrir. Dos pruebas de interacción cubren omisiones, cancelación de destino y consulta de entrega incierta sin repetición; la aceptación instalada y visual de Windows/Android sigue pendiente.

`DOC-12` incorpora el catálogo por composición de diálogo, filtros y lista existentes y una consulta de impacto dentro de renombrado/movimiento. Se conserva la acción principal sin reescrituras automáticas; los resultados distinguen ocurrencias entrantes y destinos distintos al mover. La UI usa una columna adaptable y listas desplazables; la aceptación instalada sigue pendiente.

### IA revisada en notas manuscritas · 17 de noviembre de 2026

DOC-10 compone el editor existente con ProtonPageAiDialog para OCR, dibujo editable y dictado de hasta un minuto por página. Reutiliza ModalFrame para aislar el fondo y conservar teclado y foco; muestra el destino, exige consentimiento de envío y revisión para aplicar, y consulta un intento incierto sin repetir el proveedor. El dictado reutiliza ProtonAudioCapture y mantiene el audio local hasta confirmar. La vista fluye en una columna desplazable. Cinco pruebas frontend centradas en diálogo y hook verifican los recorridos; aceptación instalada y visual con micrófono y lápiz en Windows/Android pendiente. Contrato: [IA manuscrita de Proton](../../architecture/proton-handwritten-ai.md).

`DOC-13` define favoritos compartidos para archivos con estado confirmado, consulta paginada y resultado incierto. Reutiliza menú contextual, estrella, diálogo y avisos; no introduce iconos de acción permanentes en cada fila. El hook se verificó con tres pruebas de revisión base, comprobación sin repetición, aislamiento entre raíces y solo lectura. La aceptación instalada queda pendiente.

### Combinar e insertar páginas manuscritas · 17 de noviembre de 2026

DOC-06 y DOC-10 incorporan revisión de páginas local/Proton/ambas con vista previa e identidades nuevas. El runtime recompone las elecciones y conserva ambos originales antes de preparar el borrador. DOC-02 reutiliza el diálogo de imagen para abrir la selección de una nota y página guardadas: revisa PNG y destino, sube por el contrato de recursos existente e inserta la captura con enlace original. ModalFrame conserva aislamiento y foco; las listas y formularios fluyen en una columna en Android. Seis pruebas frontend cubren selección completa, textos, inserción confirmada y subida incierta sin repetición; aceptación instalada y visual pendiente.

### Idioma de navegación y Configuración · 17 de noviembre de 2026

NAV-02 y DATA-01 reutilizan appearance.language para ES/EN en cuenta y navegación de Configuración. La apariencia incorpora selector persistido, perfiles y colores traducidos y sincronización de lang para lectores de pantalla. Los formularios principales reutilizan settingsCopy. Un proveedor controlado conserva el propietario único de preferencias; no modifica el DOM por búsqueda ni altera documentos. Trece pruebas enfocadas verifican persistencia, cambio de idioma, textos de usuario intactos y búsqueda inglesa. La cobertura especializada pendiente se enumera en [localización de interfaz](../../architecture/interface-localization.md); aceptación instalada de Windows/Android pendiente.

### Copias portables y restauración ·17 de noviembre de2026

`DOC-07` incorpora `ProtonPackageDialog` y `ProtonRestoreReview`, compuestos con el mismo marco modal, encabezado, acciones, avisos y progreso del sistema. Preparar copia y revisar paquete conservan un único propietario de estado. La revisión presenta archivos, carpetas y exclusiones; las copias parciales requieren aceptación. La restauración requiere nombre libre, revisión del destino y confirmación antes de escribir. Cada entrada muestra pendiente, verificada, comprobada o sin confirmar; una respuesta perdida ofrece consultar y evita repetir creaciones. La detención conserva parciales. Windows y Android reutilizan sus selectores nativos, con listas desplazables, paginación de100 archivos, foco modal y cierre bloqueado mientras hay trabajo sin consultar. Las pruebas de componente cubren copia parcial, revisión sin commit local y creación incierta. La aceptación instalada/visual sigue pendiente.

### Diálogos manuscritos en ES/EN · 17 de noviembre de 2026

DOC-06 y DOC-10 extienden el proveedor de idioma existente a propuestas OCR/dibujo/dictado, inserción PNG, comparación y combinación de páginas, vista previa y exportación. La captura local comparte controles traducidos. Reutilizan ModalFrame, encabezados, avisos y botones con etiquetas accesibles en ambos idiomas y español predeterminado. El diccionario tipado conserva contenido, nombres y Markdown generado. Quince pruebas enfocadas verifican ES/EN y los contratos de envío, revisión y conservación; los mensajes nativos y la barra de tinta heredada requieren adaptación posterior. La aceptación instalada y visual de Windows/Android queda pendiente.

### Idioma de exploración y reemplazo · 17 de noviembre de 2026

`DATA-01`, `DATA-07`, `DOC-11` y `DOC-12` seleccionan textos españoles o ingleses mediante `useUiLocale` y el diccionario tipado `protonWorkspace/protonExplorationCopy`. Se traducen títulos, campos, acciones, etiquetas accesibles, estados, cobertura parcial, posiciones y resultados de borradores; el español sigue siendo el valor por defecto. Nombres, rutas, destinos literales, consultas y contenido original/propuesto conservan sus datos. Los detalles técnicos devueltos por el runtime mantienen su mensaje de origen. Las pruebas cambian el idioma sin volver a buscar, recorren un resultado Excel, comprueban un reemplazo incierto sin repetirlo y abren una línea de origen con la misma revisión. Los componentes y sus interacciones se reutilizan sin añadir variantes visuales.

### Plantillas con adjuntos ·17 de noviembre de2026

`ProtonTemplateDialog` permite seleccionar recursos existentes de la biblioteca y revisa su lista antes de preparar una carpeta con `ProtonRestoreReview`. Conserva destino explícito del árbol, campos y digest del preview; el cambio de plantilla/campo invalida la revisión. Los enlaces del preview no ejecutan navegación y la creación usa confirmación, progreso y resultado por entrada. Las plantillas de texto conservan su acción de archivo único. La prueba de interacción verifica handoff de paquete con adjuntos y destino seleccionado; la aceptación instalada sigue pendiente.

El mismo diccionario cubre `DOC-09`: controles PDF, texto, Word, Excel y medios, avisos de carga, formato, cobertura parcial y coordenadas. `MarkdownSourceViewer` traduce su etiqueta por defecto y la línea enfocada sin modificar las líneas físicas. El estado interno de PDF muestra carga y fallo en el idioma activo sin volver a abrir el documento. Se verificaron 19 casos de lectura (inglés, español, cambio de idioma, posición PDF, celda, línea, URL de medios y detalle técnico literal) y TypeScript. La aceptación de códecs y foco en clientes instalados sigue pendiente.

### Dispositivo y Actualizaciones en ES/EN · 18 de noviembre de 2026

DATA-06 y la sección de actualización reutilizan el proveedor controlado y el diccionario tipado deviceSettingsCopy. Categorías, tamaños, fechas, estados, progreso y controles usan el idioma elegido; el diagnóstico seguro reutiliza su variante inglesa existente. Se conservan el informe, las notas de versión y los errores externos, y no cambia la instalación ni su canal. Trece pruebas enfocadas cubren español predeterminado, inglés, consulta parcial, fallo sin exponer rutas, instalación bloqueada, progreso y versión sin canal. La aceptación instalada y visual de Windows/Android continúa pendiente; no se ha consultado un proveedor ni cambiado un artefacto firmado.

### Recuperación y Papelera en ES/EN · 18 de noviembre de 2026

DOC-06 completa el inventario de copias, consulta, exportación y retirada confirmada de originales, además de revisión y comprobación de restauración en Papelera. Reutiliza ModalFrame, encabezados, avisos, botones y el proveedor controlado con recoveryCopy; conserva español predeterminado, destinos, nombres y contenido. Las fechas siguen la preferencia de idioma. Diez pruebas enfocadas cubren ES/EN, resultados parciales, copia huérfana, confirmación y restauración incierta sin repetición; no cambia ningún contrato de escritura. Aceptación instalada y visual de teclado, lector de pantalla y anchuras Windows/Android pendiente.

### Perfiles compartidos · 18 de noviembre de 2026

`DOC-14` compone los diálogos, listas, confirmación y grupos de selector existentes para revisar la publicación del catálogo del dispositivo a un proyecto Proton. La nueva colección se elige explícitamente en exportación individual/lote, con revisión fija. Windows presenta listas en paralelo y Android en una columna. Se verificaron nueve casos dirigidos de UI/API con publicación, lectura incierta sin replay, solo lectura, selección individual/lote y compatibilidad del perfil local. La comprobación instalada y el recorrido remoto real siguen pendientes; las reglas nativas de deriva y portabilidad tienen pruebas de contrato separadas.

### Control de índice local · 18 de noviembre de 2026

DATA-08 compone un control desplegable en la búsqueda de contenido, fuera del formulario, con activación voluntaria y ámbitos de cuenta y raíz. Muestra cantidades guardadas y conexión por separado; desactivar y borrar piden confirmación, y una respuesta incierta exige consulta de estado antes de otra mutación. Reutiliza ModalFrame, botones, estados y avisos; ES/EN y disposición adaptable. Trece pruebas frontend/API enfocadas cubren preferencias, confirmación, aislamiento y conservación del flujo de búsqueda. Aceptación instalada y visual de Windows/Android pendiente.

### Captura de plantillas desde Proton ·18 de noviembre de2026

`DOC-15` compone `ModalFrame`, `DialogHeading`, `Button`, `InlineNotice`, `ProgressBar` y el visor Milkdown de solo lectura en `ProtonTemplateCaptureDialog`. El usuario revisa una versión guardada y sus recursos, aporta nombre/descripción y confirma antes de guardar en la biblioteca del dispositivo. Se distinguen guardado, no registrado y retirado; una respuesta perdida conserva identidad y bloquea cierre/repetición hasta comprobar. La captura admite controles ES/EN y mantiene literales documento, rutas y nombres de adjuntos. Las pruebas cubren confirmación, guardado incierto, cambio de revisión activo y copia inglesa sin traducir contenido. La aceptación instalada de Windows/Android sigue pendiente.

### Investigación con fuentes privadas elegidas · 18 de noviembre de 2026

TOOL-05 compone la investigación pública con una síntesis opcional de las fuentes de texto ya adjuntas. Muestra sus nombres, exige casilla desmarcada por defecto y nueva revisión de coste al cambiarla; imágenes y documento activo quedan fuera del contrato. Informe/citas y síntesis tienen paneles y acciones de copia separados. Un fallo de síntesis conserva el informe sin repetición automática. ES/EN y las mismas primitivas modales. Diecisiete pruebas de asistente/diálogo y dos de API verifican consentimiento y privacidad de la petición; aceptación instalada y verificación nativa se registran aparte.

### Clasificación semántica de fuentes elegidas · 18 de noviembre de 2026

TOOL-08 reutiliza los diálogos modales y el selector de fuentes de texto. Requiere revisión de coste y consentimiento desmarcado; consulta o selección nuevas invalidan la revisión. El asistente captura documento, revisión y editor, y retira el diálogo al cambiar el contexto. Muestra referencias y evidencia sin navegación implícita ni escritura. ES/EN, 21 pruebas enfocadas de asistente, diálogo, selector real y API; las reglas nativas se verifican aparte. La cobertura se limita a las fuentes seleccionadas y la aceptación instalada sigue pendiente.

### Exportación de archivos en ES/EN · 18 de noviembre de 2026

Los controles existentes de exportación individual y por lotes reutilizan `exportCopy` y el proveedor controlado. Se traducen progreso local, formatos, perfiles, cantidades, revisión parcial, estado del lote y aviso de resultado confirmado; las fechas y tamaños siguen el idioma elegido. Nombres, contenido, detalles externos, identidad y revisión de perfiles permanecen literales. No cambian los contratos nativos, la selección ni la política de comprobar entregas inciertas. La aceptación instalada de Windows/Android y el selector del sistema continúa pendiente.

### Instantáneas de plantillas compartidas · 18 de noviembre de 2026

DOC-15 añade una composición de ModalFrame, DialogHeading, Button, InlineNotice y Milkdown de solo lectura en ProtonSharedTemplatesDialog. El flujo reutiliza la biblioteca portable: publicación revisada de un archivo nuevo en la raíz e importación explícita por plantilla/nombre al dispositivo. Un resultado incierto conserva operación y bloquea repetición hasta comprobar; los recibos previos se consultan sin replay. Controles ES/EN, foco visible, retorno al invocador, listas desplazables y acciones que se adaptan al ancho Windows/Android. Siete pruebas dirigidas de UI/API cubren revisión, selección, permiso de lectura, pérdida de respuesta, reinicio simulado con recibos, idioma y ámbito cambiado; aceptación instalada y visual pendiente. El [contrato](../../architecture/proton-shared-template-snapshots.md) delimita formato, recursos, permisos y límites.

### Búsqueda por significado en el proyecto · 18 de noviembre de 2026

`TOOL-08` reutiliza el control segmentado para elegir entre Proyecto y Fuentes elegidas. El aviso distingue cobertura completa y parcial. La lista de revisiones se recorre con teclado o gesto y señala los archivos que incluyen extractos. El cuadro modal se adapta a una columna en Android y distribuye las cifras de cobertura en dos columnas cuando hay anchura suficiente. Las pruebas de interacción y API verifican la previsualización y el consentimiento por separado. La aceptación visual instalada sigue pendiente. [Contrato](../../architecture/proton-semantic-ranking.md).
