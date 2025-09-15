const { PythonShell } = require('python-shell');
const path = require('path');
const EventEmitter = require('events');

class ComputerVision extends EventEmitter {
  constructor(configManager) {
    super();
    this.configManager = configManager;
    this.pythonProcess = null;
    this.isDetecting = false;
    this.detectionConfig = null;
    
    // Get the correct Python script path for packaged app
    const { app } = require('electron');
    if (app && app.isPackaged) {
      // In packaged app, Python scripts are in resources/python
      this.pythonScriptPath = path.join(process.resourcesPath, 'python', 'cv_detection.py');
    } else {
      // In development, use relative path
      this.pythonScriptPath = path.join(__dirname, '../../python/cv_detection.py');
    }
    
    // Try multiple Python executable paths
    this.pythonExecutablePaths = [];
    
    if (app && app.isPackaged) {
      // In packaged app, try embedded Python first
      this.pythonExecutablePaths.push(
        path.join(process.resourcesPath, 'python', 'python.exe'),
        path.join(process.resourcesPath, 'python', 'python3.exe')
      );
    }
    
    // Add system Python paths
    this.pythonExecutablePaths.push(
      'python',
      'python3',
      'py',
      'C:\\Python39\\python.exe',
      'C:\\Python310\\python.exe',
      'C:\\Python311\\python.exe',
      'C:\\Python312\\python.exe'
    );
    this.pythonExecutable = null; // Will be determined dynamically
  }

  // Helper method to convert merchant window coordinates to detection window format
  convertMerchantWindowToDetectionWindow(merchantWindow) {
    if (!merchantWindow || merchantWindow.x1 === undefined) {
      return { x: 834, y: 284, width: 875, height: 867 }; // Default fallback for 3440x1440 resolution
    }

    const x1 = merchantWindow.x1 || 0;
    const y1 = merchantWindow.y1 || 0;
    const x2 = merchantWindow.x2 || 0;
    const y2 = merchantWindow.y2 || 0;

    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1)
    };
  }

  async detectItems(windowBounds) {
    try {
      // For one-time detection, we don't need to start the full detection session
      // Just validate Python environment and run detection directly
      const validation = await this.validatePythonEnvironment();
      if (!validation.valid) {
        throw new Error(`Python environment validation failed: ${validation.error}`);
      }

      // Get mouse settings from config
      const mouseSpeed = await this.configManager.get('automation.mouseSpeed') || 1.0;
      const mouseMovementType = await this.configManager.get('automation.mouseMovementType') || 'natural';
      
      // Build config for V5 detection using the provided window bounds
      this.detectionConfig = {
        confidence_threshold: 0.4, // V5 optimized threshold
        detection_window: windowBounds, // Use the provided merchant window bounds
        min_area: 300, // V5 optimized minimum area
        max_area: 100000, // V5 maximum area
        mouse_speed: mouseSpeed,
        mouse_movement_type: mouseMovementType,
        click_modifiers: ['ctrl']
      };

      console.log('One-time detection config built:', this.detectionConfig);
      console.log('Window bounds received:', windowBounds);
      console.log('Mouse speed from config:', mouseSpeed);

      // Start a temporary Python process for one-time detection
      await this.startPythonProcess(false); // false = one-time detection, don't start continuous loop

      // Send detection request to Python process
      const detectionRequest = {
        type: 'detect',
        windowBounds,
        timestamp: Date.now()
      };

      const result = await this.sendToPython(detectionRequest);

      // Don't clean up the process here - let the calling code handle it
      // This allows for mouse movement and other operations after detection
      
      return result;

    } catch (error) {
      console.error('Item detection failed:', error);
      
      // Clean up on error
      if (this.pythonProcess && !this.isDetecting) {
        this.pythonProcess.end();
        this.pythonProcess = null;
      }
      
      return {
        success: false,
        error: error.message,
        items: []
      };
    }
  }

  async startDetection(config) {
    try {
      if (this.isDetecting) {
        await this.stopDetection();
      }

      // Validate Python environment first
      const validation = await this.validatePythonEnvironment();
      if (!validation.valid) {
        throw new Error(`Python environment validation failed: ${validation.error}`);
      }

      // Get mouse settings from config if not provided
      const mouseSpeed = config.mouseSpeed || await this.configManager.get('automation.mouseSpeed') || 1.0;
      const mouseMovementType = config.mouseMovementType || await this.configManager.get('automation.mouseMovementType') || 'natural';
      
      this.detectionConfig = {
        confidence_threshold: 0.4,
        detection_window: config.detectionWindow || this.convertMerchantWindowToDetectionWindow(config.merchantWindow),
        min_area: 300,
        max_area: 100000,
        mouse_speed: mouseSpeed,
        mouse_movement_type: mouseMovementType,
        click_modifiers: config.clickModifiers || ['ctrl']
      };

      // Start Python process
      await this.startPythonProcess(true); // true = start continuous detection

      this.isDetecting = true;

      this.emit('cv:detection', {
        type: 'started',
        config: this.detectionConfig
      });

      console.log('Computer vision detection started with config:', this.detectionConfig);

      return {
        success: true,
        message: 'Computer vision detection started',
        config: this.detectionConfig
      };

    } catch (error) {
      console.error('Failed to start detection:', error);
      this.emit('cv:detection', {
        type: 'error',
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  async stopDetection() {
    try {
      if (this.pythonProcess) {
        this.pythonProcess.end();
        this.pythonProcess = null;
      }

      this.isDetecting = false;
      this.detectionConfig = null;

      this.emit('cv:detection', {
        type: 'stopped'
      });

      return {
        success: true,
        message: 'Computer vision detection stopped'
      };

    } catch (error) {
      console.error('Failed to stop detection:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async startPythonProcess(startContinuousDetection = true) {
    return new Promise(async (resolve, reject) => {
      try {
        // Ensure we have a valid Python executable
        if (!this.pythonExecutable) {
          const validation = await this.validatePythonEnvironment();
          if (!validation.valid) {
            reject(new Error(validation.error));
            return;
          }
        }

        // Use PythonShell for better integration
        this.pythonProcess = new PythonShell(this.pythonScriptPath, {
          mode: 'json',
          pythonPath: this.pythonExecutable,
          cwd: path.dirname(this.pythonScriptPath)
        });

        this.pythonProcess.on('message', (message) => {
          try {
            // Check if this is a response to a pending request
            if (this.pendingResponses && this.pendingResponses.size > 0) {
              // Find the first pending response handler and call it
              for (const [requestId, handler] of this.pendingResponses) {
                handler(message);
                break; // Only call the first handler
              }
              return;
            }
            
            // Otherwise, process it as a continuous detection result
            this.handlePythonOutput(message);
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
          this.isDetecting = false;
        });

        this.pythonProcess.on('error', (error) => {
          console.error('Python process error:', error);
          reject(error);
        });

        // Send initial configuration
        setTimeout(async () => {
          // Get mouse settings from config for fallback
          const fallbackMouseSpeed = await this.configManager.get('automation.mouseSpeed') || 1.0;
          const fallbackMouseMovementType = await this.configManager.get('automation.mouseMovementType') || 'natural';
          
          const configToSend = this.detectionConfig || {
            confidence_threshold: 0.4,
            detection_window: { x: 834, y: 284, width: 875, height: 867 }, // Default for 3440x1440 resolution
            min_area: 300,
            max_area: 100000,
            detection_interval: 100, // 100ms between detections (faster polling)
            detection_timeout: 15000, // 15 second timeout
            mouse_speed: fallbackMouseSpeed,
            mouse_movement_type: fallbackMouseMovementType,
            click_modifiers: ['ctrl']
          };
          
          this.sendToPython({
            type: 'config',
            config: configToSend,
            startContinuousDetection: startContinuousDetection
          }).then(() => {
            resolve();
          }).catch(reject);
        }, 1000);

      } catch (error) {
        reject(error);
      }
    });
  }

  async sendToPython(data) {
    return new Promise((resolve, reject) => {
      if (!this.pythonProcess) {
        reject(new Error('Python process not running'));
        return;
      }

      try {
        const requestId = data.timestamp || Date.now();
        data.requestId = requestId;
        
        console.log('Sending to Python:', JSON.stringify(data, null, 2));
        this.pythonProcess.send(data);
        
        // Set up response handler with timeout
        const timeout = setTimeout(() => {
          if (this.pendingResponses && this.pendingResponses.has(requestId)) {
            this.pendingResponses.delete(requestId);
            reject(new Error('Python response timeout'));
          }
        }, 15000); // Increased timeout for complex operations

        const responseHandler = (response) => {
          console.log('Received response from Python:', response);
          clearTimeout(timeout);
          if (this.pendingResponses && this.pendingResponses.has(requestId)) {
            this.pendingResponses.delete(requestId);
            resolve(response);
          }
        };

        // Store response handler for this request
        this.pendingResponses = this.pendingResponses || new Map();
        this.pendingResponses.set(requestId, responseHandler);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  handlePythonOutput(result) {
    try {
      console.log('ComputerVision received Python output:', result);
      switch (result.type) {
        case 'detection_result':
          console.log('ComputerVision emitting cv:detection event with items:', result.items);
          this.emit('cv:detection', {
            type: 'items_detected',
            items: result.items,
            confidence: result.confidence,
            timestamp: result.timestamp
          });
          break;

        case 'error':
          this.emit('cv:detection', {
            type: 'error',
            error: result.error,
            timestamp: result.timestamp
          });
          break;

        case 'status':
          this.emit('cv:detection', {
            type: 'status',
            status: result.status,
            message: result.message,
            timestamp: result.timestamp
          });
          break;

        case 'response':
          // Handle pending response
          if (this.pendingResponses && this.pendingResponses.has(result.requestId)) {
            const handler = this.pendingResponses.get(result.requestId);
            this.pendingResponses.delete(result.requestId);
            handler(result.data);
          }
          break;

        default:
          console.log('Unknown Python output type:', result.type);
      }
    } catch (error) {
      console.error('Failed to handle Python output:', error);
    }
  }

  // Utility methods
  async findPythonExecutable() {
    const { exec } = require('child_process');
    const fs = require('fs');
    
    // First, try to find Python using system commands
    const systemCommands = ['python', 'python3', 'py'];
    
    for (const cmd of systemCommands) {
      try {
        const result = await new Promise((resolve, reject) => {
          exec(`${cmd} --version`, (error, stdout, stderr) => {
            if (error) {
              reject(error);
            } else {
              resolve(stdout);
            }
          });
        });
        
        if (result && result.includes('Python')) {
          console.log(`Found Python: ${cmd} - ${result.trim()}`);
          return cmd;
        }
      } catch (error) {
        // Continue to next command
      }
    }
    
    // If system commands don't work, try file paths
    for (const pythonPath of this.pythonExecutablePaths) {
      try {
        if (fs.existsSync(pythonPath)) {
          console.log(`Found Python at: ${pythonPath}`);
          return pythonPath;
        }
      } catch (error) {
        // Continue to next path
      }
    }
    
    return null;
  }

  async validatePythonEnvironment() {
    try {
      // Find Python executable
      const pythonExe = await this.findPythonExecutable();
      if (!pythonExe) {
        return {
          valid: false,
          error: 'Python executable not found. Please ensure Python is installed and available in PATH, or install Python dependencies.'
        };
      }
      
      this.pythonExecutable = pythonExe;

      // Check if Python script exists
      const fs = require('fs');
      if (!fs.existsSync(this.pythonScriptPath)) {
        return {
          valid: false,
          error: `Computer vision script not found at: ${this.pythonScriptPath}`
        };
      }

      return {
        valid: true,
        pythonPath: this.pythonExecutable,
        scriptPath: this.pythonScriptPath
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  // Test Python environment without starting detection
  async testPythonEnvironment() {
    try {
      const validation = await this.validatePythonEnvironment();
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          suggestion: 'Try running: pip install opencv-python numpy mss pyautogui pillow'
        };
      }

      // Try to start and immediately stop a Python process to test
      await this.startPythonProcess(true); // true = start continuous detection
      
      // Send a simple test command
      const testRequest = {
        type: 'test',
        timestamp: Date.now()
      };
      
      console.log('Sending test request to Python:', JSON.stringify(testRequest, null, 2));

      // Set a short timeout for testing
      const timeout = setTimeout(() => {
        if (this.pythonProcess) {
          this.pythonProcess.end();
          this.pythonProcess = null;
        }
      }, 5000);

      try {
        await this.sendToPython(testRequest);
        clearTimeout(timeout);
        
        // Clean up
        if (this.pythonProcess) {
          this.pythonProcess.end();
          this.pythonProcess = null;
        }

        return {
          success: true,
          message: `Python environment is working correctly (${validation.pythonPath})`
        };
      } catch (error) {
        clearTimeout(timeout);
        if (this.pythonProcess) {
          this.pythonProcess.end();
          this.pythonProcess = null;
        }
        throw error;
      }

    } catch (error) {
      return {
        success: false,
        error: `Python environment test failed: ${error.message}`,
        suggestion: 'Make sure all required packages are installed: pip install opencv-python numpy mss pyautogui pillow'
      };
    }
  }

  getDetectionStatus() {
    return {
      isDetecting: this.isDetecting,
      config: this.detectionConfig,
      pythonProcessRunning: !!this.pythonProcess
    };
  }

  // Enhanced utility methods
  async captureScreenRegion(windowBounds) {
    try {
      if (!this.isDetecting) {
        throw new Error('Detection not started. Call startDetection() first.');
      }

      const captureRequest = {
        type: 'capture',
        windowBounds,
        timestamp: Date.now()
      };

      return await this.sendToPython(captureRequest);
    } catch (error) {
      console.error('Screen capture failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async moveMouse(x, y) {
    try {
      // Mouse movement doesn't require detection to be started
      // It can work independently for one-time operations

      const moveRequest = {
        type: 'move_mouse',
        x,
        y,
        timestamp: Date.now()
      };

      return await this.sendToPython(moveRequest);
    } catch (error) {
      console.error('Mouse movement failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async clickMouse(x, y, modifiers = ['ctrl']) {
    try {
      const clickRequest = {
        type: 'click_mouse',
        x,
        y,
        modifiers,
        timestamp: Date.now()
      };

      return await this.sendToPython(clickRequest);
    } catch (error) {
      console.error('Mouse click failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async pressKey(key) {
    try {
      const keyRequest = {
        type: 'press_key',
        key,
        timestamp: Date.now()
      };

      return await this.sendToPython(keyRequest);
    } catch (error) {
      console.error('Key press failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }



  async purchaseItem(itemBounds) {
    try {
      if (!this.isDetecting) {
        throw new Error('Detection not started. Call startDetection() first.');
      }

      const purchaseRequest = {
        type: 'purchase',
        itemBounds,
        timestamp: Date.now()
      };

      return await this.sendToPython(purchaseRequest);
    } catch (error) {
      console.error('Item purchase failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get detailed status information
  getDetailedStatus() {
    return {
      isDetecting: this.isDetecting,
      pythonProcessRunning: !!this.pythonProcess,
      config: this.detectionConfig,
      pendingResponses: this.pendingResponses ? this.pendingResponses.size : 0,
      lastError: this.lastError || null
    };
  }

  // Cleanup method
  async cleanup() {
    try {
      // Clear all pending responses
      if (this.pendingResponses) {
        this.pendingResponses.clear();
      }
      
      await this.stopDetection();
      
      console.log('Computer vision cleanup completed');
    } catch (error) {
      console.error('Error during computer vision cleanup:', error);
    }
  }
}

module.exports = { ComputerVision };
