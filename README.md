# Roku Remote for VS Code

Control your Roku device without leaving your editor. This extension adds a fully
interactive remote-control UI to the VS Code sidebar, talking to your Roku over its
built-in **External Control Protocol (ECP)** — no cloud, no account, all on your local
network.

![Roku Remote](media/icon.png)

## Features

- 📺 **Full remote UI** in the Activity Bar — D-pad, OK, Back, Home, transport
  (play/pause, rewind, fast-forward), volume, mute and power.
- 🔍 **Automatic device discovery** over SSDP — find Rokus on your network with one click.
- ✋ **Manual IP entry** as a fallback.
- ⌨️ **Send text** to on-screen keyboards (search boxes, logins, etc.).
- 🟢 **Live connection status** with device name & model.
- 🎬 **Channel launcher** — load installed channels and launch them by clicking the icon.

## Getting started

1. Install/run the extension (see *Development* below to run from source).
2. Click the **Roku Remote** icon in the Activity Bar.
3. Click **Discover devices** (or the ⚙ button) to find your Roku automatically,
   or choose **Enter IP manually** and type your Roku's IP address.
   - Find the IP on the device under **Settings → Network → About**.
4. Use the remote!

> Your Roku and your computer must be on the same local network. "Fast TV start"
> / network standby must be enabled on the Roku for the **Power** button to wake it.

## Settings

| Setting | Description | Default |
| --- | --- | --- |
| `rokuRemote.deviceIp` | IP address of the Roku to control. | `""` |
| `rokuRemote.requestTimeoutMs` | Timeout (ms) for ECP requests. | `4000` |

## Commands

- **Roku Remote: Discover Devices**
- **Roku Remote: Set Device IP Address**
- **Roku Remote: Open Remote**

## How it works

Roku exposes a small HTTP API on port `8060`:

- `POST /keypress/<Key>` — send a button press (e.g. `Home`, `Select`, `VolumeUp`).
- `POST /keypress/Lit_<char>` — type a literal character.
- `POST /launch/<appId>` — launch a channel.
- `GET /query/apps`, `GET /query/device-info`, `GET /query/icon/<id>` — read state.
- SSDP `M-SEARCH` with `ST: roku:ecp` — discover devices.

This extension wraps those endpoints; everything stays on your LAN.

## Development

```bash
npm install
npm run compile      # or: npm run watch
```

Then press <kbd>F5</kbd> in VS Code to launch an **Extension Development Host**
with the extension loaded.

To package a `.vsix`:

```bash
npm install -g @vscode/vsce
vsce package
```

## License

MIT
