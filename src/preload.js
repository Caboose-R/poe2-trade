const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // WebSocket Management
  websocket: {
    connect: (searchConfig) => ipcRenderer.invoke('websocket:connect', searchConfig),
    disconnect: (searchId) => ipcRenderer.invoke('websocket:disconnect', searchId),
    getStatus: () => ipcRenderer.invoke('websocket:get-status')
  },

  // Travel API
  travel: {
    toHideout: (itemData) => ipcRenderer.invoke('travel:to-hideout', itemData)
  },

  // Auto-travel events
  autoTravel: {
    onResult: (callback) => {
      ipcRenderer.on('auto-travel:result', (event, data) => callback(data));
    },
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('auto-travel:result');
    }
  },

  // Configuration Management
  config: {
    get: (key) => ipcRenderer.invoke('config:get', key),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
    export: (filePath) => ipcRenderer.invoke('config:export', filePath),
    import: (filePath) => ipcRenderer.invoke('config:import', filePath)
  },

  // Computer Vision
  computerVision: {
    detectItems: (windowBounds) => ipcRenderer.invoke('cv:detect-items', windowBounds),
    startDetection: (config) => ipcRenderer.invoke('cv:start-detection', config),
    stopDetection: () => ipcRenderer.invoke('cv:stop-detection'),
    captureScreen: (windowBounds) => ipcRenderer.invoke('cv:capture-screen', windowBounds),
        moveMouse: (x, y) => ipcRenderer.invoke('cv:move-mouse', x, y),
        clickMouse: (x, y, modifiers) => ipcRenderer.invoke('cv:click-mouse', x, y, modifiers),
        pressKey: (key) => ipcRenderer.invoke('cv:press-key', key),
    purchaseItem: (itemBounds) => ipcRenderer.invoke('cv:purchase-item', itemBounds),
    getStatus: () => ipcRenderer.invoke('cv:get-status'),
    testEnvironment: () => ipcRenderer.invoke('cv:test-environment'),
    cleanup: () => ipcRenderer.invoke('cv:cleanup')
  },

  // Automation
  automation: {
    moveMouse: (x, y) => ipcRenderer.invoke('automation:move-mouse', x, y),
    click: (x, y, modifiers) => ipcRenderer.invoke('automation:click', x, y, modifiers),
    keyPress: (key) => ipcRenderer.invoke('automation:key-press', key),
    // Automation Manager methods
    start: (itemData) => ipcRenderer.invoke('automation:start', itemData),
    stop: () => ipcRenderer.invoke('automation:stop'),
    getStatus: () => ipcRenderer.invoke('automation:get-status')
  },

  // File Operations
  file: {
    select: (options) => ipcRenderer.invoke('file:select', options),
    save: (options) => ipcRenderer.invoke('file:save', options),
    read: (filePath) => ipcRenderer.invoke('file:read', filePath),
    write: (filePath, content) => ipcRenderer.invoke('file:write', filePath, content)
  },

  // Event Listeners
  on: (channel, callback) => {
    const validChannels = [
      'websocket:message',
      'websocket:status',
      'travel:result',
      'cv:detection',
      'automation:complete',
      'automation:started',
      'automation:step',
      'automation:completed',
      'automation:failed',
      'automation:stopped'
    ];
    
    if (validChannels.includes(channel)) {
      console.log('Preload: Registering listener for channel:', channel);
      ipcRenderer.on(channel, (event, data) => {
        console.log('Preload: Received event on channel', channel, ':', data);
        callback(data);
      });
    } else {
      console.log('Preload: Invalid channel:', channel);
    }
  },

  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  }
});
