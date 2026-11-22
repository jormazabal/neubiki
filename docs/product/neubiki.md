# Neubiki

Neubiki es una aplicación independiente de Windows y Android. Trabaja sobre una carpeta elegida de Proton Drive y abre documentos Markdown con Milkdown. Conserva los nombres, rutas relativas y formatos de los archivos del usuario, incluidas las notas `.knote`.

El objetivo de producto es conservar toda la funcionalidad de usuario de la aplicación original. Esto incluye el editor completo de Markdown, la IA contextual, la traducción, la generación de imágenes, la edición de notas `.knote`, la búsqueda, el historial y la restauración, la grabación y la importación y exportación. Las funciones se adaptan al proyecto en Proton Drive y se validan en Windows y Android conforme se incorporan.

## Primera versión del flujo remoto

La prueba inicial cubre una cuenta de Proton, la selección de una carpeta existente, la navegación bajo esa carpeta y la apertura de Markdown e imágenes relativas. La interfaz declara las capacidades disponibles. Guardar el archivo remoto requiere que el proveedor proteja la revisión base; sin esa garantía la edición queda en un borrador privado recuperable. Un guardado no confirmado se presenta como pendiente de comprobación.

El candidato 0.6.0 valida el flujo inicial con Proton Drive. Queda pendiente adaptar y verificar el resto del editor y las demás funciones del producto, entre ellas la creación de carpetas, la edición de `.knote`, el historial y la restauración, la búsqueda global, la IA, la traducción, la generación de imágenes, la grabación y la importación y exportación. La instalación no migra proyectos ni sesiones.

## Comportamiento objetivo

- El acceso, navegación y operaciones definitivas de proyecto requieren conexión. Se lee primero la raíz, cada carpeta al abrirla, y se actualiza el árbol según los eventos del proveedor.
- Los datos compartidos residen en Drive. El dispositivo conserva ajustes privados, credenciales protegidas y temporales para recuperación y procesamiento. Un borrador se retira tras confirmar su guardado o al descartarlo expresamente.
- La comparación, restauración y papelera se apoyan en Proton. Las tareas programadas requieren una instancia activa y conectada. Cualquier traslado de un proyecto previo se prepara como copia y se verifica en otra carpeta.
- Windows y Android usan el runtime Rust y el conector Proton dentro de la aplicación. La interfaz no ofrece rutas de trabajo sobre carpetas del dispositivo, replicación ni repositorios.

Validar primero con datos sintéticos: abrir un Markdown con imagen en ambas plataformas, recuperar un borrador tras una interrupción y, cuando el proveedor permita escrituras protegidas, comprobar el guardado y las ediciones concurrentes.

La integración se plantea para evaluación personal no comercial bajo [las directrices del SDK de Proton Drive](https://github.com/ProtonDriveApps/sdk#usage-guidelines-for-personal-projects).
