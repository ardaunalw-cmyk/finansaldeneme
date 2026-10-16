/**
 * ==============================================================================
 * UTL FİNANS - Enterprise Frontend API Client & WebSocket Service
 * ==============================================================================
 * Connects frontend views to backend RESTful endpoints and real-time WebSocket feeds.
 * Includes automated fallback to local client-side KAP database when offline.
 */

class UtlApiClient {
  constructor(baseUrl = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
    this.isOnline = false;
    this.lastHealthCheck = null;
  }

  /**
   * Checks if backend API server is reachable.
   */
  async checkHealth() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        this.isOnline = true;
        this.lastHealthCheck = data;
        return { online: true, data };
      }
    } catch (e) {
      this.isOnline = false;
    }
    return { online: false };
  }

  /**
   * Fetches real-time market quotes across BIST, FX, and Commodities.
   */
  async getMarketQuotes(instrumentType = null) {
    if (!this.isOnline) return null;
    try {
      let url = `${this.baseUrl}/api/v1/market/quotes`;
      if (instrumentType) url += `?instrument_type=${instrumentType}`;
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[UtlApiClient] Failed to fetch market quotes from backend, falling back to local.');
    }
    return null;
  }

  /**
   * Fetches latest KAP disclosures with ticker and sentiment tagging.
   */
  async getDisclosures(ticker = null, category = null, limit = 20) {
    if (!this.isOnline) return null;
    try {
      let url = `${this.baseUrl}/api/v1/news/disclosures?limit=${limit}`;
      if (ticker) url += `&ticker=${encodeURIComponent(ticker)}`;
      if (category) url += `&category=${encodeURIComponent(category)}`;
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[UtlApiClient] Failed to fetch KAP disclosures from backend.');
    }
    return null;
  }

  /**
   * Fetches official macroeconomic benchmarks (TCMB policy rate, 5Y CDS, Inflation).
   */
  async getMacroIndicators() {
    if (!this.isOnline) return null;
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/macro/indicators`);
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[UtlApiClient] Failed to fetch macroeconomic indicators from backend.');
    }
    return null;
  }

  /**
   * Computes DuPont ROE decomposition, Altman Z''-Score, and Piotroski F-Score.
   */
  async evaluateFundamentalHealth(ticker, currentFinancials, previousFinancials = null) {
    if (!this.isOnline) return null;
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/analytics/fundamental`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          current_period: currentFinancials,
          previous_period: previousFinancials
        })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[UtlApiClient] Failed to evaluate fundamental health on backend.');
    }
    return null;
  }

  /**
   * Computes hybrid UTL Alpha Score (0-10) with institutional Al/Sat decision.
   */
  async computeAlphaScore(ticker, currentFinancials, previousFinancials, bars) {
    if (!this.isOnline) return null;
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/analytics/alpha-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          current_financials: currentFinancials,
          previous_financials: previousFinancials,
          bars: bars
        })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[UtlApiClient] Failed to compute UTL Alpha Score on backend.');
    }
    return null;
  }

  /**
   * Runs Swiss Risk Parity rebalancer with 20% cap and target beta optimization.
   */
  async runSwissRebalance(positions, currentCash, targetBeta = 1.0, maxCap = 0.20) {
    if (!this.isOnline) return null;
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/analytics/rebalance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positions,
          current_cash: currentCash.toString(),
          target_beta: targetBeta.toString(),
          max_single_asset_cap: maxCap.toString()
        })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('[UtlApiClient] Failed to run Swiss Rebalance on backend.');
    }
    return null;
  }
}


/**
 * ==============================================================================
 * Real-Time WebSocket Market Client
 * ==============================================================================
 * Subscribes to real-time quotes with auto-reconnection and event dispatch.
 */
class UtlWebSocketClient {
  constructor(wsUrl = 'ws://localhost:8000/api/v1/market/ws') {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.isConnected = false;
    this.subscribedSymbols = new Set(['*']);
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.listeners = new Set();
    this.statusListeners = new Set();
  }

  connect() {
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        console.log('[UtlWebSocket] Connected to real-time market feed.');
        this._notifyStatus(true);

        // Resubscribe symbols
        if (this.subscribedSymbols.size > 0) {
          this.subscribe(Array.from(this.subscribedSymbols));
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.type === 'TICK') {
            this._notifyTick(data);
          }
        } catch (err) {
          // Ignore ping or malformed frames
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this._notifyStatus(false);
        this._scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        this._notifyStatus(false);
      };
    } catch (e) {
      this._scheduleReconnect();
    }
  }

  subscribe(symbols) {
    if (!Array.isArray(symbols)) symbols = [symbols];
    symbols.forEach(s => this.subscribedSymbols.add(s.toUpperCase()));

    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action: 'subscribe',
        symbols: symbols
      }));
    }
  }

  onTick(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  onStatusChange(callback) {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  _notifyTick(tickData) {
    this.listeners.forEach(cb => {
      try { cb(tickData); } catch (e) { console.error('[UtlWebSocket] Listener error:', e); }
    });
  }

  _notifyStatus(isOnline) {
    this.statusListeners.forEach(cb => {
      try { cb(isOnline); } catch (e) {}
    });
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts), 15000);
      setTimeout(() => this.connect(), delay);
    }
  }
}

// Global Singletons
const utlApi = new UtlApiClient();
const utlWs = new UtlWebSocketClient();

// Expose to window for global access
if (typeof window !== 'undefined') {
  window.utlApi = utlApi;
  window.utlWs = utlWs;
}
