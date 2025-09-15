const fs = require('fs').promises;
const path = require('path');
const yaml = require('yaml');
const CryptoJS = require('crypto-js');

class ConfigManager {
  constructor() {
    // Use app.getPath('userData') for proper config directory in packaged app
    const { app } = require('electron');
    const userDataPath = app ? app.getPath('userData') : path.join(process.cwd(), 'config');
    this.configPath = path.join(userDataPath, 'config');
    this.configFile = path.join(this.configPath, 'settings.json');
    this.encryptionKey = 'poe2-trade-config-key-2024'; // In production, this should be derived from user input
    this.config = new Map();
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Ensure config directory exists
      await this.ensureConfigDirectory();
      
      // Load existing configuration
      await this.loadConfig();
      
      // Set default values if not present
      await this.setDefaults();
      
      this.isInitialized = true;
      console.log('ConfigManager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize ConfigManager:', error);
      throw error;
    }
  }

  async ensureConfigDirectory() {
    try {
      await fs.access(this.configPath);
    } catch (error) {
      await fs.mkdir(this.configPath, { recursive: true });
    }
  }

  async loadConfig() {
    try {
      const data = await fs.readFile(this.configFile, 'utf8');
      const decryptedData = this.decrypt(data);
      const configObject = JSON.parse(decryptedData);
      
      // Convert object to Map
      this.config = new Map(Object.entries(configObject));
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Config file doesn't exist, start with empty config
        this.config = new Map();
      } else {
        console.error('Failed to load config:', error);
        throw error;
      }
    }
  }

  async saveConfig() {
    try {
      // Convert Map to object
      const configObject = Object.fromEntries(this.config);
      const jsonData = JSON.stringify(configObject, null, 2);
      const encryptedData = this.encrypt(jsonData);
      
      await fs.writeFile(this.configFile, encryptedData, 'utf8');
      
    } catch (error) {
      console.error('Failed to save config:', error);
      throw error;
    }
  }

  async setDefaults() {
    const defaults = {
      'ui.theme': 'dark',
      'ui.language': 'en',
      'ui.windowBounds': {
        x: 100,
        y: 100,
        width: 800,
        height: 600
      },
      'trading.maxConnections': 20,
      'trading.travelCooldown': 30000,
      'trading.purchaseDelay': 2000,
      'computerVision.enabled': true,
      'computerVision.merchantWindow': {
        x1: 834,
        y1: 284,
        x2: 1709,
        y2: 1151
      },
          'automation.enabled': true,
          'automation.mouseSpeed': 1.0,
          'automation.mouseMovementType': 'natural', // 'natural' or 'curved'
          'automation.clickModifiers': ['ctrl'],
          'automation.autoPurchase': false, // Enable automatic item purchasing
          'automation.refreshKey': 'f5',
      'logging.level': 'info',
      'logging.maxFiles': 10,
      'logging.maxSize': '10MB'
    };

    let hasChanges = false;
    for (const [key, value] of Object.entries(defaults)) {
      if (!this.config.has(key)) {
        this.config.set(key, value);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      await this.saveConfig();
    }
  }

  async get(key) {
    if (!this.isInitialized) {
      throw new Error('ConfigManager not initialized');
    }
    return this.config.get(key);
  }

  async set(key, value) {
    if (!this.isInitialized) {
      throw new Error('ConfigManager not initialized');
    }
    
    this.config.set(key, value);
    await this.saveConfig();
    
    return true;
  }

  async delete(key) {
    if (!this.isInitialized) {
      throw new Error('ConfigManager not initialized');
    }
    
    const existed = this.config.has(key);
    this.config.delete(key);
    
    if (existed) {
      await this.saveConfig();
    }
    
    return existed;
  }

  async getAll() {
    if (!this.isInitialized) {
      throw new Error('ConfigManager not initialized');
    }
    
    return Object.fromEntries(this.config);
  }

  async exportConfig(filePath) {
    try {
      const configData = await this.getAll();
      const yamlContent = yaml.stringify(configData);
      
      await fs.writeFile(filePath, yamlContent, 'utf8');
      
      return {
        success: true,
        message: 'Configuration exported successfully'
      };
    } catch (error) {
      console.error('Failed to export config:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async importConfig(filePath) {
    try {
      const yamlContent = await fs.readFile(filePath, 'utf8');
      const configData = yaml.parse(yamlContent);
      
      if (typeof configData !== 'object' || configData === null) {
        throw new Error('Invalid configuration file format');
      }
      
      // Merge imported config with existing config
      for (const [key, value] of Object.entries(configData)) {
        this.config.set(key, value);
      }
      
      await this.saveConfig();
      
      return {
        success: true,
        message: 'Configuration imported successfully',
        importedKeys: Object.keys(configData)
      };
    } catch (error) {
      console.error('Failed to import config:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Authentication methods
  async setAuthCredentials(poesessid, cf_clearance) {
    try {
      await this.set('auth.poesessid', poesessid);
      await this.set('auth.cf_clearance', cf_clearance);
      
      return {
        success: true,
        message: 'Authentication credentials saved'
      };
    } catch (error) {
      console.error('Failed to save auth credentials:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getAuthCredentials() {
    try {
      const poesessid = await this.get('auth.poesessid');
      const cf_clearance = await this.get('auth.cf_clearance');
      
      return {
        poesessid,
        cf_clearance,
        isValid: !!(poesessid && cf_clearance)
      };
    } catch (error) {
      console.error('Failed to get auth credentials:', error);
      return {
        poesessid: null,
        cf_clearance: null,
        isValid: false
      };
    }
  }

  async clearAuthCredentials() {
    try {
      await this.delete('auth.poesessid');
      await this.delete('auth.cf_clearance');
      
      return {
        success: true,
        message: 'Authentication credentials cleared'
      };
    } catch (error) {
      console.error('Failed to clear auth credentials:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Search configuration methods
  async saveSearchConfig(searchConfig) {
    try {
      const searches = await this.get('searches') || [];
      const existingIndex = searches.findIndex(s => s.id === searchConfig.id);
      
      if (existingIndex >= 0) {
        searches[existingIndex] = searchConfig;
      } else {
        searches.push(searchConfig);
      }
      
      await this.set('searches', searches);
      
      return {
        success: true,
        message: 'Search configuration saved'
      };
    } catch (error) {
      console.error('Failed to save search config:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getSearchConfigs() {
    try {
      return await this.get('searches') || [];
    } catch (error) {
      console.error('Failed to get search configs:', error);
      return [];
    }
  }

  async deleteSearchConfig(searchId) {
    try {
      const searches = await this.get('searches') || [];
      const filteredSearches = searches.filter(s => s.id !== searchId);
      
      await this.set('searches', filteredSearches);
      
      return {
        success: true,
        message: 'Search configuration deleted'
      };
    } catch (error) {
      console.error('Failed to delete search config:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Encryption/Decryption methods
  encrypt(text) {
    return CryptoJS.AES.encrypt(text, this.encryptionKey).toString();
  }

  decrypt(encryptedText) {
    const bytes = CryptoJS.AES.decrypt(encryptedText, this.encryptionKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  }

  // Utility methods
  async resetToDefaults() {
    try {
      this.config.clear();
      await this.setDefaults();
      
      return {
        success: true,
        message: 'Configuration reset to defaults'
      };
    } catch (error) {
      console.error('Failed to reset config:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async backupConfig() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.configPath, `backup-${timestamp}.json`);
      
      const configData = await this.getAll();
      const jsonData = JSON.stringify(configData, null, 2);
      const encryptedData = this.encrypt(jsonData);
      
      await fs.writeFile(backupPath, encryptedData, 'utf8');
      
      return {
        success: true,
        message: 'Configuration backed up successfully',
        backupPath
      };
    } catch (error) {
      console.error('Failed to backup config:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = { ConfigManager };
