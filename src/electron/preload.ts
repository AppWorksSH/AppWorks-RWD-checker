import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { RwdApi } from '../shared/api';

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

function listen<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: RwdApi = {
  getSettings: invoke('settings:get') as RwdApi['getSettings'],
  saveSettings: invoke('settings:save') as RwdApi['saveSettings'],
  setApiKey: invoke('settings:setKey') as RwdApi['setApiKey'],
  removeSiteRule: invoke('settings:removeSiteRule') as RwdApi['removeSiteRule'],

  startScan: invoke('scan:start') as RwdApi['startScan'],
  cancelScan: invoke('scan:cancel') as RwdApi['cancelScan'],
  resumeScan: invoke('scan:resume') as RwdApi['resumeScan'],
  getState: invoke('scan:state') as RwdApi['getState'],
  clearFinished: invoke('scan:clearFinished') as RwdApi['clearFinished'],

  listScans: invoke('scans:list') as RwdApi['listScans'],
  deleteScan: invoke('scans:delete') as RwdApi['deleteScan'],
  openReport: invoke('scans:open') as RwdApi['openReport'],
  revealScan: invoke('scans:reveal') as RwdApi['revealScan'],
  exportPdf: invoke('scans:exportPdf') as RwdApi['exportPdf'],
  exportHtml: invoke('scans:exportHtml') as RwdApi['exportHtml'],

  browserInfo: invoke('browsers:info') as RwdApi['browserInfo'],
  installBrowsers: invoke('browsers:install') as RwdApi['installBrowsers'],
  testAi: invoke('ai:test') as RwdApi['testAi'],
  listModels: invoke('ai:models') as RwdApi['listModels'],

  appInfo: invoke('app:info') as RwdApi['appInfo'],
  openDataDir: invoke('app:openDataDir') as RwdApi['openDataDir'],
  openExternal: invoke('app:openExternal') as RwdApi['openExternal'],

  onState: (cb) => listen('state', cb),
  onScanEvent: (cb) => listen('scan:event', cb),
  onBrowsersLog: (cb) => listen('browsers:log', cb),
  onSettingsChanged: (cb) => listen('settings:changed', cb),
};

contextBridge.exposeInMainWorld('rwd', api);
