# Neubiki

Neubiki es una aplicación independiente de Windows y Android. Trabaja sobre una carpeta elegida de Proton Drive y abre documentos Markdown con Milkdown. Conserva los nombres, rutas relativas y formatos de los archivos del usuario.

El objetivo de producto es conservar toda la funcionalidad de usuario de la aplicación original. Esto incluye el editor completo de Markdown, la IA contextual, la traducción, la generación de imágenes, las notas manuscritas, la búsqueda, el historial y la restauración, la grabación y la importación y exportación. Las funciones se adaptan al proyecto en Proton Drive y se validan en Windows y Android conforme se incorporan.

La definición de las vistas, los componentes y su evolución se mantiene en el [sistema de diseño de Neubiki](design-system/README.md).

## Primera versión del flujo remoto

La prueba inicial cubre una cuenta de Proton, la selección de una carpeta existente, la navegación bajo esa carpeta y la apertura de Markdown e imágenes relativas. La interfaz declara las capacidades disponibles. Guardar el archivo remoto requiere que el proveedor proteja la revisión base; sin esa garantía la edición queda en un borrador privado recuperable. Un guardado no confirmado se presenta como pendiente de comprobación.

El candidato 0.6.0 validó el flujo inicial con Proton Drive. El [plan de implementación](../development/neubiki-implementation-plan.md) recoge los avances y la aceptación de cada ampliación. La instalación no migra proyectos ni sesiones.

## Comportamiento objetivo

- El acceso, navegación y operaciones definitivas de proyecto requieren conexión. Se lee primero la raíz, cada carpeta al abrirla, y se actualiza el árbol según los eventos del proveedor.
- Los datos compartidos residen en Drive. El dispositivo conserva ajustes privados, credenciales protegidas y temporales para recuperación y procesamiento. Un borrador se retira tras confirmar su guardado o al descartarlo expresamente.
- La comparación, restauración y papelera se apoyan en Proton. Las tareas programadas requieren una instancia activa y conectada. Cualquier traslado de un proyecto previo se prepara como copia y se verifica en otra carpeta.
- Windows y Android usan el runtime Rust y el conector Proton dentro de la aplicación. La interfaz no ofrece rutas de trabajo sobre carpetas del dispositivo, replicación ni repositorios.

## Espacio de trabajo

En ancho de escritorio, el panel izquierdo comparte fondo con el marco y contiene la carpeta de Proton, el árbol y el menú de cuenta. El documento ocupa la superficie central y sus herramientas el panel derecho. El perfil de Apariencia determina los colores. En un móvil en vertical se alterna entre Archivos y el documento, y las herramientas se abren a pantalla completa dentro del espacio de trabajo.

En escritorio, los laterales se pliegan por separado y recuperan su ancho al desplegarse. El ancho se ajusta desde cada separador.

El árbol abre las opciones de cada elemento con clic derecho, el teclado o el botón de tres puntos. Las carpetas permiten crear documentos, subcarpetas y notas manuscritas. **Crear desde plantilla…** revisa el Markdown de una plantilla de texto y crea un archivo en la carpeta elegida. Los elementos se pueden renombrar, mover dentro del espacio o enviar a la papelera de Proton. En Markdown, el menú también permite duplicar la revisión guardada y abrir la exportación del documento.

En Windows, arrastrar un archivo o carpeta del árbol a otra carpeta o al encabezado **Archivos** prepara un traslado. El destino resaltado se abre en la confirmación de **Mover**. Para copiar desde el Explorador, suelta archivos o carpetas sobre esos mismos destinos y revisa el contenido antes de importar. La copia conserva la estructura y las carpetas vacías. En Android, **Mover…** e **Importar archivos…** están disponibles en el menú de opciones.

La importación admite hasta 8 MiB por archivo, 500 elementos y 32 niveles por selección. Se detiene en el primer conflicto o resultado incierto y muestra lo que Proton ya confirmó. Los elementos presentes en el destino conservan su contenido.

Cada documento abierto tiene una pestaña. Al cambiar o cerrar la pestaña activa, el editor protege primero los cambios como borrador privado. La pestaña marca los guardados pendientes en Proton y el pie del editor ofrece el guardado, la relectura y las acciones de recuperación.

El dispositivo recuerda hasta ocho pestañas por carpeta de trabajo y la disposición de los paneles. Al volver a conectar, Neubiki comprueba los archivos con Proton antes de reabrirlos y avisa si alguno ya no está disponible. **Recuperar borradores**, en el menú de cuenta, permite revisar y exportar copias locales aunque el archivo remoto no pueda abrirse.

**Buscar en el proyecto** consulta nombres y contenido guardado de Markdown, PDF con capa de texto, Word, Excel, texto UTF-8 y notas manuscritas con texto reconocido. Permite acotar por carpeta y formato e indica si la cobertura es parcial. Los resultados muestran un extracto y, cuando procede, la línea o página. **Revisar reemplazo** compara el Markdown original y el propuesto de los archivos seleccionados y prepara borradores privados tras la confirmación. Cada documento se guarda en Proton desde su editor. En Windows, `Ctrl+Mayús+F` abre la búsqueda. **Referencias**, en las herramientas de la nota Markdown, muestra destinos y documentos que enlazan a la nota guardada desde la carpeta de trabajo. La consulta entrante muestra ruta, línea y cobertura parcial cuando corresponde.

Las pestañas de referencia muestran PDF, texto UTF-8, texto por párrafos de Word, celdas guardadas de Excel y audio y vídeo compatibles. Excel sitúa el resultado en la hoja y celda encontradas y muestra un área de hasta 100 filas y 26 columnas. Se muestran los límites de tamaño, cobertura o formato. La revisión del impacto de una ruta identifica enlaces relativos de revisiones guardadas antes de mover o renombrar archivos y carpetas.

### Notas manuscritas de Neubiki

El formato de las notas nuevas y de las exportaciones editables es `.nbnote`. Neubiki también reconoce, edita y guarda las notas `.knote` existentes en su ubicación y con su nombre. El editor permite revisar OCR, transcripción y dibujo asistido por página, combinar páginas ante un conflicto e insertar el PNG de una página en Markdown con enlace a la nota original. Los trazos se conservan en borradores privados mientras el guardado en Proton está por confirmar. **Recuperar borradores** ofrece exportar la nota editable aunque el original remoto no esté disponible.

El menú de cuenta reúne el inicio y cierre de sesión de Proton, la configuración, las estadísticas de IA y las grabaciones de reuniones. Se puede abrir cada una sin elegir una carpeta de Drive.

Configuración usa el espacio de trabajo en dos columnas. Los apartados ocupan el lateral izquierdo y el apartado activo ocupa el centro. Volver recupera la vista anterior, sus pestañas y el estado de los laterales. En móvil, el índice y el apartado se muestran sucesivamente.

Exportar está al pie del editor. Markdown, PDF y Word parten del contenido visible del documento, incluido el borrador. Windows usa el diálogo de guardado y Android el selector de archivos del sistema. PDF y Word aplican la plantilla activa o un perfil de este dispositivo o del proyecto e incorporan los diagramas y las imágenes relativas disponibles en Proton. Los perfiles pueden incluir portada e índice. Markdown conserva sus enlaces relativos. La exportación por lotes y los paquetes portables trabajan con revisiones guardadas. Puedes guardar una revisión Markdown y sus recursos como plantilla de este dispositivo, revisar paquetes y restaurarlos en una carpeta nueva.

Los apartados de IA recuperan la selección de modelos, la clave protegida, los permisos, las capacidades y las habilidades. El asistente puede incluir hasta tres intercambios anteriores del mismo documento y revisión, hasta tres fuentes guardadas elegidas para la consulta y, si Visión está habilitada, una imagen. El dictado se revisa antes de incorporarlo a la consulta o al editor. La investigación permite consultar primero la web con una pregunta pública y después sintetizar el resultado con las fuentes guardadas aceptadas para ese envío. La generación de imágenes aplica su modelo, tamaño, calidad y formato.

La búsqueda de contenido puede guardar texto extraído en un índice privado del dispositivo para la carpeta actual. La opción se activa expresamente y puede vaciarse sin afectar los borradores. Las búsquedas verifican en Proton la identidad y la revisión antes de reutilizar el texto.

Desde **Historial de IA** se pueden consultar los resultados que se hayan elegido conservar y borrarlos antes de que caduquen. Los resultados permanecen en este dispositivo durante un máximo de siete días. El [plan de implementación](../development/neubiki-implementation-plan.md) registra la cobertura y la validación pendiente.

Validar primero con datos sintéticos: abrir un Markdown con imagen en ambas plataformas, recuperar un borrador tras una interrupción y, cuando el proveedor permita escrituras protegidas, comprobar el guardado y las ediciones concurrentes.

La integración con Proton se plantea para evaluación personal no comercial bajo [las directrices del SDK de Proton Drive](https://github.com/ProtonDriveApps/sdk#usage-guidelines-for-personal-projects).

## Grabaciones de reuniones

**Menú de cuenta → Grabaciones** permite nombrar, iniciar, pausar, continuar, detener y reproducir una reunión. Windows admite micrófono y audio del sistema. Android graba desde el micrófono y mantiene la captura en un servicio en primer plano. Cerrar el panel mantiene la captura activa. Las sesiones se conservan en el directorio privado de Neubiki en este dispositivo.

**Transcribir** solicita confirmación antes de enviar fragmentos de audio a OpenAI. Requiere una clave configurada y la capacidad Audio y transcripción activada. Se conservan los fragmentos recibidos si se interrumpe el procesamiento. Si OpenAI pudo recibir el audio y falta la respuesta, se advierte del posible consumo duplicado antes de reintentar. El texto se puede consultar por intervalos de captura. La primera versión trabaja con intervalos de fragmentos y no atribuye hablantes.

**Resumen de la reunión** utiliza la habilidad versionada **Resumen de reuniones**. La persona elige **Resumen ejecutivo** o **Acta estructurada**, puede añadir indicaciones y confirma el envío del texto. Si quedan fragmentos pendientes, el resultado se presenta como parcial. Se pueden comprobar sus referencias, editar el Markdown y guardar la versión revisada en este dispositivo. El resumen guardado se puede copiar como Markdown e incorporar a un documento mediante el flujo normal del editor de Proton.

El envío para resumir admite hasta 120 KiB de fuente e indicaciones. Si se supera ese límite, la sesión conserva el texto completo para consultarlo.
