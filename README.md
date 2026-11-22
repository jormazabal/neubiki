# Neubiki

Neubiki es una aplicación Tauri para Windows y Android que trabaja con proyectos Markdown alojados en Proton Drive. Usa React, Milkdown y servicios Rust que corren en el dispositivo.

Descarga la [versión estable de Neubiki](https://github.com/jormazabal/neubiki/releases/latest) para Windows x64 o Android ARM64, desde Android 10. Si instalaste un candidato 0.6.0 o 0.7.0, instala primero esta versión sobre la anterior. En Windows, usa el mismo tipo de instalador que tenías. A partir de esta entrega, consulta las versiones siguientes en **Configuración → Actualizaciones**.

La versión de desarrollo se indica en [VERSION](VERSION). Consulta el [diseño del producto](docs/product/neubiki.md), la [arquitectura](docs/architecture/architecture-overview.md) y el [procedimiento de compilación y distribución](docs/development/release-process.md).

Para desarrollar la interfaz, instala las dependencias con `pnpm install --frozen-lockfile` y ejecuta `pnpm dev`. El navegador sirve para revisar la interfaz; las pruebas de cuenta y almacenamiento requieren una compilación nativa y el conector Proton. Las recetas nativas están en [native/proton-sdk](native/proton-sdk/README.md).

Este proyecto se distribuye bajo [Apache 2.0](LICENSE), con sus [atribuciones](NOTICE) y [avisos de terceros](THIRD_PARTY_NOTICES.md).
