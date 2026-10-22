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
