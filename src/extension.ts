import * as path from "path";
import * as vscode from "vscode";
import { LinkerScriptEditorProvider } from "./linkerScriptEditorProvider";

/** Returns true if `fileName` should open in Linker Script Studio because of the linkerScript.additionalExtensions setting (the *.ld/*.lds cases are already handled by the static customEditors selector in package.json). */
function matchesAdditionalExtension(fileName: string, patterns: string[]): boolean {
  const base = path.basename(fileName);
  return patterns.some((p) => (p.startsWith(".") ? fileName.endsWith(p) : base === p));
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(LinkerScriptEditorProvider.register(context));

  context.subscriptions.push(
    vscode.commands.registerCommand("linkerScriptStudio.toggleView", () => {
      LinkerScriptEditorProvider.toggleActiveView();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("linkerScriptStudio.openAsText", async () => {
      const uri = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      if (uri instanceof vscode.TabInputCustom) {
        await vscode.commands.executeCommand("vscode.openWith", uri.uri, "default");
      }
    }),
  );

  // linkerScript.additionalExtensions covers project-specific naming (e.g. no
  // extension at all, ".ldS", ".ld.S") that VS Code's static customEditors
  // selector in package.json can't express. We reopen matching documents in
  // Linker Script Studio as soon as they're opened as plain text.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      const patterns = vscode.workspace.getConfiguration("linkerScript", document.uri).get<string[]>("additionalExtensions", []);
      if (patterns.length === 0) return;
      if (!matchesAdditionalExtension(document.fileName, patterns)) return;
      await vscode.commands.executeCommand("vscode.openWith", document.uri, LinkerScriptEditorProvider.viewType);
    }),
  );
}

export function deactivate(): void {
  // No global state to tear down; per-panel listeners are disposed via context.subscriptions and onDidDispose.
}
