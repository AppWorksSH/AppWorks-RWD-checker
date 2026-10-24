import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('rwdApp', {
  ignoreFingerprint: (host: string, fingerprint: string, title: string) =>
    ipcRenderer.invoke('report:ignoreFingerprint', host, fingerprint, title),
  ignoreSelector: (host: string, selector: string) => ipcRenderer.invoke('report:ignoreSelector', host, selector),
});
