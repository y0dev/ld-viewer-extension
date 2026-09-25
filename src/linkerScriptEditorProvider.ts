import * as vscode from "vscode";
import { HostMessage, WebviewMessage } from "./shared/messages";

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
      localResourceRoots: [this.context.extensionUri],
    };
    panel.webview.html = getHtml(panel.webview, this.context.extensionUri);

    const postUpdate = () => {
      postMessage(panel, { type: "update", text: document.getText() });
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) postUpdate();
    });

    panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      if (message.type === "ready") {
        postUpdate();
        return;
      }
      if (message.type === "save") {
        await replaceWholeDocument(document, message.text);
        await document.save();
        return;
      }
    });

    panel.onDidDispose(() => {
      changeSub.dispose();
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
  await vscode.workspace.applyEdit(edit);
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
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}
