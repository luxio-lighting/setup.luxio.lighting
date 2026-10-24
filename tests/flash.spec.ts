import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

for (const [family, description, target, chipId, boot, appAddress, flashMb] of [
  ['ESP32', 'ESP32-D0WD-V3 (revision 3)', 'esp32', 0, 0x1000, 0x130000, 4],
  ['ESP32-S3', 'ESP32-S3 (revision v0.2)', 'esp32s3', 9, 0, 0x130000, 4],
  ['ESP32-C3', 'ESP32-C3 (revision v0.4)', 'esp32c3', 5, 0, 0x150000, 4],
  ['ESP32-C5', 'ESP32-C5 (revision v0.1)', 'esp32c5', 23, 0x2000, 0x210000, 8],
  ['ESP32-C6', 'ESP32-C6 (revision v0.1)', 'esp32c6', 13, 0, 0x210000, 8],
] as const) {
  for (const scenario of ['install', 'unpublished', 'wrong manifest chip', 'wrong image chip', 'wrong offsets', 'duplicate offsets', 'wrong size', 'wrong checksum', 'small flash']) {
    test(`${family}: ${scenario}`, async ({ page }) => {
      await page.route('**/esptool-js.js*', route => route.fulfill({
        contentType: 'application/javascript',
        body: `
          export class Transport { async disconnect() {} }
          export class ESPLoader {
            chip = { CHIP_NAME: ${JSON.stringify(family)} };
            async main() { return ${JSON.stringify(description)}; }
            async getFlashSize() { return ${scenario === 'small flash' ? (flashMb / 2) * 1024 : flashMb * 1024}; }
            async writeFlash(options) { window.flashAddresses = options.fileArray.map(file => file.address); }
            async after() {}
          }
        `,
      }));
      const files = new Map<number, Buffer>();
      const parts = [boot, 0x8000, 0xe000, 0x10000, appAddress].map(address => {
        const bytes = Buffer.alloc(address === appAddress ? 288 : 32);
        if ([boot, 0x10000, appAddress].includes(address)) {
          bytes[0] = 0xe9;
          bytes.writeUInt16LE(scenario === 'wrong image chip' && address === appAddress ? 99 : chipId, 12);
        }
        files.set(address, bytes);
        return { address, url: `https://firmware.example/${address}.bin`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      });
      const manifest = { chip: target, target: `${target}-recovery-v1`, minimumFlashSize: flashMb * 1048576, size: 288, sha256: parts[4].sha256, parts };
      if (scenario === 'wrong manifest chip') manifest.chip = 'esp8266' as typeof target;
      if (scenario === 'wrong offsets') parts[0].address = 0x3000;
      if (scenario === 'duplicate offsets') parts[0].address = parts[1].address;
      if (scenario === 'wrong size') parts[0].size++;
      if (scenario === 'wrong checksum') parts[0].sha256 = '0'.repeat(64);
      const requests: URL[] = [];
      await page.route('https://api.luxio.lighting/updates?*', route => {
        requests.push(new URL(route.request().url()));
        return route.fulfill({ json: scenario === 'unpublished' ? null : manifest });
      });
      await page.route('https://firmware.example/*', route => {
        const address = Number(new URL(route.request().url()).pathname.slice(1).replace('.bin', ''));
        return route.fulfill({ contentType: 'application/octet-stream', body: files.get(address)! });
      });
      await page.goto('/');
      await page.evaluate(() => { navigator.serial.requestPort = async () => ({} as SerialPort); });
      await page.locator('#connect').click();
      await page.locator('#flash').click();
      if (scenario === 'install') {
        await expect(page.locator('#message')).toContainText('Firmware installed');
        expect(await page.evaluate('window.flashAddresses')).toEqual([boot, 0x8000, 0xe000, 0x10000, appAddress]);
      } else {
        await expect(page.locator('#message')).toHaveClass(/error/);
        expect(await page.evaluate('window.flashAddresses')).toBeUndefined();
        if (scenario === 'unpublished') await expect(page.locator('#message')).toContainText(`No public recovery build is available for ${description} yet`);
      }
      if (scenario === 'small flash') expect(requests).toHaveLength(0);
      else {
        expect(requests).toHaveLength(1);
        expect(requests[0].searchParams.get('chip')).toBe(target);
        expect(requests[0].searchParams.get('target')).toBe(`${target}-recovery-v1`);
      }
      await expect(page.locator('#flash')).toBeEnabled();
    });
  }
}

for (const family of ['ESP32-S2', 'ESP32-C2', 'ESP32-C61', 'ESP32-H2', 'ESP32-P4']) {
  test(`${family} is unavailable before any firmware fetch`, async ({ page }) => {
    await page.route('**/esptool-js.js*', route => route.fulfill({ contentType: 'application/javascript', body: `
      export class Transport { async disconnect() {} }
      export class ESPLoader { chip = { CHIP_NAME: '${family}' }; async main() { return '${family} (revision 0)'; } }
    ` }));
    const requests: string[] = [];
    await page.route('https://api.luxio.lighting/updates?*', route => { requests.push(route.request().url()); return route.abort(); });
    await page.goto('/');
    await page.evaluate(() => { navigator.serial.requestPort = async () => ({} as SerialPort); });
    await page.locator('#connect').click(); await page.locator('#flash').click();
    await expect(page.locator('#message')).toContainText(`Unsupported chip: ${family}`);
    expect(requests).toHaveLength(0);
  });
}
