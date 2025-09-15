const { PythonShell } = require('python-shell');
const path = require('path');
const EventEmitter = require('events');

class AutomationController extends EventEmitter {
  constructor() {
    super();
    this.isEnabled = true;
    this.mouseSpeed = 1.0;
    this.clickModifiers = ['ctrl'];
    this.refreshKey = 'f5';
    this.isProcessing = false;
    this.pythonProcess = null;
    this.pythonScriptPath = path.join(__dirname, '../../python/cv_detection.py');
    this.pythonExecutable = path.join(__dirname, '../../python/python.exe');
  }

  async moveMouse(x, y) {
    try {
      if (!this.isEnabled) {
        throw new Error('Automation is disabled');
      }

      if (this.isProcessing) {
        throw new Error('Another automation action is in progress');
      }

      this.isProcessing = true;

      // Send command to Python script
      const result = await this.sendToPython({
        type: 'move_mouse',
        x,
        y
      });

      this.isProcessing = false;

      this.emit('automation:complete', {
        type: 'mouse_move',
        x,
        y,
        success: result.success
      });

      return result;

    } catch (error) {
      this.isProcessing = false;
      console.error('Mouse movement failed:', error);
      
      this.emit('automation:complete', {
        type: 'mouse_move',
        x,
        y,
        success: false,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async click(x, y, modifiers = []) {
    try {
      if (!this.isEnabled) {
        throw new Error('Automation is disabled');
      }

      if (this.isProcessing) {
        throw new Error('Another automation action is in progress');
      }

      this.isProcessing = true;

      // Apply modifiers
      const modifierKeys = modifiers.length > 0 ? modifiers : this.clickModifiers;
      
      // Send command to Python script
      const result = await this.sendToPython({
        type: 'click',
        x,
        y,
        modifiers: modifierKeys
      });

      this.isProcessing = false;

      this.emit('automation:complete', {
        type: 'click',
        x,
        y,
        modifiers: modifierKeys,
        success: result.success
      });

      return result;

    } catch (error) {
      this.isProcessing = false;
      console.error('Click failed:', error);
      
      this.emit('automation:complete', {
        type: 'click',
        x,
        y,
        modifiers,
        success: false,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async keyPress(key) {
    try {
      if (!this.isEnabled) {
        throw new Error('Automation is disabled');
      }

      if (this.isProcessing) {
        throw new Error('Another automation action is in progress');
      }

      this.isProcessing = true;

      // Send command to Python script
      const result = await this.sendToPython({
        type: 'key_press',
        key
      });

      this.isProcessing = false;

      this.emit('automation:complete', {
        type: 'key_press',
        key,
        success: result.success
      });

      return result;

    } catch (error) {
      this.isProcessing = false;
      console.error('Key press failed:', error);
      
      this.emit('automation:complete', {
        type: 'key_press',
        key,
        success: false,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async refreshSearch() {
    try {
      return await this.keyPress(this.refreshKey);
    } catch (error) {
      console.error('Search refresh failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async purchaseItem(itemBounds) {
    try {
      if (!this.isEnabled) {
        throw new Error('Automation is disabled');
      }

      // Calculate center of item bounds
      const centerX = itemBounds.x + (itemBounds.width / 2);
      const centerY = itemBounds.y + (itemBounds.height / 2);

      // Click on item with Ctrl modifier
      const clickResult = await this.click(centerX, centerY, ['ctrl']);
      
      if (!clickResult.success) {
        throw new Error(clickResult.error);
      }

      // Wait a moment for purchase to process
      await this.sleep(1000);

      // Refresh search
      const refreshResult = await this.refreshSearch();
      
      return {
        success: true,
        itemBounds,
        clickResult,
        refreshResult
      };

    } catch (error) {
      console.error('Item purchase failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async performPurchaseSequence(itemBounds) {
    try {
      if (!this.isEnabled) {
        throw new Error('Automation is disabled');
      }

      this.emit('automation:complete', {
        type: 'purchase_sequence_started',
        itemBounds
      });

      // Step 1: Move to item
      const moveResult = await this.moveMouse(
        itemBounds.x + (itemBounds.width / 2),
        itemBounds.y + (itemBounds.height / 2)
      );

      if (!moveResult.success) {
        throw new Error(`Mouse movement failed: ${moveResult.error}`);
      }

      // Step 2: Wait for movement to complete
      await this.sleep(200);

      // Step 3: Click with modifiers
      const clickResult = await this.click(
        itemBounds.x + (itemBounds.width / 2),
        itemBounds.y + (itemBounds.height / 2),
        this.clickModifiers
      );

      if (!clickResult.success) {
        throw new Error(`Click failed: ${clickResult.error}`);
      }

      // Step 4: Wait for purchase to process
      await this.sleep(1000);

      // Step 5: Refresh search
      const refreshResult = await this.refreshSearch();

      this.emit('automation:complete', {
        type: 'purchase_sequence_completed',
        itemBounds,
        success: true,
        moveResult,
        clickResult,
        refreshResult
      });

      return {
        success: true,
        itemBounds,
        moveResult,
        clickResult,
        refreshResult
      };

    } catch (error) {
      console.error('Purchase sequence failed:', error);
      
      this.emit('automation:complete', {
        type: 'purchase_sequence_failed',
        itemBounds,
        success: false,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Configuration methods
  setMouseSpeed(speed) {
    this.mouseSpeed = Math.max(0.1, Math.min(5.0, speed));
  }

  setClickModifiers(modifiers) {
    this.clickModifiers = Array.isArray(modifiers) ? modifiers : [modifiers];
  }

  setRefreshKey(key) {
    this.refreshKey = key;
  }

  enable() {
    this.isEnabled = true;
  }

  disable() {
    this.isEnabled = false;
  }

  // Utility methods
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async sendToPython(data) {
    return new Promise((resolve, reject) => {
      if (!this.pythonProcess) {
        // Start Python process if not running
        this.startPythonProcess().then(() => {
          this.sendToPython(data).then(resolve).catch(reject);
        }).catch(reject);
        return;
      }

      try {
        this.pythonProcess.send(data);
        
        // Set up response handler
        const timeout = setTimeout(() => {
          reject(new Error('Python response timeout'));
        }, 10000);

        const responseHandler = (response) => {
          clearTimeout(timeout);
          resolve(response);
        };

        // Store response handler for this request
        this.pendingResponses = this.pendingResponses || new Map();
        this.pendingResponses.set(data.timestamp || Date.now(), responseHandler);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  async startPythonProcess() {
    return new Promise((resolve, reject) => {
      try {
        this.pythonProcess = new PythonShell(this.pythonScriptPath, {
          mode: 'json',
          pythonPath: this.pythonExecutable,
          cwd: path.dirname(this.pythonScriptPath)
        });

        this.pythonProcess.on('message', (message) => {
          try {
            // Handle pending response
            if (this.pendingResponses && this.pendingResponses.size > 0) {
              const [requestId, handler] = this.pendingResponses.entries().next().value;
              this.pendingResponses.delete(requestId);
              handler(message);
            }
          } catch (error) {
            console.error('Failed to handle Python message:', error);
          }
        });

        this.pythonProcess.on('stderr', (stderr) => {
          console.error('Python stderr:', stderr);
        });

        this.pythonProcess.on('close', (code) => {
          console.log(`Python process exited with code ${code}`);
          this.pythonProcess = null;
        });

        this.pythonProcess.on('error', (error) => {
          console.error('Python process error:', error);
          reject(error);
        });

        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  async getMousePosition() {
    try {
      // Use a simple approach for now
      return { x: 0, y: 0 };
    } catch (error) {
      console.error('Failed to get mouse position:', error);
      return { x: 0, y: 0 };
    }
  }

  async getScreenSize() {
    try {
      // Use default screen size
      return { width: 1920, height: 1080 };
    } catch (error) {
      console.error('Failed to get screen size:', error);
      return { width: 1920, height: 1080 };
    }
  }

  // Status methods
  getStatus() {
    return {
      isEnabled: this.isEnabled,
      isProcessing: this.isProcessing,
      mouseSpeed: this.mouseSpeed,
      clickModifiers: this.clickModifiers,
      refreshKey: this.refreshKey
    };
  }

  // Cleanup method
  async cleanup() {
    this.isProcessing = false;
    this.isEnabled = false;
  }
}

module.exports = { AutomationController };
