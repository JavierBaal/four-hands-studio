// Builds the app: main (ESM), preload (CJS, required by the sandbox), window, synth worklet,
// and the S0 sound test. `--harness` also builds the window for a plain browser with test songs.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "src");
const out = path.join(here, "dist");
const harness = process.argv.includes("--harness");
fs.rmSync(out, { recursive: true, force: true });

const common = { bundle: true, logLevel: "warning", sourcemap: true, legalComments: "linked" };
const browser = { ...common, platform: "browser", format: "iife", target: "chrome130" };
const css = { ...common, loader: { ".woff2": "file", ".woff": "file" }, assetNames: "fonts/[name]-[hash]" };

async function windowBundle(dir) {
  fs.mkdirSync(dir, { recursive: true });
  await Promise.all([
    build({ ...browser, entryPoints: [path.join(src, "renderer", "main.tsx")], outfile: path.join(dir, "app.js"), jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, minify: true }),
    build({ ...css, entryPoints: [path.join(src, "renderer", "styles.css")], outfile: path.join(dir, "app.css") }),
    build({ ...browser, entryPoints: [path.join(src, "worklet", "synth-worklet.ts")], outfile: path.join(dir, "worklet.js") }),
  ]);
  fs.copyFileSync(path.join(src, "renderer", "index.html"), path.join(dir, "index.html"));
}

await Promise.all([
  build({ ...common, entryPoints: [path.join(src, "main", "main.ts")], outfile: path.join(out, "main.mjs"), platform: "node", format: "esm", target: "node22", external: ["electron"], banner: { js: "import { createRequire as __fhCreateRequire } from 'node:module'; const require = __fhCreateRequire(import.meta.url);" } }),
  // F2.4: the MP3 on a thread of its own. LAME (LGPL-3.0) is not in it: it is loaded from dist/lame.
  build({ ...common, entryPoints: [path.join(src, "main", "export", "mp3-worker.ts")], outfile: path.join(out, "mp3-worker.mjs"), platform: "node", format: "esm", target: "node22" }),
  build({ ...common, entryPoints: [path.join(src, "main", "preload.ts")], outfile: path.join(out, "preload.cjs"), platform: "node", format: "cjs", target: "node22", external: ["electron"] }),
  windowBundle(path.join(out, "renderer")),
  // Blind listening of SoundFonts (Ayuda > Escucha a ciegas de sonidos).
  (async () => {
    const dir = path.join(out, "escucha");
    fs.mkdirSync(dir, { recursive: true });
    await Promise.all([
      build({ ...browser, entryPoints: [path.join(src, "escucha", "app.ts")], outfile: path.join(dir, "app.js"), loader: { ".mid": "binary" } }),
      build({ ...css, entryPoints: [path.join(src, "escucha", "app.css")], outfile: path.join(dir, "app.css") }),
      build({ ...browser, entryPoints: [path.join(src, "worklet", "synth-worklet.ts")], outfile: path.join(dir, "worklet.js") }),
    ]);
    fs.copyFileSync(path.join(src, "escucha", "index.html"), path.join(dir, "index.html"));
  })(),
  // S0: the sound and latency test, kept as a diagnostic (Ayuda > Prueba de sonido y latencia).
  (async () => {
    const dir = path.join(out, "s0");
    fs.mkdirSync(dir, { recursive: true });
    await Promise.all([
      build({ ...browser, entryPoints: [path.join(src, "s0", "app.ts")], outfile: path.join(dir, "app.js") }),
      build({ ...css, entryPoints: [path.join(src, "s0", "app.css")], outfile: path.join(dir, "app.css") }),
      build({ ...browser, entryPoints: [path.join(src, "worklet", "synth-worklet.ts")], outfile: path.join(dir, "worklet.js") }),
    ]);
    fs.copyFileSync(path.join(src, "s0", "index.html"), path.join(dir, "index.html"));
  })(),
]);

// The built-in skills: every folder of the repo's skills/ with a SKILL.md.
const skillsSrc = path.join(here, "..", "..", "skills");
for (const entry of fs.readdirSync(skillsSrc, { withFileTypes: true })) {
  if (entry.isDirectory() && fs.existsSync(path.join(skillsSrc, entry.name, "SKILL.md"))) {
    fs.cpSync(path.join(skillsSrc, entry.name), path.join(out, "skills", entry.name), { recursive: true });
  }
}

// LAME for the MP3 export (F2.4): its own file, unmodified, with its licence, so it can be replaced
// (LGPL-3.0, third-party/lamejs/README.txt). Never bundled into the app.
const lame = path.join(out, "lame");
fs.mkdirSync(lame, { recursive: true });
fs.copyFileSync(path.join(here, "..", "..", "node_modules", "@breezystack", "lamejs", "dist", "lamejs.js"), path.join(lame, "lamejs.mjs"));
fs.copyFileSync(path.join(here, "..", "..", "node_modules", "@breezystack", "lamejs", "LICENSE"), path.join(lame, "LICENSE"));
for (const f of fs.readdirSync(path.join(here, "third-party", "lamejs"))) fs.copyFileSync(path.join(here, "third-party", "lamejs", f), path.join(lame, f));

// The demo song: what the app opens the first time, and Help > Open the demo song (src/main/demo.ts).
fs.copyFileSync(path.join(here, "demo", "Invasion.fourhands"), path.join(out, "Invasion.fourhands"));

if (harness) {
  const dir = path.join(out, "harness");
  await windowBundle(dir);
  fs.copyFileSync(path.join(here, "..", "core", "test-data", "Dilatacion.mid"), path.join(dir, "Dilatacion.mid"));
  fs.copyFileSync(path.join(here, "test-fixtures", "boceto-dilatacion.json"), path.join(dir, "boceto-dilatacion.json"));
}
console.log("Four Hands built in", path.relative(process.cwd(), out) || out);
