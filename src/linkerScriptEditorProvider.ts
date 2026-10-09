import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { HostMessage } from "./shared/messages";

interface Session {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
}

/**
 * Custom text editor for .ld/.lds files. All parsing/editing happens
 * locally in the webview (it bundles src/core, which has zero vscode/Node
 * imports) against its own draft buffer -- Studio/Text toggle, undo/redo,
 * and dirty state are in-webview concerns. This provider is just a thin
 * sync layer: it tells the webview when the document changes outside of it
 * (postUpdate), and writes the webview's draft back on an explicit Save.
 */
export class LinkerScriptEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "linkerScriptStudio.editor";
  private static readonly sessions = new Set<Session>();

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new LinkerScriptEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(LinkerScriptEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    });
  }

  /** Reopens the document behind whichever managed Studio panel is currently active, with VS Code's default text editor. Available as an explicit command for anyone who wants a real separate tab instead of the in-webview Text toggle. */
  static async openActiveAsText(): Promise<void> {
    for (const session of LinkerScriptEditorProvider.sessions) {
      if (session.panel.active) {
        await vscode.commands.executeCommand("vscode.openWith", session.document.uri, "default", session.panel.viewColumn);
        return;
      }
    }
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const session: Session = { document, panel };
    LinkerScriptEditorProvider.sessions.add(session);

    panel.webview.options = {
      enableScripts: true,
      // Must cover every directory a webview resource is served from --
      // "dist" for the bundle, "media" for the stylesheet and codicon font.
      // Too narrow a root doesn't error, it silently blocks the resource.
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist"), vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    panel.webview.html = getHtml(panel.webview, this.context.extensionUri);

    const postUpdate = () => {
      postMessage(panel, { type: "update", text: document.getText() });
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) postUpdate();
    });

    let saving = false;
    const messageSub = panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!message || typeof message !== "object" || !("type" in message)) return;
      if (message.type === "ready") {
        postUpdate();
        return;
      }
      if (message.type === "save" && "text" in message && typeof message.text === "string" &&
          "baseText" in message && typeof message.baseText === "string") {
        const text = message.text;
        if (saving) {
          postMessage(panel, { type: "save-result", text, error: "A save is already in progress." });
          return;
        }
        saving = true;
        try {
          if (document.getText() !== message.baseText && document.getText() !== text) throw new Error("The document changed. Review its latest content before saving again.");
          await replaceWholeDocument(document, text);
          if (!await document.save()) throw new Error("VS Code could not save the file. Your draft is still unsaved.");
          if (document.getText() !== text) throw new Error("The document changed while saving. Your draft was kept.");
          postMessage(panel, { type: "save-result", text });
        } catch (error) {
          postMessage(panel, { type: "save-result", text, error: error instanceof Error ? error.message : String(error) });
          if (document.getText() !== text) postUpdate();
        } finally {
          saving = false;
        }
      }
    });

    panel.onDidDispose(() => {
      changeSub.dispose();
      messageSub.dispose();
      LinkerScriptEditorProvider.sessions.delete(session);
    });

    postUpdate();
  }
}

async function replaceWholeDocument(document: vscode.TextDocument, text: string): Promise<void> {
  if (document.getText() === text) return;
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
  edit.replace(document.uri, fullRange, text);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error("VS Code rejected the document edit.");
}

function postMessage(panel: vscode.WebviewPanel, message: HostMessage): void {
  panel.webview.postMessage(message);
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "main.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.css"));
  const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "codicon", "codicon.css"));
  const nonce = getNonce();
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${codiconUri}" />
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
  return randomBytes(24).toString("hex");
}
