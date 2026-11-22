# Datos y conservación de IA

## Historial privado en el espacio Proton

Las herramientas de IA permiten marcar cada consulta de texto, traducción o generación de imagen para conservar el resultado. La casilla vuelve a quedar desmarcada después de cada envío. En el asistente se guarda también la consulta. Las traducciones conservan el idioma y el texto resultante. Las imágenes conservan el resultado visual. La copia excluye el documento y la selección de origen como campos independientes. La vista de texto omite los destinos HTTP(S).

El historial se limita al perfil privado de Neubiki en el dispositivo. El menú de cuenta permite consultar las entradas y eliminar cada una de ellas. La fecha de caducidad es la de creación más siete días y se mantiene al volver a abrir la entrada. La lectura bloquea las entradas caducadas y Neubiki las retira al arrancar y durante el uso. Con la aplicación cerrada la retirada física se ejecuta en el siguiente arranque. Las copias y paquetes del proyecto excluyen el historial.

Los límites son 100 entradas y 32 MiB en el dispositivo. Si se alcanza un límite, la operación de IA entrega el resultado en el panel y avisa de que la copia privada no se confirmó. Los documentos, borradores de edición, grabaciones, transcripciones guardadas, resúmenes de reunión y registros de consumo conservan sus propios ciclos.

El runtime atiende el catálogo en `GET /api/proton/ai/history` y consulta o elimina una entrada mediante `GET` o `DELETE /api/proton/ai/history/:id`. La lectura muestra los datos retenidos. Para aplicar una propuesta al editor se usa el flujo de revisión original de la herramienta con su documento y revisión capturados.

## Contrato heredado de conservación local

El contrato `GET /api/ai/data-policy` versión 1 describe los almacenes heredados. Se muestra para distinguir los formatos previos y sirve como referencia al adaptar sus capacidades al espacio Proton.

## Transmisión
Una acción de IA envía su solicitud y el contexto preparado según documento/selección, adjuntos, permisos y capacidades. Puede incluir fragmentos recuperados del índice local, imágenes o audio cuando se usa la capacidad correspondiente. Crear/consultar este contrato y consultar el índice no llaman a proveedores. La representación de cada petición y sus fuentes específicas siguen siendo responsabilidad del flujo de contexto.

## Conservación en el dispositivo
- Conversaciones por proyecto: prompts, respuestas y eventos de operaciones; ventana rodante de hasta2000eventos, retirando primero los antiguos. El número procede de AI_CONVERSATION_MAX_EVENTS y no representa días ni2000solicitudes.
- Fuentes de contexto: representación local de adjuntos/texto seleccionado para uso posterior; sin caducidad automática por fecha.
- Resultados para revisión: contenido generado y metadatos de continuidad; no se conservan sobres de solicitud ni claves dentro de este almacén. El contenido generado puede contener información documental y requiere el mismo cuidado que un documento. Sin caducidad automática.
- Índice textual: copia auxiliar de texto guardado, local. Los fragmentos recuperados pueden incorporarse al contexto de una acción. No es una copia de borradores ni OCR. Debe reconstruirse tras cambiar fuentes; sin caducidad por fecha.

## Eliminación y límites
Las categorías son independientes. Borrar eventos de conversación no borra adjuntos, resultados conservados, índices ni documentos. Retirar un índice o un resultado de revisión no borra documentos originales. Borrar datos en el dispositivo no acredita eliminar copias en un proveedor. La aplicación no verifica su retención ni ejecuta una eliminación remota por ese borrado local.

La explicación de Ajustes/IA es plegable, consulta el runtime al abrir y no muestra reglas no verificadas para un contrato incompatible. La vista web de desarrollo usa un fixture central tipado, no evidencia de retención nativa. Este contrato describe reglas; no lee documentos, conversaciones, credenciales ni configuración privada. Diagnóstico mantiene sus reglas independientes sin prompts/documentos.

Siguen pendientes: gestión integral/revisión de borrado concurrente de conversaciones, controles finos por proyecto/proveedor y demostración completa de todos los datos existentes. No hay una acción de borrar todo implícita, expiración nueva ni aceptación de políticas externas.
