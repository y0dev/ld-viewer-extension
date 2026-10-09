import * as assert from "assert";
import * as path from "path";
import * as vm from "vm";
import { buildSync } from "esbuild";
import { randomBytes } from "crypto";

const bundle = buildSync({ entryPoints: [path.resolve("src/linkerScriptEditorProvider.ts")], bundle: true, write: false, platform: "node", format: "cjs", external: ["vscode"] }).outputFiles[0].text;

describe("extension host save protocol", () => {
  let receive: (m: unknown) => Promise<void>;
  let text: string;
  let applySuccess: boolean;
  let saveSuccess: boolean;
  let saves: number;
  let messages: { type: string; text?: string; error?: string }[];
  let options: { localResourceRoots: string[] };
  let html: string;
  beforeEach(async () => {
    text = "original";
    applySuccess = saveSuccess = true;
    saves = 0;
    messages = [];
    const disposable = { dispose() {} };
    const vscode = {
      Uri: { joinPath: (...parts: string[]) => parts.join("/") },
      Range: class {},
      WorkspaceEdit: class { replacement = ""; replace(_uri: unknown, _range: unknown, next: string) { this.replacement = next; } },
      workspace: {
        onDidChangeTextDocument: () => disposable,
        applyEdit: async (edit: { replacement: string }) => { if (applySuccess) text = edit.replacement; return applySuccess; },
      },
    };
    const exports: { LinkerScriptEditorProvider?: new (context: unknown) => { resolveCustomTextEditor(d: unknown, p: unknown): Promise<void> } } = {};
    const module = { exports };
    vm.runInNewContext(bundle, { exports, module, require: (name: string) => {
      if (name === "vscode") return vscode;
      if (name === "crypto") return { randomBytes };
      throw new Error(`Unexpected dependency: ${name}`);
    } });
    const panel = { webview: {
      options: {}, html: "", cspSource: "test-resource:",
      asWebviewUri: (uri: string) => uri,
      postMessage: (m: typeof messages[number]) => messages.push(m),
      onDidReceiveMessage: (cb: typeof receive) => { receive = cb; return disposable; },
    }, onDidDispose: () => disposable };
    const document = { uri: { toString: () => "file:///script.ld" }, getText: () => text,
      positionAt: (offset: number) => offset, save: async () => { saves++; return saveSuccess; } };
    const provider = new module.exports.LinkerScriptEditorProvider!({ extensionUri: "/extension" });
    await provider.resolveCustomTextEditor(document, panel);
    options = panel.webview.options as typeof options;
    html = panel.webview.html;
  });
  it("ignores malformed messages without changing the document", async () => {
    for (const m of [null, "save", {}, { type: "save", text: 42 }, { type: "save", text: "bad" }]) await receive(m);
    assert.strictEqual(text, "original");
    assert.strictEqual(saves, 0);
  });
  it("acknowledges a successful document edit and disk save", async () => {
    await receive({ type: "save", text: "draft", baseText: "original" });
    assert.strictEqual(text, "draft");
    assert.strictEqual(saves, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(messages[messages.length - 1])), { type: "save-result", text: "draft" });
  });
  it("rejects stale drafts without overwriting external changes", async () => {
    text = "external";
    await receive({ type: "save", text: "draft", baseText: "original" });
    assert.strictEqual(text, "external");
    assert.strictEqual(saves, 0);
    assert.ok(messages.find((m) => m.type === "save-result")!.error);
  });
  it("does not save after VS Code rejects the edit", async () => {
    applySuccess = false;
    await receive({ type: "save", text: "draft", baseText: "original" });
    assert.strictEqual(text, "original");
    assert.strictEqual(saves, 0);
    assert.ok(messages.find((m) => m.type === "save-result")!.error);
  });
  it("reports disk-save failure instead of acknowledging success", async () => {
    saveSuccess = false;
    await receive({ type: "save", text: "draft", baseText: "original" });
    assert.ok(messages.find((m) => m.type === "save-result")!.error);
  });
  it("retries a failed disk save without treating the in-memory edit as saved", async () => {
    saveSuccess = false;
    await receive({ type: "save", text: "draft", baseText: "original" });
    assert.strictEqual(messages.filter((m) => m.type === "update").length, 1);
    saveSuccess = true;
    await receive({ type: "save", text: "draft", baseText: "original" });
    assert.strictEqual(messages[messages.length - 1].error, undefined);
    assert.strictEqual(saves, 2);
  });
  it("limits webview resources and preserves restrictive CSP", () => {
    assert.deepStrictEqual(Array.from(options.localResourceRoots), ["/extension/dist", "/extension/media"]);
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(/script-src 'nonce-[0-9a-f]{48}'/.test(html));
    assert.ok(!html.includes("unsafe-inline"));
  });
});
