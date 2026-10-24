// Copies the packaged extension to the web app, which serves it at /downloads/bldt.vsix
// until the extension is on the Marketplace (VSCODE_EXTENSION_PUBLISHED=true).
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("../web/public/downloads", { recursive: true });
copyFileSync("bldt.vsix", "../web/public/downloads/bldt.vsix");
console.log("copied bldt.vsix to apps/web/public/downloads/");
