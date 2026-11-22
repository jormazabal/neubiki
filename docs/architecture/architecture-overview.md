# Arquitectura de Neubiki

React presenta la cuenta, la raíz seleccionada, el árbol y el editor Milkdown. `apps/desktop/src/lib/api` contiene los contratos de acceso al runtime; los componentes muestran el estado y despachan acciones.

Tauri expone comandos que delegan en servicios Rust. El conector Proton se carga en proceso en Windows y Android y es la única autoridad sobre los archivos del proyecto. El runtime valida el alcance de la carpeta seleccionada, conserva identificadores y revisiones de Drive y determina si puede garantizar una escritura condicionada. Las credenciales viven en el almacenamiento protegido de cada plataforma; los borradores privados y temporales pertenecen al directorio de datos de Neubiki.

Los módulos conservados de edición, exportación, IA, notas y grabación son piezas para futuras adaptaciones. Que exista una ruta o una prueba unitaria heredada no acredita disponibilidad en un proyecto de Drive. El [diseño del producto](../product/neubiki.md) define el alcance remoto.
