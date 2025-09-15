const EventEmitter = require('events');
const ComputerVision = require('./computer-vision');
const TravelAPI = require('./travel-api');

class AutomationManager extends EventEmitter {
    constructor(configManager, computerVision, travelAPI) {
        super();
        this.configManager = configManager;
        this.computerVision = computerVision;
        this.travelAPI = travelAPI;
        
        // Automation state
        this.isAutomating = false;
        this.currentAutomation = null;
        this.automationTimeout = null;
        this.cvDetectionTimeout = null;
        
        // Configuration
        this.travelWaitTime = 2000; // 2 seconds after travel
        this.cvDetectionDuration = 20000; // 20 seconds max CV detection
        
        // Setup event listeners
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Listen for travel results
        this.travelAPI.on('travel:result', (result) => {
            console.log('AutomationManager received travel:result event:', result);
            if (this.isAutomating && this.currentAutomation) {
                this.handleTravelResult(result);
            } else {
                console.log('AutomationManager ignoring travel:result - not automating or no current automation');
            }
        });
        
        // Listen for CV detection results
        this.computerVision.on('cv:detection', (result) => {
            console.log('AutomationManager received cv:detection event:', result);
            if (this.isAutomating && this.currentAutomation && result.type === 'items_detected') {
                this.handleItemDetected(result);
            }
        });
        
        // Listen for CV errors
        this.computerVision.on('cv:detection', (result) => {
            if (this.isAutomating && this.currentAutomation && result.type === 'error') {
                this.handleCVError(result.error);
            }
        });
    }
    
    async startAutomation(itemData) {
        if (this.isAutomating) {
            console.log('Automation already in progress, skipping new request for item:', itemData.id);
            return { success: false, error: 'Automation already in progress' };
        }
        
        try {
            this.isAutomating = true;
            this.currentAutomation = {
                itemData,
                startTime: Date.now(),
                step: 'travel',
                status: 'starting'
            };
            
            console.log('Starting automated trading flow for item:', itemData.id);
            this.emit('automation:started', this.currentAutomation);
            
            // Step 1: Initiate travel to hideout
            await this.initiateTravel(itemData);
            
            return { success: true, automationId: this.currentAutomation.startTime };
            
        } catch (error) {
            console.error('Failed to start automation:', error);
            this.cleanupAutomation();
            return { success: false, error: error.message };
        }
    }
    
    async initiateTravel(itemData) {
        try {
            this.currentAutomation.step = 'travel';
            this.currentAutomation.status = 'traveling';
            
            console.log('Step 1: Initiating travel to hideout for item:', itemData.id);
            this.emit('automation:step', { step: 'travel', status: 'initiating' });
            
            // Extract hideout token from item data
            const hideoutToken = this.extractHideoutToken(itemData);
            if (!hideoutToken) {
                throw new Error('No hideout token found in item data');
            }
            
            // Set timeout for travel response
            this.automationTimeout = setTimeout(() => {
                this.handleTravelTimeout();
            }, 10000); // 10 second timeout for travel
            
            // Start travel request and wait for result
            const travelResult = await this.travelAPI.travelToHideout({
                id: itemData.id,
                hideoutToken: hideoutToken
            });
            
            // Handle the immediate result from travelToHideout
            if (travelResult && travelResult.success) {
                console.log('Step 1: Travel successful (immediate result), waiting 2 seconds before CV detection');
                this.emit('automation:step', { step: 'travel', status: 'success' });
                
                // Clear timeout since we got immediate success
                if (this.automationTimeout) {
                    clearTimeout(this.automationTimeout);
                    this.automationTimeout = null;
                }
                
                // Step 2: Wait 2 seconds then start CV detection
                setTimeout(() => {
                    this.startCVDetection();
                }, this.travelWaitTime);
            } else {
                console.log('Step 1: Travel result indicates failure, waiting for event or timeout');
                // Don't fail immediately - wait for the travel:result event or timeout
            }
            
        } catch (error) {
            console.error('Travel initiation failed:', error);
            this.handleAutomationError('travel', error);
        }
    }
    
    async handleTravelResult(result) {
        if (!this.isAutomating || !this.currentAutomation) return;
        
        console.log('AutomationManager handling travel result event:', result);
        
        // Clear travel timeout
        if (this.automationTimeout) {
            clearTimeout(this.automationTimeout);
            this.automationTimeout = null;
        }
        
        // Check if travel was successful based on the result structure
        const isSuccess = result.data && result.data.success === true;
        
        if (isSuccess) {
            // Only proceed if we haven't already started CV detection
            if (this.currentAutomation.step === 'travel') {
                console.log('Step 1: Travel successful (from event), waiting 2 seconds before CV detection');
                this.emit('automation:step', { step: 'travel', status: 'success' });
                
                // Step 2: Wait 2 seconds then start CV detection
                setTimeout(() => {
                    this.startCVDetection();
                }, this.travelWaitTime);
            } else {
                console.log('Travel result received but automation already progressed past travel step');
            }
            
        } else {
            console.error('Step 1: Travel failed (from event):', result.error || 'Unknown error');
            this.handleAutomationError('travel', new Error(result.error || 'Travel failed'));
        }
    }
    
    handleTravelTimeout() {
        console.error('Step 1: Travel timeout - no response received');
        this.handleAutomationError('travel', new Error('Travel request timed out'));
    }
    
    async startCVDetection() {
        try {
            this.currentAutomation.step = 'cv_detection';
            this.currentAutomation.status = 'detecting';
            
            console.log('Step 2: Starting computer vision detection for 20 seconds');
            this.emit('automation:step', { step: 'cv_detection', status: 'starting' });
            
            // Get merchant window bounds from config
            const merchantWindow = await this.configManager.get('computerVision.merchantWindow') || {
                x1: 834, y1: 284, x2: 1709, y2: 1151
            };
            
            const detectionWindow = {
                x: merchantWindow.x1,
                y: merchantWindow.y1,
                width: merchantWindow.x2 - merchantWindow.x1,
                height: merchantWindow.y2 - merchantWindow.y1
            };
            
            // Start continuous CV detection
            const cvResult = await this.computerVision.startDetection({
                detectionWindow,
                detectionInterval: 100, // 100ms polling for faster detection
                detectionTimeout: 15000, // 15 second timeout
                mouseSpeed: await this.configManager.get('automation.mouseSpeed') || 1.0,
                mouseMovementType: await this.configManager.get('automation.mouseMovementType') || 'natural'
            });
            
            if (!cvResult.success) {
                throw new Error(cvResult.error);
            }
            
            // Set timeout for CV detection (20 seconds max)
            this.cvDetectionTimeout = setTimeout(() => {
                this.handleCVTimeout();
            }, this.cvDetectionDuration);
            
            console.log('Step 2: CV detection started successfully');
            this.emit('automation:step', { step: 'cv_detection', status: 'running' });
            
        } catch (error) {
            console.error('CV detection start failed:', error);
            this.handleAutomationError('cv_detection', error);
        }
    }
    
    async handleItemDetected(result) {
        if (!this.isAutomating || !this.currentAutomation) return;
        
        if (result.items && result.items.length > 0) {
            console.log('Step 2: Item detected! Moving mouse to item');
            this.emit('automation:step', { step: 'cv_detection', status: 'item_found' });
            
            // Clear CV timeout since we found an item
            if (this.cvDetectionTimeout) {
                clearTimeout(this.cvDetectionTimeout);
                this.cvDetectionTimeout = null;
            }
            
            // Step 3: Move mouse to the detected item
            await this.moveMouseToItem(result.items[0]); // Use highest confidence item
            
        } else {
            console.log('Step 2: CV detection running, no items found yet');
        }
    }
    
    async moveMouseToItem(item) {
        try {
            this.currentAutomation.step = 'mouse_movement';
            this.currentAutomation.status = 'moving_mouse';
            
            console.log('Step 3: Moving mouse to detected item:', item.item_type);
            this.emit('automation:step', { step: 'mouse_movement', status: 'moving' });
            
            // Get merchant window bounds for global coordinates
            const merchantWindow = await this.configManager.get('computerVision.merchantWindow') || {
                x1: 834, y1: 284, x2: 1709, y2: 1151
            };
            
            // Calculate global coordinates
            const globalX = merchantWindow.x1 + item.center_x;
            const globalY = merchantWindow.y1 + item.center_y;
            
            console.log(`Moving mouse to global coordinates: (${globalX}, ${globalY})`);
            
            // Move mouse to item
            const moveResult = await this.computerVision.moveMouse(globalX, globalY);
            
            if (moveResult.success) {
                console.log('Step 3: Mouse movement successful!');
                this.emit('automation:step', { step: 'mouse_movement', status: 'success' });
                
                // Check if auto purchase is enabled
                const autoPurchase = await this.configManager.get('automation.autoPurchase') || false;
                if (autoPurchase) {
                    console.log('Step 4: Auto purchase enabled, clicking on item');
                    this.emit('automation:step', { step: 'auto_purchase', status: 'clicking' });
                    
                    // Get click modifiers from config
                    const clickModifiers = await this.configManager.get('automation.clickModifiers') || ['ctrl'];
                    
                    // Click on the item
                    const clickResult = await this.computerVision.clickMouse(globalX, globalY, clickModifiers);
                    
                    if (clickResult.success) {
                        console.log('Step 4: Auto purchase successful!');
                        this.emit('automation:step', { step: 'auto_purchase', status: 'success' });
                        
                        // Step 5: Wait 1 second after purchase
                        console.log('Step 5: Waiting 1 second after purchase...');
                        this.emit('automation:step', { step: 'post_purchase_wait', status: 'waiting' });
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Step 6: Press F5 to return to hideout
                        console.log('Step 6: Pressing F5 to return to hideout...');
                        this.emit('automation:step', { step: 'return_hideout', status: 'pressing_f5' });
                        
                        const f5Result = await this.computerVision.pressKey('f5');
                        
                        if (f5Result.success) {
                            console.log('Step 6: F5 pressed successfully!');
                            this.emit('automation:step', { step: 'return_hideout', status: 'success' });
                        } else {
                            console.error('Step 6: F5 press failed:', f5Result.error);
                            this.emit('automation:step', { step: 'return_hideout', status: 'failed' });
                        }
                    } else {
                        console.error('Step 4: Auto purchase failed:', clickResult.error);
                        this.emit('automation:step', { step: 'auto_purchase', status: 'failed' });
                    }
                }
                
                // Complete automation
                this.completeAutomation(item);
                
            } else {
                throw new Error(moveResult.error);
            }
            
        } catch (error) {
            console.error('Mouse movement failed:', error);
            this.handleAutomationError('mouse_movement', error);
        }
    }
    
    completeAutomation(item) {
        if (!this.currentAutomation) {
            console.error('Cannot complete automation - no current automation');
            return;
        }
        
        const duration = Date.now() - this.currentAutomation.startTime;
        
        console.log(`Automation completed successfully in ${duration}ms`);
        this.emit('automation:completed', {
            item: this.currentAutomation.itemData,
            detectedItem: item,
            duration,
            success: true
        });
        
        this.cleanupAutomation();
    }
    
    handleCVTimeout() {
        // Check if automation is still running before handling timeout
        if (!this.isAutomating || !this.currentAutomation) {
            console.log('CV timeout fired but automation already completed, ignoring');
            return;
        }
        
        console.log('Step 2: CV detection timeout - no items found in 20 seconds');
        this.emit('automation:step', { step: 'cv_detection', status: 'timeout' });
        
        // Stop CV detection
        this.computerVision.stopDetection().catch(error => {
            console.error('Error stopping CV detection:', error);
        });
        
        this.handleAutomationError('cv_detection', new Error('No items detected within timeout period'));
    }
    
    handleCVError(error) {
        // Check if automation is still running before handling error
        if (!this.isAutomating || !this.currentAutomation) {
            console.log('CV error occurred but automation already completed, ignoring');
            return;
        }
        
        console.error('CV detection error:', error);
        this.handleAutomationError('cv_detection', error);
    }
    
    handleAutomationError(step, error) {
        if (!this.currentAutomation) {
            console.error(`Automation error at step ${step} but no current automation:`, error.message);
            return;
        }
        
        const duration = Date.now() - this.currentAutomation.startTime;
        
        console.error(`Automation failed at step ${step}:`, error.message);
        this.emit('automation:failed', {
            step,
            error: error.message,
            item: this.currentAutomation.itemData,
            duration
        });
        
        this.cleanupAutomation();
    }
    
    cleanupAutomation() {
        // Clear timeouts
        if (this.automationTimeout) {
            clearTimeout(this.automationTimeout);
            this.automationTimeout = null;
        }
        
        if (this.cvDetectionTimeout) {
            clearTimeout(this.cvDetectionTimeout);
            this.cvDetectionTimeout = null;
        }
        
        // Stop CV detection if running
        if (this.computerVision.isDetecting) {
            this.computerVision.stopDetection().catch(error => {
                console.error('Error stopping CV detection during cleanup:', error);
            });
        }
        
        // Reset state
        this.isAutomating = false;
        this.currentAutomation = null;
        
        console.log('Automation cleanup completed');
    }
    
    extractHideoutToken(itemData) {
        // Extract hideout token from item data structure
        if (itemData.listing && itemData.listing.hideout_token) {
            return itemData.listing.hideout_token;
        }
        
        // Fallback: check if hideoutToken is directly on itemData
        if (itemData.hideoutToken) {
            return itemData.hideoutToken;
        }
        
        return null;
    }
    
    // Public methods for external control
    stopAutomation() {
        if (this.isAutomating) {
            console.log('Stopping automation by user request');
            this.cleanupAutomation();
            this.emit('automation:stopped');
        }
    }
    
    getAutomationStatus() {
        return {
            isAutomating: this.isAutomating,
            currentAutomation: this.currentAutomation
        };
    }
}

module.exports = AutomationManager;