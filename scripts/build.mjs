import esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outFile = path.join(rootDir, "dist", "youtube-history-search.user.js");

const USER_SCRIPT_BANNER = `// ==UserScript==
// @name         YouTube Watch History Search
// @namespace    https://github.com/local/youtube-history-search
// @version      0.1.0
// @description  Local searchable YouTube watch history with multi-account tracking, Takeout import, and JSON backup/merge.
// @match        https://www.youtube.com/*
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.getValues
// @grant        GM.setValues
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==
`;

mkdirSync(path.dirname(outFile), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(rootDir, "src", "userscript", "main.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "firefox115",
  outfile: outFile,
  banner: {
    js: USER_SCRIPT_BANNER
  }
});

console.log(`Built ${outFile}`);
