const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { WebSocketManager } = require('./services/websocket-manager');
const { TravelAPI } = require('./services/travel-api');
const { ConfigManager } = require('./services/config-manager');
const { ComputerVision } = require('./services/computer-vision');
const { AutomationController } = require('./services/automation-controller');
const AutomationManager = require('./services/automation-manager');

class PoE2TradeApp {
  constructor() {
    this.mainWindow = null;
    this.websocketManager = null;
    this.travelAPI = null;
    this.configManager = null;
    this.computerVision = null;
    this.automationController = null;
    this.automationManager = null;
    this.isDev = process.argv.includes('--dev');
  }

  async initialize() {
    try {
      // Initialize core services
      this.configManager = new ConfigManager();
      await this.configManager.initialize();
      
      this.websocketManager = new WebSocketManager(this.configManager);
      this.travelAPI = new TravelAPI(this.configManager);
      this.computerVision = new ComputerVision(this.configManager);
      this.automationController = new AutomationController();
      this.automationManager = new AutomationManager(this.configManager, this.computerVision, this.travelAPI);
      
      // Set up WebSocket event forwarding
      this.setupWebSocketEvents();
      
      // Set up Travel API event forwarding
      this.setupTravelEvents();
      
      // Set up Automation Manager event forwarding
      this.setupAutomationEvents();
      
      console.log('PoE2 Trade application initialized successfully');
    } catch (error) {
      console.error('Failed to initialize application:', error);
      dialog.showErrorBox('Initialization Error', `Failed to start application: ${error.message}`);
    }
  }

  createMainWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      icon: path.join(__dirname, '../assets/icon.png'),
      title: 'PoE2 Trade - Path of Exile 2 Trading Assistant',
      show: false
    });

    // Load the main HTML file
    this.mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

    // Show window when ready
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
      if (this.isDev) {
        this.mainWindow.webContents.openDevTools();
      }
    });

    // Handle window closed
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  setupWebSocketEvents() {
    // Forward WebSocket messages to renderer
    this.websocketManager.on('websocket:message', (data) => {
      console.log('Main process received websocket:message, forwarding to renderer:', data);
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('websocket:message', data);
        console.log('Message sent to renderer');
      } else {
        console.log('No main window available to send message');
      }
    });

    // Forward WebSocket status updates to renderer
    this.websocketManager.on('websocket:connected', (data) => {
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('websocket:status', { ...data, status: 'connected' });
      }
    });

    this.websocketManager.on('websocket:disconnected', (data) => {
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('websocket:status', { ...data, status: 'disconnected' });
      }
    });

    this.websocketManager.on('websocket:error', (data) => {
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('websocket:status', { ...data, status: 'error' });
      }
    });

    this.websocketManager.on('automation:triggered', async (data) => {
      console.log('Automation triggered:', data);
      try {
        const result = await this.automationManager.startAutomation(data.itemData);
        
        // Send automation started notification to renderer
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('automation:started', {
            success: result.success,
            itemName: data.itemName,
            searchId: data.searchId,
            automationId: result.automationId,
            error: result.error
          });
        }
      } catch (error) {
        console.error('Automation start failed:', error);
        
        // Send error notification to renderer
        if (this.mainWindow && this.mainWindow.webContents) {
          this.mainWindow.webContents.send('automation:started', {
            success: false,
            itemName: data.itemName,
            searchId: data.searchId,
            error: error.message
          });
        }
      }
    });
  }

  setupAutomationEvents() {
    // Forward automation events to renderer
    this.automationManager.on('automation:started', (data) => {
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('automation:started', data);
      }
    });

    this.automationManager.on('automation:step', (data) => {
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('automation:step', data);
      }
    });

    this.automationManager.on('automation:completed', (data) => {
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('automation:completed', data);
      }
    });

    this.automationManager.on('automation:failed', (data) => {
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('automation:failed', data);
      }
    });

    this.automationManager.on('automation:stopped', (data) => {
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('automation:stopped', data);
      }
    });
  }

  setupTravelEvents() {
    // Forward travel results to renderer
    this.travelAPI.on('travel:result', (data) => {
      console.log('Main process received travel:result, forwarding to renderer:', data);
      if (this.mainWindow && this.mainWindow.webContents) {
        this.mainWindow.webContents.send('travel:result', data);
        console.log('Travel result sent to renderer');
      } else {
        console.log('No main window available to send travel result');
      }
    });
  }

  setupIPC() {
    // WebSocket Management
    ipcMain.handle('websocket:connect', async (event, searchConfig) => {
      return await this.websocketManager.connect(searchConfig);
    });

    ipcMain.handle('websocket:disconnect', async (event, searchId) => {
      return await this.websocketManager.disconnect(searchId);
    });

    ipcMain.handle('websocket:get-status', async (event) => {
      return this.websocketManager.getConnectionStatus();
    });

    // Travel API
    ipcMain.handle('travel:to-hideout', async (event, itemData) => {
      return await this.travelAPI.travelToHideout(itemData);
    });

    // Configuration Management
    ipcMain.handle('config:get', async (event, key) => {
      return await this.configManager.get(key);
    });

    ipcMain.handle('config:set', async (event, key, value) => {
      return await this.configManager.set(key, value);
    });

    ipcMain.handle('config:export', async (event, filePath) => {
      return await this.configManager.exportConfig(filePath);
    });

    ipcMain.handle('config:import', async (event, filePath) => {
      return await this.configManager.importConfig(filePath);
    });

    // Computer Vision
    ipcMain.handle('cv:detect-items', async (event, windowBounds) => {
      return await this.computerVision.detectItems(windowBounds);
    });

    ipcMain.handle('cv:start-detection', async (event, config) => {
      return await this.computerVision.startDetection(config);
    });

    ipcMain.handle('cv:stop-detection', async (event) => {
      return await this.computerVision.stopDetection();
    });

    ipcMain.handle('cv:capture-screen', async (event, windowBounds) => {
      return await this.computerVision.captureScreenRegion(windowBounds);
    });

    ipcMain.handle('cv:move-mouse', async (event, x, y) => {
      return await this.computerVision.moveMouse(x, y);
    });

    ipcMain.handle('cv:click-mouse', async (event, x, y, modifiers) => {
      return await this.computerVision.clickMouse(x, y, modifiers);
    });

    ipcMain.handle('cv:press-key', async (event, key) => {
      return await this.computerVision.pressKey(key);
    });

    ipcMain.handle('cv:purchase-item', async (event, itemBounds) => {
      return await this.computerVision.purchaseItem(itemBounds);
    });

    ipcMain.handle('cv:get-status', async (event) => {
      return this.computerVision.getDetailedStatus();
    });

    ipcMain.handle('cv:test-environment', async (event) => {
      return await this.computerVision.testPythonEnvironment();
    });

    ipcMain.handle('cv:cleanup', async (event) => {
      return await this.computerVision.cleanup();
    });

    // Automation
    ipcMain.handle('automation:move-mouse', async (event, x, y) => {
      return await this.automationController.moveMouse(x, y);
    });

    ipcMain.handle('automation:click', async (event, x, y, modifiers) => {
      return await this.automationController.click(x, y, modifiers);
    });

    ipcMain.handle('automation:key-press', async (event, key) => {
      return await this.automationController.keyPress(key);
    });

    // Automation Manager handlers
    ipcMain.handle('automation:start', async (event, itemData) => {
      return await this.automationManager.startAutomation(itemData);
    });

    ipcMain.handle('automation:stop', async (event) => {
      this.automationManager.stopAutomation();
      return { success: true };
    });

    ipcMain.handle('automation:get-status', async (event) => {
      return this.automationManager.getAutomationStatus();
    });

    // File Operations
    ipcMain.handle('file:select', async (event, options) => {
      const result = await dialog.showOpenDialog(this.mainWindow, options);
      return result;
    });

    ipcMain.handle('file:save', async (event, options) => {
      const result = await dialog.showSaveDialog(this.mainWindow, options);
      return result;
    });

    ipcMain.handle('file:read', async (event, filePath) => {
      try {
        const fs = require('fs').promises;
        const content = await fs.readFile(filePath, 'utf8');
        return { success: true, content };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('file:write', async (event, filePath, content) => {
      try {
        const fs = require('fs').promises;
        await fs.writeFile(filePath, content, 'utf8');
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  async start() {
    await this.initialize();
    this.createMainWindow();
    this.setupIPC();
  }
}

// App event handlers
app.whenReady().then(async () => {
  const poe2TradeApp = new PoE2TradeApp();
  await poe2TradeApp.start();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const poe2TradeApp = new PoE2TradeApp();
    poe2TradeApp.start();
  }
});

// Handle app termination
app.on('before-quit', () => {
  // Cleanup resources
  console.log('Application shutting down...');
});
