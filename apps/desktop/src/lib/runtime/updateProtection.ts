import {invoke} from "@tauri-apps/api/core";
import {ApiError} from "../api/errors";

export async function protectUpdateInstallation(actions:{freeze:()=>void;unfreeze:()=>void;hasPendingSettings:()=>boolean;protect:()=>Promise<boolean>;reserve?:()=>Promise<string>}):Promise<string>{
  try{
    actions.freeze();
    if(actions.hasPendingSettings())throw new ApiError(409, "Pending settings", "Espera a que se confirmen los ajustes antes de instalar la actualización.", "not-started", "runtime-update-settings-pending");
    if(!await actions.protect())throw new ApiError(409, "Draft protection unavailable", "No se confirmó la protección del trabajo actual. El espacio sigue abierto para resolverlo.", "not-started", "runtime-update-drafts-unprotected");
    if(actions.hasPendingSettings())throw new ApiError(409, "Settings changed", "Los ajustes cambiaron durante la protección. Vuelve a revisarlos antes de instalar.", "not-started", "runtime-update-settings-changed");
    return await (actions.reserve??(()=>invoke<string>("prepare_runtime_restart")))();
  }catch(error){actions.unfreeze();throw error;}
}
export async function releaseUpdateInstallation(token:string){await invoke("release_runtime_restart",{token});}
