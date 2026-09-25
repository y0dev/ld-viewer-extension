/**
 * Studio webview UI. Vanilla DOM (no framework) to keep the bundle small.
 * No vscode/Node imports -- everything here talks to the extension host
 * only through the typed postMessage protocol in src/shared/messages.ts.
 */
import { Diagnostic, LinkerScript, MemoryRegion, OutputSection } from "../core/model";
import { OutputSectionInput } from "../core/serializer";
import { HostMessage, WebviewMessage } from "../shared/messages";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; setState(s: unknown): void; getState(): unknown };
const vscode = acquireVsCodeApi();

function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}

interface State {
  model: LinkerScript | null;
  diagnostics: Diagnostic[];
}

const state: State = { model: null, diagnostics: [] };

// Which sections are expanded in the Section Detail tree. Lives outside
// `state` since it isn't server data -- it's re-derived from the model on
// each update, but must survive across those updates (a diagnostic-only
// change shouldn't collapse everything the user just expanded).
const expandedSections = new Set<string>();

const root = document.getElementById("root")!;

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  if (msg.type === "update") {
    state.model = msg.model;
    state.diagnostics = msg.diagnostics;
    render();
  } else if (msg.type === "editError") {
    showTransientError(msg.message);
  }
});

function showTransientError(message: string): void {
  const banner = el("div", "error-banner", message);
  root.prepend(banner);
  setTimeout(() => banner.remove(), 6000);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(name: string): HTMLElement {
  return el("i", `codicon codicon-${name}`);
}

function iconButton(name: string, label: string, extraClass?: string): HTMLButtonElement {
  const btn = el("button", "icon-btn" + (extraClass ? ` ${extraClass}` : ""));
  btn.append(icon(name));
  btn.append(el("span", "icon-btn-label", label));
  btn.setAttribute("aria-label", label);
  return btn;
}

function render(): void {
  root.replaceChildren();

  const page = el("div", "page");

  const header = el("div", "page-header");
  const headerText = el("div");
  headerText.append(el("h1", "page-title", "Linker Script"));
  headerText.append(
    el(
      "p",
      "page-subtitle",
      "Controls where the sections of an executable are placed in memory. Define memory regions below, then choose which region each section lives in.",
    ),
  );
  header.append(headerText);

  const openAsTextBtn = iconButton("go-to-file", "Open as Text", "toolbar-btn");
  openAsTextBtn.title = "Reopen this file with VS Code's default text editor";
  openAsTextBtn.onclick = () => post({ type: "openAsText" });
  header.append(openAsTextBtn);
  page.append(header);

  if (state.model === null) {
    const notice = el("div", "notice", diagnosticsSummary(state.diagnostics) || "This file could not be parsed as a linker script.");
    page.append(notice);
    root.append(page);
    return;
  }

  page.append(renderStudioView(state.model));

  if (state.diagnostics.length > 0) {
    page.append(renderDiagnostics(state.diagnostics));
  }

  root.append(page);
  root.append(renderStatusBar(state.model, state.diagnostics));
}

function renderStatusBar(model: LinkerScript, diagnostics: Diagnostic[]): HTMLElement {
  const bar = el("div", "status-bar");
  const regionCount = model.memory?.regions.length ?? 0;
  const sectionCount = model.sections?.sections.length ?? 0;
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;

  bar.append(el("span", undefined, `${regionCount} memory region${regionCount === 1 ? "" : "s"}`));
  bar.append(el("span", undefined, `${sectionCount} section${sectionCount === 1 ? "" : "s"}`));

  const statusText = errorCount > 0 ? `${errorCount} error${errorCount === 1 ? "" : "s"}` : warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "no problems";
  const statusSpan = el("span", errorCount > 0 ? "status-error" : warningCount > 0 ? "status-warning" : undefined, statusText);
  bar.append(statusSpan);

  return bar;
}

function diagnosticsSummary(diagnostics: Diagnostic[]): string {
  return diagnostics.map((d) => d.message).join(" ");
}

function renderDiagnostics(diagnostics: Diagnostic[]): HTMLElement {
  const container = el("div", "diagnostics");
  container.append(el("h3", "diagnostics-title", `Diagnostics (${diagnostics.length})`));
  const list = el("ul");
  for (const d of diagnostics) {
    const item = el("li", `diagnostic ${d.severity}`);
    item.append(icon(d.severity === "error" ? "error" : "warning"));
    item.append(el("span", undefined, d.message));
    list.append(item);
  }
  container.append(list);
  return container;
}

function renderStudioView(model: LinkerScript): HTMLElement {
  const wrap = el("div", "studio-view");
  wrap.append(renderSummary(model));
  wrap.append(renderMemorySection(model));
  wrap.append(renderSectionsSection(model));
  return wrap;
}

function renderSummary(model: LinkerScript): HTMLElement {
  const box = el("div", "summary");
  if (model.entry) box.append(el("span", "chip", `ENTRY(${model.entry.symbol})`));
  if (model.outputFormat) box.append(el("span", "chip", `OUTPUT_FORMAT(${model.outputFormat.args.join(", ")})`));
  if (model.outputArch) box.append(el("span", "chip", `OUTPUT_ARCH(${model.outputArch.arch})`));
  for (const inc of model.includes) box.append(el("span", "chip", `INCLUDE "${inc.path}"`));
  return box;
}

function regionRange(model: LinkerScript): { min: number; max: number } | null {
  const regions = model.memory?.regions ?? [];
  const numeric = regions.filter((r) => r.origin.value !== undefined && r.length.value !== undefined);
  if (numeric.length === 0) return null;
  const min = Math.min(...numeric.map((r) => r.origin.value!));
  const max = Math.max(...numeric.map((r) => r.origin.value! + r.length.value!));
  return { min, max: max > min ? max : min + 1 };
}

function formatHex(n: number): string {
  return "0x" + Math.trunc(n).toString(16).toUpperCase().padStart(8, "0");
}

/** "16,384 (16.0 KB)" style human-readable size, mirroring the sibling binary-structure-inspector's Sections view. */
function formatSize(bytes: number): string {
  const count = bytes.toLocaleString();
  if (bytes < 1024) return `${count} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${count} (${value.toFixed(1)} ${units[unitIndex]})`;
}

// Cycled per region so adjacent segments in the memory bar stay visually
// distinguishable. Pulled from VS Code's own charts.* theme colors, which
// keeps the bar legible whether a light, dark, or high-contrast theme is
// active -- rather than fixed hexes chosen against one theme.
const REGION_PALETTE = [
  "var(--vscode-charts-blue, #3794ff)",
  "var(--vscode-charts-green, #89d185)",
  "var(--vscode-charts-purple, #b180d7)",
  "var(--vscode-charts-orange, #d19a66)",
  "var(--vscode-charts-yellow, #cca700)",
  "var(--vscode-charts-red, #f14c4c)",
];

function renderMemorySection(model: LinkerScript): HTMLElement {
  const section = el("div", "section");
  section.append(el("h2", "section-title", "Available Memory Regions"));
  section.append(el("p", "section-subtitle", "Define and edit the memory regions. Each memory region has a name, base address, length, and attribute flags."));

  if (!model.memory) {
    section.append(el("p", "muted", "This script has no MEMORY block."));
    return section;
  }

  const range = regionRange(model);
  if (range) {
    const bar = el("div", "memory-bar");
    let colorIndex = 0;
    for (const r of model.memory.regions) {
      if (r.origin.value === undefined || r.length.value === undefined) continue;
      const seg = el("div", "memory-bar-segment");
      const leftPct = ((r.origin.value - range.min) / (range.max - range.min)) * 100;
      const widthPct = Math.max((r.length.value / (range.max - range.min)) * 100, 0.5);
      seg.style.left = `${leftPct}%`;
      seg.style.width = `${widthPct}%`;
      seg.style.background = REGION_PALETTE[colorIndex % REGION_PALETTE.length];
      colorIndex++;
      seg.title = `${r.name}: ${formatHex(r.origin.value)} + ${formatHex(r.length.value)}`;
      seg.append(el("span", "memory-bar-label", r.name));
      bar.append(seg);
    }
    section.append(bar);
  }

  const table = el("table", "memory-table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const h of ["Name", "Attrs", "Base Address", "Size", "End", ""]) headRow.append(el("th", undefined, h));
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  for (const region of model.memory.regions) {
    tbody.append(renderMemoryRow(region));
  }
  table.append(tbody);
  section.append(table);

  const buttonRow = el("div", "action-row");
  const addBtn = iconButton("add", "Add memory region", "action-btn-primary");
  const addSharedBtn = iconButton("layers", "Add shared memory");
  addBtn.onclick = () => {
    buttonRow.remove();
    section.append(renderMemoryAddForm(section, buttonRow));
  };
  addSharedBtn.onclick = () => {
    buttonRow.remove();
    section.append(renderSharedMemoryAddForm(section, buttonRow, model));
  };
  buttonRow.append(addBtn, addSharedBtn);
  section.append(buttonRow);

  return section;
}

/** Reads all four fields live from the row's own inputs and sends the full row as the patch, keyed by the name the row was rendered with -- safe even if the name field itself was just edited (see main.ts module doc). */
function renderMemoryRow(r: MemoryRegion): HTMLElement {
  const originalName = r.name;
  const row = el("tr", "editable-row");

  const nameInput = el("input", "cell-input mono") as HTMLInputElement;
  nameInput.value = r.name;
  const attrsInput = el("input", "cell-input mono") as HTMLInputElement;
  attrsInput.value = r.attributes;
  attrsInput.placeholder = "rwx";
  const originInput = el("input", "cell-input mono") as HTMLInputElement;
  originInput.value = r.origin.raw;
  const lengthInput = el("input", "cell-input mono") as HTMLInputElement;
  lengthInput.value = r.length.raw;

  const commit = () => {
    post({
      type: "updateMemoryRegion",
      name: originalName,
      patch: { name: nameInput.value.trim(), attributes: attrsInput.value.trim(), origin: originInput.value.trim(), length: lengthInput.value.trim() },
    });
  };
  for (const input of [nameInput, attrsInput, originInput]) {
    input.onchange = commit;
    const cell = el("td");
    cell.append(input);
    row.append(cell);
  }

  lengthInput.onchange = commit;
  const lengthCell = el("td", "size-cell");
  lengthCell.append(lengthInput);
  if (r.length.value !== undefined) lengthCell.append(el("span", "size-hint", formatSize(r.length.value)));
  row.append(lengthCell);

  const endCell = el(
    "td",
    "mono end-cell",
    r.origin.value !== undefined && r.length.value !== undefined ? formatHex(r.origin.value + r.length.value) : "",
  );
  row.append(endCell);

  const actionsCell = el("td", "actions");
  const deleteBtn = iconButton("trash", "Delete", "danger");
  deleteBtn.onclick = () => post({ type: "deleteMemoryRegion", name: originalName });
  actionsCell.append(deleteBtn);
  row.append(actionsCell);

  return row;
}

function renderMemoryAddForm(section: HTMLElement, buttonRow: HTMLElement): HTMLElement {
  const form = el("div", "add-form");
  const nameInput = el("input") as HTMLInputElement;
  nameInput.placeholder = "name";
  const attrsInput = el("input") as HTMLInputElement;
  attrsInput.placeholder = "rwx";
  const originInput = el("input") as HTMLInputElement;
  originInput.placeholder = "ORIGIN (e.g. 0x1000)";
  const lengthInput = el("input") as HTMLInputElement;
  lengthInput.placeholder = "LENGTH (e.g. 0x1000)";

  const saveBtn = el("button", "action-btn action-btn-primary", "Add");
  saveBtn.onclick = () => {
    if (!nameInput.value.trim()) return;
    post({
      type: "addMemoryRegion",
      region: { name: nameInput.value.trim(), attributes: attrsInput.value.trim(), origin: originInput.value.trim() || "0x0", length: lengthInput.value.trim() || "0x0" },
    });
    form.remove();
    section.append(buttonRow);
  };
  const cancelBtn = el("button", "action-btn", "Cancel");
  cancelBtn.onclick = () => {
    form.remove();
    section.append(buttonRow);
  };

  form.append(nameInput, attrsInput, originInput, lengthInput, saveBtn, cancelBtn);
  return form;
}

function renderSharedMemoryAddForm(section: HTMLElement, buttonRow: HTMLElement, model: LinkerScript): HTMLElement {
  const form = el("div", "add-form shared-memory-form");

  const help = el(
    "p",
    "form-help",
    "Reserves a whole region for cross-core use: adds the region plus a (NOLOAD) section with __<name>_start/_end symbols spanning it. No input-section patterns, so nothing gets linked into it.",
  );

  const nameInput = el("input") as HTMLInputElement;
  nameInput.placeholder = "region name";
  nameInput.value = "shared_memory";
  const attrsInput = el("input") as HTMLInputElement;
  attrsInput.placeholder = "rw";
  attrsInput.value = "rw";
  const originInput = el("input") as HTMLInputElement;
  originInput.placeholder = "ORIGIN (e.g. 0x30000000)";
  const lengthInput = el("input") as HTMLInputElement;
  lengthInput.placeholder = "LENGTH (e.g. 0x10000)";
  const sectionNameInput = el("input") as HTMLInputElement;
  sectionNameInput.placeholder = "section name (optional)";

  const fieldsRow = el("div", "add-form-fields");
  fieldsRow.append(nameInput, attrsInput, originInput, lengthInput, sectionNameInput);

  const saveBtn = el("button", "action-btn action-btn-primary", "Add");
  saveBtn.onclick = () => {
    const regionName = nameInput.value.trim();
    if (!regionName) return;
    if (!model.sections) {
      showTransientError("This script has no SECTIONS block, so only the memory region will be added (no reserved section).");
    }
    post({
      type: "addSharedMemoryRegion",
      preset: {
        regionName,
        attributes: attrsInput.value.trim() || "rw",
        origin: originInput.value.trim() || "0x0",
        length: lengthInput.value.trim() || "0x1000",
        sectionName: sectionNameInput.value.trim() || undefined,
      },
    });
    form.remove();
    section.append(buttonRow);
  };
  const cancelBtn = el("button", "action-btn", "Cancel");
  cancelBtn.onclick = () => {
    form.remove();
    section.append(buttonRow);
  };

  const actionsRow = el("div", "add-form-actions");
  actionsRow.append(saveBtn, cancelBtn);

  form.append(help, fieldsRow, actionsRow);
  return form;
}

function sectionToInput(s: OutputSection, overrides: { vmaRegion: string | undefined }): OutputSectionInput {
  return {
    name: s.name,
    address: s.address?.raw,
    body: s.body,
    vmaRegion: overrides.vmaRegion,
    lmaRegion: s.placement.lmaRegion,
    lmaAddress: s.placement.lmaAddress?.raw,
  };
}

function renderSectionRegionMappingTable(model: LinkerScript, sections: OutputSection[]): HTMLElement {
  const wrap = el("div", "mapping-table-wrap");
  wrap.append(el("h3", "subsection-title", "Section to Memory Region Mapping"));
  wrap.append(el("p", "section-subtitle", "A list of linker sections and their associated memory regions."));

  const table = el("table", "mapping-table");
  const thead = el("thead");
  const headRow = el("tr");
  headRow.append(el("th", undefined, "Section"), el("th", undefined, "Memory Region"));
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  const regionNames = model.memory?.regions.map((r) => r.name) ?? [];
  for (const s of sections) {
    const row = el("tr");
    row.append(el("td", "mono", s.name));

    const cell = el("td");
    const select = el("select", "region-select") as HTMLSelectElement;
    const noneOption = el("option", undefined, "(unplaced)") as HTMLOptionElement;
    noneOption.value = "";
    select.append(noneOption);
    for (const name of regionNames) {
      const opt = el("option", undefined, name) as HTMLOptionElement;
      opt.value = name;
      if (name === s.placement.vmaRegion) opt.selected = true;
      select.append(opt);
    }
    if (!s.placement.vmaRegion) noneOption.selected = true;
    select.onchange = () => {
      post({
        type: "updateOutputSection",
        name: s.name,
        section: sectionToInput(s, { vmaRegion: select.value || undefined }),
      });
    };
    cell.append(select);
    row.append(cell);
    tbody.append(row);
  }
  table.append(tbody);
  wrap.append(table);

  return wrap;
}

function renderSectionsSection(model: LinkerScript): HTMLElement {
  const section = el("div", "section");
  section.append(el("h2", "section-title", "Output Sections"));
  section.append(el("p", "section-subtitle", "The sections that make up the linked output, in link order, and where each one is placed."));

  if (!model.sections) {
    section.append(el("p", "muted", "This script has no SECTIONS block."));
    return section;
  }

  section.append(renderSectionRegionMappingTable(model, model.sections.sections));

  const detailHeader = el("div", "detail-header");
  detailHeader.append(el("h3", "subsection-title", "Section Detail"));
  const expandAllBtn = el("button", "action-btn action-btn-small", "Expand all");
  const collapseAllBtn = el("button", "action-btn action-btn-small", "Collapse all");
  expandAllBtn.onclick = () => {
    for (const s of model.sections!.sections) expandedSections.add(s.name);
    render();
  };
  collapseAllBtn.onclick = () => {
    expandedSections.clear();
    render();
  };
  detailHeader.append(expandAllBtn, collapseAllBtn);
  section.append(detailHeader);

  const treeHeader = el("div", "tree-header");
  treeHeader.append(el("span"), el("span", undefined, "Name"), el("span", undefined, "Placement"), el("span"));
  section.append(treeHeader);

  const tree = el("ul", "sections-tree");
  for (const s of model.sections.sections) {
    tree.append(renderSectionNode(s));
  }
  section.append(tree);

  const regionNames = model.memory?.regions.map((r) => r.name) ?? [];
  const addBtn = iconButton("add", "Add section", "action-btn-primary");
  addBtn.onclick = () => section.append(renderSectionAddForm(section, addBtn, regionNames));
  section.append(addBtn);

  return section;
}

function renderSectionAddForm(section: HTMLElement, addBtn: HTMLElement, regionNames: string[]): HTMLElement {
  addBtn.remove();
  const form = el("div", "add-form");
  const nameInput = el("input") as HTMLInputElement;
  nameInput.placeholder = "section name, e.g. .rodata";

  const regionSelect = el("select") as HTMLSelectElement;
  const noneOption = el("option", undefined, "(no region)") as HTMLOptionElement;
  noneOption.value = "";
  regionSelect.append(noneOption);
  for (const name of regionNames) {
    const opt = el("option", undefined, name) as HTMLOptionElement;
    opt.value = name;
    regionSelect.append(opt);
  }

  const saveBtn = el("button", "action-btn action-btn-primary", "Add");
  saveBtn.onclick = () => {
    if (!nameInput.value.trim()) return;
    post({
      type: "addOutputSection",
      section: { name: nameInput.value.trim(), body: [], vmaRegion: regionSelect.value || undefined },
    });
    form.remove();
    section.append(addBtn);
  };
  const cancelBtn = el("button", "action-btn", "Cancel");
  cancelBtn.onclick = () => {
    form.remove();
    section.append(addBtn);
  };

  form.append(nameInput, regionSelect, saveBtn, cancelBtn);
  return form;
}

function renderSectionNode(s: OutputSection): HTMLElement {
  const item = el("li", "section-node");
  const header = el("div", "section-node-header");

  const hasBody = s.body.length > 0;
  const expanded = expandedSections.has(s.name);

  const chevron = el("button", "chevron-btn");
  if (hasBody) chevron.append(icon(expanded ? "chevron-down" : "chevron-right"));
  chevron.disabled = !hasBody;
  chevron.setAttribute("aria-label", expanded ? "Collapse" : "Expand");
  chevron.onclick = () => {
    if (expanded) expandedSections.delete(s.name);
    else expandedSections.add(s.name);
    render();
  };
  header.append(chevron);

  header.append(el("span", "section-name", s.name));

  const placement: string[] = [];
  if (s.placement.vmaRegion) placement.push(`> ${s.placement.vmaRegion}`);
  if (s.placement.lmaRegion) placement.push(`AT> ${s.placement.lmaRegion}`);
  header.append(el("span", "section-placement", placement.join(" ")));

  const deleteBtn = iconButton("trash", "Delete", "danger");
  deleteBtn.onclick = () => post({ type: "deleteOutputSection", name: s.name });
  header.append(deleteBtn);
  item.append(header);

  if (hasBody && expanded) {
    const bodyList = el("ul", "section-body");
    for (const stmt of s.body) {
      let text: string;
      if (stmt.kind === "input-section") {
        text = `${stmt.keep ? "KEEP(" : ""}${stmt.fileGlob}(${stmt.sectionGlobs.join(" ")})${stmt.keep ? ")" : ""}`;
      } else if (stmt.kind === "align") {
        text = stmt.raw;
      } else {
        text = `${stmt.name} ${stmt.operator} ${stmt.value.raw}`;
      }
      bodyList.append(el("li", "section-body-item", text));
    }
    item.append(bodyList);
  }

  return item;
}

post({ type: "ready" });
render();
