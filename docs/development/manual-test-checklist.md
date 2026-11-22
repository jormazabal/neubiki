# Aceptación manual en Windows y Android

## Preparar y registrar la campaña de entrega

- Usar un perfil Windows de prueba, un Android ARM64 físico dedicado a la campaña y una cuenta Proton de prueba. Generar el corpus local con `python scripts/prepare-installed-qa.py <id-campaña>`. Crear una carpeta Proton para esa campaña e importar `proyecto/`. Cargar `limites/superior-a-8-MiB.txt` mediante el cliente oficial de Proton para probar una omisión por tamaño. Subir `limites/fuera-del-proyecto.md` a una carpeta hermana para verificar el aislamiento de la raíz.
- Registrar por plataforma el sistema, dispositivo o emulador, fecha, versión, identidad de instalación, revisión del código y SHA-256 del paquete. Guardar recorrido, resultado esperado y observado y referencia de evidencia. Usar los estados `aprobado`, `fallido` o `pendiente` para cada caso. Indicar el impedimento concreto de cada caso pendiente.
- En el emulador pueden verificarse arranque, navegación y distribución de la interfaz. Ejecutar en ARM64 físico la instalación del APK firmado, lápiz, micrófono, teclado, segundo plano y recuperación sin red. Completar el guardado y la resolución de conflictos desde dos clientes conectados a la misma carpeta de prueba.
- Abrir `Inicio QA.md` y comprobar el enlace, la imagen, el diagrama y la estructura de Milkdown. Buscar `coral-qa-739` en Markdown y Excel y abrir la hoja `Inventario`, celda `B2`. Buscar por significado «vías de escape durante una emergencia» y comprobar que aparece `Equipo/Rutas de salida.md`. La consulta de texto debe declarar cobertura parcial con el archivo que excede 8 MiB y omitir la carpeta hermana. Usar los tres Markdown guardados para la revisión y preparación de borradores por lotes.
- Anotar el consumo de IA por operación en ambos clientes, con el límite conjunto de **5 €** incluyendo reservas de resultados inciertos. Revisar cotización, consentimiento, fuentes y destino antes de confirmar. Si una confirmación se pierde, consultar el intento previo y registrar su resolución antes de volver a gastar. Usar solo documentos y voces de prueba.
- Probar ES/EN con un error conocido, un fallo de conexión, un error sin traducción específica y una confirmación perdida. Cambiar el idioma con el aviso visible y tras reiniciar. Verificar instrucciones acordes al resultado, retorno del foco, lectura del aviso con tecnología de asistencia y conservación del borrador.
- Instalar los paquetes firmados. En Windows, usar perfiles aislados para MSI y NSIS y comprobar la firma del actualizador. En Android, comprobar firma continua, identificador, ABI y API mínima. Alcanzar las verificaciones de actualización con los dos recorridos siguientes.

## Recorrido principal

- Instalar el candidato de Neubiki y confirmar identidad, versión y arranque.
- Desde el menú de cuenta del panel izquierdo, conectar una cuenta Proton de prueba, cancelar un intento, restaurar una sesión y cerrar sesión. El cierre debe pedir confirmación y conservar el borrador privado.
- En Windows, comprobar la cuenta y el árbol con el fondo del marco, el editor central y las herramientas a la derecha. En Android vertical, pasar de Archivos al editor, abrir y cerrar una herramienta y volver a Archivos.
- Abrir Configuración y Estadísticas de IA desde el menú, también sin un documento abierto. Comprobar la consulta de consumo por mes y que los ajustes guardados de IA se reflejan en el asistente.
- En Configuración, cambiar de apartado en el lateral izquierdo y confirmar que su contenido ocupa el centro. Comprobar que Herramientas queda oculto y que Volver recupera la pestaña, el borrador y los laterales previos. En móvil, recorrer índice, apartado, índice y la vista de origen.
- En ancho de escritorio, plegar y desplegar ambos laterales por separado. Arrastrar los separadores y ajustar su ancho también con el teclado. Comprobar que cada lateral recupera su ancho al abrirlo de nuevo.
- Abrir dos documentos en pestañas. Editar uno, cambiar de pestaña y comprobar que el indicador de cambios acompaña al borrador. Probar Guardar en Proton, Volver a leer y las acciones de borrador en el pie. Cerrar una pestaña con cambios, reabrir el archivo y comprobar la recuperación.
- Elegir una carpeta de prueba. Abrir ramas del árbol según se navega. Confirmar que no aparece contenido exterior a la raíz.
- En una carpeta de prueba, abrir las opciones por clic derecho, `Mayús+F10` y el botón de tres puntos. Crear una subcarpeta y un Markdown, renombrar una pestaña con cambios, duplicar el Markdown y moverlo a otra carpeta del espacio. Enviar esa carpeta a la papelera con confirmación y comprobar que se cierran sus pestañas y se conserva el borrador. En Android, repetir el acceso por el botón de tres puntos.
- En Windows, arrastrar un archivo y una carpeta del árbol a otra carpeta y al encabezado **Archivos**. Confirmar que se resalta el destino, una carpeta cerrada se abre al mantener el puntero y el destino llega a **Mover**. Probar cancelar, soltar en el padre actual y soltar una carpeta en una descendiente. Confirmar que el traslado conserva el borrador abierto.
- Soltar desde el Explorador una carpeta de prueba con una subcarpeta vacía y archivos de texto y binarios. Revisar el destino, importar y comprobar nombres, contenido y estructura en Proton. Probar un conflicto y comprobar que el lote se detiene mostrando el progreso confirmado. En Android, usar **Importar archivos…** desde el menú de una carpeta con un archivo de prueba.
- Abrir un Markdown con imagen relativa en Milkdown. Confirmar que se conservan las rutas.
- Desde Configuración, cambiar los modelos de texto e imagen y guardar. Reabrir el apartado y comprobar los valores. Cambiar el tamaño de página en Exportación y guardar la plantilla. Cambiar otro valor, salir y comprobar que se avisa de los cambios pendientes.
- Con un borrador abierto, exportar Markdown, PDF y Word desde el pie del editor. Abrir los archivos y comprobar el texto pendiente de guardar. En PDF y Word, comprobar el tamaño de página, una imagen relativa y un diagrama. En Windows, probar el diálogo de destino y la cancelación. En Android, guardar con el selector del sistema y usar Abrir en el aviso de exportación.
- Editar, interrumpir la conexión y recuperar el borrador privado. Si está habilitada una escritura remota, comprobar la revisión guardada y el comportamiento ante una modificación concurrente o confirmación perdida.
- Con otro cliente, guardar cambios en el documento de prueba mientras existe un borrador local. Abrir **Revisar conflicto**, comparar el borrador con la revisión de Proton y preparar una edición manual. Confirmar que la revisión remota solo cambia al pulsar **Guardar en Proton**. Repetir alterando la revisión remota durante la comparación y comprobar que se exige actualizarla.
- Desde **Recuperación**, sin conexión, consultar y exportar el borrador de un archivo ausente y las dos versiones archivadas de una resolución. Verificar que el contenido exportado coincide, cancelar el selector nativo y comprobar que el borrador original sigue disponible.
- En 0.7.0, usar formato, tabla, enlace, diagrama y deshacer o rehacer en un documento sintético. Guardarlo y volver a abrirlo conservando su estructura. En Android, comprobar las herramientas con el teclado visible.
- Con una clave configurada, pedir una respuesta y una propuesta de edición sobre una selección. Cambiar el documento durante otra petición y verificar que cualquier propuesta conserva su destino original. Revisar y aplicar una traducción con enlaces e imágenes y guardar por la vía habitual.
- Generar una imagen sintética y comprobar la vista previa. Subirla, insertarla, guardar el Markdown y abrir desde el otro cliente el documento con su imagen relativa. Verificar que un fallo de subida mantiene la vista previa para reintentar y evita un enlace sin recurso confirmado.
- Confirmar la disponibilidad real de IA, notas manuscritas, importación, exportación y actualizaciones conforme al contrato de esta entrega. Revisar conflicto, papelera e historial privado de IA en sus recorridos propios.

Registrar plataforma y dispositivo, compilación, fecha, pasos y resultado. Una prueba con datos falsos no acredita conexión real ni aceptación instalada.

## Exploración y continuidad

- En **Configuración → Exportación**, guardar un perfil con portada e índice, seleccionarlo al exportar PDF y Word y abrir los resultados. Repetir con Markdown y comprobar el texto original. Cambiar de apartado con el nombre de otro perfil empezado, volver y comprobar que se conserva. Probar salir, descartar, eliminación confirmada y consulta después de perder la respuesta de guardado.
- Desde el menú de una carpeta, crear un documento desde una plantilla inicial o de texto del dispositivo. Revisar las variables y el documento, comprobar destino y nombre, crear y abrir el archivo guardado. Probar un nombre ocupado, cambio de plantilla tras la revisión y pérdida de confirmación. El último caso debe pedir comprobar el destino antes de repetir.

- Abrir **Buscar en el proyecto** desde Archivos y con `Ctrl+Mayús+F` en Windows. Probar nombres, contenido Markdown y una subcarpeta. Completar una búsqueda parcial y comprobar el aviso, la ruta y la navegación al resultado. Mantener `Ctrl+F` en el editor.
- Abrir un `.mdown` y verificar creación, edición, guardado, recarga, duplicación y exportación. Abrir PDF multipágina, Word, Excel y texto UTF-8. Comprobar cambios de página, zoom, selección de hoja, tamaño excesivo y archivo malformado. En `.knote`, comprobar trazos, paso de página y texto guardado.
- Abrir varias pestañas en una carpeta de prueba, ocultar un lateral, reiniciar y reconectar. Comprobar orden, selección y disposición. Repetir con un archivo enviado a la papelera fuera de Neubiki y comprobar el aviso y el acceso a borradores.
- En Android, con una capa abierta, Atrás vuelve a la tarea anterior. Repetir en Configuración, el selector de carpeta y una herramienta del documento. Comprobar primero con el teclado abierto y después desde el contenido de la vista.
- En Actualizaciones, comprobar que un candidato sin canal lo explica. En un canal de prueba, instalar una versión firmada después de proteger el borrador y probar interrupción de la descarga, rechazo de firma, cancelación y retorno a la aplicación.

## Búsqueda y reemplazo entre documentos

- En una carpeta sintética, buscar una misma palabra en Markdown, texto UTF-8, PDF multipágina, Word, Excel y texto guardado de páginas `.nbnote`. Repetir con una nota `.knote` heredada. Cambiar el tipo y la carpeta y verificar la ruta de cada resultado. Los metadatos y el texto de páginas eliminadas quedan fuera de las coincidencias.
- Abrir un resultado PDF en su página, comprobar el resaltado en texto y Word y abrir un resultado Excel de una segunda hoja en AA101. Comprobar nombre de hoja, cabeceras absolutas, foco y resaltado de la celda. Un resultado de otra revisión no aplica el salto. El libro se consulta por valores almacenados, sin recalcular fórmulas; más de 10.000 celdas, 1 MiB de texto o 4 MiB de XML marca esa lectura fallida y la búsqueda parcial.
- Buscar una cadena al final de un archivo de texto de entre 2 y 8 MiB. Añadir un archivo que supere 8 MiB, otro ilegible y un conjunto que exceda 32 MiB de lecturas, 32 documentos o 48 carpetas. Comprobar el aviso de cobertura parcial y el contador de archivos fuera de tamaño. La búsqueda devuelve como máximo 100 resultados y una ubicación por archivo. El visor avisa si el resultado supera su límite de apertura.
- Buscar de nuevo sobre las mismas revisiones y comprobar la reutilización de extracción en memoria. Cambiar una revisión desde otro cliente, repetir y verificar que se lee el contenido nuevo.
- En contenido, elegir hasta 16 Markdown, escribir un reemplazo literal y revisar Original y Propuesta de cada uno. Comprobar que nombres, enlaces y sintaxis afectados se ven completos en la revisión. Cancelar conserva los archivos y borradores.
- Con un Markdown abierto, seleccionar dos o tres resultados Markdown guardados y elegir **Editar documentos con IA**. Cambiar de redacción a traducción e idioma para invalidar el coste anterior. Confirmar el envío solo después de revisar nombres y coste. Verificar propuesta válida, incompatibilidad estructural y texto sin cambios. Seleccionar solo una propuesta compatible y comparar original y propuesta con teclado y toque. Revocar el permiso o cambiar la revisión antes de preparar. Confirmar que los borradores aceptados siguen privados hasta el guardado individual. Ante pérdida de respuesta revisar el consumo y comprobar que la misma confirmación no inicia otro envío.
- Preparar el reemplazo, modificar después un documento o borrador y aplicar. Comprobar el resultado individual y que el documento cambiado conserva su contenido. Los demás resultados confirmados se recuperan como borradores pendientes de guardar en Proton.
- Interrumpir una aplicación después de preparar algún borrador y usar Comprobar resultado. Reabrir Recuperación y comprobar que el intento conserva su resultado por documento. Volver a consultar el mismo intento mantiene las generaciones de los borradores.
- Probar el límite de 2 MiB por documento y 8 MiB entre original y propuesta. Un reemplazo expansivo debe fallar antes de preparar borradores. Una revisión caducada tras 24 horas requiere una nueva preparación.
- Abrir Referencias de un Markdown y buscar enlaces entrantes desde otros documentos sintéticos con rutas relativas y nombres codificados. Elegir **Ver fuente** y comprobar foco en la línea física exacta, conservando líneas vacías. Repetir con un borrador que cambie el número de líneas: debe conservarse y explicar que la ubicación pertenece a la revisión guardada. Probar una fuente movida durante la consulta y un enlace externo. Los enlaces externos se clasifican y permanecen fuera del recorrido de lectura.
- Superar el alcance de enlaces entrantes y verificar el aviso parcial. Se procesan hasta 16 Markdown, 16 carpetas, 100 coincidencias y 2 MiB de texto fuente. Para determinar que se alcanzó el presupuesto puede recibirse un archivo adicional de hasta 2 MiB que queda fuera de los resultados. El límite de 15 segundos se comprueba entre operaciones del SDK.

## Notas manuscritas y modos de IA

- Crear una nota manuscrita desde una carpeta y comprobar que se llama `.nbnote`. Abrir una nota `.knote` existente, trazar con lápiz y toque, cambiar de página, guardar y comprobar que el original conserva su nombre y los datos de ambas páginas.
- Cortar la conexión después de proteger los trazos de la nota, reiniciar y exportar el borrador como `.nbnote` desde Recuperación. Volver a conectarse y comprobar los estados de guardado pendiente, conflicto y publicación confirmada con otro cliente modificando la revisión base.
- Exportar una nota de varias páginas a PDF y a `.nbnote`. Comprobar que PNG y SVG identifican la primera página. Cancelar el selector nativo y revisar el contenido del editor.
- En IA, enviar una consulta en Rápido y otra en Razonar. Revisar el indicador de contexto y comprobar que el intercambio anterior se incluye solo al marcar la opción. Abrir otra pestaña o confirmar una revisión nueva antes de probar la continuación.
- Comprobar el límite de contexto, la denegación del permiso de edición, un fallo del proveedor y el importe disponible del presupuesto de pruebas. Marcar el historial privado en una sola solicitud y verificar que la opción vuelve a desmarcarse.

## Paquetes portables y copia programada

- Desde **Paquetes de proyecto**, preparar un ZIP sintético con Markdown, una nota manuscrita, un recurso compatible y una carpeta vacía. Revisar la exclusión de archivos incompatibles, cancelar el selector y comprobar que el paquete queda disponible para revisar.
- Seleccionar el ZIP preparado, revisar hashes y rutas, elegir un nombre nuevo y confirmar la restauración como copia dentro de Proton. Comprobar bytes, árbol, enlaces relativos y que el proyecto de origen conserva su contenido. Repetir con un destino ocupado.
- Interrumpir la respuesta durante la creación de una carpeta y durante la creación de un archivo. Usar **Comprobar estado**. Confirmar que una carpeta incierta no se toma como propia. Un archivo que coincide en padre, nombre y bytes puede quedar confirmado. Comprobar que se conserva el resultado por archivo tras retirar la preparación.
- Crear desde una plantilla con recursos verificados en una carpeta nueva. Revisar los archivos y abrir el Markdown tras confirmar la copia completa. Comprobar que las imágenes relativas se resuelven y que una copia parcial queda disponible para consulta.
- Activar copia diaria o semanal en una carpeta de prueba. Comprobar que una copia pendiente aplaza otra, que la programación se conserva al reiniciar y que solo se evalúa con el espacio visible y conexión confirmada. Revisar la copia preparada y probar la desactivación.

## Apariencia de Proton

- Abrir **Configuración → Apariencia** en Windows y Android. Recorrer los cuatro perfiles y las doce muestras mediante teclado o toque. Comprobar que **Interfaz** y **Notas** se desplazan con el resto de la página.
- Probar una combinación clara, una oscura y **Contraste**. Comprobar que el marco y la columna izquierda comparten fondo en Archivos y Configuración. Revisar logotipo, árbol, editor, herramientas y menús flotantes. Seleccionar Amarillo y comprobar los tres estados del botón principal, la fila activa y el foco.
- Cambiar escala, tipografía, tamaño normal, tamaño de títulos e interlineado con un borrador abierto. Con texto normal de 16 px, comprobar que el selector ofrece 18–30 px y que H1 parte de 22 px. Volver a la nota y comprobar que el contenido y el borrador se conservan.
- A 85 %, 100 % y 125 %, abrir Exportar, las acciones del árbol y el menú de formato. Confirmar que se escalan, permanecen dentro de la ventana y devuelven el foco al cerrar. En Android, repetir con el teclado visible en un diálogo con campo de texto.
- Provocar un aviso de pegado y un error de subida de imagen con un documento de prueba. Comprobar que el aviso y el error tienen los tonos semánticos de su contexto en Clásico y Nocturno.
- En Android, pasar de Clásico a Lectura, Contraste y Nocturno. Comprobar que las barras de estado y navegación siguen el fondo del marco y mantienen sus iconos legibles al cambiar también el color principal.
- Cambiar dos opciones deprisa y reabrir Neubiki. Verificar que se aplica la última configuración confirmada. Repetir sin conexión a Proton y comprobar el restablecimiento.
- Con una configuración de prueba heredada en Sistema, verificar que el perfil se guarda una vez y se conserva al cambiar el tema del dispositivo.

## Sistema de diseño y componentes

- Identificar vista, IDs y estados afectados en el [catálogo](../product/design-system/componentes.md). Ejecutar los mismos recorridos aplicables en Windows y Android y registrar compilación, plataforma y evidencia.
- Recorrer por teclado y toque acciones, campos y capas. Comprobar foco visible, retorno al disparador, cierre, desplazamiento, etiquetas accesibles y acción disponible con el teclado de Android abierto.
- En una superficie clara, una oscura y Contraste, comprobar la forma y el color contextual. En Configuración, verificar fondo continuo con el marco, selección por relleno e icono y ausencia de borde izquierdo en la fila activa.
- Probar con escala baja y alta, nombres largos y la variante estrecha. Confirmar que no se pierden etiquetas, acciones principales ni señales de estado.
- Si cambia la respuesta de una operación, comprobar icono y texto, estado confirmado, espera, error y recuperación según su contrato. Verificar que una copia privada recuperable se distingue de una escritura remota pendiente y de una revisión confirmada. [Reglas de estado](../product/design-system/fundamentos.md#estados-semánticos).
- En Android, abrir **Herramientas** desde la nota y comprobar que vuelve al mismo borrador y herramienta. Desde una búsqueda, usar **Ver en el documento**. En revisión de IA, alternar **Original** y **Propuesta** sin cambiar el destino capturado.
- Abrir **Estadísticas de IA** con consumo sintético, cambiar la agrupación y el orden de Interacciones. Comparar las barras con los valores y comprobar que los importes no disponibles conservan su marca.

## Grabaciones de reuniones

- Abrir **Grabaciones** desde el menú de cuenta sin conectar Proton. Nombrar una reunión sintética, iniciar, pausar, continuar, cerrar y volver al panel con la captura en curso. Detener, reiniciar la aplicación y reproducir la sesión conservada.
- En Windows, probar micrófono y audio del sistema por separado. En Android, rechazar y luego conceder el permiso de micrófono, enviar la app a segundo plano y comprobar las acciones de pausa, continuar, detener y volver a Grabaciones desde la notificación.
- Configurar la clave de prueba y activar Audio y transcripción. Detener una grabación y comprobar que queda lista sin envío. Abrir **Transcribir**, cancelar y repetir confirmando de forma explícita. Interrumpir la conectividad durante otro trabajo y verificar los fragmentos recuperables y el aviso al reintentar un envío incierto.
- Abrir **Resumen de la reunión**, revisar los fragmentos, alternar los dos modos y cancelar la confirmación de envío. Enviar el texto sintético, comprobar las referencias, editar y guardar. Reabrir y copiar el Markdown. Si se completan nuevos fragmentos, la revisión anterior debe seguir visible y marcar su fuente anterior.
- Probar sin clave y sin capacidad de transcripción. Confirmar que el audio queda disponible y que los mensajes permiten corregir los ajustes antes de reintentar.
- Desde una transcripción parcial y desde un resumen local guardado, abrir **Publicar en Proton**, seleccionar carpeta, cambiar nombre y revisar el documento. Comprobar que el contenido parcial y los fragmentos quedan identificados. Tras publicar, abrir el archivo, repetir la misma revisión y comprobar que se ofrece el resultado existente. Probar también nombre ocupado y confirmación perdida sin duplicar la publicación.

- Abrir audio MP3, WAV, OGG, FLAC y M4A y vídeo MP4/WebM sintéticos de hasta 16 MiB. Verificar controles nativos, ausencia de reproducción automática, cambio de pestaña, recurso liberado al cerrar y error de códec. Probar extensión con cabecera falsa y tamaño excesivo. La compatibilidad del códec depende del WebView de Windows y Android; comprobar cada plataforma instalada.

## Exportación por lotes desde Proton

- [ ] Desde la raíz, abrir «Exportar por lotes…», recorrer carpetas con teclado y seleccionar documentos en varias carpetas (máximo 32). Cerrar devuelve el foco al árbol.
- [ ] Preparar versiones guardadas de Markdown y notas manuscritas como PDF, elegir un perfil para PDF/Word y verificar que los borradores privados quedan excluidos.
- [ ] Modificar una revisión seleccionada en otro cliente: se omite ese documento con explicación; guardar un lote parcial exige confirmar las omisiones. Verificar imágenes, diagramas y tildes.
- [ ] Exportar Markdown con imágenes relativas: el ZIP contiene destinos locales por hash y manifiesto; los enlaces documentales conservan su referencia original (no es un paquete de proyecto).
- [ ] Cancelar el selector de destino: el lote permanece preparado. Reiniciar, consultar el mismo lote y elegir destino de nuevo.
- [ ] Interrumpir una entrega: vuelve como pendiente/sin confirmar, permite comprobar y evita repetirla. Retirar solo elimina el ZIP privado, conservando destino, fuentes y recibo.
- [ ] Android: comprobar desplazamiento, retorno físico, pérdida de conexión, selector SAF y guardado ZIP. Windows: comprobar guardado nativo y bloqueo de cierre mientras una acción está pendiente.

## Recursos e impacto de rutas

- Abrir Recursos del proyecto, filtrar nombre y tipo (PDF, audio, vídeo y demás), abrir un archivo y verificar su alcance. Probar error, desconexión, actualización y más de 200 archivos o 16 carpetas; el catálogo parcial debe conservar su aviso. Solo se consultan metadatos.
- Antes de renombrar o mover un archivo, elegir Revisar enlaces afectados. Dos enlaces desde la misma nota deben contar dos ocurrencias con línea y destino literal. Cero enlaces se distingue de consulta parcial o fallida. Cambiar revisión, nombre o carpeta de origen durante la consulta debe invalidarla.
- Al mover Markdown, comprobar destinos relativos distintos y el aviso de revisión manual. Al mover una carpeta, comprobar enlaces desde fuera y enlaces de su contenido que atraviesan el límite de la carpeta. Al renombrarla, comprobar enlaces que usan su nombre y enlaces internos con ruta directa. Los límites de cobertura son 16 documentos, 16 carpetas, 100 resultados, 2 MiB procesados y hasta un archivo adicional de 2 MiB para detectar el límite. Confirmar que la consulta carece de efectos en Proton.

## Favoritos compartidos en Proton

- Marcar y retirar un archivo desde su menú. Comprobar estrella, revisión confirmada y visibilidad desde otro cliente conectado al mismo proyecto. Las carpetas quedan fuera de esta acción. Abrir Favoritos y recorrer más de 20 archivos con teclado y toque; los nombres se consultan sin descargar contenido.
- Borrar o mover un favorito fuera de la raíz desde otro cliente. La lista conserva una entrada ausente/no disponible y permite retirarla; no debe bloquear cambios a otros favoritos conservados.
- Modificar los favoritos desde otro cliente antes de aplicar el cambio local. La base obsoleta se rechaza y se solicita actualización. Perder la respuesta después de escribir: el intento privado sobrevive al reinicio, bloquea otro cambio y Comprobar solo lee hasta confirmar la operación. Una base sin cambios tras un fallo incierto sigue sin probar que la operación no se aplicó.
- Cuando Comprobar siga dejando un intento pendiente, abrir **Revisar la lista actual** y comprobar el retorno de foco al elegir **Volver**. Cambiar la revisión de esa lista desde otro cliente durante la revisión para verificar que la confirmación obsoleta se rechaza. Revisar de nuevo, elegir **Continuar con la lista de Proton**, reiniciar y comprobar el aviso de cierre sin confirmación y que otra acción parte de la revisión actual.
- Colisionar el nombre reservado con una carpeta, variante de mayúsculas o un JSON sin propietario/esquema válido. No sobrescribirlo. El archivo interno queda oculto de árbol, catálogo y búsqueda y no se puede crear, importar, renombrar o mover mediante acciones ordinarias.
- Probar 200 identidades, 64 KiB y pérdida de conexión durante una página. La lista muestra consulta parcial y separa errores de lectura de elementos ausentes.

## Copias portables de Proton

- [ ] Preparar una raíz con Markdown (.md/.markdown/.mdown), notas .nbnote/.knote, imágenes/adjuntos y carpetas vacías. Verificar bytes, nombres, estructura, exclusiones y límites; aceptar explícitamente si la copia es parcial.
- [ ] Guardar en Windows/SAF Android; cancelar destino y reabrir; comprobar que una entrega incierta no se repite. Alterar un ZIP privado de prueba: catálogo/entrega deben bloquearlo.
- [ ] Revisar un ZIP mediante el selector nativo. Rechazar traversal, alias de caso/Unicode, entradas no declaradas, CRC/hash erróneos y paquetes fuera de presupuesto. No debe crear un proyecto local ni incorporar configuración.
- [ ] Restaurar en una carpeta nueva del ámbito abierto. Nombre ya existente impide iniciar; confirmar nombre/paquete y verificar cada archivo en Proton byte por byte. Mantener los originales y documentos abiertos.
- [ ] Perder respuesta de una subida: queda pendiente, consulta observa bytes exactos y evita repetir creación. Perder respuesta de la carpeta inicial: queda sin confirmar, no se atribuye ni vuelve a crear automáticamente.
- [ ] Detener entre entradas y cerrar el proceso en un caso de prueba: conservar parciales y recibos. Retirar staging conserva resultados consultables; no elimina la copia remota ni el ZIP original.
- [ ] Comprobar cambio/renombrado de carpeta destino desde otro cliente: detener nuevas escrituras si la cadena de carpetas cambia. Revisar foco, Escape, Back Android, desplazamiento y bloqueo de cierre con apply sin respuesta.

- Con la interfaz en English, abrir Search project, Content y el filtro File type. Buscar texto español en un archivo con tildes; el resultado conserva nombre, ruta y fragmento. Cambiar el idioma con la consulta abierta sin reiniciar la búsqueda ni alterar su texto.
- Con English, abrir **Document tools** y **More options** en ancho estrecho. Navegar a **Block format** y aplicar **Heading 2**. Probar foco y salida con teclado, controles de resaltado, nombre de archivo sin traducir y título de exportación. En el selector nativo, comprobar el idioma de los controles propios del sistema.
- En Review replacement across documents, comparar Original/Proposal con enlaces y código literales. Preparar borradores y provocar una respuesta incierta: Check result consulta el mismo intento y no repite la aplicación. Verificar nombres, resultado individual y foco accesible en ambas anchuras.
- En References, elegir Find incoming links y View source de una nota española. Confirmar línea y revisión de origen. En Project resources y Review affected links, verificar tipos, estado parcial y destinos literales sin traducir. Los detalles procedentes del runtime pueden conservar su idioma de origen.

## Aplicar plantillas con adjuntos en Proton

- [ ] Elegir plantilla con PDF/Word/Excel/texto adjunto, rellenar campos y revisar contenido y lista de recursos. Cambiar un campo o selección invalida el preview.
- [ ] Preparar paquete y revisar carpeta nueva bajo la carpeta elegida en el árbol. Rechazar colisiones; no subir adjuntos sueltos ni un documento incompleto.
- [ ] Confirmar la creación y verificar bytes, nombre Unicode con espacios y enlace con fragmento/consulta. Abrir el documento solo al completarse todo el plan; sus enlaces deben resolver dentro de la carpeta nueva.
- [ ] Perder respuesta/detener durante recursos: conservar diario y parciales, no repetir operaciones desconocidas. Reabrir desde Copias portables muestra destino conservado y resultados.
- [ ] Plantilla o adjunto cambiado entre preview/preparación: exigir nueva revisión. Comprobar cuenta/raíz cambiada, padre renombrado/movido fuera de ámbito y desconexión.

- Con English, abrir PDF y comprobar Previous/Next page, zoom, Page/Width, Search this page y mensajes internos de carga/fallo. Cambiar el idioma con una posición abierta conserva la página, búsqueda y documento cargado. Probar texto UTF-8 con tildes y Next/Previous match.
- Abrir Word y Excel en English: la hoja, cabeceras, celda y valores conservan su texto original; controles y cobertura parcial usan el idioma activo. Un detalle de error nativo sigue literal. Reintentar consulta la misma revisión.
- Cambiar de español a inglés mientras se reproduce un medio o se enfoca una línea de fuente. Conservar el recurso multimedia, controles sin reproducción automática y foco; la etiqueta de línea cambia, las líneas vacías y los enlaces Markdown permanecen intactos.

## Perfiles de exportación compartidos

- Abrir Perfiles compartidos en un proyecto conectado. Revisar la colección guardada del dispositivo y del proyecto; publicar exige confirmar nombres y sustitución. Probar catálogo vacío,32 perfiles, nombre ocupado por otro archivo/carpeta y metadatos de propietario/esquema incorrectos. No se debe sobrescribir una colisión ni cambiar la plantilla del dispositivo.
- Cambiar el catálogo local o remoto después de abrir la confirmación. La publicación debe pedir una nueva revisión. Probar campos desconocidos, una ruta de fuente o recurso en un perfil y un nombre con separadores: no deben enviarse como perfil compartido. El nombre técnico/fecha del dispositivo queda fuera del estilo publicado.
- Perder la respuesta de publicación y reiniciar: Comprobar consulta el mismo intento y no publica de nuevo. Un cambio sin confirmar bloquea otra publicación; el catálogo solo se confirma con operationId y digest coincidentes.
- En Exportar y Exportar por lotes, elegir un perfil del grupo Proyecto y exportar Markdown como PDF/Word. Verificar estilos, portada, índice y resolución de diagramas. Cambiar el perfil desde otro cliente durante la conversión: se rechaza el resultado/lote obsoleto y no se mezclan estilos. Exportar Markdown ignora perfiles; el manuscrito mantiene su formato propio.
- Recorrer listas, confirmación, selector y avisos en español e inglés, con teclado/toque y ancho Android. Cerrar devuelve el foco; durante publicación se protege la salida. Probar desconexión y permisos de solo lectura conservando los catálogos existentes.

## Índice de contenido e investigación

- Activar el índice desde Buscar contenido. Buscar, reiniciar Neubiki y repetir. La lectura del árbol confirma la revisión actual y el texto guardado se reutiliza. Cambiar la revisión desde otro cliente y verificar que desaparece el resultado antiguo.
- Desconectar, vaciar el índice, revisar el contador y desactivar su uso. Probar raíz distinta, índice fuera de límite y un borrador abierto. Los controles locales solo afectan el índice de la raíz elegida.
- Adjuntar dos documentos guardados al asistente, abrir Investigación y elegir si se incluyen en la síntesis. Revisar la estimación total y confirmar. Verificar que la búsqueda recibe solo la pregunta pública y que los extractos entran en la síntesis sin herramientas web.
- Cambiar una revisión o el presupuesto entre la búsqueda pública y la síntesis, o perder la respuesta de la segunda etapa. El informe público y sus citas quedan accesibles. La app muestra el resultado de la síntesis y evita reintentos automáticos.
- Revisar un recibo de investigación por su identificador desde el mismo documento y cuenta. Probar un reinicio, otra raíz y una cuenta desconectada. La conservación del informe público debe comenzar desmarcada. Comprobar que el informe optativo caduca a los siete días y que la consulta devuelve el estado sin repetir búsqueda ni síntesis.
- En una copia pública conservada, cancelar primero **Eliminar copia** y verificar que sigue disponible. Confirmar la retirada y consultar de nuevo. Debe desaparecer la copia y conservarse el recibo, incluidos estado y consumo. Repetir mientras la síntesis continúa y comprobar que un punto de control posterior no vuelve a conservar el informe.
- Desde **Búsqueda por significado**, elegir **Proyecto** y buscar un concepto expresado con otras palabras en una carpeta anidada. Revisar las revisiones, la cobertura y sus límites, el coste y el consentimiento. Cambiar una revisión observada y confirmar que se pide una nueva revisión. Probar el ámbito de fuentes seleccionadas y los recorridos con teclado y toque.
- Conducir la sugerencia de reemplazo desde Buscar contenido con un Markdown activo y dos resultados guardados distintos. Revisar coste, aceptar la frase y comprobar que solo se rellena el campo. Cambiar la indicación o una revisión antes de confirmar, probar pérdida de respuesta y revisar los borradores de cada documento por el flujo habitual.

## Actualización entre versiones instaladas

- Instalar 0.7.0 en Windows x64 y Android ARM64 desde los paquetes cuyo SHA-256 figura en los recibos de esa versión. Crear un borrador reconocible, dejar una búsqueda y el idioma en English, y reiniciar. Abrir Actualizaciones y comprobar el estado de la versión sin canal. Instalar la nueva versión encima, mediante MSI y NSIS en dos instalaciones Windows separadas y mediante APK en Android. Comprobar versión, sesión de prueba, idioma y texto exacto del borrador tras el reinicio.
- Partir de una compilación anterior que tenga configurado el canal de prueba de Neubiki. Usar los mismos identificadores, clave pública Tauri y firma Android que la versión de la campaña. Hacer que el canal ofrezca una compilación firmada con un número de versión superior y registrar el manifiesto recibido, la versión detectada y el SHA-256 del artefacto. Probar actualización con un borrador y añadir texto mientras descarga. Confirmar que vuelve a protegerlo antes de abrir el instalador y que el texto añadido reaparece al reiniciar.
- Repetir con el manifiesto sin una versión superior, descarga interrumpida, firma o hash inválidos y cancelación del instalador. Registrar que el cliente anterior sigue abriendo el proyecto. En Android, probar solicitud y concesión del permiso para instalar y el regreso a la aplicación. Verificar el caso exitoso tras recuperar la conexión.
- Una vez publicado el canal, consultar los manifiestos desde la misma red que los dispositivos y verificar que las URLs de los paquetes resuelven, que la versión, las plataformas y las firmas coinciden y que una instalación conectada al canal recibe la oferta. Tras actualizar, registrar la versión mostrada y verificar la recuperación del borrador.

## Capturar una nota Proton como plantilla reutilizable

- [ ] Desde una nota Markdown guardada, abrir «Guardar como plantilla» y revisar versión, nombre/descripción, contenido visual y recursos. Verificar ES/EN y foco inicial en el nombre; los nombres/contenido originales no se traducen.
- [ ] Mantener un borrador diferente abierto: el preview y la plantilla deben proceder de la revisión guardada, sin publicar ni capturar el borrador. Se requiere confirmación explícita antes del guardado local.
- [ ] Incluir PNG/JPEG/WebP relativos y adjuntos PDF/Word/Excel/texto/CSV, con espacios, Unicode, + y fragmento/consulta; verificar hash/bytes, enlaces y aplicación posterior mediante carpeta nueva.
- [ ] Cambiar documento o recurso desde otro cliente entre revisión y guardado: rechazar la captura anterior. Recursos fuera de ámbito, formatos no admitidos, imágenes externas, rutas codificadas inválidas y límites excedidos no producen plantillas parciales.
- [ ] Perder respuesta del guardado: bloquear otra captura y cierre hasta comprobar la misma operación; saved confirma una única plantilla, not-recorded exige nueva confirmación, retired no resucita el registro. Comprobar no debe requerir volver a descargar contenido.
- [ ] Cuenta/raíz o revisión activa cambiada durante una lectura: ignorar respuesta antigua. Guardar en acceso Proton de solo lectura debe funcionar cuando el contenido es legible y la biblioteca local está disponible.
- [ ] Exportar la plantilla guardada: conservar Markdown/recursos, excluyendo captureDigest e identidad privada de la cuenta. Reiniciar, consultar biblioteca y aplicar la plantilla en Windows/Android.

## Instantáneas de plantillas compartidas

- [ ] Abrir Plantillas compartidas: cargar solo biblioteca y recibos locales. Pedir expresamente Leer instantáneas de Proton y revisar archivos de la raíz, estado parcial y nombres Unicode.
- [ ] Seleccionar plantillas personales y un nombre nuevo *.neubiki-templates.json. Revisar contenido visual, recursos y hash, confirmar y verificar un archivo nuevo con los permisos existentes. No cambiar ajustes, borradores ni archivos previos.
- [ ] Cambiar nombre/selección/revisión después de revisar: exigir revisión nueva. Rechazar colisión con archivo/carpeta, alias de caso/Unicode, 33 plantillas, archivo mayor de 8 MiB, formato desconocido y recursos inválidos.
- [ ] En acceso de solo lectura, importar una selección revisada con nombres locales. Un nombre ocupado por contenido diferente debe exigir otro; contenido idéntico queda existente. Confirmar resultado individual y aplicación posterior de enlaces/recursos con el materializador normal.
- [ ] Perder la respuesta al publicar: Comprobar verifica el mismo intento con bytes y revisión frescos, sin repetir creación. Mover/cambiar el archivo desde otro cliente impide confirmarlo. La ausencia actual sigue pendiente.
- [ ] Interrumpir la importación y reiniciar: comprobar recibo local sin conexión, conservar resultados parciales y evitar repetición. Llegar al límite de recibos debe conservarlos y rechazar una operación adicional.
- [ ] Comprobar ES/EN sin traducir contenido/nombres, teclado/Escape, Back Android, desplazamiento y retorno del foco; cambio de cuenta/raíz durante revisión descarta respuesta obsoleta. La vista previa no descarga imágenes externas ni abre enlaces implícitamente.
