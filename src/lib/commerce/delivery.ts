/** Detect delivered artifacts, not merely upstream image generation. */
type Packet = { error?: unknown; errorType?: unknown; type?: string; status?: string; stage?: string; delta?: string; content?: string; answer?: string; artifactMarkdown?: string; slides?: { imageUrl?: string | null }[]; imageUrl?: string; draft?: unknown; report?: unknown; data?: Packet; success?: boolean; code?: number };
export class DeliveryTracker {
  private buffer = '';
  private decoder = new TextDecoder();
  private failed = false;
  private delivered = 0;
  private content = false;
  public reliable = true;
  constructor(private readonly contentType: string, private readonly operation = '') {}
  push(bytes: Uint8Array) {
    if (this.contentType.includes('presentationml') || this.contentType.includes('application/octet-stream')) return;
    this.buffer += this.decoder.decode(bytes, { stream: true });
    if (this.buffer.length > 80_000_000) { this.reliable = false; this.buffer = ''; return; }
    if (!this.contentType.includes('text/event-stream')) return;
    const lines = this.buffer.split('\n'); this.buffer = lines.pop() || '';
    for (const line of lines) if (line.startsWith('data:')) this.parse(line.slice(5).trim());
  }
  private parse(text: string) {
    if (text === '[DONE]' || !text) return;
    try { this.packet(JSON.parse(text) as Packet); } catch { /* Heartbeats or malformed content cannot prove delivery. */ }
  }
  private packet(packet: Packet) {
    if (packet.error || packet.errorType || packet.type === 'error' || packet.status === 'error' || packet.stage === 'error' || packet.success === false || (typeof packet.code === 'number' && packet.code !== 0)) { this.failed = true; return; }
    if (packet.delta || packet.content || packet.answer || packet.artifactMarkdown) this.content = true;
    if (packet.code === 0 || packet.success === true) this.content = true;
    if (packet.stage === 'done' && packet.slides?.length) this.delivered = this.operation === 'ppt-html' ? 1 : packet.slides.some(item => item.imageUrl !== undefined) ? packet.slides.filter(item => item.imageUrl).length : 1;
    if (packet.imageUrl || packet.draft || packet.report) this.delivered = Math.max(this.delivered, 1);
    if (packet.data) this.packet(packet.data);
  }
  finish(): number {
    if (this.contentType.includes('presentationml') || this.contentType.includes('application/octet-stream')) return 1;
    if (this.buffer.trim()) this.parse(this.buffer.replace(/^data:\s*/, '').trim());
    if (this.failed) return 0;
    return this.delivered || (this.content ? 1 : 0);
  }
}
