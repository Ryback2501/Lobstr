export class RelayConnection {
  constructor(url, { onEvent, onEOSE, onClosed, onNotice, onStatus } = {}) {
    this.url = url;
    this.onEvent = onEvent || (() => {});
    this.onEOSE = onEOSE || (() => {});
    this.onClosed = onClosed || (() => {});
    this.onNotice = onNotice || (() => {});
    this.onStatus = onStatus || (() => {});
    this._ws = null;
    this._pendingOK = new Map(); // eventId → { resolve, reject, timer }
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.onStatus('connecting');
      const ws = new WebSocket(this.url);
      this._ws = ws;

      ws.onopen = () => {
        this.onStatus('connected');
        resolve();
      };

      ws.onerror = (err) => {
        reject(err);
      };

      ws.onclose = () => {
        this.onStatus('disconnected');
        // Reject any pending publish promises
        for (const [, { reject: rej, timer }] of this._pendingOK) {
          clearTimeout(timer);
          rej(new Error('Connection closed'));
        }
        this._pendingOK.clear();
      };

      ws.onmessage = (e) => this._handleMessage(e.data);
    });
  }

  disconnect() {
    this._ws?.close();
    this._ws = null;
  }

  publish(event) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingOK.delete(event.id);
        reject(new Error('No response from relay (timed out). The relay may require authentication or may not accept posts from new keys. Try a different relay.'));
      }, 10000);

      this._pendingOK.set(event.id, { resolve, reject, timer });
      this._send(["EVENT", event]);
    });
  }

  subscribe(subscriptionId, filters) {
    this._send(["REQ", subscriptionId, ...filters]);
  }

  unsubscribe(subscriptionId) {
    this._send(["CLOSE", subscriptionId]);
  }

  _send(msg) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  }

  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (!Array.isArray(msg) || msg.length < 2) return;

    const [type, ...rest] = msg;

    switch (type) {
      case 'EVENT': {
        const [subId, event] = rest;
        this.onEvent(subId, event);
        break;
      }
      case 'OK': {
        const [eventId, accepted, message] = rest;
        const pending = this._pendingOK.get(eventId);
        if (pending) {
          clearTimeout(pending.timer);
          this._pendingOK.delete(eventId);
          if (accepted) {
            pending.resolve({ eventId, message });
          } else {
            pending.reject(new Error(message || 'Event rejected'));
          }
        }
        break;
      }
      case 'EOSE': {
        const [subId] = rest;
        this.onEOSE(subId);
        break;
      }
      case 'CLOSED': {
        const [subId, message] = rest;
        this.onClosed(subId, message);
        break;
      }
      case 'NOTICE': {
        const [message] = rest;
        this.onNotice(message);
        break;
      }
    }
  }
}
