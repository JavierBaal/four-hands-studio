// Empaqueta la app de prueba en un solo archivo (dist/app-prueba.mjs) que se abre con Node,
// sin instalar nada en el ordenador de quien prueba. Uso: npm run build:prueba
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(here, "app.mjs")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: path.join(here, "dist", "app-prueba.mjs"),
  loader: { ".html": "text" },
  banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
  logLevel: "warning",
});
console.log(`App de prueba empaquetada: ${path.join(here, "dist", "app-prueba.mjs")}`);
