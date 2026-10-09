import * as assert from "assert";
import * as path from "path";
import { readFileSync } from "fs";
import { buildSync } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";

const source = "MEMORY { ram (rw) : ORIGIN = 0x20000000, LENGTH = 4K }\nSECTIONS { .data : { *(.data) } > ram }";
const bundle = buildSync({ entryPoints: [path.resolve("src/webview/main.ts")], bundle: true, write: false, platform: "browser" }).outputFiles[0].text;

describe("Studio browser workflow", function () {
  this.timeout(15000);
  let browser: Browser;
  let page: Page;
  before(async function () {
    const executablePath = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
    browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  });
  after(async () => { if (browser) await browser.close(); });
  beforeEach(async () => {
    page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.evaluate(() => {
      const w = window as unknown as { acquireVsCodeApi: () => unknown; sent: unknown[] };
      w.sent = [];
      w.acquireVsCodeApi = () => ({ postMessage: (m: unknown) => w.sent.push(m) });
    });
    await page.addScriptTag({ content: bundle });
    await update(source);
  });
  afterEach(async () => { await page.close(); });
  async function update(text: string) {
    await page.evaluate((text) => window.dispatchEvent(new MessageEvent("message", { data: { type: "update", text } })), text);
  }
  async function draft(text: string) {
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.getByRole("textbox", { name: "Linker script source" }).fill(text);
    await page.getByRole("textbox", { name: "Linker script source" }).blur();
  }
  async function result(text: string, error?: string) {
    await page.evaluate((data) => window.dispatchEvent(new MessageEvent("message", { data })), { type: "save-result", text, error });
  }
  for (const file of ["examples/xilinx.ld", "examples/mpfs-ddr-loaded-by-boot-loader.ld"]) {
    it(`edits stack/heap sizes in ${file} and undoes without changing vendor text`, async () => {
      const original = readFileSync(file, "utf8");
      await update(original);
      const fields = page.locator(".stack-heap-grid input");
      if (file.includes("mpfs")) assert.strictEqual(await fields.count(), 6);
      assert.ok(await fields.count() > 0);
      await fields.first().fill("12K");
      await fields.first().blur();
      await page.getByRole("button", { name: "Text", exact: true }).click();
      assert.ok((await page.getByRole("textbox", { name: "Linker script source" }).inputValue()).includes("12K"));
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.strictEqual(await page.getByRole("textbox", { name: "Linker script source" }).inputValue(), original);
    });
  }
  it("loads external updates into a clean editor", async () => {
    await update(source.replace("4K", "8K"));
    assert.strictEqual(await page.getByRole("textbox", { name: "Memory region ram length" }).inputValue(), "8K");
    assert.strictEqual(await page.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
  });
  it("updates a focused, clean Text view when the file changes externally", async () => {
    await page.getByRole("button", { name: "Text", exact: true }).click();
    const textarea = page.getByRole("textbox", { name: "Linker script source" });
    await textarea.focus();
    const changed = source.replace("4K", "8K");
    await update(changed);
    assert.strictEqual(await textarea.inputValue(), changed);
  });
  it("commits the focused memory input before Ctrl+S", async () => {
    await page.getByRole("textbox", { name: "Memory region ram length" }).fill("8K");
    await page.keyboard.press("Control+s");
    const sent = await page.evaluate(() => (window as unknown as { sent: { type: string; text?: string }[] }).sent);
    assert.ok(sent.find((m) => m.type === "save")?.text?.includes("8K"));
  });
  it("retains a dirty draft and asks before overwriting external edits", async () => {
    const changed = source.replace("4K", "8K");
    await draft(changed);
    await update(source.replace("4K", "16K"));
    assert.strictEqual(await page.getByRole("textbox", { name: "Linker script source" }).inputValue(), changed);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Save ●", exact: true }).click();
    const sent = await page.evaluate(() => (window as unknown as { sent: { type: string }[] }).sent);
    assert.ok(!sent.some((m) => m.type === "save"));
  });
  it("can discard a conflicting draft and load the current document", async () => {
    await draft(source.replace("4K", "8K"));
    const external = source.replace("4K", "16K");
    await update(external);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Discard draft", exact: true }).click();
    assert.strictEqual(await page.getByRole("textbox", { name: "Linker script source" }).inputValue(), external);
    assert.strictEqual(await page.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
  });
  it("keeps failed saves dirty and waits for acknowledgement", async () => {
    const changed = source.replace("4K", "8K");
    await draft(changed);
    await page.getByRole("button", { name: "Save ●", exact: true }).click();
    await update(changed);
    assert.strictEqual(await page.getByRole("button", { name: "Saving…", exact: true }).isDisabled(), true);
    await result(changed, "Disk is read-only");
    assert.strictEqual(await page.getByRole("button", { name: "Save ●", exact: true }).isEnabled(), true);
    assert.ok(await page.getByText("Disk is read-only", { exact: true }).isVisible());
    await page.getByRole("button", { name: "Save ●", exact: true }).click();
    await result(changed);
    assert.strictEqual(await page.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
  });
  it("preserves edits made while a save is in progress", async () => {
    const changed = source.replace("4K", "8K");
    await draft(changed);
    await page.getByRole("button", { name: "Save ●", exact: true }).click();
    await draft(source.replace("4K", "16K"));
    await result(changed);
    assert.strictEqual(await page.getByRole("button", { name: "Save ●", exact: true }).isEnabled(), true);
  });
  it("edits memory, undoes/redoes, and switches views without losing the draft", async () => {
    const input = page.getByRole("textbox", { name: "Memory region ram length" });
    await input.fill("8K");
    await input.blur();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.strictEqual(await input.inputValue(), "4K");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    assert.strictEqual(await input.inputValue(), "8K");
    await page.getByRole("button", { name: "Text", exact: true }).click();
    assert.ok((await page.getByRole("textbox", { name: "Linker script source" }).inputValue()).includes("8K"));
    await page.getByRole("button", { name: "Studio", exact: true }).click();
    assert.strictEqual(await input.inputValue(), "8K");
  });
});
