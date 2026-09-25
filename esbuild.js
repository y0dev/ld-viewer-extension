// Two bundles, matching build targets to what's actually available in each
// context: the extension host runs in Node inside VS Code, the webview runs
// in a sandboxed browser iframe.
const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const commonOptions = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

async function build() {
  const hostCtx = await esbuild.context({
    ...commonOptions,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node18",
    external: ["vscode"],
  });

  const webviewCtx = await esbuild.context({
    ...commonOptions,
    entryPoints: ["src/webview/main.ts"],
    outfile: "dist/webview/main.js",
    platform: "browser",
    format: "iife",
    target: "es2020",
  });

  if (watch) {
    await Promise.all([hostCtx.watch(), webviewCtx.watch()]);
  } else {
    await hostCtx.rebuild();
    await webviewCtx.rebuild();
    await hostCtx.dispose();
    await webviewCtx.dispose();
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
