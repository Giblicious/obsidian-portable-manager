import { build } from "esbuild";
await build({ entryPoints: ["src/main.js"], bundle: true, outfile: "main.js", platform: "node", format: "cjs", target: "node18", external: ["obsidian", "electron"], loader: { ".ps1": "text" }, legalComments: "none" });
