import { test, expect } from '@playwright/test';

for (const failure of ['empty frame', 'memory error']) {
  test(`serial continues receiving after ${failure}`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async failure => {
      const serialPath = '/shared/web/serial.ts';
      const protocolPath = '/shared/protocol/src/index.ts';
      const { DeviceSerial } = await import(serialPath);
      const { decodeRequest, encodeResponse, frame } = await import(protocolPath);
      let incoming!: ReadableStreamDefaultController<Uint8Array>;
      let writes = 0;
      const port = {
        async open() {}, async close() {},
        readable: new ReadableStream<Uint8Array>({ start(controller) { incoming = controller; } }),
        writable: new WritableStream<Uint8Array>({ write(bytes) {
          const request = decodeRequest(bytes.slice(8));
          if (++writes === 1 && failure === 'empty frame') incoming.enqueue(new Uint8Array([76, 88, 80, 49, 0, 0, 0, 0]));
          else incoming.enqueue(frame(encodeResponse({ id: request.id, ...(writes === 1 ? { error: 'Not enough memory for this request' } : { state: { build: 26, lanIp: '192.0.2.5' } }) })));
        } }),
      };
      const serial = new DeviceSerial(port as unknown as SerialPort);
      await serial.open();
      let error = '';
      try { await serial.send({ id: 1, operation: 0 }); } catch (caught) { error = String(caught); }
      const response = await serial.send({ id: 2, operation: 0 });
      await serial.close();
      return { error, id: response.id, ip: response.state.lanIp, writes };
    }, failure);
    expect(result.error).toContain(failure === 'empty frame' ? 'Invalid frame size' : 'Not enough memory');
    expect(result.id).toBe(2);
    expect(result.ip).toBe('192.0.2.5');
    expect(result.writes).toBe(2);
  });
}
