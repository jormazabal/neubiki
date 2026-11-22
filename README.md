# Neubiki

Neubiki es una aplicación Tauri para Windows y Android que trabaja con proyectos Markdown alojados en Proton Drive. Usa React, Milkdown y servicios Rust que corren en el dispositivo.

La versión de desarrollo se indica en [VERSION](VERSION). Consulta el [diseño del producto](docs/product/neubiki.md), la [arquitectura](docs/architecture/architecture-overview.md) y el [procedimiento de compilación y distribución](docs/development/release-process.md). Los canales públicos de descarga y actualización todavía no están configurados.

Para desarrollar la interfaz, instala las dependencias con `pnpm install --frozen-lockfile` y ejecuta `pnpm dev`. El navegador sirve para revisar la interfaz; las pruebas de cuenta y almacenamiento requieren una compilación nativa y el conector Proton. Las recetas nativas están en [native/proton-sdk](native/proton-sdk/README.md).

Este proyecto se distribuye bajo [Apache 2.0](LICENSE), con sus [atribuciones](NOTICE) y [avisos de terceros](THIRD_PARTY_NOTICES.md).
