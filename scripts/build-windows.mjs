import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {assertInstallerResources,fontLicenseResource} from './check-installer-resources.mjs';
import {assertProtonWindowsResources,protonComponentGuid} from './check-proton-windows.mjs';
import fs from 'node:fs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),desktop=path.join(root,'apps/desktop');
const source=path.join(desktop,'src-tauri',fontLicenseResource);
const nativeResources = path.join(desktop, 'src-tauri/resources/proton/windows');
const sourceArchive = path.join(root, 'output/neubiki-proton-sources-windows.zip');
try {
  assertProtonWindowsResources(nativeResources);
  if (!fs.existsSync(sourceArchive)) throw Error('Proton corresponding sources are missing');
} catch {
  const prepared = spawnSync('pwsh', ['-NoProfile', '-File', path.join(root, 'scripts/prepare-proton-windows.ps1')], {
    cwd: root, stdio: 'inherit', windowsHide: true,
  });
  if (prepared.error) throw prepared.error;
  if (prepared.status !== 0) throw Error('Windows Proton preparation failed');
}
const config=JSON.parse(fs.readFileSync(path.join(desktop,'src-tauri/tauri.conf.json'),'utf8'));
const platform=JSON.parse(fs.readFileSync(path.join(desktop,'src-tauri/tauri.windows.conf.json'),'utf8'));
config.bundle={...config.bundle,...platform.bundle};
const override=process.env.TAURI_CONFIG?JSON.parse(process.env.TAURI_CONFIG):{};
const nativeEnvironment = {
  TAURI_NEUBIKI_PROTON_RESOURCES: nativeResources,
  TAURI_NEUBIKI_PROTON_COMPONENT_GUID: protonComponentGuid(override.bundle?.windows?.wix?.upgradeCode ?? config.bundle.windows.wix.upgradeCode),
  TAURI_NEUBIKI_FONT_LICENSE: source,
};
assertInstallerResources(config, source);
assertProtonWindowsResources(nativeResources);
const result=spawnSync(process.execPath,[path.join(desktop,'node_modules/@tauri-apps/cli/tauri.js'),'build',...process.argv.slice(2)],{cwd:desktop,env:{...process.env,...nativeEnvironment},stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;process.exitCode=result.status??1;
