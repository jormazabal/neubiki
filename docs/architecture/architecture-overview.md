# Arquitectura de Neubiki

React presenta la cuenta, la raíz seleccionada, el árbol y el editor Milkdown. `apps/desktop/src/lib/api` contiene los contratos de acceso al runtime; los componentes muestran el estado y despachan acciones.

La [arquitectura de componentes](componentes-ui.md) define la composición del frontend de Windows y Android, las dependencias permitidas y el proceso para extender la interfaz.

Tauri expone comandos que delegan en servicios Rust. El conector Proton se carga en proceso en Windows y Android y es la única autoridad sobre los archivos del proyecto. El runtime valida el alcance de la carpeta seleccionada, conserva identificadores y revisiones de Drive y determina si puede garantizar una escritura condicionada. Las credenciales viven en el almacenamiento protegido de cada plataforma; los borradores privados y temporales pertenecen al directorio de datos de Neubiki.

OpenAI se utiliza desde Rust. El motor `neubiki-recording` conserva audio, fragmentos y recibos de transcripción en el directorio privado de grabaciones. El coordinador de Windows y el servicio y worker de Android comparten el mismo contrato de sesión. El modo reunión requiere consentimiento al encolar y completa la transcripción en la propia sesión.

Las habilidades base se empaquetan en `neubiki-ai-skills` con un `manifest.json` y un `SKILL.md` versionados. El manifiesto declara modos, acciones, validadores y requisitos. Al añadir una habilidad se registra en el catálogo y se prueba qué capacidades permiten activarla. La revisión de reuniones selecciona `neubiki.meeting_summary` y su modo explícito. El runtime valida la elección y envía a OpenAI los fragmentos confirmados, la indicación de fuente parcial y las indicaciones adicionales. La habilidad produce una propuesta de texto sin herramientas.

El contrato `/api/proton/meetings/{id}/summary` consulta, genera y guarda la revisión. Generar comprueba el consentimiento, la versión de la fuente y el presupuesto. Guardar valida las referencias y la revisión previa y escribe `summary.json` de forma atómica en la sesión privada. El [diseño del producto](../product/neubiki.md) define los usos locales y remotos.
