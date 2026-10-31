import { z } from 'zod';

const WS_URL = 'wss://ws3.indodax.com/ws/';
const streamMessageSchema = z.object({
  id: z.number().optional(),
  result: z.object({ channel: z.string().optional(), data: z.unknown().optional() }).optional(),
  error: z.unknown().optional(),
}).passthrough();

type StreamOptions = { token?: string; channels: string[]; onMessage: (message: unknown) => void; onState?: (state: 'connecting' | 'live' | 'stale' | 'error') => void };

type Cursor = { offset: number };

export class IndodaxMarketStream {
  private socket: WebSocket | undefined;
  private readonly cursors = new Map<string, Cursor>();
  private requestId = 1;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(private readonly options: StreamOptions) {}

  connect() {
    if (!this.options.token) { this.options.onState?.('error'); return; }
    this.closed = false;
    this.options.onState?.('connecting');
    this.socket = new WebSocket(WS_URL);
    this.socket.addEventListener('open', () => {
      this.options.onState?.('live');
      this.send({ params: { token: this.options.token }, id: this.nextId() });
      for (const channel of this.options.channels) {
        const cursor = this.cursors.get(channel);
        this.send({ method: 1, params: { channel, ...(cursor ? { recover: true, offset: cursor.offset } : {}) }, id: this.nextId() });
      }
      this.pingTimer = setInterval(() => this.send({ method: 7, id: this.nextId() }), 20_000);
    });
    this.socket.addEventListener('message', (event) => this.handleMessage(event.data));
    this.socket.addEventListener('error', () => this.options.onState?.('error'));
    this.socket.addEventListener('close', () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.options.onState?.('stale');
      if (!this.closed) this.reconnectTimer = setTimeout(() => this.connect(), 2_000);
    });
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.socket?.close();
  }

  private handleMessage(raw: unknown) {
    let parsed: unknown;
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { this.options.onState?.('error'); return; }
    const message = streamMessageSchema.safeParse(parsed);
    if (!message.success) { this.options.onState?.('error'); return; }
    const result = message.data.result;
    if (result?.channel && result.data && typeof result.data === 'object' && 'offset' in result.data && typeof result.data.offset === 'number') {
      this.cursors.set(result.channel, { offset: result.data.offset });
    }
    this.options.onMessage(message.data);
  }

  private send(payload: Record<string, unknown>) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload)); }
  private nextId() { return this.requestId++; }
}
