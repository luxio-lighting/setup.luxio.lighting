# Luxio setup

Standalone static site. All required protocol, browser and simulator sources are included under `shared/`; no other Luxio checkout is needed.

```sh
npm ci
npm run check
npm run build
npm run dev
```

Production output is `dist/`. CI builds this repository alone. Shared source snapshots are updated explicitly. Installed command launchers are ordinary files, not symlinks.
