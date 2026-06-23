import * as vscode from 'vscode';
import { RokuClient } from './rokuClient';
import { discoverDevices, enrichDevice, DiscoveredDevice } from './discovery';

const CONFIG_SECTION = 'rokuRemote';

export function activate(context: vscode.ExtensionContext): void {
	const provider = new RokuRemoteViewProvider(context);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(RokuRemoteViewProvider.viewType, provider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('rokuRemote.discover', () => provider.discoverAndPick()),
		vscode.commands.registerCommand('rokuRemote.setDeviceIp', () => provider.promptForIp()),
		vscode.commands.registerCommand('rokuRemote.focus', () =>
			vscode.commands.executeCommand('rokuRemote.view.focus')
		)
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(CONFIG_SECTION)) {
				provider.refreshConfig();
			}
		})
	);
}

export function deactivate(): void {
	/* nothing to clean up */
}

interface InboundMessage {
	type: string;
	key?: string;
	appId?: string;
	text?: string;
}

class RokuRemoteViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'rokuRemote.view';

	private view?: vscode.WebviewView;
	private client: RokuClient;

	constructor(private readonly context: vscode.ExtensionContext) {
		const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
		this.client = new RokuClient(
			cfg.get<string>('deviceIp', ''),
			cfg.get<number>('requestTimeoutMs', 4000)
		);
	}

	refreshConfig(): void {
		const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
		this.client.setIp(cfg.get<string>('deviceIp', ''));
		this.client.setTimeout(cfg.get<number>('requestTimeoutMs', 4000));
		this.postState();
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
		};
		webviewView.webview.html = this.getHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage((msg: InboundMessage) => this.handleMessage(msg));

		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				this.postState();
			}
		});

		this.postState();
	}

	private async handleMessage(msg: InboundMessage): Promise<void> {
		try {
			switch (msg.type) {
				case 'ready':
					this.postState();
					break;
				case 'keypress':
					if (msg.key) {
						await this.client.keypress(msg.key);
					}
					break;
				case 'launch':
					if (msg.appId) {
						await this.client.launch(msg.appId);
					}
					break;
				case 'typeText':
					if (msg.text) {
						await this.client.typeText(msg.text);
					}
					break;
				case 'loadApps':
					await this.loadApps();
					break;
				case 'discover':
					await this.discoverAndPick();
					break;
				case 'setIp':
					await this.promptForIp();
					break;
				case 'testConnection':
					await this.testConnection();
					break;
				default:
					break;
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.post({ type: 'error', message });
		}
	}

	private async testConnection(): Promise<void> {
		if (!this.client.hasDevice) {
			this.post({ type: 'connection', connected: false, info: null });
			return;
		}
		try {
			const info = await this.client.queryDeviceInfo();
			this.post({
				type: 'connection',
				connected: true,
				info: {
					name: info['user-device-name'] || info['friendly-device-name'] || 'Roku',
					model: info['model-name'] || info['friendly-model-name'] || '',
					powerMode: info['power-mode'] || ''
				}
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.post({ type: 'connection', connected: false, info: null, message });
		}
	}

	private async loadApps(): Promise<void> {
		if (!this.client.hasDevice) {
			return;
		}
		const apps = await this.client.queryApps();
		const withIcons = await Promise.all(
			apps.slice(0, 60).map(async (app) => ({
				id: app.id,
				name: app.name,
				icon: await this.client.appIconDataUri(app.id)
			}))
		);
		this.post({ type: 'apps', apps: withIcons });
	}

	async discoverAndPick(): Promise<void> {
		const devices = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Searching for Roku devices…' },
			async () => {
				const raw = await discoverDevices(3000);
				return Promise.all(raw.map((d) => enrichDevice(d)));
			}
		);

		if (devices.length === 0) {
			vscode.window.showWarningMessage(
				'No Roku devices found on the network. You can set the IP manually instead.'
			);
			return;
		}

		const pick = await vscode.window.showQuickPick(
			devices.map((d: DiscoveredDevice) => ({
				label: d.name || d.modelName || 'Roku Device',
				description: d.modelName && d.name ? d.modelName : '',
				detail: d.ip,
				device: d
			})),
			{ placeHolder: 'Select a Roku device to control' }
		);

		if (pick) {
			await this.saveIp(pick.device.ip);
		}
	}

	async promptForIp(): Promise<void> {
		const current = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('deviceIp', '');
		const ip = await vscode.window.showInputBox({
			title: 'Roku Device IP Address',
			prompt: 'Enter the IP address of your Roku (Settings > Network > About on the device).',
			value: current,
			validateInput: (value) =>
				/^(\d{1,3}\.){3}\d{1,3}$/.test(value.trim()) ? undefined : 'Enter a valid IPv4 address.'
		});
		if (ip) {
			await this.saveIp(ip.trim());
		}
	}

	private async saveIp(ip: string): Promise<void> {
		await vscode.workspace
			.getConfiguration(CONFIG_SECTION)
			.update('deviceIp', ip, vscode.ConfigurationTarget.Global);
		this.client.setIp(ip);
		this.postState();
		await this.testConnection();
		vscode.window.showInformationMessage(`Roku Remote connected to ${ip}.`);
	}

	private postState(): void {
		const ip = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>('deviceIp', '');
		this.post({ type: 'state', ip });
		if (ip) {
			void this.testConnection();
		}
	}

	private post(message: unknown): void {
		this.view?.webview.postMessage(message);
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const mediaUri = (file: string) =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file));

		const styleUri = mediaUri('main.css');
		const scriptUri = mediaUri('main.js');

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
	<link href="${styleUri}" rel="stylesheet" />
	<title>Roku Remote</title>
</head>
<body>
	<div id="app">
		<header class="status-bar">
			<span id="status-dot" class="dot disconnected"></span>
			<div class="status-text">
				<span id="device-name">No device</span>
				<span id="device-ip" class="muted"></span>
			</div>
			<button id="settings-btn" class="icon-btn" title="Set device / discover">⚙</button>
		</header>

		<div id="no-device" class="no-device hidden">
			<p>No Roku device configured.</p>
			<button id="discover-btn" class="primary-btn">Discover devices</button>
			<button id="setip-btn" class="ghost-btn">Enter IP manually</button>
		</div>

		<main id="remote" class="remote">
			<div class="top-row">
				<button class="rk-btn pwr" data-key="PowerOff" title="Power">⏻</button>
				<button class="rk-btn" data-key="Back" title="Back">↩</button>
				<button class="rk-btn" data-key="Home" title="Home">⌂</button>
			</div>

			<div class="dpad">
				<button class="rk-btn up" data-key="Up" title="Up">▲</button>
				<button class="rk-btn left" data-key="Left" title="Left">◀</button>
				<button class="rk-btn ok" data-key="Select" title="OK">OK</button>
				<button class="rk-btn right" data-key="Right" title="Right">▶</button>
				<button class="rk-btn down" data-key="Down" title="Down">▼</button>
			</div>

			<div class="mid-row">
				<button class="rk-btn" data-key="InstantReplay" title="Instant Replay">⟲</button>
				<button class="rk-btn" data-key="Info" title="Options / Info">＊</button>
			</div>

			<div class="transport">
				<button class="rk-btn" data-key="Rev" title="Rewind">⏪</button>
				<button class="rk-btn" data-key="Play" title="Play / Pause">⏯</button>
				<button class="rk-btn" data-key="Fwd" title="Fast Forward">⏩</button>
			</div>

			<div class="volume">
				<button class="rk-btn" data-key="VolumeMute" title="Mute">🔇</button>
				<button class="rk-btn" data-key="VolumeDown" title="Volume Down">🔉</button>
				<button class="rk-btn" data-key="VolumeUp" title="Volume Up">🔊</button>
			</div>

			<div class="text-entry">
				<input id="text-input" type="text" placeholder="Type & send text to Roku…" />
				<button id="send-text" class="ghost-btn" title="Send text">Send</button>
			</div>

			<section class="apps-section">
				<div class="apps-header">
					<span>Channels</span>
					<button id="refresh-apps" class="ghost-btn small">Load</button>
				</div>
				<div id="apps-grid" class="apps-grid"></div>
			</section>
		</main>

		<div id="toast" class="toast hidden"></div>
	</div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
