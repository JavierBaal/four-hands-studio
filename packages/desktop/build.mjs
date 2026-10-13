// Builds the S0 app: main (ESM), preload (CJS, required by the sandbox), window and worklet bundles.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "src");
const out = path.join(here, "dist");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "renderer"), { recursive: true });

const common = { bundle: true, logLevel: "warning", sourcemap: true, legalComments: "linked" };

await Promise.all([
  build({ ...common, entryPoints: [path.join(src, "main", "main.ts")], outfile: path.join(out, "main.mjs"), platform: "node", format: "esm", target: "node22", external: ["electron"] }),
  build({ ...common, entryPoints: [path.join(src, "main", "preload.ts")], outfile: path.join(out, "preload.cjs"), platform: "node", format: "cjs", target: "node22", external: ["electron"] }),
  build({ ...common, entryPoints: [path.join(src, "renderer", "app.ts")], outfile: path.join(out, "renderer", "app.js"), platform: "browser", format: "iife", target: "chrome130" }),
  build({ ...common, entryPoints: [path.join(src, "renderer", "app.css")], outfile: path.join(out, "renderer", "app.css"), loader: { ".woff2": "file", ".woff": "file" }, assetNames: "fonts/[name]-[hash]" }),
  build({ ...common, entryPoints: [path.join(src, "worklet", "synth-worklet.ts")], outfile: path.join(out, "renderer", "worklet.js"), platform: "browser", format: "iife", target: "chrome130" }),
]);
fs.copyFileSync(path.join(src, "renderer", "index.html"), path.join(out, "renderer", "index.html"));
console.log("S0 built in", path.relative(process.cwd(), out) || out);
