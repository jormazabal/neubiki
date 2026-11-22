const es = {
  title: "Perfiles compartidos", close: "Cerrar", refresh: "Actualizar", check: "Comprobar publicación", publish: "Publicar perfiles del dispositivo…", confirm: "Publicar catálogo", cancel: "Cancelar",
  help: "Los perfiles del proyecto se guardan en Proton. Al exportar puedes elegirlos sin cambiar la plantilla de este dispositivo.",
  safety: "Se publica una copia de los estilos, portada e índice. Se excluyen la procedencia y fecha del dispositivo; los campos desconocidos o recursos con rutas se rechazan.",
  device: "Este dispositivo", project: "Proyecto", emptyDevice: "No hay perfiles guardados en este dispositivo.", emptyProject: "Este proyecto todavía no tiene perfiles compartidos.",
  loading: "Consultando perfiles…", publishing: "Publicando catálogo…", offline: "Conéctate a Proton para consultar o publicar perfiles.", loadFailed: "No se pudieron consultar los perfiles.",
  publishFailed: "No se confirmó la publicación. Comprueba el mismo intento antes de continuar.", pending: "Hay una publicación sin confirmar. Comprobar solo consulta el resultado; no vuelve a publicar.", published: "Catálogo confirmado en Proton.",
  confirmTitle: "Publicar catálogo de perfiles", confirmHelp: (next: number, current: number) => `Se publicarán ${next} perfiles guardados de este dispositivo y se sustituirá el catálogo actual de ${current} perfiles del proyecto. Revisa los nombres antes de continuar.`,
  limit: "Hasta 32 perfiles y 1 MiB por catálogo. La publicación comprueba ambas revisiones.", cover: "Con portada", noCover: "Sin portada", contents: "Con índice", noContents: "Sin índice",
  sharedLoadFailed: "No se pudieron consultar los perfiles del proyecto.", sourceLabel: "Origen del perfil", deviceGroup: "Perfiles del dispositivo", projectGroup: "Perfiles del proyecto",
  staleSelection: "El perfil seleccionado ya no está disponible. Abre Exportar y vuelve a seleccionarlo.", scopeChanged: "El proyecto cambió. Abre Exportar y vuelve a elegir el perfil compartido.",
  batchNote: "Los perfiles se aplican a documentos Markdown en PDF y Word. Las notas manuscritas conservan su formato propio.",
};
const en: typeof es = {
  title: "Shared export profiles", close: "Close", refresh: "Refresh", check: "Check publication", publish: "Publish device profiles…", confirm: "Publish catalog", cancel: "Cancel",
  help: "Project profiles are saved in Proton. Choose them when exporting without changing this device's template.",
  safety: "A copy of styles, cover and contents settings is published. Device provenance and dates are excluded; unknown fields or resources with paths are rejected.",
  device: "This device", project: "Project", emptyDevice: "There are no saved profiles on this device.", emptyProject: "This project has no shared profiles yet.",
  loading: "Loading profiles…", publishing: "Publishing catalog…", offline: "Connect to Proton to read or publish profiles.", loadFailed: "Could not load profiles.",
  publishFailed: "Publication was not confirmed. Check the same attempt before continuing.", pending: "A publication is unconfirmed. Checking only reads its result; it does not publish again.", published: "Catalog confirmed in Proton.",
  confirmTitle: "Publish profile catalog", confirmHelp: (next, current) => `${next} saved profiles from this device will replace the project's current catalog of ${current} profiles. Review the names before continuing.`,
  limit: "Up to 32 profiles and 1 MiB per catalog. Publication checks both revisions.", cover: "With cover", noCover: "No cover", contents: "With contents", noContents: "No contents",
  sharedLoadFailed: "Could not load project profiles.", sourceLabel: "Profile source", deviceGroup: "Device profiles", projectGroup: "Project profiles",
  staleSelection: "The selected profile is no longer available. Reopen Export and choose it again.", scopeChanged: "The project changed. Reopen Export and choose the shared profile again.",
  batchNote: "Profiles apply to Markdown documents exported as PDF or Word. Handwritten notes keep their own format.",
};
export const protonSharedProfilesCopy = { es, en };
