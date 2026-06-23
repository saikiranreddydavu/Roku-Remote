(function () {
	const vscode = acquireVsCodeApi();

	const statusDot = document.getElementById('status-dot');
	const deviceName = document.getElementById('device-name');
	const deviceIp = document.getElementById('device-ip');
	const noDevice = document.getElementById('no-device');
	const remote = document.getElementById('remote');
	const appsGrid = document.getElementById('apps-grid');
	const textInput = document.getElementById('text-input');
	const toast = document.getElementById('toast');

	let toastTimer;

	function send(message) {
		vscode.postMessage(message);
	}

	function showToast(text, isError) {
		toast.textContent = text;
		toast.classList.remove('hidden');
		toast.classList.toggle('error', !!isError);
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toast.classList.add('hidden'), 2200);
	}

	// Remote buttons
	document.querySelectorAll('.rk-btn[data-key]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const key = btn.getAttribute('data-key');
			send({ type: 'keypress', key });
			btn.classList.add('pressed');
			setTimeout(() => btn.classList.remove('pressed'), 150);
		});
	});

	// Settings / discovery
	document.getElementById('settings-btn').addEventListener('click', () => send({ type: 'discover' }));
	document.getElementById('discover-btn').addEventListener('click', () => send({ type: 'discover' }));
	document.getElementById('setip-btn').addEventListener('click', () => send({ type: 'setIp' }));

	// Text entry
	document.getElementById('send-text').addEventListener('click', sendText);
	textInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			sendText();
		}
	});
	function sendText() {
		const text = textInput.value;
		if (text) {
			send({ type: 'typeText', text });
			textInput.value = '';
			showToast('Text sent');
		}
	}

	// Apps
	document.getElementById('refresh-apps').addEventListener('click', () => {
		appsGrid.innerHTML = '<div class="muted small">Loading channels…</div>';
		send({ type: 'loadApps' });
	});

	function renderApps(apps) {
		appsGrid.innerHTML = '';
		if (!apps || apps.length === 0) {
			appsGrid.innerHTML = '<div class="muted small">No channels found.</div>';
			return;
		}
		apps.forEach((app) => {
			const tile = document.createElement('button');
			tile.className = 'app-tile';
			tile.title = app.name;
			if (app.icon) {
				const img = document.createElement('img');
				img.src = app.icon;
				img.alt = app.name;
				tile.appendChild(img);
			} else {
				const ph = document.createElement('div');
				ph.className = 'app-placeholder';
				ph.textContent = app.name.slice(0, 2).toUpperCase();
				tile.appendChild(ph);
			}
			const label = document.createElement('span');
			label.textContent = app.name;
			tile.appendChild(label);
			tile.addEventListener('click', () => {
				send({ type: 'launch', appId: app.id });
				showToast('Launching ' + app.name);
			});
			appsGrid.appendChild(tile);
		});
	}

	function setConnected(connected, info) {
		statusDot.classList.toggle('connected', connected);
		statusDot.classList.toggle('disconnected', !connected);
		if (connected && info) {
			deviceName.textContent = info.name || 'Roku';
		} else if (deviceIp.textContent) {
			deviceName.textContent = 'Connecting…';
		}
	}

	function applyState(ip) {
		if (ip) {
			deviceIp.textContent = ip;
			noDevice.classList.add('hidden');
			remote.classList.remove('hidden');
		} else {
			deviceIp.textContent = '';
			deviceName.textContent = 'No device';
			noDevice.classList.remove('hidden');
			remote.classList.add('hidden');
			setConnected(false, null);
		}
	}

	window.addEventListener('message', (event) => {
		const msg = event.data;
		switch (msg.type) {
			case 'state':
				applyState(msg.ip);
				break;
			case 'connection':
				setConnected(msg.connected, msg.info);
				if (!msg.connected && msg.message) {
					showToast(msg.message, true);
				}
				break;
			case 'apps':
				renderApps(msg.apps);
				break;
			case 'error':
				showToast(msg.message, true);
				break;
			default:
				break;
		}
	});

	send({ type: 'ready' });
})();
