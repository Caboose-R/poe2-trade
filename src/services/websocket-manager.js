const WebSocket = require('ws');
const axios = require('axios');
const { Mutex } = require('async-mutex');
const Bottleneck = require('bottleneck');
const EventEmitter = require('events');

class WebSocketManager extends EventEmitter {
  constructor(configManager) {
    super();
    this.configManager = configManager;
    this.connections = new Map();
    this.maxConnections = 20; // GGG limit
    this.pendingFetches = new Map(); // Track pending fetch requests per search
    this.reconnectAttempts = new Map();
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000; // 2 seconds base delay
    
    // Rate limiting for WebSocket connections
    this.wsRequestLimiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: this.randomInt(2200, 2500), // Random delay between 2.2-2.5 seconds
    });
    
    // Rate limiting for API requests
    this.apiRequestLimiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: 1500, // 1.5 seconds between API requests
    });
    
    // Mutex for connection management
    this.connectionMutex = new Mutex();
  }

  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async connect(searchConfig) {
    const searchId = searchConfig.id || `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Use mutex to prevent race conditions
    const release = await this.connectionMutex.acquire();
    
    try {
      const existingConnection = this.connections.get(searchId);
      
      if (existingConnection && existingConnection.socket && existingConnection.socket.readyState !== WebSocket.CLOSED) {
        console.log(`Search ${searchId} already connected`);
        return searchId;
      }

      // Schedule connection with rate limiting
      await this.wsRequestLimiter.schedule(async () => {
        const webSocketUrl = this.buildWebSocketUrl(searchConfig);
        console.log(`Attempting to connect to WebSocket: ${webSocketUrl}`);

        const socketHeaders = await this.getSocketHeaders();
        console.log('WebSocket headers:', socketHeaders);

        const socket = new WebSocket(webSocketUrl, {
          headers: socketHeaders
        });

        const connection = {
          id: searchId,
          socket: socket,
          config: searchConfig,
          lastMessage: new Date(),
          messageCount: 0,
          reconnectAttempts: 0
        };

        this.connections.set(searchId, connection);

        socket.on('open', () => {
          console.log(`WebSocket connected for search: ${searchId}`);
          this.heartbeat(socket);
          this.emit('websocket:connected', { searchId, config: searchConfig });
        });

        socket.on('message', (data) => {
          this.handleMessage(searchId, JSON.parse(data.toString()));
        });

        socket.on('ping', () => {
          console.log(`WebSocket ping received for search: ${searchId}`);
          this.heartbeat(socket);
        });

        socket.on('error', (error) => {
          console.error(`WebSocket error for search ${searchId}:`, error.message);
          this.emit('websocket:error', { searchId, error: error.message });
          
          const [reason, code] = error.message.split(': ');
          connection.error = { code: parseInt(code, 10), reason };
          socket.close();
        });

        socket.on('close', (code, reason) => {
          console.log(`WebSocket closed for search ${searchId}: ${code} - ${reason}`);
          this.emit('websocket:disconnected', { searchId, code, reason });
          
          this.handleConnectionClose(searchId, code, reason);
        });
      });

      return searchId;
    } finally {
      release();
    }
  }

  buildWebSocketUrl(searchConfig) {
    // If searchId is a full URL, extract league and search ID from it
    if (searchConfig.searchId.includes('pathofexile.com/trade2/search/poe2/')) {
      const urlParts = searchConfig.searchId.split('/');
      const leagueIndex = urlParts.findIndex(part => part === 'poe2') + 1;
      const searchIdIndex = leagueIndex + 1;
      
      const league = decodeURIComponent(urlParts[leagueIndex]);
      const searchId = urlParts[searchIdIndex];
      
      const encodedLeague = encodeURIComponent(league);
      return `wss://www.pathofexile.com/api/trade2/live/poe2/${encodedLeague}/${searchId}`;
    } else {
      // Use provided league and search ID
      const encodedLeague = encodeURIComponent(searchConfig.league);
      return `wss://www.pathofexile.com/api/trade2/live/poe2/${encodedLeague}/${searchConfig.searchId}`;
    }
  }

  async getSocketHeaders() {
    const credentials = await this.getCredentials();
    const headers = {
      'Origin': 'https://www.pathofexile.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    };
    
    if (credentials) {
      headers['Cookie'] = `POESESSID=${credentials.poesessid}; cf_clearance=${credentials.cf_clearance}`;
    }
    
    return headers;
  }

  heartbeat(socket) {
    clearTimeout(socket.pingTimeout);
    
    // Set timeout for 31 seconds (server sends ping every 30 seconds)
    socket.pingTimeout = setTimeout(() => {
      console.log('WebSocket heartbeat timeout, closing connection');
      socket.terminate();
    }, 31000);
  }

  async handleMessage(searchId, message) {
    const connection = this.connections.get(searchId);
    if (!connection) {
      console.log(`Ignoring message for disconnected search: ${searchId}`);
      return;
    }

    connection.lastMessage = new Date();
    connection.messageCount++;

    // Handle new item notifications
    if (message.new && Array.isArray(message.new)) {
      console.log(`Received ${message.new.length} new item IDs for search ${searchId}`);
      
      // Batch item IDs to prevent too many rapid requests
      if (!this.pendingFetches.has(searchId)) {
        this.pendingFetches.set(searchId, []);
      }
      
      const pendingItems = this.pendingFetches.get(searchId);
      pendingItems.push(...message.new);
      
      // Process batch after a short delay to collect more items
      setTimeout(async () => {
        // Check if connection still exists before processing
        if (!this.connections.has(searchId)) {
          console.log(`Skipping batch processing for disconnected search: ${searchId}`);
          this.pendingFetches.delete(searchId);
          return;
        }

        const itemsToFetch = this.pendingFetches.get(searchId);
        if (itemsToFetch && itemsToFetch.length > 0) {
          this.pendingFetches.set(searchId, []); // Clear the batch
          
          try {
            const items = await this.fetchItemDetails(itemsToFetch, connection.config);
            
            const messageData = {
              searchId,
              type: 'new_items',
              items: items,
              itemIds: itemsToFetch,
              timestamp: new Date()
            };
            console.log('WebSocketManager emitting websocket:message:', messageData);
            this.emit('websocket:message', messageData);

            // Trigger auto-travel for each item if enabled
            // Only trigger for the first item to prevent multiple simultaneous automations
            if (items.length > 0) {
              this.triggerAutoTravel(items[0], searchId);
            }
          } catch (error) {
            console.error('Failed to fetch item details:', error);
            // Still emit the item IDs even if fetch fails
            this.emit('websocket:message', {
              searchId,
              type: 'new_items',
              items: [],
              itemIds: itemsToFetch,
              error: error.message,
              timestamp: new Date()
            });
          }
        }
      }, 200); // 200ms batching delay
    }

    // Handle other message types
    if (message.type) {
      this.emit('websocket:message', {
        searchId,
        type: message.type,
        data: message,
        timestamp: new Date()
      });
    }
  }

  async fetchItemDetails(itemIds, searchConfig) {
    try {
      const credentials = await this.getCredentials();
      if (!credentials) {
        throw new Error('Authentication credentials not available');
      }

      // Extract league and search ID from URL if it's a full URL
      let league, searchId;
      if (searchConfig.searchId.includes('pathofexile.com/trade2/search/poe2/')) {
        const urlParts = searchConfig.searchId.split('/');
        const leagueIndex = urlParts.findIndex(part => part === 'poe2') + 1;
        const searchIdIndex = leagueIndex + 1;
        
        league = decodeURIComponent(urlParts[leagueIndex]);
        searchId = urlParts[searchIdIndex];
      } else {
        league = searchConfig.league;
        searchId = searchConfig.searchId;
      }
      
      const encodedLeague = encodeURIComponent(league);
      const itemIdsString = itemIds.join(',');
      const fetchUrl = `https://www.pathofexile.com/api/trade2/fetch/${itemIdsString}?query=${searchId}&realm=poe2`;

      const headers = {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9,ja;q=0.8',
        'referer': `https://www.pathofexile.com/trade2/search/poe2/${encodedLeague}/${searchId}/live`,
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'x-requested-with': 'XMLHttpRequest',
        'Cookie': `POESESSID=${credentials.poesessid}; cf_clearance=${credentials.cf_clearance}`
      };

      console.log(`Fetching item details for ${itemIds.length} items...`);
      
      // Use rate limiter for API requests
      const response = await this.apiRequestLimiter.schedule(async () => {
        return await axios.get(fetchUrl, {
          headers,
          timeout: 15000
        });
      });

      if (response.data && response.data.result) {
        console.log(`Successfully fetched ${response.data.result.length} item details`);
        return response.data.result;
      } else {
        console.log('No item data in response');
        return [];
      }

    } catch (error) {
      if (error.response) {
        console.error(`Fetch failed with status ${error.response.status}:`, error.response.data);
        
        // Handle rate limiting
        if (error.response.status === 429 || error.response.status === 400) {
          const retryAfter = error.response.headers['retry-after'] || 2;
          console.log(`Rate limited, waiting ${retryAfter} seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          
          // Retry once
          try {
            const response = await this.apiRequestLimiter.schedule(async () => {
              return await axios.get(fetchUrl, {
                headers,
                timeout: 15000
              });
            });
            if (response.data && response.data.result) {
              console.log(`Successfully fetched ${response.data.result.length} item details on retry`);
              return response.data.result;
            }
          } catch (retryError) {
            console.error('Retry also failed:', retryError.message);
          }
        }
      } else {
        console.error('Failed to fetch item details:', error.message);
      }
      throw error;
    }
  }

  async travelToHideout(hideoutToken) {
    if (!hideoutToken) {
      throw new Error('Hideout token is required');
    }

    // Validate token format (should be a JWT-like string)
    if (typeof hideoutToken !== 'string' || !hideoutToken.includes('.')) {
      throw new Error('Invalid hideout token format');
    }

    const credentials = await this.getCredentials();
    if (!credentials.poesessid || !credentials.cf_clearance) {
      throw new Error('Both POESESSID and cf_clearance cookies are required for async trading');
    }

    const payload = {
      token: hideoutToken,
      softFailure: false
    };

    const headers = {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9,ja;q=0.8',
      'content-type': 'application/json',
      'origin': 'https://www.pathofexile.com',
      'referer': 'https://www.pathofexile.com/trade2/search/poe2/',
      'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'x-requested-with': 'XMLHttpRequest',
      'Cookie': `POESESSID=${credentials.poesessid}; cf_clearance=${credentials.cf_clearance}`
    };

    try {
      const response = await this.apiRequestLimiter.schedule(async () => {
        return await axios.post('https://www.pathofexile.com/api/trade2/whisper', payload, {
          headers,
          timeout: 15000
        });
      });

      console.log('Successfully sent travel to hideout request');
      return response.data;
    } catch (error) {
      if (error.response) {
        const errorData = error.response.data || {};
        
        // Handle specific error codes
        switch (errorData.code) {
          case 1:
            throw new Error('Resource not found - Item changed, refresh required');
          case 2:
            throw new Error('Invalid query - Payload format issue');
          case 6:
            throw new Error('Forbidden - Missing or incorrect headers');
          case 8:
            throw new Error('Unauthorized - Authentication failure');
          case 429:
            throw new Error('Rate limited - Too many requests, please wait before trying again');
          default:
            throw new Error(`API request failed: ${error.response.status} ${error.response.statusText}`);
        }
      }
      throw new Error(`Travel to hideout failed: ${error.message}`);
    }
  }

  handleConnectionClose(searchId, code, reason) {
    const connection = this.connections.get(searchId);
    if (!connection) return;

    // Check if this connection was manually disconnected
    if (!this.connections.has(searchId)) {
      console.log(`Connection ${searchId} was manually disconnected, skipping reconnection`);
      return;
    }

    // Handle specific error codes
    if (code === 429) {
      console.error('Rate limit exceeded! Closing connection for search:', searchId);
      return;
    }

    if (code === 404) {
      console.error('Search not found. Closing connection for search:', searchId);
      return;
    }

    if (code === 401) {
      console.error('Unauthorized. Closing connection for search:', searchId, 'Check Session ID.');
      return;
    }

    // Attempt reconnection
    if (connection.reconnectAttempts < this.maxReconnectAttempts) {
      connection.reconnectAttempts++;
      const delay = this.randomInt(2000, 3000);
      
      console.log(`Auto-reconnect attempt ${connection.reconnectAttempts}/${this.maxReconnectAttempts} for search ${searchId} in ${delay/1000} seconds`);
      
      setTimeout(() => {
        // Double-check connection still exists before reconnecting
        if (this.connections.has(searchId)) {
          this.connect(connection.config);
        }
      }, delay);
    } else {
      console.error(`Max reconnection attempts reached for search ${searchId}`);
      this.connections.delete(searchId);
    }
  }

  async getCredentials() {
    try {
      const poesessid = await this.configManager.get('auth.poesessid');
      const cf_clearance = await this.configManager.get('auth.cf_clearance');
      
      console.log('Credentials check:', {
        hasPoesessid: !!poesessid,
        hasCfClearance: !!cf_clearance,
        poesessidLength: poesessid ? poesessid.length : 0,
        cfClearanceLength: cf_clearance ? cf_clearance.length : 0
      });
      
      if (!poesessid || !cf_clearance) {
        throw new Error('Missing authentication credentials');
      }
      
      return { poesessid, cf_clearance };
    } catch (error) {
      console.error('Failed to get credentials:', error.message);
      return null;
    }
  }

  disconnect(searchId) {
    const connection = this.connections.get(searchId);
    if (!connection) {
      console.log(`No disconnect initiated (no such connection) - ${searchId}`);
      return { success: false, error: 'No such connection' };
    }

    console.log(`Disconnect initiated - ${searchId}`);

    // Close the WebSocket connection
    if (connection.socket && 
        (connection.socket.readyState === WebSocket.OPEN || 
         connection.socket.readyState === WebSocket.CONNECTING)) {
      connection.socket.close();
    }

    // Clear heartbeat timeout
    if (connection.socket && connection.socket.pingTimeout) {
      clearTimeout(connection.socket.pingTimeout);
    }

    // Clear any pending fetch requests for this search
    if (this.pendingFetches.has(searchId)) {
      console.log(`Clearing ${this.pendingFetches.get(searchId).length} pending fetch requests for search ${searchId}`);
      this.pendingFetches.delete(searchId);
    }

    // Clear reconnect attempts
    if (this.reconnectAttempts.has(searchId)) {
      this.reconnectAttempts.delete(searchId);
    }

    // Remove from connections
    this.connections.delete(searchId);
    
    console.log(`Successfully disconnected and cleaned up search ${searchId}`);
    return { success: true };
  }

  disconnectAll() {
    console.log('Disconnecting all WebSocket connections');
    const searchIds = Array.from(this.connections.keys());
    
    for (const searchId of searchIds) {
      this.disconnect(searchId);
    }
    
    // Clear any remaining pending fetches
    this.pendingFetches.clear();
    this.reconnectAttempts.clear();
    
    return { success: true };
  }

  getConnectionStatus(searchId) {
    const connection = this.connections.get(searchId);
    if (!connection) return 'not_found';
    
    if (!connection.socket) return 'no_socket';
    
    switch (connection.socket.readyState) {
      case WebSocket.CONNECTING: return 'connecting';
      case WebSocket.OPEN: return 'connected';
      case WebSocket.CLOSING: return 'closing';
      case WebSocket.CLOSED: return 'closed';
      default: return 'unknown';
    }
  }

  getAllConnections() {
    const connections = [];
    for (const [searchId, connection] of this.connections) {
      connections.push({
        id: searchId,
        status: this.getConnectionStatus(searchId),
        config: connection.config,
        lastMessage: connection.lastMessage,
        messageCount: connection.messageCount,
        reconnectAttempts: connection.reconnectAttempts
      });
    }
    return connections;
  }

  async triggerAutoTravel(item, searchId) {
    try {
      // Check if auto-travel is enabled
      const autoTravelEnabled = await this.configManager.get('trading.autoTravelEnabled', false);
      if (!autoTravelEnabled) {
        console.log('Auto-travel is disabled, skipping');
        return;
      }

      // Extract hideout token from item
      console.log('Auto-travel: Extracting hideout token from item:', JSON.stringify(item, null, 2));
      const hideoutToken = this.extractHideoutToken(item);
      if (!hideoutToken) {
        console.log('No hideout token found for item, skipping auto-travel');
        return;
      }
      console.log('Auto-travel: Found hideout token:', hideoutToken);

      // Check if both required cookies are present
      const credentials = await this.getCredentials();
      if (!credentials || !credentials.poesessid || !credentials.cf_clearance) {
        console.log('Auto-travel skipped: Missing required cookies');
        return;
      }

      // Check cooldown - prevent automated travel if travel happened recently
      const lastTravelTime = await this.configManager.get('trading.lastTravelTime', 0);
      const cooldownPeriod = await this.configManager.get('trading.travelCooldown', 30000); // Use configured cooldown (default 30 seconds)
      const now = Date.now();
      
      if (now - lastTravelTime < cooldownPeriod) {
        const remainingTime = cooldownPeriod - (now - lastTravelTime);
        console.log(`Auto-travel skipped: cooldown period active (${remainingTime}ms remaining of ${cooldownPeriod}ms total)`);
        return;
      }

      console.log(`Starting auto-travel for item: ${item.item?.name || 'Unknown'}`);
      
      // Emit automation event to main process (includes travel + CV detection + mouse movement)
      this.emit('automation:triggered', {
        itemData: item,
        itemId: item.id,
        hideoutToken: hideoutToken,
        itemName: item.item?.name || 'Unknown',
        searchId: searchId
      });

      // Update last travel time
      await this.configManager.set('trading.lastTravelTime', now);

    } catch (error) {
      console.error('Auto-travel trigger failed:', error);
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
}

module.exports = { WebSocketManager };