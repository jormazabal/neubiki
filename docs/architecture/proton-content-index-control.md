# Control del índice local de contenido

`ProtonContentIndexControl` se compone dentro de la búsqueda de contenido, fuera del formulario de consulta. Recibe únicamente `accountId`, `rootId` y `connected`. El proveedor ES/EN existente determina sus rótulos y formatos. La cuenta y raíz forman su identidad de montaje: cambiar de ámbito retira lecturas y estado anterior.

El índice almacena texto de búsqueda derivado de revisiones comprobadas en el dispositivo. La UI no lo presenta como búsqueda semántica ni como una fuente de IA. La conexión a Proton se muestra aparte: tener texto guardado no confirma que siga siendo la revisión actual; la búsqueda continúa comprobando esa revisión. Se pueden consultar la preferencia y el estado y retirar el índice sin conexión cuando el ámbito ya se conoce.

## Contrato y acciones

Las operaciones `POST /api/proton/workspace/content-index-status`, `content-index-configure` y `content-index-clear` reciben cuenta y raíz. Configurar añade `enabled:boolean`. Responden `{enabled:boolean,documentCount:number,byteLength:number}`. El cliente rechaza números inválidos, datos retenidos con estado desactivado y acuses incompatibles con la acción.

- La casilla de activación permanece desmarcada hasta que un estado confirmado indique lo contrario. Activarla es una acción expresa; la UI explica qué texto se conserva y dónde.
- Desactivarla abre una confirmación: desactiva el índice y elimina su texto guardado. No cambia documentos, borradores privados ni copias de recuperación.
- **Borrar índice** pide confirmación, vacía el texto guardado y conserva la preferencia de activación. El resultado debe confirmar contadores cero y el mismo valor de activación.

Una operación en curso bloquea acciones duplicadas y el cierre de la confirmación. Una respuesta incierta conserva el último estado confirmado y bloquea nuevas mutaciones hasta **Comprobar estado**. Comprobar es una lectura; no repite configurar ni borrar. El control no envía contenido del editor ni borradores en sus peticiones.

## Presentación y comprobación

El control desplegable reutiliza botones, estados, avisos y `ModalFrame`. La confirmación tiene foco inicial en Cancelar, aislamiento del fondo y retorno al disparador. Texto y acciones fluyen en una columna adaptable; tamaños y cantidades siguen el idioma elegido. La integración conserva la consulta y los resultados de búsqueda existentes.

Las pruebas enfocadas usan servicios simulados: activación voluntaria en español, confirmación de borrado/desactivación, preferencia conservada, fallo con consulta sin repetición, aislamiento al cambiar cuenta/raíz y validación de los contratos API. La aceptación instalada de Windows/Android de teclado, lectores de pantalla, pérdida de conectividad y búsqueda por revisión continúa pendiente. La implementación nativa y sus límites de conservación se documentan con la verificación del runtime.
