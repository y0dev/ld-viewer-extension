/**
 * Typed postMessage protocol between the extension host and the Studio
 * webview. Pure data shapes only -- no vscode or DOM imports -- so this
 * file can be included from both tsconfig.host.json and tsconfig.webview.json.
 *
 * There is only one in-webview view (Studio). "Text" is not a second
 * render mode of this webview -- clicking it asks the host to reopen the
 * same document with VS Code's own default text editor (a different editor
 * type for the same vscode.TextDocument), so it gets real syntax
 * highlighting, line numbers, find/replace, undo/redo, everything native.
 * Edits made there flow back into Studio the normal way (onDidChangeTextDocument),
 * since both views share the same underlying document.
 */
import { Diagnostic, LinkerScript } from "../core/model";
import { MemoryRegionInput, OutputSectionInput } from "../core/serializer";
import { SharedMemoryRegionPreset } from "../core/edits";

export interface HostUpdateMessage {
  type: "update";
  text: string;
  model: LinkerScript | null;
  diagnostics: Diagnostic[];
}

export interface HostEditErrorMessage {
  type: "editError";
  message: string;
}

export type HostMessage = HostUpdateMessage | HostEditErrorMessage;

export interface WebviewReadyMessage {
  type: "ready";
}

export interface WebviewOpenAsTextMessage {
  type: "openAsText";
}

export interface WebviewAddMemoryRegionMessage {
  type: "addMemoryRegion";
  region: MemoryRegionInput;
}

export interface WebviewUpdateMemoryRegionMessage {
  type: "updateMemoryRegion";
  name: string;
  patch: Partial<MemoryRegionInput>;
}

export interface WebviewDeleteMemoryRegionMessage {
  type: "deleteMemoryRegion";
  name: string;
}

export interface WebviewAddOutputSectionMessage {
  type: "addOutputSection";
  section: OutputSectionInput;
}

export interface WebviewDeleteOutputSectionMessage {
  type: "deleteOutputSection";
  name: string;
}

export interface WebviewUpdateOutputSectionMessage {
  type: "updateOutputSection";
  name: string;
  section: OutputSectionInput;
}

export interface WebviewAddSharedMemoryRegionMessage {
  type: "addSharedMemoryRegion";
  preset: SharedMemoryRegionPreset;
}

export type WebviewMessage =
  | WebviewReadyMessage
  | WebviewOpenAsTextMessage
  | WebviewAddMemoryRegionMessage
  | WebviewUpdateMemoryRegionMessage
  | WebviewDeleteMemoryRegionMessage
  | WebviewAddOutputSectionMessage
  | WebviewUpdateOutputSectionMessage
  | WebviewDeleteOutputSectionMessage
  | WebviewAddSharedMemoryRegionMessage;
