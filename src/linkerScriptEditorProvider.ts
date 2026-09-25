import * as vscode from "vscode";
import { parseLinkerScript } from "./core/parser";
import { validate } from "./core/validate";
import { LinkerScript, TextEdit } from "./core/model";
import { applyTextEdits } from "./core/serializer";
import {
  EditError,
  addMemoryRegion,
  deleteMemoryRegion,
  findRegionReferences,
  updateMemoryRegion,
  addOutputSection,
  updateOutputSection,
  deleteOutputSection,
  addSharedMemoryRegion,
} from "./core/edits";
import { HostMessage, ViewMode, WebviewMessage } from "./shared/messages";

interface Session {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  view: ViewMode;
}

/** Custom text editor for .ld/.lds files: renders a Studio (structured) view and a Text view, both backed by the same vscode.TextDocument so save/undo/dirty state work exactly like a normal editor. */
export class LinkerScriptEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "linkerScriptStudio.editor";
  private static readonly sessions = new Set<Session>();

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new LinkerScriptEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(LinkerScriptEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    });
  }

  /** Toggles the Studio/Text view of whichever managed panel is currently active/focused, if any. */
  static toggleActiveView(): void {
    for (const session of LinkerScriptEditorProvider.sessions) {
      if (session.panel.active) {
        session.view = session.view === "studio" ? "text" : "studio";
        postMessage(session.panel, { type: "setView", view: session.view });
        return;
      }
    }
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const config = vscode.workspace.getConfiguration("linkerScript", document.uri);
    const session: Session = {
      document,
      panel,
      view: config.get<ViewMode>("defaultView", "studio"),
    };
    LinkerScriptEditorProvider.sessions.add(session);

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };
    panel.webview.html = getHtml(panel.webview, this.context.extensionUri);

    const postUpdate = () => {
      const text = document.getText();
      const { script, diagnostics } = parseLinkerScript(text);
      const allDiagnostics = script.needsPreprocessor ? diagnostics : [...diagnostics, ...validate(script)];
      postMessage(panel, {
        type: "update",
        text,
        model: script.needsPreprocessor ? null : script,
        diagnostics: allDiagnostics,
      });
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) postUpdate();
    });

    panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      try {
        await this.handleMessage(document, message);
      } catch (e) {
        const msg = e instanceof EditError ? e.message : e instanceof Error ? e.message : String(e);
        postMessage(panel, { type: "editError", message: msg });
      }
    });

    panel.onDidDispose(() => {
      changeSub.dispose();
      LinkerScriptEditorProvider.sessions.delete(session);
    });

    postMessage(panel, { type: "setView", view: session.view });
    postUpdate();
  }

  private async handleMessage(document: vscode.TextDocument, message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        return;
      case "setText":
        await replaceWholeDocument(document, message.text);
        return;
      case "setView":
        for (const s of LinkerScriptEditorProvider.sessions) {
          if (s.document.uri.toString() === document.uri.toString()) s.view = message.view;
        }
        return;
      case "addMemoryRegion":
        await applyCoreEdits(document, (script) => addMemoryRegion(script, message.region));
        return;
      case "updateMemoryRegion":
        await applyCoreEdits(document, (script) => updateMemoryRegion(script, message.name, message.patch));
        return;
      case "deleteMemoryRegion": {
        const { script } = parseLinkerScript(document.getText());
        const refs = findRegionReferences(script, message.name);
        if (refs.length > 0) {
          const choice = await vscode.window.showWarningMessage(
            `Memory region "${message.name}" is referenced by section(s) ${refs.join(", ")}. Delete it anyway?`,
            { modal: true },
            "Delete",
          );
          if (choice !== "Delete") return;
        }
        await applyCoreEdits(document, (s) => deleteMemoryRegion(s, message.name));
        return;
      }
      case "addOutputSection":
        await applyCoreEdits(document, (script) => addOutputSection(script, message.section));
        return;
      case "updateOutputSection":
        await applyCoreEdits(document, (script) => updateOutputSection(script, message.name, message.section));
        return;
      case "addSharedMemoryRegion":
        await applyCoreEdits(document, (script) => addSharedMemoryRegion(script, message.preset));
        return;
      case "deleteOutputSection": {
        const choice = await vscode.window.showWarningMessage(`Delete output section "${message.name}"?`, { modal: true }, "Delete");
        if (choice !== "Delete") return;
        await applyCoreEdits(document, (s) => deleteOutputSection(s, message.name));
        return;
      }
      default:
        return;
    }
  }
}

async function applyCoreEdits(document: vscode.TextDocument, compute: (script: LinkerScript) => TextEdit[]): Promise<void> {
  const text = document.getText();
  const { script } = parseLinkerScript(text);
  const edits = compute(script);
  if (edits.length === 0) return;
  const nextText = applyTextEdits(text, edits);
  await replaceWholeDocument(document, nextText);
}

async function replaceWholeDocument(document: vscode.TextDocument, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
  edit.replace(document.uri, fullRange, text);
  await vscode.workspace.applyEdit(edit);
}

function postMessage(panel: vscode.WebviewPanel, message: HostMessage): void {
  panel.webview.postMessage(message);
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "main.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.css"));
  const nonce = getNonce();
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Linker Script Studio</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

