/**
 * Typed postMessage protocol between the extension host and the Studio
 * webview. Pure data shapes only -- no vscode or DOM imports -- so this
 * file can be included from both tsconfig.host.json and tsconfig.webview.json.
 */
import { Diagnostic, LinkerScript } from "../core/model";
import { MemoryRegionInput, OutputSectionInput } from "../core/serializer";
import { SharedMemoryRegionPreset } from "../core/edits";

export type ViewMode = "studio" | "text";

export interface HostUpdateMessage {
  type: "update";
  text: string;
  model: LinkerScript | null;
  diagnostics: Diagnostic[];
}

export interface HostSetViewMessage {
  type: "setView";
  view: ViewMode;
}

export interface HostEditErrorMessage {
  type: "editError";
  message: string;
}

export type HostMessage = HostUpdateMessage | HostSetViewMessage | HostEditErrorMessage;

export interface WebviewReadyMessage {
  type: "ready";
}

export interface WebviewSetTextMessage {
  type: "setText";
  text: string;
}

export interface WebviewSetViewMessage {
  type: "setView";
  view: ViewMode;
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
  | WebviewSetTextMessage
  | WebviewSetViewMessage
  | WebviewAddMemoryRegionMessage
  | WebviewUpdateMemoryRegionMessage
  | WebviewDeleteMemoryRegionMessage
  | WebviewAddOutputSectionMessage
  | WebviewUpdateOutputSectionMessage
  | WebviewDeleteOutputSectionMessage
  | WebviewAddSharedMemoryRegionMessage;
