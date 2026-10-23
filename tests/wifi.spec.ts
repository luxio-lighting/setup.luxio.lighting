import { test, expect } from '@playwright/test';
import type { Request, WifiNetwork } from '../shared/protocol/src/index';

declare global {
  interface Window {
    calls: Request[];
    networks: WifiNetwork[];
    scanFailure: string;
    scanPolls: number;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    window.calls = []; window.scanFailure = ''; window.scanPolls = 0;
    window.networks = [
      { ssid: 'Guest', rssi: -80, passwordRequired: false },
      { ssid: 'Home <&>', rssi: -40, passwordRequired: true },
      { ssid: 'Home <&>', rssi: -70, passwordRequired: true },
    ];
    navigator.serial.requestPort = async () => ({} as SerialPort);
    const modulePath = '/shared/web/serial.ts';
    const { DeviceSerial } = await import(modulePath);
    DeviceSerial.prototype.open = async () => {};
    DeviceSerial.prototype.send = async (request: Request) => {
      window.calls.push(request);
      const response = { id: request.id, state: { config: { name: 'Desk', stripType: 'WS2805', ledCount: 60, gpio: 16, channel: 0 }, lanIp: '192.168.1.231' }, wifiScanning: false, wifiNetworks: window.networks };
      if (request.operation === 16) {
        if (window.scanFailure) throw new Error(window.scanFailure);
        window.scanPolls = 2;
        return { ...response, wifiScanning: true, wifiNetworks: [] };
      }
      if (request.operation === 0 && window.scanPolls > 0) { window.scanPolls--; response.wifiScanning = window.scanPolls > 0; }
      return response;
    };
  });
  await page.locator('#connect').click();
});

test('scan is polled, names render safely, secured selection saves its SSID', async ({ page }) => {
  await page.locator('#existing').click();
  await expect(page.locator('#scan-status')).toHaveText('Scanning…');
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#scan')).toBeEnabled();
  await expect(page.locator('#password-field')).toBeHidden();
  expect(await page.locator('#network-options [role=option]').allTextContents()).toEqual(['Home <&>', 'Guest', 'Other secured network…', 'Other open network…']);
  await expect(page.locator('#network-options .strength-3')).toHaveCount(1);
  await expect(page.locator('#network-options .strength-1')).toHaveCount(1);
  await expect(page.locator('#network-options .lock-icon')).toHaveCount(1);
  await page.locator('#network-trigger').click();
  await page.getByRole('option', { name: /Home <&>/ }).click();
  await expect(page.locator('#ssid')).toBeHidden();
  await expect(page.locator('#password')).toHaveAttribute('required', '');
  await page.locator('#password').fill('test-password');
  await page.locator('#save').click();
  await expect(page.locator('#done-panel')).toBeVisible();
  expect(await page.evaluate(() => window.calls.find(c => c.operation === 4)?.wifi)).toEqual({ ssid: 'Home <&>', password: 'test-password' });
});

test('open network clears a previous password and sends none', async ({ page }) => {
  await page.locator('#existing').click(); await expect(page.locator('#scan')).toBeEnabled();
  await page.locator('#network-trigger').click();
  await page.getByRole('option', { name: /Home <&>/ }).click();
  await page.locator('#password').fill('do-not-send');
  await page.locator('#network-trigger').click();
  await page.getByRole('option', { name: /Guest/ }).click();
  await expect(page.locator('#password-field')).toBeHidden();
  await expect(page.locator('#password')).toBeDisabled(); await expect(page.locator('#password')).toHaveValue('');
  await page.locator('#save').click(); await expect(page.locator('#done-panel')).toBeVisible();
  expect(await page.evaluate(() => window.calls.find(c => c.operation === 4)?.wifi)).toEqual({ ssid: 'Guest', password: '' });
});

test('failed scan leaves manual entry usable and allows retry', async ({ page }) => {
  await page.evaluate(() => { window.scanFailure = 'Unknown operation'; });
  await page.locator('#existing').click();
  await expect(page.locator('#scan-status')).toContainText('Could not scan');
  await page.locator('#network-trigger').click();
  await page.getByRole('option', { name: 'Other secured network…' }).click();
  await page.locator('#ssid').fill('Hidden café'); await page.locator('#password').fill('secret-for-test');
  await page.evaluate(() => { window.scanFailure = ''; });
  await page.locator('#scan').click(); await expect(page.locator('#scan')).toBeEnabled();
  await expect(page.locator('#network')).toHaveValue('custom');
  await expect(page.locator('#ssid')).toHaveValue('Hidden café');
  await expect(page.locator('#password')).toHaveValue('secret-for-test');
  await page.locator('#save').click(); await expect(page.locator('#done-panel')).toBeVisible();
  expect(await page.evaluate(() => window.calls.find(c => c.operation === 4)?.wifi)).toEqual({ ssid: 'Hidden café', password: 'secret-for-test' });
});

test('empty scan allows a manual open network and validates UTF-8 byte limits', async ({ page }) => {
  await page.evaluate(() => { window.networks = []; });
  await page.locator('#existing').click(); await expect(page.locator('#scan-status')).toContainText('No networks found');
  await page.locator('#network-trigger').click();
  await page.getByRole('option', { name: 'Other open network…' }).click(); await page.locator('#ssid').fill('é'.repeat(17));
  await page.locator('#save').click(); await expect(page.locator('#message')).toContainText('byte length');
  expect(await page.evaluate(() => window.calls.some(c => c.operation === 4))).toBe(false);
  await page.locator('#ssid').fill('My hidden open network');
  await page.locator('#save').click(); await expect(page.locator('#done-panel')).toBeVisible();
  expect(await page.evaluate(() => window.calls.find(c => c.operation === 4)?.wifi?.password)).toBe('');
});

test('refresh preserves a selected secured network and password even if it disappears', async ({ page }) => {
  await page.locator('#existing').click(); await expect(page.locator('#scan')).toBeEnabled();
  await page.locator('#network-trigger').click();
  await page.getByRole('option', { name: /Home <&>/ }).click();
  await page.locator('#password').fill('still-here');
  await page.evaluate(() => { window.networks = []; });
  await page.locator('#scan').click(); await expect(page.locator('#scan')).toBeEnabled();
  await expect(page.locator('#network')).toHaveValue(JSON.stringify(['Home <&>', true]));
  await expect(page.locator('#password')).toHaveValue('still-here');
  await page.locator('#network-trigger').click();
  await page.screenshot({ path: '.sdk/wifi-desktop.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.sdk/wifi-mobile.png', fullPage: true });
});


test('dropdowns support keyboard selection, dismissal, and saving strip type', async ({ page }) => {
  await page.locator('#existing').click(); await expect(page.locator('#scan')).toBeEnabled();
  await page.locator('#network-trigger').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: /Home <&>/ })).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('#network-trigger')).toBeFocused();
  await expect(page.locator('#password-field')).toBeHidden();
  await page.locator('#strip-type-trigger').click();
  await page.screenshot({ path: '.sdk/strip-desktop.png', fullPage: true });
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await expect(page.locator('#strip-type-value')).toHaveText('WS2812RGB');
  await page.locator('#strip-type-trigger').click(); await page.keyboard.press('Escape');
  await expect(page.locator('#strip-type-options')).toBeHidden();
  await expect(page.locator('#strip-type-trigger')).toBeFocused();
  await page.locator('#network-trigger').click(); await page.locator('#name').click();
  await expect(page.locator('#network-options')).toBeHidden();
  await page.locator('#strip-type-trigger').click(); await page.keyboard.press('Tab');
  await expect(page.locator('#strip-type-options')).toBeHidden();
  await page.locator('#save').click(); await expect(page.locator('#done-panel')).toBeVisible();
  expect(await page.evaluate(() => window.calls.find(c => c.operation === 3)?.config?.stripType)).toBe('WS2812');
});
