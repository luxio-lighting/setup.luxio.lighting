import { decodeResponse, encodeRequest, frame, FrameDecoder, type Request, type Response } from '../protocol/src/index.js';
export class DeviceSerial {
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private pending = new Map<number, { resolve: (value: Response) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private reading?: Promise<void>;
  constructor(public port: SerialPort) {}
  async open() {
    await this.port.open({ baudRate: 115200 });
    this.reader = this.port.readable!.getReader(); this.writer = this.port.writable!.getWriter();
    const decoder = new FrameDecoder();
    this.reading = (async () => {
      try {
        while (this.reader) {
          const { value, done } = await this.reader.read(); if (done) break;
          for (const bytes of decoder.push(value)) {
            const response = decodeResponse(bytes); const pending = this.pending.get(response.id);
            if (!pending) continue;
            clearTimeout(pending.timer); this.pending.delete(response.id);
            if (response.error) pending.reject(new Error(response.error)); else pending.resolve(response);
          }
        }
      } catch (error) {
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error instanceof Error ? error : new Error(String(error))); }
        this.pending.clear();
      }
    })();
  }
  async send(request: Request): Promise<Response> {
    if (!this.writer) throw new Error('Connect the device first');
    const bytes = frame(encodeRequest(request));
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(request.id); reject(new Error('Device did not respond. Check its USB connection and firmware.')); }, 15000);
      this.pending.set(request.id, { resolve, reject, timer });
      this.writer!.write(bytes).catch(error => { clearTimeout(timer); this.pending.delete(request.id); reject(error); });
    });
  }
  async close() {
    await this.reader?.cancel(); await this.reading; this.reader?.releaseLock(); this.reader = undefined;
    this.writer?.releaseLock(); this.writer = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Device disconnected')); } this.pending.clear();
    await this.port.close();
  }
}
