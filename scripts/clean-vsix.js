// Removes any stale .vsix packages from the project root before a fresh
// `vsce package` run, so the root never accumulates multiple old builds.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
for (const entry of fs.readdirSync(root)) {
  if (entry.endsWith(".vsix")) {
    fs.rmSync(path.join(root, entry));
    console.log(`Removed stale package: ${entry}`);
  }
}
