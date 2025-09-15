// Event emitter utility
class EventEmitter {
    constructor() {
        this.events = {};
    }

    on(event, callback) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
    }

    off(event, callback) {
        if (this.events[event]) {
            this.events[event] = this.events[event].filter(cb => cb !== callback);
        }
    }

    emit(event, data) {
        if (this.events[event]) {
            this.events[event].forEach(callback => callback(data));
        }
    }
}

// WebSocket Manager
class WebSocketManager extends EventEmitter {
    constructor() {
        super();
        this.connections = new Map();
    }

    async connect(searchConfig) {
        try {
            const connectedSearchId = await window.electronAPI.websocket.connect(searchConfig);
            if (connectedSearchId) {
                this.connections.set(searchConfig.id, {
                    config: searchConfig,
                    status: 'connecting'
                });
                return { success: true, searchId: connectedSearchId };
            }
            return { success: false, error: 'Failed to connect' };
        } catch (error) {
            console.error('WebSocket connection failed:', error);
            return { success: false, error: error.message };
        }
    }

    async disconnect(searchId) {
        try {
            const result = await window.electronAPI.websocket.disconnect(searchId);
            if (result.success) {
                this.connections.delete(searchId);
            }
            return result;
        } catch (error) {
            console.error('WebSocket disconnect failed:', error);
            return { success: false, error: error.message };
        }
    }

    async disconnectAll() {
        const promises = Array.from(this.connections.keys()).map(searchId => 
            this.disconnect(searchId)
        );
        await Promise.all(promises);
    }

    getConnectionStatus() {
        return Array.from(this.connections.entries()).map(([id, connection]) => ({
            id,
            status: connection.status,
            config: connection.config
        }));
    }
}

// Search Manager
class SearchManager extends EventEmitter {
    constructor() {
        super();
        this.searches = new Map();
    }

    async addSearch(searchData) {
        const search = {
            id: this.generateId(),
            name: searchData.name,
            league: searchData.league,
            searchId: searchData.searchId,
            createdAt: new Date(),
            status: 'disconnected'
        };

        this.searches.set(search.id, search);
        this.emit('searchAdded', search);
        return search;
    }

    async removeSearch(searchId) {
        if (this.searches.has(searchId)) {
            // Emit disconnect event first - let UIManager handle the WebSocket disconnection
            this.emit('disconnectSearch', searchId);
            
            // Then remove from local storage
            this.searches.delete(searchId);
            this.emit('searchRemoved', searchId);
        }
    }

    getSearch(searchId) {
        return this.searches.get(searchId);
    }

    getAllSearches() {
        return Array.from(this.searches.values());
    }

    async loadSearches() {
        try {
            const searches = await window.electronAPI.config.get('searches') || [];
            this.searches.clear();
            
            searches.forEach(searchData => {
                const search = {
                    ...searchData,
                    status: 'disconnected'
                };
                this.searches.set(search.id, search);
                this.emit('searchAdded', search);
            });
        } catch (error) {
            console.error('Failed to load searches:', error);
        }
    }

    async saveSearches() {
        try {
            const searches = this.getAllSearches();
            await window.electronAPI.config.set('searches', searches);
        } catch (error) {
            console.error('Failed to save searches:', error);
        }
    }

    generateId() {
        return 'search_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
}

// Configuration Manager
class ConfigManager extends EventEmitter {
    constructor() {
        super();
        this.config = new Map();
    }

    async load() {
        try {
            // Load theme
            const theme = await window.electronAPI.config.get('ui.theme') || 'dark';
            document.body.className = `theme-${theme}`;
            
            // Load other settings
            const settings = {
                'ui.language': await window.electronAPI.config.get('ui.language') || 'en',
                'trading.maxConnections': await window.electronAPI.config.get('trading.maxConnections') || 20,
                'automation.mouseSpeed': await window.electronAPI.config.get('automation.mouseSpeed') || 1.0
            };

            for (const [key, value] of Object.entries(settings)) {
                this.config.set(key, value);
            }
        } catch (error) {
            console.error('Failed to load configuration:', error);
        }
    }

    get(key) {
        return this.config.get(key);
    }

    set(key, value) {
        this.config.set(key, value);
        this.emit('configChanged', { key, value });
    }

    getAll() {
        return Object.fromEntries(this.config);
    }
}

// UI Manager
class UIManager extends EventEmitter {
    constructor() {
        super();
        this.modals = new Map();
        this.notifications = [];
        this.pendingResults = new Map(); // Store pending results for throttling
        this.notificationThrottle = new Map(); // Throttle duplicate notifications
        this.throttleDelay = 2000; // 2 seconds between identical notifications
        this.maxNotifications = 10; // Maximum number of notifications to prevent spam
        this.updateThrottleDelay = 100; // 100ms throttle
        this.maxResultsPerUpdate = 10; // Process max 10 items per update
        this.updateTimeouts = new Map(); // Store timeout IDs for throttling
        this.processingCounters = new Map(); // Track processing iterations to prevent infinite loops
    }

    async initialize() {
        this.setupModals();
        this.setupEventListeners();
        this.setupThemeToggle();
        this.setupRangeInputs();
    }

    setupModals() {
        // Add Search Modal
        this.modals.set('add-search-modal', {
            element: document.getElementById('add-search-modal'),
            form: document.getElementById('add-search-form')
        });

        // Settings Modal
        this.modals.set('settings-modal', {
            element: document.getElementById('settings-modal'),
            tabs: document.querySelectorAll('.tab-btn'),
            panes: document.querySelectorAll('.tab-pane')
        });

        // Auth Modal (now part of settings)
        // No separate auth modal needed since it's now in settings
    }

    setupEventListeners() {
        // Modal controls
        document.querySelectorAll('[data-modal]').forEach(button => {
            button.addEventListener('click', (e) => {
                const modalName = e.currentTarget.getAttribute('data-modal');
                this.closeModal(modalName);
            });
        });

        // Add search form
        const addSearchForm = document.getElementById('add-search-form');
        if (addSearchForm) {
            addSearchForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleAddSearchForm();
            });
        }

        // Handle URL input changes to show/hide league field
        const searchIdInput = document.getElementById('search-id');
        const leagueGroup = document.getElementById('league-group');
        if (searchIdInput && leagueGroup) {
            searchIdInput.addEventListener('input', (e) => {
                const value = e.target.value;
                if (value.includes('pathofexile.com/trade2/search/poe2/')) {
                    // Hide league field when full URL is provided
                    leagueGroup.style.display = 'none';
                    document.getElementById('search-league').required = false;
                } else {
                    // Show league field when only search ID is provided
                    leagueGroup.style.display = 'block';
                    document.getElementById('search-league').required = true;
                }
            });
        }

        // Settings form
        const saveSettingsBtn = document.getElementById('save-settings-btn');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', () => {
                this.handleSaveSettings();
            });
        }

        // Auth form is now handled in settings

        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchTab(e.currentTarget.getAttribute('data-tab'));
            });
        });

        // Button actions
        document.getElementById('add-search-btn')?.addEventListener('click', () => {
            this.openModal('add-search-modal');
        });

        document.getElementById('settings-btn')?.addEventListener('click', () => {
            this.loadSettings();
            this.openModal('settings-modal');
        });

        document.getElementById('test-cv-btn')?.addEventListener('click', () => {
            this.quickTestComputerVision();
        });

        // Clear results button
        document.getElementById('clear-results-btn')?.addEventListener('click', () => {
            this.clearSearchResults();
        });

        // Connect All button
        document.getElementById('connect-all-btn')?.addEventListener('click', () => {
            this.connectAllSearches();
        });

        // Disconnect All button
        document.getElementById('disconnect-all-btn')?.addEventListener('click', () => {
            this.disconnectAllSearches();
        });

        document.getElementById('import-searches-btn')?.addEventListener('click', () => {
            this.importSearches();
        });

        document.getElementById('export-searches-btn')?.addEventListener('click', () => {
            this.exportSearches();
        });
    }

    setupThemeToggle() {
        const themeSelect = document.getElementById('theme-select');
        if (themeSelect) {
            themeSelect.addEventListener('change', (e) => {
                const theme = e.target.value;
                document.body.className = `theme-${theme}`;
                this.emit('settingsChanged', { 'ui.theme': theme });
            });
        }
    }

    setupRangeInputs() {
        // Confidence threshold

        // Mouse speed control
        this.setupMouseSpeedControl();

        // Computer Vision Controls
        this.setupComputerVisionControls();
        
        // Merchant window coordinate updates
        this.setupMerchantWindowControls();
    }

    setupComputerVisionControls() {
        // Test Detection Button
        const testDetectionBtn = document.getElementById('cv-test-detection');
        if (testDetectionBtn) {
            testDetectionBtn.addEventListener('click', () => {
                this.testComputerVisionDetection();
            });
        }

        // Start Detection Button
        const startDetectionBtn = document.getElementById('cv-start-detection');
        if (startDetectionBtn) {
            startDetectionBtn.addEventListener('click', () => {
                this.startComputerVisionDetection();
            });
        }

        // Stop Detection Button
        const stopDetectionBtn = document.getElementById('cv-stop-detection');
        if (stopDetectionBtn) {
            stopDetectionBtn.addEventListener('click', () => {
                this.stopComputerVisionDetection();
            });
        }

        // Capture Region Button
        const captureRegionBtn = document.getElementById('cv-capture-region');
        if (captureRegionBtn) {
            captureRegionBtn.addEventListener('click', () => {
                this.captureCurrentRegion();
            });
        }

        // Update CV status periodically
        this.updateComputerVisionStatus();
        setInterval(() => {
            this.updateComputerVisionStatus();
        }, 2000);
    }

    async testComputerVisionDetection() {
        try {
            this.updateCVStatus('testing', 'Testing detection...');
            
            const windowBounds = this.getMerchantWindowBounds();
            console.log('Using merchant window bounds for detection:', windowBounds);

            const result = await window.electronAPI.computerVision.detectItems(windowBounds);
            
            if (result.success && result.items && result.items.length > 0) {
                // Show V5 detection results with item types
                const itemTypes = result.items.map(item => item.item_type || 'Unknown').join(', ');
                const avgConfidence = (result.items.reduce((sum, item) => sum + item.confidence, 0) / result.items.length * 100).toFixed(1);
                
                this.updateCVStatus('success', `Found ${result.items.length} items (${avgConfidence}% avg confidence)`);
                this.showNotification(`V5 Detection successful: Found ${result.items.length} PoE2 items - ${itemTypes}`, 'success');
                
                // Log detailed results for debugging
                console.log('V5 Detection Results:', result.items.map(item => ({
                    type: item.item_type,
                    position: `(${item.center_x}, ${item.center_y})`,
                    confidence: `${(item.confidence * 100).toFixed(1)}%`,
                    size: `${item.width}x${item.height}`,
                    aspectRatio: item.aspect_ratio.toFixed(3)
                })));

                // Move mouse to the center of the highest confidence item
                if (result.items.length > 0) {
                    const bestItem = result.items[0]; // Already sorted by confidence
                    const windowBounds = this.getMerchantWindowBounds();
                    const globalX = windowBounds.x + bestItem.center_x;
                    const globalY = windowBounds.y + bestItem.center_y;
                    
                    console.log(`Moving mouse to item center: global (${globalX}, ${globalY}), relative (${bestItem.center_x}, ${bestItem.center_y})`);
                    
                    try {
                        // Add a small delay to make the movement more visible
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        await window.electronAPI.computerVision.moveMouse(globalX, globalY);
                        
                        const confidencePercent = (bestItem.confidence * 100).toFixed(1);
                        this.showNotification(`✅ Mouse moved to ${bestItem.item_type} (${confidencePercent}% confidence) at (${globalX}, ${globalY})`, 'success');
                        
                        // Check if auto purchase is enabled for testing
                        const autoPurchase = await window.electronAPI.config.get('automation.autoPurchase') || false;
                        if (autoPurchase) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                            const clickModifiers = await window.electronAPI.config.get('automation.clickModifiers') || ['ctrl'];
                            await window.electronAPI.computerVision.clickMouse(globalX, globalY, clickModifiers);
                            this.showNotification(`🛒 Auto purchase clicked on ${bestItem.item_type} with ${clickModifiers.join('+')}`, 'success');
                            
                            // Wait 1 second then press F5
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            await window.electronAPI.computerVision.pressKey('f5');
                            this.showNotification(`🏠 F5 pressed to return to hideout`, 'success');
                        }
                        
                        // Update status to show mouse movement completed
                        this.updateCVStatus('success', `Found ${result.items.length} items, mouse moved to best match`);
                    } catch (mouseError) {
                        console.error('Mouse movement failed:', mouseError);
                        this.showNotification(`Detection successful but mouse movement failed: ${mouseError.message}`, 'warning');
                    } finally {
                        // Clean up the Python process after detection and mouse movement
                        try {
                            await window.electronAPI.computerVision.cleanup();
                        } catch (cleanupError) {
                            console.error('Cleanup failed:', cleanupError);
                        }
                    }
                }
            } else {
                this.updateCVStatus('warning', 'No items detected');
                this.showNotification('V5 Detection completed: No PoE2 rectangle borders found', 'warning');
                
                // Clean up the Python process even when no items are detected
                try {
                    await window.electronAPI.computerVision.cleanup();
                } catch (cleanupError) {
                    console.error('Cleanup failed:', cleanupError);
                }
            }
        } catch (error) {
            this.updateCVStatus('error', 'Test failed');
            this.showNotification(`Computer vision test failed: ${error.message}`, 'error');
        }
    }

    async startComputerVisionDetection() {
        try {
            this.updateCVStatus('starting', 'Starting detection...');
            
                // Get mouse speed from config
                const mouseSpeed = await window.electronAPI.config.get('automation.mouseSpeed') || 1.0;
                
                const config = {
                detectionWindow: this.getMerchantWindowBounds(),
                mouseSpeed: mouseSpeed
            };

            const result = await window.electronAPI.computerVision.startDetection(config);
            
            if (result.success) {
                this.updateCVStatus('active', 'Detection active');
                this.showNotification('Computer vision detection started', 'success');
            } else {
                this.updateCVStatus('error', 'Failed to start');
                this.showNotification(`Failed to start detection: ${result.error}`, 'error');
            }
        } catch (error) {
            this.updateCVStatus('error', 'Start failed');
            this.showNotification(`Failed to start detection: ${error.message}`, 'error');
        }
    }

    async stopComputerVisionDetection() {
        try {
            this.updateCVStatus('stopping', 'Stopping detection...');
            
            const result = await window.electronAPI.computerVision.stopDetection();
            
            if (result.success) {
                this.updateCVStatus('ready', 'Detection stopped');
                this.showNotification('Computer vision detection stopped', 'info');
            } else {
                this.updateCVStatus('error', 'Failed to stop');
                this.showNotification(`Failed to stop detection: ${result.error}`, 'error');
            }
        } catch (error) {
            this.updateCVStatus('error', 'Stop failed');
            this.showNotification(`Failed to stop detection: ${error.message}`, 'error');
        }
    }

    async captureCurrentRegion() {
        try {
            this.updateCVStatus('capturing', 'Capturing region...');
            
            // Get current merchant window bounds
            const windowBounds = this.getMerchantWindowBounds();

            const result = await window.electronAPI.computerVision.captureScreen(windowBounds);
            
            if (result.success) {
                this.updateCVStatus('ready', 'Region captured');
                this.showNotification('Screen region captured successfully', 'success');
            } else {
                this.updateCVStatus('error', 'Capture failed');
                this.showNotification(`Failed to capture region: ${result.error}`, 'error');
            }
        } catch (error) {
            this.updateCVStatus('error', 'Capture failed');
            this.showNotification(`Failed to capture region: ${error.message}`, 'error');
        }
    }

    updateCVStatus(status, message) {
        const statusElement = document.getElementById('cv-status');
        if (!statusElement) return;

        const indicator = statusElement.querySelector('.status-indicator');
        const text = statusElement.querySelector('.status-text');
        
        if (indicator && text) {
            // Remove existing status classes
            indicator.classList.remove('active', 'error', 'warning');
            
            // Add appropriate class and update text
            switch (status) {
                case 'active':
                case 'success':
                    indicator.classList.add('active');
                    break;
                case 'error':
                    indicator.classList.add('error');
                    break;
                case 'warning':
                case 'testing':
                case 'starting':
                case 'stopping':
                case 'capturing':
                    indicator.classList.add('warning');
                    break;
                default:
                    // No additional class for 'ready'
                    break;
            }
            
            text.textContent = message;
        }
    }

    async updateComputerVisionStatus() {
        try {
            const status = await window.electronAPI.computerVision.getStatus();
            
            if (status.isDetecting) {
                this.updateCVStatus('active', 'Detection running');
            } else if (status.pythonProcessRunning) {
                this.updateCVStatus('warning', 'Python process running');
            } else {
                this.updateCVStatus('ready', 'Ready');
            }
        } catch (error) {
            // Silently handle status update errors to avoid spam
        }
    }

    setupMerchantWindowControls() {
        // Update area info when coordinates change
        const updateAreaInfo = () => {
            const x1 = parseInt(document.getElementById('merchant-x1').value) || 0;
            const y1 = parseInt(document.getElementById('merchant-y1').value) || 0;
            const x2 = parseInt(document.getElementById('merchant-x2').value) || 0;
            const y2 = parseInt(document.getElementById('merchant-y2').value) || 0;
            
            const width = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);
            
            const areaInfo = document.getElementById('merchant-area-info');
            if (areaInfo) {
                areaInfo.textContent = `Area: ${width}x${height} pixels`;
            }
        };

        // Add event listeners to coordinate inputs
        const coordInputs = ['merchant-x1', 'merchant-y1', 'merchant-x2', 'merchant-y2'];
        coordInputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('input', updateAreaInfo);
                input.addEventListener('change', updateAreaInfo);
            }
        });

        // Initial update
        updateAreaInfo();
    }

    getMerchantWindowBounds() {
        const x1 = parseInt(document.getElementById('merchant-x1').value) || 0;
        const y1 = parseInt(document.getElementById('merchant-y1').value) || 0;
        const x2 = parseInt(document.getElementById('merchant-x2').value) || 0;
        const y2 = parseInt(document.getElementById('merchant-y2').value) || 0;
        
        // Convert corner coordinates to x, y, width, height format
        const x = Math.min(x1, x2);
        const y = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        
        console.log(`Merchant window bounds: x1=${x1}, y1=${y1}, x2=${x2}, y2=${y2} -> x=${x}, y=${y}, width=${width}, height=${height}`);
        
        return { x, y, width, height };
    }

    async quickTestComputerVision() {
        try {
            this.showNotification('Testing computer vision detection...', 'info');
            
            // Use merchant window bounds - skip environment test to avoid timeout
            const windowBounds = this.getMerchantWindowBounds();

            const result = await window.electronAPI.computerVision.detectItems(windowBounds);
            
            if (result.success && result.items && result.items.length > 0) {
                // Show V5 detection results with item types
                const itemTypes = result.items.map(item => item.item_type || 'Unknown').join(', ');
                const avgConfidence = (result.items.reduce((sum, item) => sum + item.confidence, 0) / result.items.length * 100).toFixed(1);
                
                this.showNotification(`V5 Detection successful: Found ${result.items.length} PoE2 items - ${itemTypes}`, 'success');
                
                // Log detailed results for debugging
                console.log('V5 Detection Results:', result.items.map(item => ({
                    type: item.item_type,
                    position: `(${item.center_x}, ${item.center_y})`,
                    confidence: `${(item.confidence * 100).toFixed(1)}%`,
                    size: `${item.width}x${item.height}`,
                    aspectRatio: item.aspect_ratio.toFixed(3)
                })));

                // Move mouse to the center of the highest confidence item
                if (result.items.length > 0) {
                    const bestItem = result.items[0]; // Already sorted by confidence
                    const globalX = windowBounds.x + bestItem.center_x;
                    const globalY = windowBounds.y + bestItem.center_y;
                    
                    console.log(`Moving mouse to item center: global (${globalX}, ${globalY}), relative (${bestItem.center_x}, ${bestItem.center_y})`);
                    
                    try {
                        // Add a small delay to make the movement more visible
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        await window.electronAPI.computerVision.moveMouse(globalX, globalY);
                        
                        const confidencePercent = (bestItem.confidence * 100).toFixed(1);
                        this.showNotification(`✅ Mouse moved to ${bestItem.item_type} (${confidencePercent}% confidence) at (${globalX}, ${globalY})`, 'success');
                    } catch (mouseError) {
                        console.error('Mouse movement failed:', mouseError);
                        this.showNotification(`Detection successful but mouse movement failed: ${mouseError.message}`, 'warning');
                    }
                }
            } else if (result.success) {
                this.showNotification('V5 Detection completed: No PoE2 rectangle borders found', 'warning');
            } else {
                this.showNotification(`Detection failed: ${result.error}`, 'error');
            }
        } catch (error) {
            this.showNotification(`Computer vision test failed: ${error.message}`, 'error');
        }
    }

    setupMouseSpeedControl() {
        // Mouse speed
        const mouseSpeedRange = document.getElementById('mouse-speed');
        const mouseSpeedValue = document.getElementById('mouse-speed-value');
        if (mouseSpeedRange && mouseSpeedValue) {
            mouseSpeedRange.addEventListener('input', (e) => {
                mouseSpeedValue.textContent = e.target.value;
            });
        }
    }

    openModal(modalName) {
        const modal = this.modals.get(modalName);
        if (modal) {
            modal.element.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    closeModal(modalName) {
        const modal = this.modals.get(modalName);
        if (modal) {
            modal.element.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update tab panes
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');
    }

    async handleAddSearchForm() {
        const formData = new FormData(document.getElementById('add-search-form'));
        const searchData = {
            name: formData.get('search-name') || document.getElementById('search-name').value,
            league: formData.get('search-league') || document.getElementById('search-league').value,
            searchId: formData.get('search-id') || document.getElementById('search-id').value
        };

        this.emit('addSearch', searchData);
        this.closeModal('add-search-modal');
        
        // Reset form
        document.getElementById('add-search-form').reset();
    }

    async handleSaveSettings() {
        const settings = {
            'ui.theme': document.getElementById('theme-select').value,
            'ui.language': document.getElementById('language-select').value,
            'trading.autoTravelEnabled': document.getElementById('auto-travel-enabled').checked,
            'trading.maxConnections': parseInt(document.getElementById('max-connections').value),
            'trading.travelCooldown': parseInt(document.getElementById('travel-cooldown').value),
            'auth.poesessid': document.getElementById('poesessid').value,
            'auth.cf_clearance': document.getElementById('cf-clearance').value,
            'computerVision.merchantWindow': {
                x1: parseInt(document.getElementById('merchant-x1').value),
                y1: parseInt(document.getElementById('merchant-y1').value),
                x2: parseInt(document.getElementById('merchant-x2').value),
                y2: parseInt(document.getElementById('merchant-y2').value)
            },
               'automation.mouseSpeed': parseFloat(document.getElementById('mouse-speed').value),
               'automation.mouseMovementType': document.getElementById('mouse-movement-type').value,
               'automation.autoPurchase': document.getElementById('auto-purchase').checked
        };

        this.emit('settingsChanged', settings);
        this.closeModal('settings-modal');
    }

    async loadSettings() {
        try {
            // Load current settings from config
            const autoTravelEnabled = await window.electronAPI.config.get('trading.autoTravelEnabled') || false;
            const maxConnections = await window.electronAPI.config.get('trading.maxConnections') || 20;
            const travelCooldown = await window.electronAPI.config.get('trading.travelCooldown') || 30000;
            const theme = await window.electronAPI.config.get('ui.theme') || 'dark';
            const language = await window.electronAPI.config.get('ui.language') || 'en';
            const poesessid = await window.electronAPI.config.get('auth.poesessid') || '';
            const cfClearance = await window.electronAPI.config.get('auth.cf_clearance') || '';
            const merchantWindow = await window.electronAPI.config.get('computerVision.merchantWindow') || { x1: 834, y1: 284, x2: 1709, y2: 1151 };
            const mouseSpeed = await window.electronAPI.config.get('automation.mouseSpeed') || 1.0;
            const mouseMovementType = await window.electronAPI.config.get('automation.mouseMovementType') || 'natural';
            const autoPurchase = await window.electronAPI.config.get('automation.autoPurchase') || false;

            // Populate form fields
            document.getElementById('auto-travel-enabled').checked = autoTravelEnabled;
            document.getElementById('max-connections').value = maxConnections;
            document.getElementById('travel-cooldown').value = travelCooldown;
            document.getElementById('theme-select').value = theme;
            document.getElementById('language-select').value = language;
            document.getElementById('poesessid').value = poesessid;
            document.getElementById('cf-clearance').value = cfClearance;
            document.getElementById('merchant-x1').value = merchantWindow.x1;
            document.getElementById('merchant-y1').value = merchantWindow.y1;
            document.getElementById('merchant-x2').value = merchantWindow.x2;
            document.getElementById('merchant-y2').value = merchantWindow.y2;
            document.getElementById('mouse-speed').value = mouseSpeed;
            document.getElementById('mouse-speed-value').textContent = mouseSpeed.toFixed(1);
            document.getElementById('mouse-movement-type').value = mouseMovementType;
            document.getElementById('auto-purchase').checked = autoPurchase;
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }


    addSearchToList(search) {
        const searchList = document.getElementById('search-list');
        const searchItem = this.createSearchItem(search);
        searchList.appendChild(searchItem);
        this.updateStats();
    }

    removeSearchFromList(searchId) {
        const searchItem = document.querySelector(`[data-search-id="${searchId}"]`);
        if (searchItem) {
            searchItem.remove();
            this.updateStats();
        }
        
        // Clean up pending results and timeouts for this search
        this.pendingResults.delete(searchId);
        if (this.updateTimeouts.has(searchId)) {
            clearTimeout(this.updateTimeouts.get(searchId));
            this.updateTimeouts.delete(searchId);
        }
    }

    updateSearchInList(search) {
        const searchItem = document.querySelector(`[data-search-id="${search.id}"]`);
        if (searchItem) {
            searchItem.replaceWith(this.createSearchItem(search));
        }
    }

    createSearchItem(search) {
        const div = document.createElement('div');
        div.className = 'search-item';
        div.setAttribute('data-search-id', search.id);

        // Extract search ID from URL if it's a full URL
        let displaySearchId = search.searchId;
        if (search.searchId.includes('pathofexile.com/trade2/search/poe2/')) {
            const urlParts = search.searchId.split('/');
            displaySearchId = urlParts[urlParts.length - 1]; // Get the last part (the ID)
        }

        div.innerHTML = `
            <div class="search-item-header">
                <span class="search-item-name">${search.name}</span>
                <span class="search-item-status ${search.status}">
                    <i class="fas fa-circle"></i>
                    ${search.status}
                </span>
            </div>
            <div class="search-item-details">
                <div>ID: ${displaySearchId}</div>
            </div>
            <div class="search-item-actions">
                <button class="btn btn-sm btn-primary connect-btn" data-search-id="${search.id}">
                    <i class="fas fa-play"></i>
                    On
                </button>
                <button class="btn btn-sm btn-secondary disconnect-btn" data-search-id="${search.id}">
                    <i class="fas fa-stop"></i>
                    Off
                </button>
                <button class="btn btn-sm btn-error remove-btn" data-search-id="${search.id}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;

        // Add event listeners
        div.querySelector('.connect-btn').addEventListener('click', (e) => {
            this.emit('connectSearch', e.currentTarget.getAttribute('data-search-id'));
        });

        div.querySelector('.disconnect-btn').addEventListener('click', (e) => {
            this.emit('disconnectSearch', e.currentTarget.getAttribute('data-search-id'));
        });

        div.querySelector('.remove-btn').addEventListener('click', (e) => {
            this.emit('removeSearch', e.currentTarget.getAttribute('data-search-id'));
        });

        return div;
    }

    updateSearchStatus(searchId, status) {
        const searchItem = document.querySelector(`[data-search-id="${searchId}"]`);
        if (searchItem) {
            const statusElement = searchItem.querySelector('.search-item-status');
            statusElement.className = `search-item-status ${status}`;
            statusElement.innerHTML = `<i class="fas fa-circle"></i> ${status}`;
            
            // Update stats when status changes
            this.updateStats();
        }
    }

    updateConnectionStatus(status) {
        const statusElement = document.getElementById('connection-status');
        const icon = statusElement.querySelector('.status-icon');
        const text = statusElement.querySelector('.status-text');

        icon.className = `fas fa-circle status-icon ${status}`;
        text.textContent = status === 'connected' ? 'Connected' : 'Disconnected';
    }


    addSearchResults(searchId, items) {
        // Debug: Log the first item to see its structure
        if (items.length > 0) {
            console.log('Sample item structure:', JSON.stringify(items[0], null, 2));
        }
        
        // Add items to pending queue
        if (!this.pendingResults.has(searchId)) {
            this.pendingResults.set(searchId, []);
        }
        
        const pendingItems = this.pendingResults.get(searchId);
        pendingItems.push(...items);
        
        // Throttle the UI updates
        this.throttledUpdateResults(searchId);
    }

    throttledUpdateResults(searchId) {
        // Clear any existing timeout for this search
        if (this.updateTimeouts && this.updateTimeouts.has(searchId)) {
            clearTimeout(this.updateTimeouts.get(searchId));
        }
        
        if (!this.updateTimeouts) {
            this.updateTimeouts = new Map();
        }
        
        // Set a new timeout
        const timeoutId = setTimeout(() => {
            this.processPendingResults(searchId);
        }, this.updateThrottleDelay);
        
        this.updateTimeouts.set(searchId, timeoutId);
    }

    processPendingResults(searchId) {
        const pendingItems = this.pendingResults.get(searchId);
        if (!pendingItems || pendingItems.length === 0) {
            // Reset counter when no more items to process
            this.processingCounters.delete(searchId);
            return;
        }
        
        // Safety check to prevent infinite loops
        const counter = this.processingCounters.get(searchId) || 0;
        if (counter > 100) { // Max 100 iterations per search
            console.warn(`Processing counter exceeded for search ${searchId}, stopping to prevent infinite loop`);
            this.processingCounters.delete(searchId);
            return;
        }
        this.processingCounters.set(searchId, counter + 1);
        
        const resultsContainer = document.getElementById('results-container');
        if (!resultsContainer) return;
        
        // Remove empty state if present
        const emptyState = resultsContainer.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }

        // Process items in batches to prevent UI blocking
        const itemsToProcess = pendingItems.splice(0, this.maxResultsPerUpdate);
        
        // Use requestAnimationFrame for smooth UI updates
        requestAnimationFrame(() => {
            itemsToProcess.forEach(item => {
                const resultItem = this.createResultItem(item);
                resultsContainer.insertBefore(resultItem, resultsContainer.firstChild);
            });
            
            // Limit total results to prevent memory issues
            this.limitResults(resultsContainer);
            
            this.updateStats();
            
            // If there are more items, process them in the next frame
            if (pendingItems.length > 0) {
                requestAnimationFrame(() => {
                    this.processPendingResults(searchId);
                });
            }
        });
    }

    limitResults(resultsContainer) {
        const maxResults = 100; // Keep only the latest 100 results
        const resultItems = resultsContainer.querySelectorAll('.result-item');
        
        if (resultItems.length > maxResults) {
            // Remove oldest results
            const itemsToRemove = resultItems.length - maxResults;
            for (let i = 0; i < itemsToRemove; i++) {
                resultItems[resultItems.length - 1 - i].remove();
            }
        }
    }

    extractHideoutToken(itemDetails) {
        try {
            // Based on the reference app, the hideout token is at:
            // itemDetails.listing.hideout_token
            
            if (itemDetails && itemDetails.listing && itemDetails.listing.hideout_token) {
                console.log(`Found hideout token for item: ${itemDetails.item?.name || 'Unknown'}`);
                return itemDetails.listing.hideout_token;
            }
            
            // Fallback: Check if it's directly in the item details (for backward compatibility)
            if (itemDetails && itemDetails.hideoutToken) {
                console.log(`Found hideoutToken directly for item: ${itemDetails.item?.name || 'Unknown'}`);
                return itemDetails.hideoutToken;
            }
            
            // Fallback: Check if it's in a token field
            if (itemDetails && itemDetails.token) {
                console.log(`Found token field for item: ${itemDetails.item?.name || 'Unknown'}`);
                return itemDetails.token;
            }
            
            // Fallback: Check for any field that might contain a JWT-like token
            if (itemDetails) {
                const possibleTokenFields = ['hideout_token', 'hideoutToken', 'token', 'travelToken', 'whisperToken'];
                for (const field of possibleTokenFields) {
                    if (itemDetails[field] && typeof itemDetails[field] === 'string' && itemDetails[field].includes('.')) {
                        console.log(`Found JWT-like token in field '${field}' for item: ${itemDetails.item?.name || 'Unknown'}`);
                        return itemDetails[field];
                    }
                }
            }
            
            console.log(`No hideout token found for item: ${itemDetails.item?.name || 'Unknown'}`);
            return null;
        } catch (error) {
            console.error(`Error extracting hideout token: ${error.message}`);
            return null;
        }
    }

    createResultItem(item) {
        const div = document.createElement('div');
        div.className = 'result-item';

        // Extract item data from actual PoE API response structure
        const itemName = item.item?.name || 'Unknown Item';
        const itemBaseType = item.item?.baseType || 'Unknown Base';
        const itemPrice = item.listing?.price ? 
            `${item.listing.price.amount} ${item.listing.price.currency}` : 'No price';
        const itemLeague = item.item?.league || 'Unknown';
        const itemSeller = item.listing?.account?.name || 'Unknown';
        const itemId = item.id || Math.random().toString(36).substr(2, 9);

        div.innerHTML = `
            <div class="result-item-header">
                <div class="result-item-name">${itemName}</div>
                <div class="result-item-price">${itemPrice}</div>
            </div>
            <div class="result-item-meta">
                <span>Base: ${itemBaseType}</span>
                <span>League: ${itemLeague}</span>
                <span>Seller: ${itemSeller}</span>
                <span>Found: ${new Date().toLocaleTimeString()}</span>
            </div>
            <div class="result-item-actions">
                <button class="btn btn-sm btn-primary travel-btn" data-item-id="${itemId}">
                    <i class="fas fa-map-marker-alt"></i>
                    Travel
                </button>
                <button class="btn btn-sm btn-success purchase-btn" data-item-id="${itemId}">
                    <i class="fas fa-shopping-cart"></i>
                    Purchase
                </button>
            </div>
        `;

        // Add event listeners
        div.querySelector('.travel-btn').addEventListener('click', (e) => {
            console.log('Travel button clicked for item:', JSON.stringify(item, null, 2));
            
            // Extract hideout token from the correct location
            const hideoutToken = this.extractHideoutToken(item);
            console.log('Extracted hideout token:', hideoutToken);
            
            if (!hideoutToken) {
                console.error('No hideout token found for item');
                return;
            }
            
            this.emit('travelToHideout', { id: item.id, hideoutToken: hideoutToken });
        });

        div.querySelector('.purchase-btn').addEventListener('click', (e) => {
            this.emit('purchaseItem', item);
        });

        return div;
    }

    updateStats() {
        const activeSearches = document.querySelectorAll('.search-item-status.connected').length;
        const itemsFound = document.querySelectorAll('.result-item').length;
        const travelsMade = document.querySelectorAll('.result-item .travel-btn').length; // Count travel buttons as travels made

        document.getElementById('active-searches-count').textContent = activeSearches;
        document.getElementById('items-found-count').textContent = itemsFound;
        document.getElementById('travels-count').textContent = travelsMade;
    }

    clearSearchResults() {
        const resultsContainer = document.getElementById('results-container');
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-search empty-icon"></i>
                <h3>No search results yet</h3>
                <p>Add a live search to start monitoring for items</p>
            </div>
        `;
        this.updateStats(); // Update stats after clearing
        this.showNotification('Search results cleared', 'info');
    }

    connectAllSearches() {
        const disconnectedSearches = document.querySelectorAll('.search-item-status.disconnected');
        if (disconnectedSearches.length === 0) {
            this.showNotification('No disconnected searches to connect', 'info');
            return;
        }

        this.showNotification(`Connecting ${disconnectedSearches.length} searches...`, 'info');
        
        disconnectedSearches.forEach((statusElement, index) => {
            const searchItem = statusElement.closest('.search-item');
            const searchId = searchItem.getAttribute('data-search-id');
            
            // Add delay between connections (100ms)
            setTimeout(() => {
                this.emit('connectSearch', searchId);
            }, index * 100);
        });
    }

    disconnectAllSearches() {
        const connectedSearches = document.querySelectorAll('.search-item-status.connected');
        if (connectedSearches.length === 0) {
            this.showNotification('No connected searches to disconnect', 'info');
            return;
        }

        this.showNotification(`Disconnecting ${connectedSearches.length} searches...`, 'info');
        
        connectedSearches.forEach((statusElement) => {
            const searchItem = statusElement.closest('.search-item');
            const searchId = searchItem.getAttribute('data-search-id');
            this.emit('disconnectSearch', searchId);
        });
    }

    exportSearches() {
        // Emit event to app.js to handle export
        this.emit('exportSearches');
    }

    importSearches() {
        // Emit event to app.js to handle import
        this.emit('importSearches');
    }


    showNotification(message, type = 'info') {
        // Prevent too many notifications
        if (this.notifications.length >= this.maxNotifications) {
            console.log(`Maximum notifications (${this.maxNotifications}) reached, skipping: ${message}`);
            return;
        }
        
        // Create a key for throttling identical notifications
        const throttleKey = `${type}:${message}`;
        const now = Date.now();
        
        // Check if we've shown this notification recently
        if (this.notificationThrottle.has(throttleKey)) {
            const lastShown = this.notificationThrottle.get(throttleKey);
            if (now - lastShown < this.throttleDelay) {
                console.log(`Throttling duplicate notification: ${message}`);
                return; // Skip this notification
            }
        }
        
        // Update throttle timestamp
        this.notificationThrottle.set(throttleKey, now);
        
        // Periodically clean up old throttle entries
        if (this.notificationThrottle.size > 50) {
            this.cleanupNotificationThrottle();
        }
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${this.getNotificationIcon(type)}"></i>
                <span>${message}</span>
            </div>
        `;

        // Calculate position based on existing notifications array
        const topPosition = 20 + (this.notifications.length * 70); // 70px per notification (height + margin)
        notification.style.top = `${topPosition}px`;

        document.body.appendChild(notification);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
                // Remove from notifications array
                const index = this.notifications.indexOf(notification);
                if (index > -1) {
                    this.notifications.splice(index, 1);
                }
                // Recalculate positions of remaining notifications
                this.repositionNotifications();
            }
        }, 5000);

        this.notifications.push(notification);
    }

    repositionNotifications() {
        // Use the notifications array instead of querying DOM
        this.notifications.forEach((notification, index) => {
            const topPosition = 20 + (index * 70);
            notification.style.top = `${topPosition}px`;
        });
    }

    // Clean up old throttle entries to prevent memory leaks
    cleanupNotificationThrottle() {
        const now = Date.now();
        const maxAge = 30000; // 30 seconds
        
        // Collect keys to delete first, then delete them
        const keysToDelete = [];
        for (const [key, timestamp] of this.notificationThrottle.entries()) {
            if (now - timestamp > maxAge) {
                keysToDelete.push(key);
            }
        }
        
        // Delete the collected keys
        keysToDelete.forEach(key => {
            this.notificationThrottle.delete(key);
        });
    }

    getNotificationIcon(type) {
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };
        return icons[type] || 'info-circle';
    }
}

// Make classes globally available
window.WebSocketManager = WebSocketManager;
window.SearchManager = SearchManager;
window.ConfigManager = ConfigManager;
window.UIManager = UIManager;
