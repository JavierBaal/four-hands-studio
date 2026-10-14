// Builds the bridge into a single file and packs it as a Claude Desktop extension (.mcpb).
// Output: packages/bridge/dist/fourhands-mcp-<version>.mcpb
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));
const out = path.join(here, "dist", "pkg");
fs.rmSync(path.join(here, "dist"), { recursive: true, force: true });
fs.mkdirSync(path.join(out, "server"), { recursive: true });

await build({
  entryPoints: [path.join(here, "src", "bridge.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: path.join(out, "server", "index.mjs"),
  banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
  define: { __BRIDGE_VERSION__: JSON.stringify(pkg.version) },
  logLevel: "warning",
});

// The manifest lists the same tools and prompts as the code, from the shared definitions.
const { TOOLS, PROMPTS } = await import("@fourhands/mcp-tools");
const manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.template.json"), "utf8"));
manifest.version = pkg.version;
manifest.tools = TOOLS.map((t) => ({ name: t.name, description: t.title }));
manifest.prompts = PROMPTS.map((p) => ({
  name: p.name,
  description: p.description,
  arguments: Object.keys(p.argsSchema),
  text: p.render(Object.fromEntries(Object.keys(p.argsSchema).map((k) => [k, `\${arguments.${k}}`]))),
}));
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
fs.copyFileSync(path.join(here, "assets", "icon.png"), path.join(out, "icon.png"));

// The mcpb CLI runs with this same Node, without a shell: on Windows, going through cmd.exe broke
// paths with spaces ("H:\\SALA_CREATIVA\\Four Hands Studio\\…", 14/10/2026).
const mcpbDir = [path.join(here, "node_modules"), path.join(here, "..", "..", "node_modules")]
  .map((d) => path.join(d, "@anthropic-ai", "mcpb"))
  .find((d) => fs.existsSync(path.join(d, "package.json")));
if (!mcpbDir) throw new Error("@anthropic-ai/mcpb is not installed: run npm install");
const mcpbBin = JSON.parse(fs.readFileSync(path.join(mcpbDir, "package.json"), "utf8")).bin;
const cli = path.join(mcpbDir, typeof mcpbBin === "string" ? mcpbBin : mcpbBin.mcpb);
const target = path.join(here, "dist", `fourhands-mcp-${pkg.version}.mcpb`);
execFileSync(process.execPath, [cli, "validate", path.join(out, "manifest.json")], { stdio: "inherit" });
execFileSync(process.execPath, [cli, "pack", out, target], { stdio: "inherit" });
console.log(`\nBridge packed: ${target}`);
