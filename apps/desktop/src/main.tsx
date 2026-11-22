import React from "react";
import ReactDOM from "react-dom/client";
import { GlobalTooltip } from "./components/ui/GlobalTooltip";
import { ProtonWorkspace } from "./features/protonWorkspace/ProtonWorkspace";
import { uploadProtonWorkspaceImage } from "./lib/api/protonImageAssets";
import { initializeWindowStatePersistence } from "./lib/runtime/windowControls";
import { isTauriMobileRuntime } from "./lib/runtime/platform";
import "./styles/index.css";
import "./styles/workspaceAppearance.css";
import "./styles/ui.css";

if (!isTauriMobileRuntime()) void initializeWindowStatePersistence();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ProtonWorkspace uploadImage={uploadProtonWorkspaceImage} />
    <GlobalTooltip />
  </React.StrictMode>,
);
