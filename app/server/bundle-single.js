/* Bundle everything into one HTML file.

   The app is hosted on GitHub Pages with no build step at the far end, so the
   whole thing — JS, CSS, manifest — has to arrive as a single file the user
   uploads by hand. Only `index.html` and `sw.js` are deployed. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, "..", "dist");
const OUT = path.join(here, "..", "single");
fs.mkdirSync(OUT, { recursive: true });

let html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");

// inline every script and stylesheet; attribute order varies, so match the tag
const assets = path.join(DIST, "assets");
for (const file of fs.readdirSync(assets)) {
  const body = fs.readFileSync(path.join(assets, file), "utf8");
  if (file.endsWith(".js")) {
    html = html.replace(new RegExp(`<script[^>]*${file}[^>]*>\\s*</script>`, "g"),
      () => `<script type="module">${body}</script>`);
  } else if (file.endsWith(".css")) {
    html = html.replace(new RegExp(`<link[^>]*${file}[^>]*>`, "g"), () => `<style>${body}</style>`);
  }
}

// the manifest becomes a data URL so there is nothing else to upload
const manifest = fs.readFileSync(path.join(DIST, "manifest.webmanifest"), "utf8");
html = html.replace(/<link rel="manifest"[^>]*>/,
  `<link rel="manifest" href="data:application/manifest+json;base64,${Buffer.from(manifest).toString("base64")}" />`);

/* An escape that survives into a string we display renders as a literal
   "\u2014" on the phone. React's own bundled regexes legitimately contain such
   sequences, so only check text that reaches the UI. This has shipped twice. */
const ESCAPE_IN_TEXT = new RegExp(
  String.fromCharCode(92) + String.fromCharCode(92) + "u[0-9a-fA-F]{4}", "g");
const stray = (html.match(/children:"[^"]{0,400}"/g) || []).filter((t) => ESCAPE_IN_TEXT.test(t));
if (stray.length) {
  console.error(`REFUSING TO SHIP: ${stray.length} escape(s) would render as text.`);
  stray.slice(0, 3).forEach((t) => console.error("  " + t.slice(0, 90)));
  process.exit(1);
}

fs.writeFileSync(path.join(OUT, "index.html"), html);

// stamp the real version into the worker at build time
const pkgVer = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")).version;
fs.writeFileSync(path.join(OUT, "sw.js"),
  fs.readFileSync(path.join(DIST, "sw.js"), "utf8").replace("__VERSION__", pkgVer));

console.log(`single/index.html  ${(html.length / 1024).toFixed(0)} KB`);
console.log(`single/sw.js       version ${pkgVer}`);
