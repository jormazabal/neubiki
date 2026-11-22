# Cambios de Neubiki

## 0.7.0 — candidato local

- Editor visual de Proton con barra de formato, menú contextual, selección Markdown, búsqueda, reemplazo, tablas, enlaces, imágenes, diagramas y deshacer y rehacer.
- Navegación compacta y panel de herramientas para IA, traducción e imágenes. En Android, el editor ocupa el ancho y las herramientas se abren bajo demanda.
- IA contextual en modo Rápido y traducción de selección o documento. Las propuestas se revisan y se aplican al borrador vinculado a su contexto original.
- Generación y subida de imágenes al espacio de Proton. Los enlaces relativos se insertan tras verificar los bytes en Drive y el destino del editor.

Consulta la [validación de la 0.7.0](docs/releases/0.7.0.md).

## 0.6.0 — candidato local

- Identidad independiente para Windows y Android, incluidos nombres de paquetes, rutas privadas, puente nativo de Proton y recursos de marca.
- Los instaladores de prueba no usan un canal de actualización.
- Cuenta Proton, selección de carpeta, navegación por demanda y lectura de Markdown con imágenes relativas desde Drive.
- Borradores privados por documento y revisión base; contratos de guardado condicionado, conflicto y comprobación de un resultado incierto sin repetir la escritura.
- Windows x64 y Android ARM64, con Android 10 como mínimo. El conector del SDK se carga dentro de la aplicación.
- Guardado remoto validado con Proton Drive en Windows x64 y en el emulador de Android con el APK ARM64. Windows cubrió revisión obsoleta, concurrencia y confirmación perdida. Android cubrió guardado y relectura, conflicto con una revisión web y recuperación del borrador tras desconexión y reinicio.
- El historial completo de revisiones y las funciones pendientes de adaptación no se ofrecen como disponibles.

Consulta el [estado y la validación de la entrega](docs/releases/0.6.0.md).
