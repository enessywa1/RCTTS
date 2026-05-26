type Handler = (topic: string, msg: any) => void;

class WSClient {
  socket: WebSocket | null = null;
  handlers: Set<Handler> = new Set();
  url: string;
  reconnectMs = 2000;

  constructor(url?: string) {
    this.url = url || ((location.protocol === 'https:') ? 'wss://' : 'ws://') + location.host;
    this.connect();
  }

  connect() {
    try {
      this.socket = new WebSocket(this.url);
      this.socket.onopen = () => console.log('WS connected');
      this.socket.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data);
          const topic = parsed.topic || '';
          const msg = parsed.msg || parsed;
          this.handlers.forEach(h => h(topic, msg));
        } catch (e) { console.error('WS parse', e); }
      };
      this.socket.onclose = () => {
        console.log('WS closed, reconnecting');
        this.socket = null;
        setTimeout(() => this.connect(), this.reconnectMs);
      };
      this.socket.onerror = (e) => { console.error('WS error', e); };
    } catch (e) {
      console.error('WS connect failed', e);
      setTimeout(() => this.connect(), this.reconnectMs);
    }
  }

  send(data: any) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(data));
  }

  subscribe(handler: Handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

const wsClient = new WSClient();
export default wsClient;
