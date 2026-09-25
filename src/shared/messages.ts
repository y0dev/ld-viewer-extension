/**
 * Typed postMessage protocol between the extension host and the Studio
 * webview. Pure data shapes only -- no vscode or DOM imports -- so this
 * file can be included from both tsconfig.host.json and tsconfig.webview.json.
 *
 * The protocol is intentionally thin: the webview bundles src/core (it has
 * zero vscode/Node imports, so it's safe in a browser context) and does all
 * parsing/editing locally against its own draft text buffer -- add/update/
 * delete, undo/redo, and the Studio/Text toggle are all in-webview state.
 * The host's only jobs are (1) telling the webview when the underlying
 * document changed outside of it, and (2) writing the webview's draft back
 * to the document and disk on an explicit Save.
 */

export interface HostUpdateMessage {
  type: "update";
  /** The vscode.TextDocument's current text. */
  text: string;
}

export type HostMessage = HostUpdateMessage;

export interface WebviewReadyMessage {
  type: "ready";
}

export interface WebviewSaveMessage {
  type: "save";
  text: string;
}

export type WebviewMessage = WebviewReadyMessage | WebviewSaveMessage;
