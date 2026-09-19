English | [中文](DEVELOPMENT.md)

# Development Notes

For anyone changing this repository. Instructions for first-time use of the product are in [README.md](./README.md).

## Preparation

- Node 20 or higher (it is enough that `node -v` shows it).
- `npm ci` to install dependencies.
- `runtime/` is the runtime environment shipped with the package (Node + Python + ADB) and does not go into the repository. The UI runs without it, but **image slicing will fail** — slicing is executed by `runtime/python/python.exe`. Just copy one over from a release package.

## Development (code changes take effect immediately)

```bash
npm run dev                      # use the in-repo data/ as the library
npm run dev -- --data <folder>      # specify the library directory
npm run dev -- --port 5180       # specify the Vite port (it automatically moves on if the port is taken)
npm run dev -- --no-open         # do not open the browser automatically
```

The command starts two things at once: the **product service** (the library, images, slicing, recognition and sending to the phone all live there) and **Vite** (front-end source and hot reload). The browser connects to Vite, and `/api`, `/media`, `/handoff` are reverse-proxied by Vite to the product service, so:

- After you edit a file in `src/` and save it, the page updates automatically — no rebuild and no manual refresh;
- Every feature in the UI goes through the real service, consistent with the behavior after packaging.

Authentication for the proxy is handled by `tools/dev.mjs` (injects the startup token, rewrites Host, strips the Origin from write requests); the product code needs no changes at all for dev mode.

To stop: press `Ctrl+C` in the terminal.

## Tests

```bash
npm test               # unit tests (algorithms, protocol, storage, geometry)
npm run test:ai        # empty library → recognition (local simulated model) → proofreading → playback, the whole chain
npm run test:release   # portable package acceptance: copy two and really start them, verifying port isolation, upload and slicing, and retention across restart
npm run test:editor    # stability of the editing toolbar at three resolutions
npm run fixtures:mobile  # after changing playback/layout algorithms, regenerate the mobile golden fixtures
```

A few unit tests need the personal score fixtures under `local/fixtures`; without them those cases are explicitly skipped (`skipped`) and the rest run as usual.

## Mobile App

```bash
cd android
./scripts/gradle-local.ps1 :app:testDebugUnitTest :app:assembleDebug
```

- The toolchain (JDK 17 + Android SDK + Gradle) is not in the repository: set `YUEBEIDOU_TOOLING` to point at it, or create a `.tooling` directory junction under `android/` that points at it.
- The debug build's package name is `com.yuebeidou.player.debug`, so it can be installed alongside the release build.
- Release signing: copy `keystore.properties.example` to `keystore.properties` and fill it in, and `assembleRelease` will sign with it; neither that file nor the keystore goes into the repository.

## Packaging

```bash
npm run build
node tools/package.mjs --refresh                     # releases/乐北斗 (empty library, for distribution)
node tools/package.mjs --refresh --with-data <folder>   # releases/乐北斗－自用 (with the specified library)
```

Packaging requires both `runtime/` and the mobile APK (the build output under `android/`) to be present. Run this once before an official release:

```bash
npm run check:publish
```

It lists the files that will be made public, and fails outright when it finds personal content (scores, library, screenshots).

## Directory Conventions

| Directory | Description |
|---|---|
| `src/` `server/` `python/` | front end, local service, bundled Python slicing |
| `tools/` | dev mode, packaging, fixture generation, pre-release checks |
| `tests/` | unit and acceptance tests |
| `android/` | mobile app (receives and plays only, no editing) |
| `local/` | **does not go into the repository**: personal score fixtures, UI regression tests that run only on this machine |
| `data/` `releases/` `runtime/` `qa/` | **does not go into the repository**: runtime data, finished builds, runtime environment, test artifacts |
