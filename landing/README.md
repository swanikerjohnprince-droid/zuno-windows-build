# Zuno — marketing site

The public landing page. A separate Vite project that shares Zuno's look but none of its build.

```bash
cd landing
npm install
npm run dev      # http://localhost:5173
npm run build    # -> landing/dist
```

## Why it is its own project

The desktop app's Vite config has fixed Rollup inputs (`index.html`, `mini.html`), a strict dev
port Tauri depends on, and a `src-tauri` watcher. Adding a third entry point would tie a public
website's release cadence to the app's, and a stray import could pull `@tauri-apps/*` into a
bundle that has no Tauri runtime under it.

Nothing here is reachable from the app: its `tsconfig` is `include: ["src"]` and its Rollup
inputs are the two HTML files above. Running `npm run build` in either directory leaves the
other untouched.

## What is shared, and how

- **Colour tokens** — `src/styles.css` carries a byte-identical copy of the app's `@theme`
  block and its `html[data-theme="light"]` overrides. Copied rather than imported, because
  `src/ui/styles/global.css` also contains window rounding, titlebar heights and Paper-PC rules
  that a website has no use for. If the brand shifts, change both.
- **Component shapes** — `src/components/ui.tsx` reproduces the app's primary/secondary pill
  buttons and its `rounded-2xl bg-card/50` section card, so the page and the product read as one
  thing.
- **Icons** — OS marks come from Iconify's `logos` set via `@iconify/react`. Iconify normally
  fetches at runtime and the full set is 7.4 MB, so the four marks actually used are extracted
  into `src/components/brandIcons.tsx` and registered up front — no request, no pop-in.
  `@iconify-json/logos` stays a devDependency as the source of record; regenerate that file from
  it if a mark changes. The handful of UI glyphs are hand-rolled in `src/components/icons.tsx`.
- **Screenshots** — copied into `public/` from `docs/`. Re-copy them when the app's shots are
  refreshed:

  ```bash
  cp ../assets/img/Logo.png public/logo.png
  cp ../docs/zuno-d.PNG public/screenshot-dark.png
  cp ../docs/zuno-l.PNG public/screenshot-light.png
  ```

## Downloads

`src/releases.ts` reads the newest release from the GitHub API at page load and points each
platform button at the matching installer. Asset names carry the version
(`Zuno_1.1.1_x64-setup.exe`), so there is no stable per-file URL to hardcode.

Every button falls back to the releases page — while the request is in flight, if it fails, and
if a release is missing an asset for that platform. A rate-limited or offline visitor still gets
somewhere useful.

The visitor's platform is detected only to emphasise one card. Detection is unreliable and
downloading for another machine is ordinary, so the other three stay fully available.

## Deploying

`base` is `"./"`, so the build works from a subpath — including GitHub Pages project sites,
which serve from `/<repo>/`. Publish `landing/dist` as-is.
