/**
 * Studio webview UI. Vanilla DOM (no framework) to keep the bundle small.
 * No vscode/Node imports -- everything here talks to the extension host
 * only through the typed postMessage protocol in src/shared/messages.ts.
 */
import { Diagnostic, LinkerScript, MemoryRegion, OutputSection } from "../core/model";
import { OutputSectionInput } from "../core/serializer";
import { HostMessage, ViewMode, WebviewMessage } from "../shared/messages";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; setState(s: unknown): void; getState(): unknown };
const vscode = acquireVsCodeApi();

function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}

interface State {
  text: string;
  model: LinkerScript | null;
  diagnostics: Diagnostic[];
  view: ViewMode;
}

const state: State = { text: "", model: null, diagnostics: [], view: "studio" };
let textareaFocused = false;

const root = document.getElementById("root")!;

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  if (msg.type === "update") {
    state.text = msg.text;
    state.model = msg.model;
    state.diagnostics = msg.diagnostics;
    render();
  } else if (msg.type === "setView") {
    state.view = msg.view;
    render();
  } else if (msg.type === "editError") {
    showTransientError(msg.message);
  }
});

function showTransientError(message: string): void {
  const banner = document.createElement("div");
  banner.className = "error-banner";
  banner.textContent = message;
  root.prepend(banner);
  setTimeout(() => banner.remove(), 6000);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function render(): void {
  // While the Text view's textarea has focus, skip re-rendering entirely --
  // render() rebuilds the DOM from scratch, which would otherwise blow away
  // in-progress typing on every host update. The textarea's onblur handler
  // re-renders once the user is done.
  if (textareaFocused) return;
  root.replaceChildren();

  const tabs = el("div", "tabs");
  const studioTab = el("button", "tab" + (state.view === "studio" ? " active" : ""), "Studio");
  const textTab = el("button", "tab" + (state.view === "text" ? " active" : ""), "Text");
  studioTab.disabled = state.model === null;
  studioTab.onclick = () => setView("studio");
  textTab.onclick = () => setView("text");
  tabs.append(studioTab, textTab);
  root.append(tabs);

  if (state.model === null) {
    const notice = el("div", "notice", diagnosticsSummary(state.diagnostics) || "This file could not be parsed as a linker script.");
    root.append(notice);
    root.append(renderTextView());
    return;
  }

  if (state.view === "studio") {
    root.append(renderStudioView(state.model));
  } else {
    root.append(renderTextView());
  }

  if (state.diagnostics.length > 0) {
    root.append(renderDiagnostics(state.diagnostics));
  }
}

function setView(view: ViewMode): void {
  state.view = view;
  post({ type: "setView", view });
  render();
}

function diagnosticsSummary(diagnostics: Diagnostic[]): string {
  return diagnostics.map((d) => d.message).join(" ");
}

function renderDiagnostics(diagnostics: Diagnostic[]): HTMLElement {
  const container = el("div", "diagnostics");
  container.append(el("h3", undefined, `Diagnostics (${diagnostics.length})`));
  const list = el("ul");
  for (const d of diagnostics) {
    const item = el("li", `diagnostic ${d.severity}`, `${d.severity === "error" ? "⛔" : "⚠️"} ${d.message}`);
    list.append(item);
  }
  container.append(list);
  return container;
}

function renderTextView(): HTMLElement {
  const wrap = el("div", "text-view");
  const textarea = el("textarea", "text-editor") as HTMLTextAreaElement;
  textarea.value = state.text;
  textarea.spellcheck = false;
  textarea.onfocus = () => {
    textareaFocused = true;
  };
  textarea.onblur = () => {
    textareaFocused = false;
    if (textarea.value !== state.text) {
      post({ type: "setText", text: textarea.value });
    }
    render();
  };
  wrap.append(textarea);
  return wrap;
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

function renderMemorySection(model: LinkerScript): HTMLElement {
  const section = el("div", "section");
  section.append(el("h3", undefined, "Memory Regions"));

  if (!model.memory) {
    section.append(el("p", "muted", "This script has no MEMORY block."));
    return section;
  }

  const range = regionRange(model);
  if (range) {
    const bar = el("div", "memory-bar");
    for (const r of model.memory.regions) {
      if (r.origin.value === undefined || r.length.value === undefined) continue;
      const seg = el("div", "memory-bar-segment");
      const leftPct = ((r.origin.value - range.min) / (range.max - range.min)) * 100;
      const widthPct = Math.max((r.length.value / (range.max - range.min)) * 100, 0.5);
      seg.style.left = `${leftPct}%`;
      seg.style.width = `${widthPct}%`;
      seg.title = `${r.name}: ${formatHex(r.origin.value)} + ${formatHex(r.length.value)}`;
      seg.append(el("span", "memory-bar-label", r.name));
      bar.append(seg);
    }
    section.append(bar);
  }

  const table = el("table", "memory-table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const h of ["Name", "Attrs", "Origin", "Length", "End", ""]) headRow.append(el("th", undefined, h));
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  for (const region of model.memory.regions) {
    tbody.append(renderMemoryRow(region));
  }
  table.append(tbody);
  section.append(table);

  const buttonRow = el("div", "add-button-row");
  const addBtn = el("button", "add-button", "+ Add region");
  const addSharedBtn = el("button", "add-button", "+ Add shared memory");
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

function renderMemoryRow(r: MemoryRegion): HTMLElement {
  const row = el("tr");
  const nameCell = el("td", undefined, r.name);
  const attrsCell = el("td", undefined, r.attributes);
  const originCell = el("td", "mono", r.origin.value !== undefined ? formatHex(r.origin.value) : r.origin.raw);
  const lengthCell = el("td", "mono", r.length.value !== undefined ? formatHex(r.length.value) : r.length.raw);
  const endCell = el(
    "td",
    "mono",
    r.origin.value !== undefined && r.length.value !== undefined ? formatHex(r.origin.value + r.length.value) : "",
  );
  const actionsCell = el("td", "actions");

  const editBtn = el("button", "icon-button", "Edit");
  editBtn.onclick = () => {
    row.replaceWith(renderMemoryEditRow(r, row));
  };
  const deleteBtn = el("button", "icon-button danger", "Delete");
  deleteBtn.onclick = () => post({ type: "deleteMemoryRegion", name: r.name });

  actionsCell.append(editBtn, deleteBtn);
  row.append(nameCell, attrsCell, originCell, lengthCell, endCell, actionsCell);
  return row;
}

function renderMemoryEditRow(r: MemoryRegion, original: HTMLElement): HTMLElement {
  const row = el("tr", "editing");
  const nameInput = el("input") as HTMLInputElement;
  nameInput.value = r.name;
  const attrsInput = el("input") as HTMLInputElement;
  attrsInput.value = r.attributes;
  const originInput = el("input") as HTMLInputElement;
  originInput.value = r.origin.raw;
  const lengthInput = el("input") as HTMLInputElement;
  lengthInput.value = r.length.raw;

  for (const input of [nameInput, attrsInput, originInput, lengthInput]) {
    const cell = el("td");
    cell.append(input);
    row.append(cell);
  }

  const actionsCell = el("td", "actions");
  const saveBtn = el("button", "icon-button primary", "Save");
  saveBtn.onclick = () => {
    post({
      type: "updateMemoryRegion",
      name: r.name,
      patch: { name: nameInput.value, attributes: attrsInput.value, origin: originInput.value, length: lengthInput.value },
    });
  };
  const cancelBtn = el("button", "icon-button", "Cancel");
  cancelBtn.onclick = () => row.replaceWith(original);
  actionsCell.append(saveBtn, cancelBtn);
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

  const saveBtn = el("button", "icon-button primary", "Add");
  saveBtn.onclick = () => {
    if (!nameInput.value.trim()) return;
    post({
      type: "addMemoryRegion",
      region: { name: nameInput.value.trim(), attributes: attrsInput.value.trim(), origin: originInput.value.trim() || "0x0", length: lengthInput.value.trim() || "0x0" },
    });
    form.remove();
    section.append(buttonRow);
  };
  const cancelBtn = el("button", "icon-button", "Cancel");
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

  const saveBtn = el("button", "icon-button primary", "Add");
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
  const cancelBtn = el("button", "icon-button", "Cancel");
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
  wrap.append(el("h4", "mapping-title", "Section to Memory Region Mapping"));
  wrap.append(el("p", "form-help", "A list of linker sections and their associated memory regions."));

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
  section.append(el("h3", undefined, "Output Sections"));

  if (!model.sections) {
    section.append(el("p", "muted", "This script has no SECTIONS block."));
    return section;
  }

  section.append(renderSectionRegionMappingTable(model, model.sections.sections));

  const tree = el("ul", "sections-tree");
  for (const s of model.sections.sections) {
    tree.append(renderSectionNode(s));
  }
  section.append(tree);

  const regionNames = model.memory?.regions.map((r) => r.name) ?? [];
  const addBtn = el("button", "add-button", "+ Add section");
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

  const saveBtn = el("button", "icon-button primary", "Add");
  saveBtn.onclick = () => {
    if (!nameInput.value.trim()) return;
    post({
      type: "addOutputSection",
      section: { name: nameInput.value.trim(), body: [], vmaRegion: regionSelect.value || undefined },
    });
    form.remove();
    section.append(addBtn);
  };
  const cancelBtn = el("button", "icon-button", "Cancel");
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
  const placement: string[] = [];
  if (s.placement.vmaRegion) placement.push(`> ${s.placement.vmaRegion}`);
  if (s.placement.lmaRegion) placement.push(`AT> ${s.placement.lmaRegion}`);
  header.append(el("span", "section-name", s.name), el("span", "section-placement", placement.join(" ")));

  const deleteBtn = el("button", "icon-button danger", "Delete");
  deleteBtn.onclick = () => post({ type: "deleteOutputSection", name: s.name });
  header.append(deleteBtn);
  item.append(header);

  if (s.body.length > 0) {
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
