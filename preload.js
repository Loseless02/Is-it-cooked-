const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const handler = (_e, data) => fn(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('iic', {
  systemInfo: () => ipcRenderer.invoke('sys:info'),
  usbDevices: () => ipcRenderer.invoke('sys:usb'),
  gpuTemps: () => ipcRenderer.invoke('sys:gpuTemps'),
  busyApps: () => ipcRenderer.invoke('apps:list'),
  closeApp: (id, force) => ipcRenderer.invoke('apps:close', id, force),

  startRun: () => ipcRenderer.invoke('bench:start'),
  endRun: () => ipcRenderer.invoke('bench:end'),
  cancel: () => ipcRenderer.invoke('bench:cancel'),
  cpuBench: () => ipcRenderer.invoke('bench:cpu'),
  ramTest: (quick) => ipcRenderer.invoke('bench:ram', quick),
  diskTest: (quick, isAdmin) => ipcRenderer.invoke('bench:disk', quick, isAdmin),
  stressTest: (seconds, isAdmin) => ipcRenderer.invoke('bench:stress', seconds, isAdmin),
  onProgress: on('bench:progress'),
  onStressSample: on('bench:stress'),

  setFullscreen: (on) => ipcRenderer.invoke('win:fullscreen', on),
  openSettings: (uri) => ipcRenderer.invoke('app:openSettings', uri),
  restartAsAdmin: () => ipcRenderer.invoke('app:restartAdmin'),
  saveReport: (html, name) => ipcRenderer.invoke('report:save', html, name),
});
