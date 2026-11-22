# Sistema de diseño de Neubiki

**Versión 1.3.0 · 18 de noviembre de 2026 · Windows y Android**

La interfaz de Neubiki permite navegar por Proton Drive, editar y leer documentos, trabajar con herramientas contextuales y entender qué operaciones se han completado y cuáles requieren atención. La interfaz se especifica a partir de siete láminas de ImageGen. El texto de esta especificación fija las medidas, las interacciones y el significado de los estados. Las láminas muestran composición, jerarquía y acabado.

## Especificación

| Documento | Contenido |
| --- | --- |
| [Fundamentos](fundamentos.md) | Paletas, tipografía, forma, espaciado, accesibilidad y color semántico. |
| [Interfaz](interfaz.md) | Vistas, recorridos, adaptaciones a Windows y Android y cobertura de KnowNext. |
| [Componentes](componentes.md) | Inventario con identificadores, variantes, contratos de interacción y responsables de código. |
| [Historial](cambios.md) | Decisiones, precedencia de las láminas y registro de evolución. |
| [Arquitectura de componentes](../../architecture/componentes-ui.md) | Capas, dependencias, composición, pruebas y proceso de incorporación. |
| [Aceptación manual](../../development/manual-test-checklist.md) | Verificación de la interfaz en clientes instalados. |

**En uso** indica que el patrón tiene un uso en el espacio de Proton, aunque su representación pueda requerir alineación. **Por adaptar** identifica capacidades heredadas cuyo contrato con Proton y verificación necesitan trabajo propio. **Objetivo** identifica un patrón definido que se incorporará cuando exista un flujo que lo necesite. La disponibilidad por versión se documenta en los registros de entrega y aceptación.

## Referencias visuales

| Lámina | Referencia |
| --- | --- |
| Fundamentos | [01 · Color, escala, tipografía y formas](referencias/01-fundamentos.webp) |
| Espacio de trabajo | [02 · Windows, Android, árbol, configuración y herramientas](referencias/02-espacio-de-trabajo.webp) |
| Editor y lectura | [03 · Superficie de documento, jerarquía y elementos Markdown](referencias/03-editor-y-lectura.webp) |
| Controles y diálogos | [04 · Selección, formularios, diálogos y primeras variantes de estado](referencias/04-controles-dialogos-estados.webp) |
| Interacción y respuesta | [05 · Ayuda contextual, notificaciones, progreso y controles](referencias/05-interaccion-y-respuesta.webp) |
| Datos y exploración | [06 · Búsqueda, filtros, tablas, gráficos, paginación y vacíos](referencias/06-datos-busqueda-exploracion.webp) |
| Estados y color | [07 · Etiquetas, notificaciones y avisos semánticos en claro y oscuro](referencias/07-estados-y-color-semantico.webp) |

Las referencias se conservan en WebP sin pérdida. La lámina 07 rige las variantes de estado de las láminas 04 y 05. La paleta de Apariencia fija los valores de producción.

## Cómo se usa

Cada cambio de UI empieza en la vista y el componente del catálogo que ya cubren la necesidad. Se compone con las piezas existentes y se registra cualquier variante nueva. Cuando hace falta un componente distinto, se define su contrato y se valida su referencia visual y de interacción antes de promoverlo al sistema. La [arquitectura](../../architecture/componentes-ui.md#incorporar-o-cambiar-un-componente) describe los pasos y la evidencia que acompaña el cambio.
