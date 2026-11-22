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

## Editor, propuestas y recursos en 0.7.0

La aplicación conecta las herramientas de Milkdown con el borrador de Proton. Una propuesta de IA, traducción o imagen captura cuenta, carpeta, documento, revisión base, contenido y destino del editor. Solo se aplica a ese estado y genera cambios en el borrador. La escritura en Drive requiere el guardado condicionado del documento.

Los comandos de IA se ejecutan en Rust con la clave protegida y la política de permisos y presupuesto de Neubiki. El modo Rápido envía una petición de texto estructurada. La traducción valida el resultado contra la estructura del Markdown antes de mostrar la propuesta. Los prompts y propuestas de estos paneles se manejan en memoria durante la sesión.

El runtime sube imágenes junto al documento bajo `assets/` y asigna un nombre derivado de la huella de los bytes. Acepta PNG, JPEG, GIF y WebP de hasta 8 MiB. Una subida repetida con los mismos bytes conserva el mismo recurso. Antes de devolver el enlace, el runtime verifica el archivo por su ruta relativa dentro de la raíz. Si se pierde la confirmación, la vista previa de la imagen generada se conserva en el panel para reintentar durante la sesión.

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
