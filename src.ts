import './styles.css';
import { ESPLoader, Transport } from 'esptool-js';
import { DeviceSerial } from './shared/web/serial.js';
import { configSchema, operations } from './shared/protocol/src/index.js';
const message = document.querySelector<HTMLElement>('#message')!;
const connect = document.querySelector<HTMLButtonElement>('#connect')!;
const log = document.querySelector<HTMLElement>('#log')!;
const progress = document.querySelector<HTMLProgressElement>('#progress')!;
const network = document.querySelector<HTMLSelectElement>('#network')!;
const ssidInput = document.querySelector<HTMLInputElement>('#ssid')!;
const passwordInput = document.querySelector<HTMLInputElement>('#password')!;
const scanButton = document.querySelector<HTMLButtonElement>('#scan')!;
const scanStatus = document.querySelector<HTMLElement>('#scan-status')!;
let scanning = false;
let port: SerialPort;
let serial: DeviceSerial | undefined;
let id = 1;
let channel = 0;
const supported = 'serial' in navigator && 'usb' in navigator;
if (!supported) { document.querySelector<HTMLElement>('#unsupported')!.hidden = false; connect.disabled = true; }
network.onchange = () => {
  const custom = network.value === 'custom';
  document.querySelector<HTMLElement>('#custom-network')!.hidden = !custom;
  ssidInput.disabled = !custom;
  passwordInput.value = '';
  const secured = network.value && !custom ? JSON.parse(network.value)[1] as boolean : false;
  passwordInput.disabled = !custom && !secured;
  passwordInput.required = secured;
  document.querySelector<HTMLElement>('#password-hint')!.textContent = custom ? 'Leave empty for an open network.' : secured ? 'Password required.' : network.value ? 'Open network — no password.' : 'Select a network.';
  if (custom) ssidInput.focus();
};
async function scanNetworks() {
  if (!serial || scanning) return;
  scanning = true; scanButton.disabled = true;
  document.querySelector<HTMLButtonElement>('#save')!.disabled = true;
  scanStatus.textContent = 'Scanning…';
  try {
    let response = await serial.send({ id: id++, operation: operations.SCAN_WIFI });
    const deadline = Date.now() + 20000;
    while (response.wifiScanning) {
      if (Date.now() >= deadline) throw new Error('Scan timed out.');
      await new Promise(resolve => setTimeout(resolve, 500));
      response = await serial.send({ id: id++, operation: operations.GET_STATE });
    }
    if (response.wifiScanError) throw new Error(response.wifiScanError);
    const selected = network.value;
    const previous = network.selectedOptions[0]?.cloneNode(true) as HTMLOptionElement | undefined;
    const placeholder = new Option('Select a network', ''); placeholder.disabled = true;
    network.replaceChildren(placeholder);
    const networks = (response.wifiNetworks ?? []).filter(item => item.ssid).sort((a, b) => b.rssi - a.rssi);
    for (const item of networks) {
      const value = JSON.stringify([item.ssid, item.passwordRequired]);
      if (Array.from(network.options).some(option => option.value === value)) continue;
      network.add(new Option(`${item.ssid} · ${item.rssi} dBm · ${item.passwordRequired ? 'Password' : 'Open'}`, value));
    }
    // A refresh must not discard the user's selection or password.
    if (selected && selected !== 'custom' && previous && !Array.from(network.options).some(option => option.value === selected)) network.add(previous);
    network.add(new Option('Custom...', 'custom'));
    network.value = selected;
    scanStatus.textContent = networks.length ? '' : 'No networks found. Choose Custom... or refresh.';
  } catch (error) {
    scanStatus.textContent = `Could not scan networks. Choose Custom... or refresh. ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    scanning = false; scanButton.disabled = false;
    document.querySelector<HTMLButtonElement>('#save')!.disabled = false;
  }
}
scanButton.onclick = () => { void scanNetworks(); };
connect.onclick = async () => {
  try {
    port = await navigator.serial.requestPort();
    document.querySelector<HTMLElement>('#connect-panel')!.hidden = true;
    document.querySelector<HTMLElement>('#install-panel')!.hidden = false;
    document.querySelector('#step-1')!.classList.remove('current'); document.querySelector('#step-2')!.classList.add('current');
    document.querySelector('#step-1')!.removeAttribute('aria-current'); document.querySelector('#step-2')!.setAttribute('aria-current', 'step');
    message.textContent = ''; message.classList.remove('error');
  } catch (error) { message.textContent = String(error); message.classList.add('error'); }
};
async function configure() {
  serial = new DeviceSerial(port); await serial.open();
  const response = await serial.send({ id: id++, operation: 0 });
  if (!response.state) throw new Error('Device did not return its configuration');
  const config = response.state.config; channel = config.channel;
  document.querySelector<HTMLInputElement>('#name')!.value = config.name;
  document.querySelector<HTMLSelectElement>('#strip-type')!.value = config.stripType;
  document.querySelector<HTMLInputElement>('#led-count')!.value = String(config.ledCount);
  document.querySelector<HTMLInputElement>('#gpio')!.value = String(config.gpio);
  document.querySelector<HTMLElement>('#install-panel')!.hidden = true;
  document.querySelector<HTMLElement>('#config-panel')!.hidden = false;
  document.querySelector('#step-2')!.classList.remove('current'); document.querySelector('#step-3')!.classList.add('current');
  document.querySelector('#step-2')!.removeAttribute('aria-current'); document.querySelector('#step-3')!.setAttribute('aria-current', 'step');
  void scanNetworks();
}
document.querySelector<HTMLButtonElement>('#existing')!.onclick = async event => {
  const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
  try { await configure(); message.textContent = ''; message.classList.remove('error'); }
  catch (error) { await serial?.close().catch(() => {}); serial = undefined; message.textContent = String(error); message.classList.add('error'); }
  finally { button.disabled = false; }
};
document.querySelector<HTMLButtonElement>('#flash')!.onclick = async event => {
  const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
  const existing = document.querySelector<HTMLButtonElement>('#existing')!; existing.disabled = true;
  const transport = new Transport(port);
  try {
    log.textContent = ''; progress.hidden = false;
    const loader = new ESPLoader({ transport, baudrate: 460800, romBaudrate: 115200, terminal: { clean: () => { log.textContent = ''; }, write: text => { log.textContent += text; log.scrollTop = log.scrollHeight; }, writeLine: text => { log.textContent += text + '\n'; log.scrollTop = log.scrollHeight; } } });
    const detected = await loader.main();
    const chip = detected.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!['esp32', 'esp32s3', 'esp32c2', 'esp32c3', 'esp32c5', 'esp32c6', 'esp32c61'].includes(chip)) throw new Error('This chip does not meet Luxio’s integrated Wi-Fi and Bluetooth requirement');
    const target = `${chip}-recovery-v1`;
    const response = await fetch(`https://api.luxio.lighting/updates?chip=${chip}&target=${target}&build=0&channel=0`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Firmware service returned HTTP ${response.status}`);
    const manifest = await response.json() as { chip: string; target: string; parts: { address: number; url: string; sha256: string }[] } | null;
    if (!manifest) throw new Error(`No public recovery build is available for ${detected} yet`);
    if (manifest.chip !== chip || manifest.target !== target || !Array.isArray(manifest.parts) || !manifest.parts.length) throw new Error('Invalid recovery firmware manifest');
    const files = [];
    for (const part of manifest.parts) {
      if (!Number.isInteger(part.address) || part.address < 0 || !part.url.startsWith('https://')) throw new Error('Invalid flash manifest');
      const response = await fetch(part.url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Firmware download returned HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (digest !== part.sha256) throw new Error('Firmware download checksum does not match');
      let data = ''; for (let offset = 0; offset < bytes.length; offset += 8192) data += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      files.push({ address: part.address, data });
    }
    await loader.writeFlash({ fileArray: files, flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep', eraseAll: false, compress: true,
      reportProgress: (file, written, total) => { progress.value = ((file + written / total) / files.length) * 100; } });
    await loader.after('hard_reset'); await transport.disconnect();
    message.textContent = 'Firmware installed. Wait for the board to restart, then choose “Already installed” to configure it.'; message.classList.remove('error');
  } catch (error) { message.textContent = String(error); message.classList.add('error'); }
  finally { await transport.disconnect().catch(() => {}); button.disabled = false; existing.disabled = false; }
};
document.querySelector<HTMLFormElement>('#config-panel')!.onsubmit = async event => {
  event.preventDefault(); if (scanning) return;
  const button = document.querySelector<HTMLButtonElement>('#save')!; button.disabled = true; scanButton.disabled = true;
  try {
    if (!serial) throw new Error('Reconnect your device');
    const config = configSchema.parse({ name: document.querySelector<HTMLInputElement>('#name')!.value, stripType: document.querySelector<HTMLSelectElement>('#strip-type')!.value,
      ledCount: Number(document.querySelector<HTMLInputElement>('#led-count')!.value), gpio: Number(document.querySelector<HTMLInputElement>('#gpio')!.value), channel });
    const ssid: string = network.value === 'custom' ? ssidInput.value : network.value ? JSON.parse(network.value)[0] : '';
    const password = passwordInput.disabled ? '' : passwordInput.value;
    if (!ssid) throw new Error('Select a Wi-Fi network or enter its name.');
    if (new TextEncoder().encode(ssid).length > 32 || new TextEncoder().encode(password).length > 64) throw new Error('Wi-Fi credentials exceed the supported byte length');
    await serial.send({ id: id++, operation: 3, config });
    await serial.send({ id: id++, operation: 4, wifi: { ssid, password } });
    document.querySelector<HTMLInputElement>('#password')!.value = '';
    message.textContent = 'Settings saved. Waiting for Wi-Fi…'; message.classList.remove('error');
    let ip = '';
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const result = await serial.send({ id: id++, operation: 0 });
      if (result.state?.lanIp && result.state.lanIp !== '0.0.0.0') { ip = result.state.lanIp; break; }
    }
    if (!ip) throw new Error('Settings saved, but Wi-Fi has not connected. Check the network name and password, then retry.');
    document.querySelector<HTMLElement>('#config-panel')!.hidden = true; document.querySelector<HTMLElement>('#done-panel')!.hidden = false;
    document.querySelector('#done-description')!.textContent = `${config.name} is connected at ${ip}. You can now discover it on this network or use this address in Studio.`;
    message.textContent = '';
  } catch (error) { message.textContent = String(error); message.classList.add('error'); }
  finally { button.disabled = false; scanButton.disabled = false; }
};
document.querySelector<HTMLButtonElement>('#edit')!.onclick = () => { document.querySelector<HTMLElement>('#done-panel')!.hidden = true; document.querySelector<HTMLElement>('#config-panel')!.hidden = false; };
navigator.serial?.addEventListener('disconnect', () => { message.textContent = 'USB device disconnected. Reconnect it and reload to continue.'; message.classList.add('error'); });
