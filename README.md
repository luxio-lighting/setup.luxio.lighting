# Luxio setup

Standalone static site. All required protocol, browser and simulator sources are included under `shared/`; no other Luxio checkout is needed.

```sh
npm ci
npm run check
npm run build
npm run dev
```

Production output is `dist/`. CI builds this repository alone. Shared source snapshots are updated explicitly. Installed command launchers are ordinary files, not symlinks.

## Deployment

GitHub Actions deploys `main` to GitHub Pages after type checking and building pass. Pull requests and other branches run checks without deploying. The workflow can also be run manually on `main`.

In repository Settings → Pages, select **GitHub Actions** as the source and set the custom domain to **setup.luxio.lighting**. Point that domain's DNS CNAME to **luxio-lighting.github.io** and enable HTTPS once GitHub provisions the certificate. Vite uses the root base path for this custom domain; `public/CNAME` is included in the build output.

## Wi-Fi selection

After opening the board, Setup scans for nearby networks using firmware `SCAN_WIFI` (build 12+). The picker shows SSID, RSSI in dBm, and Password/Open, strongest first. `Refresh` scans again without losing the selection or password. `Custom...` accepts hidden networks and remains usable if scanning fails. Open networks send an empty password.

Browser regressions mock only the USB device transport: `npx playwright install chromium`, then `npm test`. To use an installed Chrome instead, set `CHROME_PATH` to its executable.

## Firmware targets

Setup uses `shared/firmware/targets.json`, an explicit snapshot of the firmware repository's `targets.json`. Refresh it with `python3 tools/sync-targets.py` in that repository. The supported builds are ESP32, S3, C3, C5 and C6; C2/C61 are unavailable with the pinned SDK. Chip selection uses esptool's canonical `CHIP_NAME`, never the package/revision description or USB bridge ID.

Before writing, Setup checks the target’s minimum flash capacity (4 MB for ESP32/S3/C3, 8 MB for C5/C6), requests exactly `<chip>-recovery-v1` from the OTA API, and verifies all five flash offsets, download sizes, SHA-256 checksums and embedded chip IDs. The original ESP32 bootloader starts at 0x1000, C5 at 0x2000, and S3/C3/C6 at 0x0. The USB application must match the OTA application hash and size. All parts are downloaded and validated before the first write. An unpublished target stops with a clear message; no alternate chip build is selected.

The firmware serves both native USB Serial/JTAG and UART0 bridges where available. GPIO wiring remains user configuration; chip detection cannot determine the controller model.
