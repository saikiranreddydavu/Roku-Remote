import * as http from 'http';
import { URL } from 'url';

export interface RokuApp {
	id: string;
	type: string;
	subtype: string;
	version: string;
	name: string;
}

export interface RokuDeviceInfo {
	[key: string]: string;
}

/**
 * Minimal HTTP client for the Roku External Control Protocol (ECP).
 * ECP is a simple HTTP interface exposed by every Roku device on port 8060.
 */
export class RokuClient {
	constructor(private ip: string, private timeoutMs = 4000) {}

	setIp(ip: string): void {
		this.ip = ip;
	}

	setTimeout(timeoutMs: number): void {
		this.timeoutMs = timeoutMs;
	}

	get hasDevice(): boolean {
		return !!this.ip;
	}

	private baseUrl(): string {
		return `http://${this.ip}:8060`;
	}

	private request(method: 'GET' | 'POST', path: string): Promise<{ status: number; body: string }> {
		return new Promise((resolve, reject) => {
			if (!this.ip) {
				reject(new Error('No Roku device IP configured.'));
				return;
			}
			let url: URL;
			try {
				url = new URL(this.baseUrl() + path);
			} catch (err) {
				reject(err);
				return;
			}
			const req = http.request(
				{
					method,
					hostname: url.hostname,
					port: url.port || 8060,
					path: url.pathname + url.search,
					timeout: this.timeoutMs
				},
				(res) => {
					const chunks: Buffer[] = [];
					res.on('data', (c) => chunks.push(c as Buffer));
					res.on('end', () => {
						resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') });
					});
				}
			);
			req.on('timeout', () => {
				req.destroy(new Error(`Request to Roku at ${this.ip} timed out after ${this.timeoutMs}ms.`));
			});
			req.on('error', (err) => reject(err));
			req.end();
		});
	}

	/** Send a remote keypress (e.g. Home, Up, Select, Play, VolumeUp). */
	async keypress(key: string): Promise<void> {
		const res = await this.request('POST', `/keypress/${encodeURIComponent(key)}`);
		if (res.status >= 400) {
			throw new Error(`Roku rejected keypress "${key}" (HTTP ${res.status}).`);
		}
	}

	/** Press and immediately release is the default; keydown/keyup allow holds. */
	async keydown(key: string): Promise<void> {
		await this.request('POST', `/keydown/${encodeURIComponent(key)}`);
	}

	async keyup(key: string): Promise<void> {
		await this.request('POST', `/keyup/${encodeURIComponent(key)}`);
	}

	/** Type a single literal character into the Roku on-screen keyboard. */
	async typeChar(ch: string): Promise<void> {
		await this.request('POST', `/keypress/Lit_${encodeURIComponent(ch)}`);
	}

	/** Type a whole string, one character at a time. */
	async typeText(text: string): Promise<void> {
		for (const ch of text) {
			await this.typeChar(ch);
		}
	}

	/** Launch an installed channel/app by its app id. */
	async launch(appId: string): Promise<void> {
		const res = await this.request('POST', `/launch/${encodeURIComponent(appId)}`);
		if (res.status >= 400) {
			throw new Error(`Failed to launch app ${appId} (HTTP ${res.status}).`);
		}
	}

	/** Return the list of installed channels/apps. */
	async queryApps(): Promise<RokuApp[]> {
		const res = await this.request('GET', '/query/apps');
		return parseApps(res.body);
	}

	/** Return device-info as a flat key/value map. */
	async queryDeviceInfo(): Promise<RokuDeviceInfo> {
		const res = await this.request('GET', '/query/device-info');
		return parseDeviceInfo(res.body);
	}

	/** Fetch the PNG icon bytes for an app, returned as a data URI. */
	async appIconDataUri(appId: string): Promise<string | undefined> {
		try {
			const url = new URL(this.baseUrl() + `/query/icon/${encodeURIComponent(appId)}`);
			const result = await new Promise<{ status: number; contentType: string; buffer: Buffer }>((resolve, reject) => {
				const req = http.request(
					{
						method: 'GET',
						hostname: url.hostname,
						port: url.port || 8060,
						path: url.pathname,
						timeout: this.timeoutMs
					},
					(res) => {
						const chunks: Buffer[] = [];
						res.on('data', (c) => chunks.push(c as Buffer));
						res.on('end', () =>
							resolve({
								status: res.statusCode || 0,
								contentType: String(res.headers['content-type'] || 'image/png'),
								buffer: Buffer.concat(chunks)
							})
						);
					}
				);
				req.on('timeout', () => req.destroy(new Error('icon request timed out')));
				req.on('error', reject);
				req.end();
			});
			if (result.status >= 400 || result.buffer.length === 0) {
				return undefined;
			}
			return `data:${result.contentType};base64,${result.buffer.toString('base64')}`;
		} catch {
			return undefined;
		}
	}
}

/** Tiny, dependency-free XML extraction for the small ECP payloads. */
export function parseApps(xml: string): RokuApp[] {
	const apps: RokuApp[] = [];
	const regex = /<app\s+id="([^"]*)"(?:\s+type="([^"]*)")?(?:\s+subtype="([^"]*)")?(?:\s+version="([^"]*)")?\s*>([^<]*)<\/app>/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(xml)) !== null) {
		apps.push({
			id: match[1],
			type: match[2] || '',
			subtype: match[3] || '',
			version: match[4] || '',
			name: decodeEntities(match[5].trim())
		});
	}
	return apps;
}

export function parseDeviceInfo(xml: string): RokuDeviceInfo {
	const info: RokuDeviceInfo = {};
	const regex = /<([a-zA-Z0-9-]+)>([^<]*)<\/[a-zA-Z0-9-]+>/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(xml)) !== null) {
		info[match[1]] = decodeEntities(match[2].trim());
	}
	return info;
}

function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}
