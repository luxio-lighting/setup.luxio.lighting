import './styles.css';
import { ESPLoader, Transport } from 'esptool-js';
import { DeviceSerial } from './shared/web/serial.js';
import { configSchema, operations } from './shared/protocol/src/index.js';
import firmwareTargets from './shared/firmware/targets.json';
const message = document.querySelector<HTMLElement>('#message')!;
const connect = document.querySelector<HTMLButtonElement>('#connect')!;
const log = document.querySelector<HTMLElement>('#log')!;
const progress = document.querySelector<HTMLProgressElement>('#progress')!;
const network = document.querySelector<HTMLInputElement>('#network')!;
const networkOptions = document.querySelector<HTMLUListElement>('#network-options')!;
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
  const custom = network.value === 'custom' || network.value === 'custom-open';
  ssidInput.hidden = !custom;
  ssidInput.disabled = !custom;
  passwordInput.value = '';
  const secured = custom ? network.value === 'custom' : network.value ? JSON.parse(network.value)[1] as boolean : false;
  document.querySelector<HTMLElement>('#password-field')!.hidden = !secured;
  passwordInput.disabled = !secured;
  passwordInput.required = secured;
  if (custom) ssidInput.focus();
};
for (const dropdown of document.querySelectorAll<HTMLElement>('.dropdown')) {
  const input = dropdown.querySelector<HTMLInputElement>('input[type="hidden"]')!;
  const trigger = dropdown.querySelector<HTMLButtonElement>('.select-trigger')!;
  const list = dropdown.querySelector<HTMLUListElement>('.select-options')!;
  const value = dropdown.querySelector<HTMLElement>('.selected-value')!;
  trigger.onclick = () => {
    list.hidden = !list.hidden;
    trigger.setAttribute('aria-expanded', String(!list.hidden));
    if (!list.hidden) (list.querySelector<HTMLElement>('[aria-selected="true"]') ?? list.querySelector<HTMLElement>('[role="option"]'))?.focus();
  };
  trigger.onkeydown = event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault(); list.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    const options = list.querySelectorAll<HTMLElement>('[role="option"]');
    (list.querySelector<HTMLElement>('[aria-selected="true"]') ?? options[event.key === 'ArrowUp' ? options.length - 1 : 0])?.focus();
  };
  list.onclick = event => {
    const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
    if (!option) return;
    const changed = input.value !== option.dataset.value;
    input.value = option.dataset.value!;
    value.replaceChildren(...Array.from(option.childNodes, node => node.cloneNode(true)));
    value.classList.remove('placeholder');
    for (const item of list.querySelectorAll('[role="option"]')) item.setAttribute('aria-selected', String(item === option));
    list.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus();
    if (changed) input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  list.onkeydown = event => {
    const options = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'));
    const index = options.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); options[index]?.click(); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      [...options.slice(index + 1), ...options.slice(0, index + 1)].find(option => option.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()))?.focus();
    }
  };
  dropdown.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); list.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus();
  });
  dropdown.addEventListener('focusout', event => {
    if (dropdown.contains(event.relatedTarget as Node | null)) return;
    list.hidden = true; trigger.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('click', event => {
    if (dropdown.contains(event.target as Node)) return;
    list.hidden = true; trigger.setAttribute('aria-expanded', 'false');
  });
}
async function scanNetworks() {
  if (!serial || scanning) return;
  scanning = true; scanButton.disabled = true;
  scanButton.setAttribute('aria-busy', 'true');
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
    const previous = networkOptions.querySelector<HTMLElement>('[aria-selected="true"]')?.cloneNode(true) as HTMLElement | undefined;
    const focusedValue = networkOptions.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.value : undefined;
    const customOptions = Array.from(networkOptions.querySelectorAll<HTMLElement>('[data-value^="custom"]'));
    networkOptions.replaceChildren();
    const networks = (response.wifiNetworks ?? []).filter(item => item.ssid).sort((a, b) => b.rssi - a.rssi);
    for (const item of networks) {
      const value = JSON.stringify([item.ssid, item.passwordRequired]);
      if (Array.from(networkOptions.children).some(option => (option as HTMLElement).dataset.value === value)) continue;
      const strength = item.rssi >= -55 ? 3 : item.rssi >= -70 ? 2 : item.rssi >= -80 ? 1 : 0;
      const option = document.createElement('li');
      option.setAttribute('role', 'option'); option.tabIndex = -1; option.dataset.value = value;
      option.setAttribute('aria-selected', String(value === selected));
      const icon = document.createElement('span'); icon.className = 'network-icon';
      icon.setAttribute('role', 'img');
      icon.setAttribute('aria-label', `${['Weak', 'Fair', 'Good', 'Strong'][strength]} signal, ${item.rssi} dBm, ${item.passwordRequired ? 'password required' : 'open network'}`);
      icon.innerHTML = `<svg class="wifi-icon strength-${strength}" viewBox="0 0 24 24" aria-hidden="true"><path class="wifi-arc outer" d="M2 8a16 16 0 0 1 20 0"/><path class="wifi-arc middle" d="M5 12a11 11 0 0 1 14 0"/><path class="wifi-arc inner" d="M8.5 16a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>${item.passwordRequired ? '<svg class="lock-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="7" width="8" height="7" rx="1.5"/><path d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7"/></svg>' : ''}`;
      const name = document.createElement('span'); name.className = 'network-name'; name.textContent = item.ssid;
      option.append(icon, name); networkOptions.append(option);
    }
    // A refresh must not discard the user's selection or password.
    if (selected && !selected.startsWith('custom') && previous && !Array.from(networkOptions.children).some(option => (option as HTMLElement).dataset.value === selected)) networkOptions.append(previous);
    networkOptions.append(...customOptions);
    const selectedOption = networkOptions.querySelector<HTMLElement>('[aria-selected="true"]');
    if (selectedOption) document.querySelector('#network-value')!.replaceChildren(...Array.from(selectedOption.childNodes, node => node.cloneNode(true)));
    if (focusedValue) (Array.from(networkOptions.children).find(option => (option as HTMLElement).dataset.value === focusedValue) as HTMLElement | undefined ?? networkOptions.querySelector<HTMLElement>('[role="option"]'))?.focus();
    scanStatus.textContent = networks.length ? '' : 'No networks found. Enter another network or refresh.';
  } catch (error) {
    scanStatus.textContent = `Could not scan networks. Enter another network or refresh. ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    scanning = false; scanButton.disabled = false;
    scanButton.removeAttribute('aria-busy');
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
  document.querySelector<HTMLInputElement>('#strip-type')!.value = config.stripType;
  for (const option of document.querySelectorAll<HTMLElement>('#strip-type-options [role="option"]')) {
    option.setAttribute('aria-selected', String(option.dataset.value === config.stripType));
    if (option.dataset.value === config.stripType) document.querySelector('#strip-type-value')!.replaceChildren(...Array.from(option.childNodes, node => node.cloneNode(true)));
  }
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
    const chip = loader.chip.CHIP_NAME.toLowerCase().replace(/[^a-z0-9]/g, '');
    const hardware = firmwareTargets.find(target => target.chip === chip);
    if (!hardware) throw new Error(`Unsupported chip: ${detected}. Available firmware targets: ${firmwareTargets.map(target => target.chip).join(', ')}.`);
    const flashBytes = (await loader.getFlashSize()) * 1024;
    if (!Number.isFinite(flashBytes) || flashBytes < hardware.minimumFlashSize) throw new Error(`Luxio for ${chip} requires at least ${hardware.minimumFlashSize / 1048576} MB of detected flash memory.`);
    const target = `${chip}-recovery-v1`;
    const response = await fetch(`https://api.luxio.lighting/updates?chip=${chip}&target=${target}&build=0&channel=0`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Firmware service returned HTTP ${response.status}`);
    const manifest = await response.json() as { chip: string; target: string; minimumFlashSize?: number; size: number; sha256: string; parts: { address: number; url: string; sha256: string; size?: number }[] } | null;
    if (!manifest) throw new Error(`No public recovery build is available for ${detected} yet`);
    if (manifest.chip !== chip || manifest.target !== target || !Array.isArray(manifest.parts) || !manifest.parts.length) throw new Error('Invalid recovery firmware manifest');
    if (manifest.minimumFlashSize !== undefined && manifest.minimumFlashSize !== hardware.minimumFlashSize) throw new Error('Incompatible firmware flash requirement');
    const limits = new Map([[hardware.bootloaderAddress, 0x8000 - hardware.bootloaderAddress], [0x8000, 0x1000], [0xe000, 0x2000], [0x10000, hardware.recoverySize], [hardware.applicationAddress, hardware.applicationSize]]);
    if (manifest.parts.length !== limits.size || new Set(manifest.parts.map(part => part.address)).size !== limits.size || manifest.parts.some(part => !limits.has(part.address))) throw new Error('Flash parts do not match this chip’s recovery layout');
    const application = manifest.parts.find(part => part.address === hardware.applicationAddress)!;
    if (!Number.isInteger(manifest.size) || manifest.size < 288 || manifest.size > hardware.applicationSize || application.sha256 !== manifest.sha256) throw new Error('USB and OTA application must match');
    const files = [];
    for (const part of manifest.parts) {
      if (!Number.isInteger(part.address) || part.address < 0 || !part.url.startsWith('https://')) throw new Error('Invalid flash manifest');
      const response = await fetch(part.url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Firmware download returned HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.length > limits.get(part.address)! || (part.size !== undefined && part.size !== bytes.length)) throw new Error('Firmware part does not fit its partition or declared size');
      if (part.address === hardware.applicationAddress && bytes.length !== manifest.size) throw new Error('Application size does not match manifest');
      if ([hardware.bootloaderAddress, 0x10000, hardware.applicationAddress].includes(part.address) && (bytes.length < 24 || bytes[0] !== 0xe9 || new DataView(bytes.buffer).getUint16(12, true) !== hardware.imageChipId)) throw new Error('Firmware image is for a different chip');
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (digest !== part.sha256) throw new Error('Firmware download checksum does not match');
      let data = ''; for (let offset = 0; offset < bytes.length; offset += 8192) data += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      files.push({ address: part.address, data });
    }
    await loader.writeFlash({ fileArray: files, flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep', eraseAll: false, compress: true,
      reportProgress: (file, written, total) => { progress.value = ((file + written / total) / files.length) * 100; } });
    // esptool-js 0.5.7's hard reset only releases RTS, leaving the flasher running.
    // Keep GPIO0 high and pulse EN so the board boots the installed application.
    await transport.setDTR(false);
    await transport.setRTS(true);
    await new Promise(resolve => setTimeout(resolve, 100));
    await transport.setRTS(false);
    await transport.disconnect();
    message.textContent = 'Firmware installed. Wait for the board to restart, then choose “Already installed” to configure it.'; message.classList.remove('error');
  } catch (error) { message.textContent = String(error); message.classList.add('error'); }
  finally { await transport.disconnect().catch(() => {}); button.disabled = false; existing.disabled = false; }
};
document.querySelector<HTMLFormElement>('#config-panel')!.onsubmit = async event => {
  event.preventDefault(); if (scanning) return;
  const button = document.querySelector<HTMLButtonElement>('#save')!; button.disabled = true; scanButton.disabled = true;
  try {
    if (!serial) throw new Error('Reconnect your device');
    const config = configSchema.parse({ name: document.querySelector<HTMLInputElement>('#name')!.value, stripType: document.querySelector<HTMLInputElement>('#strip-type')!.value,
      ledCount: Number(document.querySelector<HTMLInputElement>('#led-count')!.value), gpio: Number(document.querySelector<HTMLInputElement>('#gpio')!.value), channel });
    const ssid: string = network.value.startsWith('custom') ? ssidInput.value : network.value ? JSON.parse(network.value)[0] : '';
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
