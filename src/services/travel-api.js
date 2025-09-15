const axios = require('axios');
const EventEmitter = require('events');

class TravelAPI extends EventEmitter {
  constructor(configManager) {
    super();
    this.configManager = configManager;
    this.baseUrl = 'https://www.pathofexile.com/api/trade2/whisper';
    this.rateLimitDelay = 1000; // 1 second minimum between requests
    this.lastRequestTime = 0;
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.retryQueue = []; // Queue for retryable failed requests
    this.maxRetries = 3; // Maximum number of retry attempts
    this.retryDelay = 5000; // 5 seconds delay between retries
    this.errorStats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retryableErrors: 0,
      nonRetryableErrors: 0,
      errorsByType: {},
      lastErrorTime: null
    };
  }

  async travelToHideout(itemData) {
    try {
      // Debug: Log the item data to see what we're receiving
      console.log('TravelAPI received itemData:', JSON.stringify(itemData, null, 2));
      
      // Validate item data
      if (!this.validateItemData(itemData)) {
        console.log('Item data validation failed. Expected: { id: string, hideoutToken: string }');
        throw new Error('Invalid item data provided');
      }

      // Get authentication credentials
      const credentials = await this.getCredentials();
      if (!credentials) {
        throw new Error('Authentication credentials not configured');
      }

      // Add to request queue for rate limiting
      return await this.queueRequest(async () => {
        return await this.executeTravelRequest(itemData, credentials);
      });

    } catch (error) {
      console.error('Travel to hideout failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async executeTravelRequest(itemData, credentials) {
    try {
      const payload = {
        token: itemData.hideoutToken,
        softFailure: false
      };

      const headers = this.buildHeaders(credentials);
      
      console.log(`Traveling to hideout for item: ${itemData.id}`);
      
      const response = await axios.post(this.baseUrl, payload, {
        headers,
        timeout: 10000,
        validateStatus: (status) => status < 500 // Accept 4xx responses
      });

      const result = {
        success: response.status === 200,
        status: response.status,
        data: response.data,
        itemId: itemData.id,
        timestamp: new Date()
      };

      // Update last travel time for cooldown management (regardless of success/failure)
      await this.configManager.set('trading.lastTravelTime', Date.now());

      // Update statistics
      this.errorStats.totalRequests++;
      if (response.status === 200) {
        this.errorStats.successfulRequests++;
        console.log(`Successfully traveled to hideout for item: ${itemData.id}`);
        this.emit('travel:result', {
          type: 'success',
          itemId: itemData.id,
          data: result
        });
      } else {
        // Enhanced error handling for different HTTP status codes
        const errorInfo = this.classifyHttpError(response.status, response.statusText, response.data);
        console.warn(`Travel request failed with status ${response.status} for item: ${itemData.id}`, errorInfo);
        
        // Update error statistics
        this.updateErrorStats(errorInfo);
        
        // Queue for retry if retryable
        if (errorInfo.retryable) {
          this.queueRetry(itemData, credentials, 1); // Start with attempt 1
        }
        
        this.emit('travel:result', {
          type: 'error',
          itemId: itemData.id,
          error: errorInfo.message,
          errorType: errorInfo.type,
          statusCode: response.status,
          retryable: errorInfo.retryable,
          userMessage: errorInfo.userMessage
        });
      }

      return result;

    } catch (error) {
      console.error(`Travel request error for item ${itemData.id}:`, error);
      
      // Enhanced error handling for network and other errors
      const errorInfo = this.classifyNetworkError(error);
      
      // Update error statistics
      this.updateErrorStats(errorInfo);
      
      // Queue for retry if retryable
      if (errorInfo.retryable) {
        const credentials = await this.getCredentials();
        if (credentials) {
          this.queueRetry(itemData, credentials, 1); // Start with attempt 1
        }
      }
      
      const result = {
        success: false,
        error: errorInfo.message,
        errorType: errorInfo.type,
        itemId: itemData.id,
        timestamp: new Date()
      };

      // Update last travel time for cooldown management (even for failed requests)
      await this.configManager.set('trading.lastTravelTime', Date.now());

      this.emit('travel:result', {
        type: 'error',
        itemId: itemData.id,
        error: errorInfo.message,
        errorType: errorInfo.type,
        retryable: errorInfo.retryable,
        userMessage: errorInfo.userMessage
      });

      return result;
    }
  }

  async queueRequest(requestFunction) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        requestFunction,
        resolve,
        reject,
        timestamp: Date.now()
      });

      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      
      try {
        // Enforce rate limiting
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimitDelay) {
          const delay = this.rateLimitDelay - timeSinceLastRequest;
          await this.sleep(delay);
        }

        // Execute request
        const result = await request.requestFunction();
        this.lastRequestTime = Date.now();
        
        request.resolve(result);
        
      } catch (error) {
        request.reject(error);
      }
    }

    this.isProcessingQueue = false;
  }

  validateItemData(itemData) {
    return itemData &&
           itemData.id &&
           itemData.hideoutToken &&
           typeof itemData.id === 'string' &&
           typeof itemData.hideoutToken === 'string';
  }

  buildHeaders(credentials) {
    return {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9,ja;q=0.8',
      'content-type': 'application/json',
      'origin': 'https://www.pathofexile.com',
      'referer': 'https://www.pathofexile.com/trade2/search/poe2/',
      'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139"',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      'x-requested-with': 'XMLHttpRequest',
      'Cookie': `POESESSID=${credentials.poesessid}; cf_clearance=${credentials.cf_clearance}`
    };
  }

  async getCredentials() {
    try {
      const poesessid = await this.configManager.get('auth.poesessid');
      const cf_clearance = await this.configManager.get('auth.cf_clearance');
      
      if (!poesessid || !cf_clearance) {
        return null;
      }

      return {
        poesessid,
        cf_clearance
      };
    } catch (error) {
      console.error('Failed to get credentials:', error);
      return null;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Enhanced error classification for HTTP errors
  classifyHttpError(statusCode, statusText, responseData) {
    switch (statusCode) {
      case 400:
        return {
          type: 'bad_request',
          message: `Bad Request: ${statusText}`,
          userMessage: 'Invalid travel request. The hideout token may be expired or invalid.',
          retryable: false
        };
      
      case 401:
        return {
          type: 'unauthorized',
          message: `Unauthorized: ${statusText}`,
          userMessage: 'Authentication failed. Please check your POESESSID and cf_clearance cookies.',
          retryable: false
        };
      
      case 403:
        return {
          type: 'forbidden',
          message: `Forbidden: ${statusText}`,
          userMessage: 'Access denied. Your account may not have permission to travel to this hideout.',
          retryable: false
        };
      
      case 404:
        return {
          type: 'not_found',
          message: `Not Found: ${statusText}`,
          userMessage: 'Hideout not found. The seller may have moved or the hideout is no longer available.',
          retryable: false
        };
      
      case 429:
        return {
          type: 'rate_limit',
          message: `Rate Limited: ${statusText}`,
          userMessage: 'Too many requests. Please wait before trying again.',
          retryable: true
        };
      
      case 503:
        return {
          type: 'service_unavailable',
          message: `Service Unavailable: ${statusText}`,
          userMessage: 'PoE servers are busy. Please wait a moment and try again.',
          retryable: true
        };
      
      case 504:
        return {
          type: 'gateway_timeout',
          message: `Gateway Timeout: ${statusText}`,
          userMessage: 'Request timed out. The servers may be experiencing issues.',
          retryable: true
        };
      
      default:
        return {
          type: 'http_error',
          message: `HTTP ${statusCode}: ${statusText}`,
          userMessage: `Travel request failed with error ${statusCode}.`,
          retryable: statusCode >= 500 // Retry on server errors
        };
    }
  }

  // Enhanced error classification for network errors
  classifyNetworkError(error) {
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return {
        type: 'timeout',
        message: `Request timeout: ${error.message}`,
        userMessage: 'Request timed out. Please check your internet connection and try again.',
        retryable: true
      };
    }
    
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return {
        type: 'connection_error',
        message: `Connection error: ${error.message}`,
        userMessage: 'Cannot connect to PoE servers. Please check your internet connection.',
        retryable: true
      };
    }
    
    if (error.code === 'ECONNRESET' || error.message.includes('socket hang up')) {
      return {
        type: 'connection_reset',
        message: `Connection reset: ${error.message}`,
        userMessage: 'Connection was interrupted. Please try again.',
        retryable: true
      };
    }
    
    if (error.response && error.response.status) {
      // Handle axios errors with response
      return this.classifyHttpError(error.response.status, error.response.statusText, error.response.data);
    }
    
    return {
      type: 'unknown_error',
      message: error.message || 'Unknown error occurred',
      userMessage: 'An unexpected error occurred. Please try again.',
      retryable: true
    };
  }

  // Get queue status for monitoring
  getQueueStatus() {
    return {
      queueLength: this.requestQueue.length,
      isProcessing: this.isProcessingQueue,
      lastRequestTime: this.lastRequestTime,
      timeSinceLastRequest: Date.now() - this.lastRequestTime
    };
  }

  // Clear queue (useful for cleanup)
  clearQueue() {
    this.requestQueue.forEach(request => {
      request.reject(new Error('Queue cleared'));
    });
    this.requestQueue = [];
    
    // Also clear retry queue
    this.retryQueue.forEach(retry => {
      clearTimeout(retry.timeoutId);
    });
    this.retryQueue = [];
  }

  // Queue a retryable request for later retry
  queueRetry(itemData, credentials, attemptNumber) {
    if (attemptNumber > this.maxRetries) {
      console.log(`Max retries (${this.maxRetries}) exceeded for item ${itemData.id}, giving up`);
      return;
    }

    const retryDelay = this.retryDelay * attemptNumber; // Exponential backoff
    console.log(`Queueing retry ${attemptNumber}/${this.maxRetries} for item ${itemData.id} in ${retryDelay}ms`);

    const timeoutId = setTimeout(async () => {
      try {
        console.log(`Retrying travel request for item ${itemData.id} (attempt ${attemptNumber})`);
        const result = await this.executeTravelRequest(itemData, credentials);
        
        if (!result.success) {
          // If retry also failed and is retryable, queue another retry
          const errorInfo = result.errorType ? 
            { retryable: this.isRetryableErrorType(result.errorType) } : 
            { retryable: false };
            
          if (errorInfo.retryable) {
            this.queueRetry(itemData, credentials, attemptNumber + 1);
          }
        }
      } catch (error) {
        console.error(`Retry attempt ${attemptNumber} failed for item ${itemData.id}:`, error);
        const errorInfo = this.classifyNetworkError(error);
        if (errorInfo.retryable) {
          this.queueRetry(itemData, credentials, attemptNumber + 1);
        }
      }
    }, retryDelay);

    this.retryQueue.push({
      itemData,
      credentials,
      attemptNumber,
      timeoutId,
      queuedAt: Date.now()
    });
  }

  // Check if an error type is retryable
  isRetryableErrorType(errorType) {
    const retryableTypes = [
      'rate_limit',
      'service_unavailable',
      'gateway_timeout',
      'timeout',
      'connection_error',
      'connection_reset'
    ];
    return retryableTypes.includes(errorType);
  }

  // Get retry queue status for monitoring
  getRetryQueueStatus() {
    return {
      retryQueueLength: this.retryQueue.length,
      retries: this.retryQueue.map(retry => ({
        itemId: retry.itemData.id,
        attempt: retry.attemptNumber,
        queuedAt: retry.queuedAt
      }))
    };
  }

  // Update error statistics
  updateErrorStats(errorInfo) {
    this.errorStats.failedRequests++;
    this.errorStats.lastErrorTime = Date.now();
    
    if (errorInfo.retryable) {
      this.errorStats.retryableErrors++;
    } else {
      this.errorStats.nonRetryableErrors++;
    }
    
    // Track errors by type
    if (!this.errorStats.errorsByType[errorInfo.type]) {
      this.errorStats.errorsByType[errorInfo.type] = 0;
    }
    this.errorStats.errorsByType[errorInfo.type]++;
  }

  // Get comprehensive error statistics
  getErrorStats() {
    const successRate = this.errorStats.totalRequests > 0 ? 
      (this.errorStats.successfulRequests / this.errorStats.totalRequests * 100).toFixed(2) : 0;
    
    return {
      ...this.errorStats,
      successRate: `${successRate}%`,
      failureRate: this.errorStats.totalRequests > 0 ? 
        (this.errorStats.failedRequests / this.errorStats.totalRequests * 100).toFixed(2) + '%' : '0%',
      lastErrorTime: this.errorStats.lastErrorTime ? 
        new Date(this.errorStats.lastErrorTime).toISOString() : null
    };
  }

  // Reset error statistics (useful for testing or periodic resets)
  resetErrorStats() {
    this.errorStats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retryableErrors: 0,
      nonRetryableErrors: 0,
      errorsByType: {},
      lastErrorTime: null
    };
  }
}

module.exports = { TravelAPI };
