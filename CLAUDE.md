# Repo layout

The app's source lives in `app/`. Read `app/CLAUDE.md` and `app/README.md`
before changing anything, and run every npm command from `app/`.

The repo root is what GitHub Pages serves. Only two files there matter:

```
index.html   the built app (generated, never edit by hand)
sw.js        the service worker (generated, never edit by hand)
```

## Deploying

Pages serves the root of `main`, so deploying means replacing those two files
with a fresh build:

```sh
cd app
npm test
npm run build
cp single/index.html single/sw.js ..
```

Commit the source change and the rebuilt root files together, with the version
in the message (e.g. `v0.49.1`), so the commit list reads as a deployment
history. The site only changes when that commit reaches `main`.

`CHANGELOG.md` at the root is an old history that stops at 0.14.3. The current
release notes are the `CHANGELOG` array in `app/src/SpendingWallet.jsx`.
