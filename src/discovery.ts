import * as dgram from 'dgram';
import * as http from 'http';
import { URL } from 'url';

export interface DiscoveredDevice {
	ip: string;
	location: string;
	usn: string;
	name?: string;
	modelName?: string;
}

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;

/**
 * Discover Roku devices on the local network using SSDP (the same mechanism
 * the official Roku app uses). Sends an M-SEARCH for `roku:ecp` and collects
 * the responses for the given duration.
 */
export function discoverDevices(durationMs = 3000): Promise<DiscoveredDevice[]> {
	return new Promise((resolve) => {
		const found = new Map<string, DiscoveredDevice>();
		let socket: dgram.Socket;
		try {
			socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
		} catch {
			resolve([]);
			return;
		}

		const message = Buffer.from(
			'M-SEARCH * HTTP/1.1\r\n' +
				`HOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\n` +
				'MAN: "ssdp:discover"\r\n' +
				'ST: roku:ecp\r\n' +
				'MX: 3\r\n' +
				'\r\n'
		);

		const finish = () => {
			try {
				socket.close();
			} catch {
				/* already closed */
			}
			resolve(Array.from(found.values()));
		};

		socket.on('error', () => finish());

		socket.on('message', (msg) => {
			const text = msg.toString('utf8');
			const location = headerValue(text, 'LOCATION');
			const usn = headerValue(text, 'USN');
			if (!location) {
				return;
			}
			let ip = '';
			try {
				ip = new URL(location).hostname;
			} catch {
				return;
			}
			if (!found.has(ip)) {
				found.set(ip, { ip, location, usn: usn || ip });
			}
		});

		socket.bind(() => {
			try {
				socket.setBroadcast(true);
			} catch {
				/* ignore */
			}
			socket.send(message, 0, message.length, SSDP_PORT, SSDP_ADDRESS, (err) => {
				if (err) {
					finish();
				}
			});
		});

		setTimeout(finish, durationMs);
	});
}

/** Enrich discovered devices with friendly names from /query/device-info. */
export async function enrichDevice(device: DiscoveredDevice, timeoutMs = 3000): Promise<DiscoveredDevice> {
	try {
		const body = await httpGet(`http://${device.ip}:8060/query/device-info`, timeoutMs);
		const name = matchTag(body, 'user-device-name') || matchTag(body, 'friendly-device-name');
		const modelName = matchTag(body, 'model-name') || matchTag(body, 'friendly-model-name');
		return { ...device, name: name || device.name, modelName: modelName || device.modelName };
	} catch {
		return device;
	}
}

function httpGet(url: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const req = http.request(
			{
				method: 'GET',
				hostname: parsed.hostname,
				port: parsed.port || 8060,
				path: parsed.pathname,
				timeout: timeoutMs
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (c) => chunks.push(c as Buffer));
				res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
			}
		);
		req.on('timeout', () => req.destroy(new Error('timeout')));
		req.on('error', reject);
		req.end();
	});
}

function headerValue(message: string, header: string): string | undefined {
	const regex = new RegExp(`^${header}:\\s*(.+)$`, 'im');
	const match = regex.exec(message);
	return match ? match[1].trim() : undefined;
}

function matchTag(xml: string, tag: string): string | undefined {
	const match = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(xml);
	return match ? match[1].trim() : undefined;
}
