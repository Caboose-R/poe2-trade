// WebSocket event handling and management
class WebSocketEventHandler {
    constructor() {
        this.messageHandlers = new Map();
        this.statusHandlers = new Map();
        this.setupEventListeners();
    }

    registerMessageHandler(searchId, handler) {
        if (!this.messageHandlers.has(searchId)) {
            this.messageHandlers.set(searchId, []);
        }
        this.messageHandlers.get(searchId).push(handler);
    }

    registerStatusHandler(searchId, handler) {
        if (!this.statusHandlers.has(searchId)) {
            this.statusHandlers.set(searchId, []);
        }
        this.statusHandlers.get(searchId).push(handler);
    }

    setupEventListeners() {
        console.log('WebSocketEventHandler: Setting up event listeners');
        
        // Listen for WebSocket messages from main process
        window.electronAPI.on('websocket:message', (data) => {
            this.handleMessage(data);
        });

        window.electronAPI.on('websocket:status', (data) => {
            this.handleStatus(data);
        });
        
        console.log('WebSocketEventHandler: Event listeners registered');

        window.electronAPI.on('travel:result', (data) => {
            this.handleTravelResult(data);
        });

        window.electronAPI.on('cv:detection', (data) => {
            this.handleComputerVision(data);
        });

        window.electronAPI.on('automation:complete', (data) => {
            this.handleAutomation(data);
        });
    }

    handleMessage(data) {
        console.log('WebSocket message received in WebSocketEventHandler:', data);
        console.log('Registered message handlers:', this.messageHandlers);
        
        // Notify registered handlers
        if (this.messageHandlers.has(data.searchId)) {
            console.log('Calling handlers for searchId:', data.searchId);
            this.messageHandlers.get(data.searchId).forEach(handler => {
                handler(data);
            });
        }

        // Global message handler
        if (this.messageHandlers.has('*')) {
            console.log('Calling global handlers');
            this.messageHandlers.get('*').forEach(handler => {
                handler(data);
            });
        }

        // Note: UI updates are handled by registered message handlers
        // No direct UI updates here to avoid duplication
    }

    handleStatus(data) {
        console.log('WebSocket status changed:', data);
        
        // Notify registered handlers
        if (this.statusHandlers.has(data.searchId)) {
            this.statusHandlers.get(data.searchId).forEach(handler => {
                handler(data);
            });
        }

        // Global status handler
        if (this.statusHandlers.has('*')) {
            this.statusHandlers.get('*').forEach(handler => {
                handler(data);
            });
        }

        // Update UI status indicators
        this.updateConnectionStatus(data);
    }

    handleTravelResult(data) {
        console.log('Travel result:', data);
        
        if (data.type === 'success') {
            window.poe2TradeApp?.uiManager?.showNotification('Successfully traveled to hideout', 'success');
        } else if (data.type === 'error') {
            // Use enhanced error information if available
            const userMessage = data.userMessage || data.error || 'Travel failed';
            const errorType = data.errorType || 'unknown_error';
            const retryable = data.retryable || false;
            
            // Create detailed notification with error type and retry info
            let notificationMessage = userMessage;
            if (retryable) {
                notificationMessage += ' (Will retry automatically)';
            }
            
            // Show different notification styles based on error type
            let notificationType = 'error';
            if (errorType === 'rate_limit' || errorType === 'service_unavailable') {
                notificationType = 'warning'; // Temporary issues
            } else if (errorType === 'unauthorized' || errorType === 'forbidden') {
                notificationType = 'error'; // Authentication issues
            }
            
            window.poe2TradeApp?.uiManager?.showNotification(notificationMessage, notificationType);
            
            // Log detailed error information for debugging
            console.warn('Travel error details:', {
                errorType,
                retryable,
                statusCode: data.statusCode,
                message: data.error,
                userMessage: data.userMessage
            });
        }
    }

    handleComputerVision(data) {
        console.log('Computer vision event:', data);
        
        switch (data.type) {
            case 'started':
                this.handleCVStarted(data);
                break;
            case 'stopped':
                this.handleCVStopped(data);
                break;
            case 'items_detected':
                this.handleCVItemsDetected(data);
                break;
            case 'error':
                this.handleCVError(data);
                break;
            case 'status':
                this.handleCVStatus(data);
                break;
            default:
                console.log('Unknown computer vision event type:', data.type);
        }
    }

    handleCVStarted(data) {
        console.log('Computer vision detection started:', data.config);
        // Could show a notification or update UI status
    }

    handleCVStopped(data) {
        console.log('Computer vision detection stopped');
        // Could show a notification or update UI status
    }

    handleCVItemsDetected(data) {
        console.log('Items detected:', data.items);
        
        if (data.items && data.items.length > 0) {
            // Show notification for detected items
            const itemCount = data.items.length;
            const confidence = (data.confidence * 100).toFixed(1);
            
            // Create a more detailed notification
            const message = `Found ${itemCount} purple-bordered item${itemCount > 1 ? 's' : ''} (${confidence}% confidence)`;
            
            // Emit event to main app for further processing
            window.dispatchEvent(new CustomEvent('cv:itemsDetected', {
                detail: {
                    items: data.items,
                    confidence: data.confidence,
                    timestamp: data.timestamp
                }
            }));
        }
    }

    handleCVError(data) {
        console.error('Computer vision error:', data.error);
        
        // Show error notification
        window.dispatchEvent(new CustomEvent('cv:error', {
            detail: {
                error: data.error,
                timestamp: data.timestamp
            }
        }));
    }

    handleCVStatus(data) {
        console.log('Computer vision status:', data.status, data.message);
        
        // Update status in UI if needed
        window.dispatchEvent(new CustomEvent('cv:status', {
            detail: {
                status: data.status,
                message: data.message,
                timestamp: data.timestamp
            }
        }));
    }

    handleAutomation(data) {
        console.log('Automation event:', data);
        
        switch (data.type) {
            case 'purchase_sequence_started':
                window.poe2TradeApp?.uiManager?.showNotification('Starting purchase sequence...', 'info');
                break;
                
            case 'purchase_sequence_completed':
                window.poe2TradeApp?.uiManager?.showNotification('Purchase completed successfully!', 'success');
                break;
                
            case 'purchase_sequence_failed':
                window.poe2TradeApp?.uiManager?.showNotification(`Purchase failed: ${data.error}`, 'error');
                break;
        }
    }

    updateSearchResults(searchId, items) {
        // This will be handled by the main app
        if (window.poe2TradeApp) {
            window.poe2TradeApp.uiManager.addSearchResults(searchId, items);
        }
    }

    updateConnectionStatus(data) {
        if (window.poe2TradeApp) {
            window.poe2TradeApp.uiManager.updateSearchStatus(data.searchId, data.status);
            window.poe2TradeApp.uiManager.updateConnectionStatus(data.status);
        }
    }

    updateCVStatus(status) {
        const cvStatusElement = document.getElementById('cv-status');
        if (cvStatusElement) {
            const icon = cvStatusElement.querySelector('.status-icon');
            const text = cvStatusElement.querySelector('.status-text');
            
            icon.className = `fas fa-eye status-icon ${status}`;
            text.textContent = `CV: ${status.charAt(0).toUpperCase() + status.slice(1)}`;
        }
    }

    // Register message handlers
    onMessage(searchId, handler) {
        if (!this.messageHandlers.has(searchId)) {
            this.messageHandlers.set(searchId, []);
        }
        this.messageHandlers.get(searchId).push(handler);
    }

    offMessage(searchId, handler) {
        if (this.messageHandlers.has(searchId)) {
            const handlers = this.messageHandlers.get(searchId);
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    // Register status handlers
    onStatus(searchId, handler) {
        if (!this.statusHandlers.has(searchId)) {
            this.statusHandlers.set(searchId, []);
        }
        this.statusHandlers.get(searchId).push(handler);
    }

    offStatus(searchId, handler) {
        if (this.statusHandlers.has(searchId)) {
            const handlers = this.statusHandlers.get(searchId);
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    // Connection management helpers
    async getConnectionStatus() {
        try {
            return await window.electronAPI.websocket.getStatus();
        } catch (error) {
            console.error('Failed to get connection status:', error);
            return null;
        }
    }

    async connectToSearch(searchConfig) {
        try {
            const result = await window.electronAPI.websocket.connect(searchConfig);
            return result;
        } catch (error) {
            console.error('Failed to connect to search:', error);
            return { success: false, error: error.message };
        }
    }

    async disconnectFromSearch(searchId) {
        try {
            const result = await window.electronAPI.websocket.disconnect(searchId);
            return result;
        } catch (error) {
            console.error('Failed to disconnect from search:', error);
            return { success: false, error: error.message };
        }
    }

    // Utility methods
    formatConnectionStatus(status) {
        const statusMap = {
            'connected': { text: 'Connected', class: 'connected', icon: 'check-circle' },
            'connecting': { text: 'Connecting', class: 'connecting', icon: 'spinner' },
            'disconnected': { text: 'Disconnected', class: 'disconnected', icon: 'times-circle' },
            'error': { text: 'Error', class: 'error', icon: 'exclamation-circle' },
            'failed': { text: 'Failed', class: 'failed', icon: 'exclamation-triangle' }
        };

        return statusMap[status] || { text: 'Unknown', class: 'unknown', icon: 'question-circle' };
    }

    formatItemData(item) {
        return {
            id: item.id || 'unknown',
            name: item.name || 'Unknown Item',
            price: item.price || 'No price',
            league: item.league || 'Unknown',
            seller: item.seller || 'Unknown',
            hideoutToken: item.hideoutToken || null,
            timestamp: new Date()
        };
    }

    // Error handling
    handleError(error, context = 'WebSocket') {
        console.error(`${context} error:`, error);
        
        if (window.poe2TradeApp?.uiManager) {
            window.poe2TradeApp.uiManager.showNotification(
                `${context} error: ${error.message || error}`,
                'error'
            );
        }
    }

    // Cleanup
    cleanup() {
        this.messageHandlers.clear();
        this.statusHandlers.clear();
    }
}

// Initialize WebSocket event handler when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.webSocketEventHandler = new WebSocketEventHandler();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.webSocketEventHandler) {
        window.webSocketEventHandler.cleanup();
    }
});
