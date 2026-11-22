# Apariencia de Neubiki

Definición para el espacio de trabajo de Proton en Windows y Android. Los valores y reglas de aplicación están en [Paletas de apariencia](../architecture/paletas-apariencia.md).

La aplicación de las paletas a las vistas, tipografía, controles y estados se especifica en los [fundamentos del sistema de diseño](design-system/fundamentos.md).

## Formulario

**Configuración → Apariencia** es una sola página con desplazamiento vertical. El orden es **Perfiles**, **Interfaz** y **Notas**. Las dos secciones de ajustes tienen encabezados estáticos y todos sus campos están visibles dentro del flujo de la página. Las miniaturas permiten elegir el perfil y muestran los fondos de sus tres paneles con el color principal actual.

En Windows, el menú de Configuración permanece fijo y se desplaza el contenido del apartado. En Android, el apartado ocupa la pantalla de contenido y coloca las miniaturas en una cuadrícula de dos columnas cuando hay espacio para controles utilizables. El formulario se reduce a una columna si el ancho disponible lo requiere. Cada perfil y muestra tiene un nombre accesible y una marca de selección. Al usar teclado, el foco se distingue de la selección.

### Perfiles

| Perfil | Marco y panel izquierdo | Editor central y herramientas |
| --- | --- | --- |
| **Clásico** | Tonos oscuros de la paleta | Tonos claros de la paleta |
| **Contraste** | Fondos negros | Fondos blancos |
| **Nocturno** | Tonos oscuros de la paleta | Tonos oscuros de la paleta |
| **Lectura** | Tonos claros de la paleta | Tonos claros de la paleta |

El perfil determina los fondos de los paneles. El marco y el panel izquierdo comparten el mismo color de fondo en todos los perfiles. El color principal determina la familia cromática de fondos, acciones, selecciones, foco y logotipo. En Contraste, negro y blanco gobiernan los fondos principales y el color elegido se aplica a acentos, foco y logotipo. En Android, **Archivos** adopta el color del marco, el documento el del editor y la vista de herramientas el del panel derecho. Clásico es el perfil inicial.

El alcance acordado contiene estos cuatro perfiles y la personalización siguiente. **Compacto**, el selector de fondo lateral, el selector general de tema, el ancho de lectura, los acordeones y el panel de vista previa en directo se descartan del formulario.

### Interfaz

| Ajuste | Opciones | Inicial |
| --- | --- | --- |
| **Escala de la interfaz** | 85 % a 125 %, en intervalos de 5 % | 100 % |
| **Color principal del tema** | Rojo, Naranja, Ámbar, Amarillo, Oliva, Verde, Verde azulado, Cian, Azul, Violeta, Magenta y Vino, en ese orden | Naranja |

La escala modifica menús, iconos, controles, pestañas y árbol. Las áreas táctiles siguen siendo utilizables al reducirla. Los tamaños del contenido Markdown se controlan desde **Notas** y desde el zoom puntual del editor.

### Notas

| Ajuste | Opciones | Inicial |
| --- | --- | --- |
| **Tipografía de la nota** | Source Sans 3, Atkinson Hyperlegible Next, Noto Serif y Noto Sans Mono | Source Sans 3 |
| **Tamaño del texto normal** | 12–28 px, en incrementos de 1 px | 16 px |
| **Tamaño de los títulos** | 18–30 px, en incrementos de 1 px. El mínimo sube al tamaño del texto normal si este es mayor | 22 px |
| **Interlineado** | 1,3 · 1,5 · 1,75 · 2 | 1,5 |

El tamaño de títulos corresponde a H1 y tiene como mínimo el tamaño del cuerpo. Para H2 a H6 se usa el tamaño del cuerpo más el 75 %, 56 %, 38 %, 19 % y 0 % de la diferencia entre H1 y el cuerpo, respectivamente, redondeado al píxel más próximo. Los niveles mantienen su peso y espaciado aunque dos tamaños redondeados coincidan. El interlineado se aplica al texto normal y las listas, y los títulos conservan su propio espaciado. Los bloques de código conservan una fuente monoespaciada.

La configuración afecta a la presentación de Markdown en el editor. El contenido, el formato guardado y las revisiones se conservan. PDF y Word siguen su plantilla de **Exportación**. El ancho de la nota responde al espacio disponible y los bloques anchos siguen siendo accesibles.

## Aplicación y persistencia

- El cambio visual es inmediato y conserva el foco, la pestaña, los borradores y la posición de lectura o edición. Los perfiles y el color principal se eligen por separado. El cambio de uno conserva el otro y las preferencias de Notas y escala.
- El guardado es automático en la configuración nativa del dispositivo, compartida por las cuentas y proyectos de esa instalación. Funciona sin conexión a Proton. El estado del formulario distingue **Guardando**, **Cambios guardados** y **No se pudieron guardar los cambios**. Un fallo conserva el ajuste visible durante la sesión y permite reintentar.
- **Restablecer apariencia** recupera Clásico, Naranja, 100 %, Source Sans 3, 16 px, 22 px y 1,5. El restablecimiento sigue el mismo guardado local.
- Los tamaños de título guardados con el rango anterior se reducen 6 px, con un máximo de 30 px. El tamaño inicial anterior de 28 px pasa a 22 px.
- La migración se realiza una vez para preferencias anteriores. **Claro** pasa a Lectura y **Oscuro** a Nocturno. **Sistema** se resuelve una vez según el tema del dispositivo al migrar: Clásico si es claro y Nocturno si es oscuro. Una instalación sin ajuste previo empieza en Clásico. Se conserva la escala y el identificador de color cuando existe en el nuevo catálogo. **Lima** pasa a Oliva, **Índigo** a Azul y **Rosa** a Vino. Los valores desconocidos recuperan el inicial de su campo.
- El logotipo dentro de Neubiki adopta los tonos de la paleta. Los iconos de instalación y lanzador quedan fuera del alcance de Apariencia.

## Criterios de aceptación

1. El apartado muestra cuatro perfiles, doce colores y los seis ajustes descritos. En Windows y Android se puede acceder a todos mediante el desplazamiento del formulario.
2. Cambiar de perfil o de color aplica la combinación definida al marco, al lateral, al editor, a las herramientas, a Configuración y a sus controles. Los fondos principales de Contraste son negro y blanco.
3. En cada combinación, las acciones y selecciones siguen siendo reconocibles con teclado, ratón o toque. Los estados de conexión, éxito, aviso y error se distinguen por su texto o su icono.
4. Escala, tamaño de texto normal y tamaño de títulos tienen efectos independientes. Cambiar tipografía, tamaños o interlineado no genera una revisión del Markdown ni altera su exportación.
5. Tras cerrar y reabrir Neubiki, se recupera la última configuración confirmada. Una escritura fallida nunca muestra que los cambios se han guardado. La salida de un apartado conserva la escritura en curso y su resultado.
6. La migración de opciones existentes mantiene el resultado elegido incluso si cambia posteriormente el tema del sistema. Restablecer aplica los valores iniciales y deja intactos los ajustes ajenos a Apariencia.
