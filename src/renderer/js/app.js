// Main application class
class PoE2TradeApp {
    constructor() {
        this.websocketManager = null;
        this.searchManager = null;
        this.uiManager = null;
        this.configManager = null;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            console.log('Initializing PoE2 Trade application...');
            
            // Initialize managers
            this.websocketManager = new WebSocketManager();
            this.searchManager = new SearchManager();
            this.uiManager = new UIManager();
            this.configManager = new ConfigManager();
            
            // Wait for WebSocket handler to be ready
            await this.waitForWebSocketHandler();
            
            // Initialize UI components
            await this.uiManager.initialize();
            
            // Load configuration
            await this.configManager.load();
            
            // Set up event listeners
            this.setupEventListeners();
            
        // Set up auto-travel event listeners
        this.setupAutoTravelListeners();
        
        // Set up automation event listeners
        this.setupAutomationListeners();
            
            // Load saved searches
            await this.searchManager.loadSearches();
            
            this.isInitialized = true;
            console.log('Application initialized successfully');
            
            // Show welcome notification
            this.uiManager.showNotification('Application ready', 'success');
            
        } catch (error) {
            console.error('Failed to initialize application:', error);
            if (this.uiManager) {
                this.uiManager.showNotification('Failed to initialize application', 'error');
            }
        }
    }

    async waitForWebSocketHandler() {
        // Wait for the global WebSocket handler to be available
        while (!window.webSocketEventHandler) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.log('WebSocket handler ready');
    }

    setupEventListeners() {
        // WebSocket events - use the global WebSocket handler
        if (window.webSocketEventHandler) {
            window.webSocketEventHandler.registerMessageHandler('*', (data) => {
                this.handleWebSocketMessage(data);
            });
            
            window.webSocketEventHandler.registerStatusHandler('*', (data) => {
                this.handleWebSocketStatus(data);
            });
        }

        // Search events
        this.searchManager.on('searchAdded', (search) => {
            this.uiManager.addSearchToList(search);
        });

        this.searchManager.on('searchRemoved', (searchId) => {
            this.uiManager.removeSearchFromList(searchId);
        });

        this.searchManager.on('searchUpdated', (search) => {
            this.uiManager.updateSearchInList(search);
        });

        this.searchManager.on('disconnectSearch', (searchId) => {
            this.handleDisconnectSearch(searchId);
        });

        // UI events
        this.uiManager.on('addSearch', (searchData) => {
            this.handleAddSearch(searchData);
        });

        this.uiManager.on('removeSearch', (searchId) => {
            this.handleRemoveSearch(searchId);
        });

        this.uiManager.on('connectSearch', (searchId) => {
            this.handleConnectSearch(searchId);
        });

        this.uiManager.on('disconnectSearch', (searchId) => {
            this.handleDisconnectSearch(searchId);
        });

        this.uiManager.on('travelToHideout', (itemData) => {
            this.handleTravelToHideout(itemData);
        });

        this.uiManager.on('purchaseItem', (itemData) => {
            this.handlePurchaseItem(itemData);
        });

        this.uiManager.on('settingsChanged', (settings) => {
            this.handleSettingsChanged(settings);
        });

        this.uiManager.on('authChanged', (credentials) => {
            this.handleAuthChanged(credentials);
        });

        this.uiManager.on('exportSearches', () => {
            this.exportSearches();
        });

        this.uiManager.on('importSearches', () => {
            this.importSearches();
        });
    }

    setupAutoTravelListeners() {
        // Listen for auto-travel results from main process
        window.electronAPI.autoTravel.onResult((data) => {
            this.handleAutoTravelResult(data);
        });
    }

    handleAutoTravelResult(data) {
        // Don't show notifications here - they're already handled by handleTravelResult
        // This prevents duplicate notifications for the same travel attempt
        console.log('Auto-travel result:', data);
    }

    setupAutomationListeners() {
        // Listen for automation events
        window.electronAPI.on('automation:started', (data) => {
            this.handleAutomationStarted(data);
        });

        window.electronAPI.on('automation:step', (data) => {
            this.handleAutomationStep(data);
        });

        window.electronAPI.on('automation:completed', (data) => {
            this.handleAutomationCompleted(data);
        });

        window.electronAPI.on('automation:failed', (data) => {
            this.handleAutomationFailed(data);
        });

        window.electronAPI.on('automation:stopped', (data) => {
            this.handleAutomationStopped(data);
        });
    }

    handleAutomationStarted(data) {
        console.log('Automation started:', data);
        this.updateAutomationStatus('running', 'Automation Started');
        
        if (data.success) {
            this.uiManager.showNotification(`🤖 Automation started for ${data.itemName}`, 'info');
        } else {
            this.uiManager.showNotification(`❌ Automation failed to start: ${data.error}`, 'error');
            this.updateAutomationStatus('error', 'Automation Failed');
        }
    }

    handleAutomationStep(data) {
        console.log('Automation step:', data);
        
        const stepMessages = {
            'travel': {
                'initiating': '🚀 Initiating travel to hideout...',
                'success': '✅ Travel successful, waiting 5 seconds...',
                'failed': '❌ Travel failed'
            },
            'cv_detection': {
                'starting': '👁️ Starting computer vision detection...',
                'running': '🔍 Scanning for items...',
                'item_found': '🎯 Item detected!',
                'timeout': '⏰ Detection timeout - no items found'
            },
            'mouse_movement': {
                'moving': '🖱️ Moving mouse to item...',
                'success': '✅ Mouse movement complete!'
            }
        };

        const message = stepMessages[data.step]?.[data.status];
        if (message) {
            this.updateAutomationStatus('running', message);
        }
    }

    handleAutomationCompleted(data) {
        console.log('Automation completed:', data);
        this.updateAutomationStatus('success', 'Automation Complete');
        
        const duration = (data.duration / 1000).toFixed(1);
        this.uiManager.showNotification(
            `🎉 Automation completed in ${duration}s! Mouse moved to detected item.`, 
            'success'
        );
        
        // Hide status after 3 seconds
        setTimeout(() => {
            this.updateAutomationStatus('hidden', '');
        }, 3000);
    }

    handleAutomationFailed(data) {
        console.log('Automation failed:', data);
        this.updateAutomationStatus('error', `Failed at ${data.step}`);
        
        this.uiManager.showNotification(
            `❌ Automation failed at ${data.step}: ${data.error}`, 
            'error'
        );
        
        // Hide status after 5 seconds
        setTimeout(() => {
            this.updateAutomationStatus('hidden', '');
        }, 5000);
    }

    handleAutomationStopped(data) {
        console.log('Automation stopped:', data);
        this.updateAutomationStatus('hidden', '');
        this.uiManager.showNotification('⏹️ Automation stopped by user', 'info');
    }

    updateAutomationStatus(status, message) {
        const statusElement = document.getElementById('automation-status');
        const indicatorElement = statusElement.querySelector('.status-indicator');
        const textElement = statusElement.querySelector('.status-text');
        
        if (status === 'hidden') {
            statusElement.style.display = 'none';
            return;
        }
        
        statusElement.style.display = 'flex';
        textElement.textContent = message;
        
        // Update status classes
        statusElement.className = 'automation-status';
        if (status === 'error') {
            statusElement.classList.add('error');
        }
    }

    async handleAddSearch(searchData) {
        try {
            const search = await this.searchManager.addSearch(searchData);
            this.uiManager.showNotification('Search added successfully', 'success');
            
            // Automatically connect the search
            try {
                await this.handleConnectSearch(search.id);
            } catch (connectError) {
                console.error('Failed to auto-connect search:', connectError);
                this.uiManager.showNotification('Search added but failed to connect: ' + connectError.message, 'warning');
            }
            
            return search;
        } catch (error) {
            console.error('Failed to add search:', error);
            this.uiManager.showNotification('Failed to add search: ' + error.message, 'error');
            throw error;
        }
    }

    async handleRemoveSearch(searchId) {
        try {
            await this.searchManager.removeSearch(searchId);
            this.uiManager.showNotification('Search removed successfully', 'success');
        } catch (error) {
            console.error('Failed to remove search:', error);
            this.uiManager.showNotification('Failed to remove search: ' + error.message, 'error');
        }
    }

    async handleConnectSearch(searchId) {
        try {
            const search = this.searchManager.getSearch(searchId);
            if (!search) {
                throw new Error('Search not found');
            }

            const connectedSearchId = await this.websocketManager.connect(search);
            if (connectedSearchId) {
                this.uiManager.showNotification('Connected to search', 'success');
            } else {
                throw new Error('Failed to connect to WebSocket');
            }
        } catch (error) {
            console.error('Failed to connect search:', error);
            this.uiManager.showNotification('Failed to connect: ' + error.message, 'error');
        }
    }

    async handleDisconnectSearch(searchId) {
        try {
            const result = await this.websocketManager.disconnect(searchId);
            if (result.success) {
                this.uiManager.showNotification('Disconnected from search', 'info');
            } else {
                // If the connection doesn't exist, it's not necessarily an error
                // (e.g., when deleting an already disconnected search)
                if (result.error === 'No such connection') {
                    console.log(`Search ${searchId} was already disconnected`);
                } else {
                    throw new Error(result.error);
                }
            }
        } catch (error) {
            console.error('Failed to disconnect search:', error);
            this.uiManager.showNotification('Failed to disconnect: ' + error.message, 'error');
        }
    }

    async handleTravelToHideout(itemData) {
        try {
            const result = await window.electronAPI.travel.toHideout(itemData);
            if (result.success) {
                this.uiManager.showNotification('Traveling to hideout...', 'info');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Failed to travel to hideout:', error);
            this.uiManager.showNotification('Failed to travel: ' + error.message, 'error');
        }
    }

    async handlePurchaseItem(itemData) {
        try {
            // Start computer vision detection
            const cvResult = await window.electronAPI.computerVision.startDetection({
                detectionWindow: { x: 834, y: 284, width: 875, height: 867 }
            });

            if (!cvResult.success) {
                throw new Error(cvResult.error);
            }

            this.uiManager.showNotification('Looking for items to purchase...', 'info');

            // Listen for detection results
            const detectionHandler = (data) => {
                if (data.type === 'items_detected' && data.items.length > 0) {
                    // Purchase the first detected item
                    const item = data.items[0];
                    this.performPurchase(item);
                }
            };

            window.electronAPI.on('cv:detection', detectionHandler);

            // Stop detection after timeout
            setTimeout(() => {
                window.electronAPI.removeListener('cv:detection', detectionHandler);
                window.electronAPI.computerVision.stopDetection();
            }, 15000);

        } catch (error) {
            console.error('Failed to purchase item:', error);
            this.uiManager.showNotification('Failed to purchase: ' + error.message, 'error');
        }
    }

    async performPurchase(itemBounds) {
        try {
            // Move mouse to item
            await window.electronAPI.automation.moveMouse(
                itemBounds.x + (itemBounds.width / 2),
                itemBounds.y + (itemBounds.height / 2)
            );

            // Click with Ctrl modifier
            await window.electronAPI.automation.click(
                itemBounds.x + (itemBounds.width / 2),
                itemBounds.y + (itemBounds.height / 2),
                ['ctrl']
            );

            // Refresh search
            await window.electronAPI.automation.keyPress('f5');

            this.uiManager.showNotification('Item purchased successfully!', 'success');

        } catch (error) {
            console.error('Purchase failed:', error);
            this.uiManager.showNotification('Purchase failed: ' + error.message, 'error');
        }
    }

    handleWebSocketMessage(data) {
        console.log('WebSocket message received in app:', data);
        
        // Update UI with new items
        if (data.type === 'new_items') {
            console.log('Processing new_items:', data.items);
            
            // Throttle processing to prevent UI blocking
            if (!this.messageThrottle) {
                this.messageThrottle = new Map();
            }
            
            const searchId = data.searchId;
            if (!this.messageThrottle.has(searchId)) {
                this.messageThrottle.set(searchId, { lastProcessed: 0, pending: [] });
            }
            
            const throttle = this.messageThrottle.get(searchId);
            throttle.pending.push(...data.items);
            
            // Process messages with throttling
            const now = Date.now();
            if (now - throttle.lastProcessed > 50) { // 50ms throttle
                this.processThrottledMessages(searchId);
            } else {
                // Schedule processing for later
                setTimeout(() => {
                    this.processThrottledMessages(searchId);
                }, 50 - (now - throttle.lastProcessed));
            }
        }
    }

    processThrottledMessages(searchId) {
        const throttle = this.messageThrottle.get(searchId);
        if (!throttle || throttle.pending.length === 0) return;
        
        // Safety check to prevent infinite loops
        throttle.processingCount = (throttle.processingCount || 0) + 1;
        if (throttle.processingCount > 100) { // Max 100 iterations per search
            console.warn(`Message processing counter exceeded for search ${searchId}, stopping to prevent infinite loop`);
            throttle.pending = []; // Clear pending items
            throttle.processingCount = 0;
            return;
        }
        
        const itemsToProcess = throttle.pending.splice(0, 20); // Process max 20 items at once
        this.uiManager.addSearchResults(searchId, itemsToProcess);
        
        throttle.lastProcessed = Date.now();
        
        // If there are more pending items, schedule another batch
        if (throttle.pending.length > 0) {
            setTimeout(() => {
                this.processThrottledMessages(searchId);
            }, 50);
        } else {
            // Reset counter when no more items to process
            throttle.processingCount = 0;
        }
    }

    handleWebSocketStatus(data) {
        console.log('WebSocket status changed:', data);
        
        // Update search status in UI
        this.uiManager.updateSearchStatus(data.searchId, data.status);
        
        // Update connection indicator
        this.uiManager.updateConnectionStatus(data.status);
    }

    async handleSettingsChanged(settings) {
        try {
            for (const [key, value] of Object.entries(settings)) {
                await window.electronAPI.config.set(key, value);
            }
            this.uiManager.showNotification('Settings saved successfully', 'success');
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.uiManager.showNotification('Failed to save settings: ' + error.message, 'error');
        }
    }

    async handleAuthChanged(credentials) {
        try {
            const result = await window.electronAPI.config.set('auth.poesessid', credentials.poesessid);
            await window.electronAPI.config.set('auth.cf_clearance', credentials.cf_clearance);
            
            this.uiManager.showNotification('Authentication credentials saved', 'success');
        } catch (error) {
            console.error('Failed to save auth credentials:', error);
            this.uiManager.showNotification('Failed to save credentials: ' + error.message, 'error');
        }
    }

    // Utility methods
    async exportSearches() {
        try {
            const searches = this.searchManager.getAllSearches();
            
            if (searches.length === 0) {
                this.uiManager.showNotification('No searches to export', 'warning');
                return;
            }

            const result = await window.electronAPI.file.save({
                title: 'Export Searches',
                defaultPath: 'poe2-searches.yaml',
                filters: [
                    { name: 'YAML Files', extensions: ['yaml', 'yml'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (!result.canceled) {
                // Create YAML structure with only searches
                const yamlData = {
                    searches: searches.map(search => ({
                        name: search.name,
                        league: search.league,
                        searchId: search.searchId
                    }))
                };

                // Convert to YAML string
                const yamlString = this.convertToYAML(yamlData);
                
                // Write to file
                const writeResult = await window.electronAPI.file.write(result.filePath, yamlString);
                
                if (writeResult.success) {
                    this.uiManager.showNotification(`Exported ${searches.length} searches successfully`, 'success');
                } else {
                    throw new Error(writeResult.error);
                }
            }
        } catch (error) {
            console.error('Failed to export searches:', error);
            this.uiManager.showNotification('Failed to export searches: ' + error.message, 'error');
        }
    }

    async importSearches() {
        try {
            const result = await window.electronAPI.file.select({
                title: 'Import Searches',
                filters: [
                    { name: 'YAML Files', extensions: ['yaml', 'yml'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (!result.canceled && result.filePaths.length > 0) {
                // Read the file content
                const readResult = await window.electronAPI.file.read(result.filePaths[0]);
                
                if (!readResult.success) {
                    throw new Error(readResult.error);
                }
                
                // Parse YAML
                const data = this.parseYAML(readResult.content);
                
                if (!data.searches || !Array.isArray(data.searches)) {
                    throw new Error('Invalid YAML format: missing searches array');
                }
                
                let importedCount = 0;
                for (const searchData of data.searches) {
                    if (searchData.name && searchData.searchId) {
                        await this.handleAddSearch({
                            name: searchData.name,
                            league: searchData.league || 'Rise of the Abyssal',
                            searchId: searchData.searchId
                        });
                        importedCount++;
                    }
                }
                
                this.uiManager.showNotification(`Imported ${importedCount} searches successfully`, 'success');
            }
        } catch (error) {
            console.error('Failed to import searches:', error);
            this.uiManager.showNotification('Failed to import searches: ' + error.message, 'error');
        }
    }

    convertToYAML(data) {
        // Simple YAML conversion for our search data
        let yaml = 'searches:\n';
        data.searches.forEach(search => {
            yaml += `  - name: "${search.name}"\n`;
            yaml += `    league: "${search.league}"\n`;
            yaml += `    searchId: "${search.searchId}"\n`;
        });
        return yaml;
    }

    parseYAML(yamlString) {
        // Simple YAML parser for our search data
        const lines = yamlString.split('\n');
        const data = { searches: [] };
        let currentSearch = null;
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            if (trimmed === 'searches:') {
                continue;
            }
            
            if (trimmed.startsWith('- name:')) {
                if (currentSearch) {
                    data.searches.push(currentSearch);
                }
                currentSearch = {};
                currentSearch.name = trimmed.match(/- name: "(.+)"/)?.[1] || '';
            } else if (trimmed.startsWith('league:')) {
                currentSearch.league = trimmed.match(/league: "(.+)"/)?.[1] || '';
            } else if (trimmed.startsWith('searchId:')) {
                currentSearch.searchId = trimmed.match(/searchId: "(.+)"/)?.[1] || '';
            }
        }
        
        if (currentSearch) {
            data.searches.push(currentSearch);
        }
        
        return data;
    }

    // Cleanup method
    async cleanup() {
        try {
            if (this.websocketManager) {
                await this.websocketManager.disconnectAll();
            }
            console.log('Application cleanup completed');
        } catch (error) {
            console.error('Cleanup failed:', error);
        }
    }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    window.poe2TradeApp = new PoE2TradeApp();
    await window.poe2TradeApp.initialize();
});

// Cleanup on page unload
window.addEventListener('beforeunload', async () => {
    if (window.poe2TradeApp) {
        await window.poe2TradeApp.cleanup();
    }
});
