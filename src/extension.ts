import * as path from "path";
import * as vscode from "vscode";
import { LinkerScriptEditorProvider } from "./linkerScriptEditorProvider";

const STATIC_EXTENSIONS = [".ld", ".lds"];

/** Returns true if `fileName` should open in Linker Script Studio: the static *.ld/*.lds selector, or the configurable linkerScript.additionalExtensions (project-specific naming a static package.json selector can't express -- no extension at all, ".ldS", ".ld.S", etc). */
function matchesLinkerScriptFile(fileName: string, additionalPatterns: string[]): boolean {
  const base = path.basename(fileName);
  if (STATIC_EXTENSIONS.some((ext) => fileName.endsWith(ext))) return true;
  return additionalPatterns.some((p) => (p.startsWith(".") ? fileName.endsWith(p) : base === p));
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(LinkerScriptEditorProvider.register(context));

  context.subscriptions.push(
    vscode.commands.registerCommand("linkerScriptStudio.openAsText", async () => {
      await LinkerScriptEditorProvider.openActiveAsText();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("linkerScriptStudio.openAsStudio", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const patterns = vscode.workspace.getConfiguration("linkerScript", editor.document.uri).get<string[]>("additionalExtensions", []);
      if (!matchesLinkerScriptFile(editor.document.fileName, patterns)) return;
      await vscode.commands.executeCommand("vscode.openWith", editor.document.uri, LinkerScriptEditorProvider.viewType, editor.viewColumn);
    }),
  );

  // linkerScript.additionalExtensions covers project-specific naming that
  // VS Code's static customEditors selector in package.json can't express.
  // We reopen matching documents in Linker Script Studio as soon as they're
  // opened as plain text.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      const patterns = vscode.workspace.getConfiguration("linkerScript", document.uri).get<string[]>("additionalExtensions", []);
      if (patterns.length === 0) return;
      if (STATIC_EXTENSIONS.some((ext) => document.fileName.endsWith(ext))) return; // already handled by the static selector
      if (!matchesLinkerScriptFile(document.fileName, patterns)) return;
      await vscode.commands.executeCommand("vscode.openWith", document.uri, LinkerScriptEditorProvider.viewType);
    }),
  );
}

export function deactivate(): void {
  // No global state to tear down; per-panel listeners are disposed via context.subscriptions and onDidDispose.
}
