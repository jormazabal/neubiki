# Fundamentos

## Superficies y color

El marco y la columna izquierda usan exactamente el mismo fondo. Configuración usa ese mismo marco y destaca la fila seleccionada con un relleno suave, peso de texto e icono. La fila seleccionada carece de raya lateral. El anillo de foco de teclado permanece visible. Editor y herramientas se leen como superficies diferenciadas, con bordes suaves, separación suficiente y sombra leve al superponerse.

| Perfil | Marco, navegación y barras nativas de Android | Editor y herramientas |
| --- | --- | --- |
| Clásico | Superficie oscura de la paleta | Superficies claras de la paleta |
| Contraste | Negro, con bordes y foco diferenciados | Blanco, con bordes y foco diferenciados |
| Nocturno | Superficie oscura de la paleta | Superficies oscuras de la paleta |
| Lectura | Superficie clara de la paleta | Superficies claras de la paleta |

Naranja es el color inicial. La muestra de marca es `#F37021`. Los controles toman el acento accesible resuelto para la superficie y el color elegido. Cada variante interactiva consume los roles de normal, hover, pulsación, selección y foco de la paleta. El selector de Apariencia ofrece las doce familias acordadas y deja al usuario elegir el acento. [Definición de Apariencia](../apariencia.md) · [Paletas y contrastes](../../architecture/paletas-apariencia.md).

| Rol | Consumo en la interfaz |
| --- | --- |
| Marco y navegación | `--workspace-frame` y contexto del espacio. Las barras nativas lo reciben mediante el puente de Apariencia. |
| Lienzo, superficie elevada, borde, texto principal y secundario | Tokens contextuales `--app-*`. Los paneles, controles y capas flotantes heredan el contexto de la superficie que los contiene o los abre. |
| Acción, texto de acción y foco | `--accent*` resuelto por contexto. Los estados semánticos tienen sus propios pares. |
| Densidad y nota | `--appearance-scale` para la interfaz y sus capas. `--note-*` y zoom del editor para el contenido. |

## Forma, densidad y tipografía

| Elemento | Referencia de diseño |
| --- | --- |
| Editor, paneles principales y tarjetas grandes | Radio de **22 px** para las superficies expuestas en escritorio. En Android se pueden ajustar al borde de la ventana conservando el redondeo de tarjetas y controles interiores. |
| Menús y superficies flotantes compactas | Radio de **14–16 px**, según tamaño. |
| Campos, muestras y filas | Radio de **7–12 px** según densidad. La fila tiene relleno, icono y texto alineados con el resto de la lista. |
| Botones de acción, etiquetas y filtros | Forma de cápsula. Los disparadores de icono pueden ser circulares o redondeados según su área disponible. |
| Altura de control | Botón habitual de 40 px y compacto de 34 px antes de escalar. En móvil la altura se ajusta para mantener 48 px lógicos en acciones autónomas. |
| Espaciado | Referencias de 4, 8, 12, 16, 24 y 32 px lógicos. Usar separación mayor entre secciones que entre etiqueta, control y ayuda. La composición responde al ancho disponible. |
| Interfaz | Inter con alternativas del sistema. Objetivo de 13–14 px para controles, 14–16 px para texto de vista y 18–22 px para títulos habituales. El título describe la tarea y deja sitio al contenido. |
| Nota | Source Sans 3 de inicio. Alternativas Atkinson Hyperlegible Next, Noto Serif y Noto Sans Mono. Cuerpo de **12–28 px** con valor inicial **16 px**. H1 de **18–30 px** con valor inicial **22 px** y mínimo igual al cuerpo si supera 18 px. |
| Jerarquía de la nota | H2–H6 interpolan el 75 %, 56 %, 38 %, 19 % y 0 % de la diferencia entre H1 y cuerpo, con redondeo. La secuencia inicial es **22, 21, 19, 18, 17 y 16 px**. Peso y espaciado siguen distinguiendo los niveles. Cuerpo y listas usan interlineado 1,3, 1,5, 1,75 o 2. |
| Escalas | Interfaz **85–125 %** en pasos de 5 puntos. Zoom de nota independiente desde el editor, con 100 % inicial y opciones actuales **80, 90, 100, 110, 125 y 150 %**. PDF y Word siguen la plantilla de exportación. |

Los valores de CSS deben vivir en tokens cuando sean compartidos. Las medidas anteriores describen el sistema y sirven para alinear implementaciones a medida que se adoptan los componentes.

## Estados semánticos

| Estado | Claro · fondo / texto e icono | Oscuro · fondo / texto e icono | Uso y ejemplo |
| --- | --- | --- | --- |
| Neutro | Superficie elevada / texto principal | Superficie elevada / texto principal | Información persistente. Icono de documento y **Borrador local** cuando se ha protegido y se puede recuperar. |
| Conexión | `#E7F5F0` / `#185444` | `#183A30` / `#BCEBD9` | Acceso a Proton comprobado. Nube o enlace y **Conexión disponible**. Si se pierde el acceso, se usa aviso contextual con la restricción correspondiente. |
| Éxito | `#E8F5EB` / `#174F30` | `#173B27` / `#ADE8BB` | Operación ya confirmada. Marca de verificación y **Guardado en Proton** o **PDF exportado**. |
| Aviso | `#FFF3D4` / `#6E470B` | `#3F300F` / `#FFE29A` | Situación que requiere atención o comprobación. Reloj para espera, triángulo para aviso general y **Confirmación pendiente**. |
| Error | `#FCEBEB` / `#8C2529` | `#481F24` / `#FFD2D3` | Fallo confirmado. Cruz o exclamación y **No se pudo guardar**, con una acción pertinente. |

Usar icono y texto para transmitir el estado con independencia del color. La **etiqueta** acompaña el objeto mientras el estado siga vigente. La **notificación flotante** anuncia una transición, conserva el foco actual y permite una acción o cierre. El **aviso en contexto** permanece junto a la tarea mientras se necesita intervención. Una confirmación destructiva describe la consecuencia y diferencia visualmente la acción del resto. [Etiquetas, avisos y notificaciones del catálogo](componentes.md#respuesta-y-estados).

| Situación de guardado | Presentación |
| --- | --- |
| Cambios aún en memoria o copia privada en curso | Cambios pendientes o Guardando borrador, con indicación de actividad si corresponde. |
| Borrador privado recuperable | **Borrador local**, neutro. Al recuperarlo, ofrecer acceso al borrador. |
| Escritura en tránsito | **Guardando en Proton**, con actividad o progreso medido. La presentación conserva la distinción con la copia privada. |
| Resultado remoto incierto | **Confirmación pendiente**, aviso persistente y **Comprobar**. Consultar el estado de la operación antes de decidir el siguiente paso. |
| Revisión confirmada | **Guardado en Proton**, éxito. |
| Fallo confirmado con repetición segura | **No se pudo guardar** y **Reintentar**. El contrato de la operación determina si se puede repetir. |
| Cambio concurrente de revisión | **Conflicto de revisión** y **Revisar**. La revisión remota y el borrador propio se conservan para comparar o resolver. |

## Accesibilidad y adaptación

- Aplicar 4,5:1 a texto habitual y 3:1 a los límites, iconos e indicadores visuales necesarios para operar. Comprobar estados activos, hover, foco y el portal en el fondo efectivo del perfil. Usar los pares medidos en la [definición de paletas](../../architecture/paletas-apariencia.md#comprobación-de-la-definición).
- Asociar rótulos, ayuda y errores a sus campos. Dar nombre accesible a botones de icono. Usar controles HTML nativos cuando expresen la interacción y roles, foco y teclas correspondientes para widgets compuestos.
- La navegación por teclado sigue el flujo de lectura. Apertura, desplazamiento, cierre y restauración de foco se prueban con teclado. En Android cada acción disponible al pasar el puntero tiene un camino visible o explícito por toque. Diseñar un área táctil objetivo de 48 px lógicos en acciones autónomas, incluso con escala reducida.
- El texto se parte o se trunca según su función. Para nombres truncados, conservar el nombre en la semántica del control y permitir consultar el nombre completo. La nota conserva una columna y las tablas, bloques de código y otros contenidos anchos disponen de desplazamiento propio.
- Los avisos importantes permanecen también visibles en la vista. Anunciar una vez las transiciones en regiones vivas, con prioridad alta reservada para fallos urgentes. Evitar anuncios por cuadro de animación o por cada variación del progreso. Respetar la preferencia de movimiento reducido.
- Posicionar menús y cuadros con el tamaño visible del cliente, incluido el teclado virtual. Mantener accesibles la acción principal y el cierre. Diferenciar desactivado, ocupado y solo lectura y explicar la causa si condiciona la tarea.
