# Cloud Sync (Shared Hosting)

Obsidian plugin for **bidirectional note synchronization** via your own shared hosting account with PHP support.

Keep full control over your data — no third-party cloud services required. If you already have a hosting plan with PHP, you can turn it into a private sync server for Obsidian.

## Features

- **Bidirectional sync** — upload and download changes automatically
- **Conflict detection** — creates a local conflict copy when both devices modify the same file
- **Auto-sync on save** — changed files are synced within 2 seconds (configurable)
- **Manual sync** — trigger sync from the ribbon icon or command palette
- **Multi-device support** — device names for clear conflict identification
- **Works on desktop and mobile** — not limited to desktop only
- **Multilingual UI** — English and Russian

## How it works

The plugin communicates with a lightweight PHP backend installed on your hosting. Files are tracked by SHA-256 hashes and modification timestamps. During sync the plugin:

1. Compares local and remote file hashes
2. Uploads new/changed local files to the server
3. Downloads new/changed remote files to the vault
4. Detects conflicts and creates `*.conflict-<device>-<timestamp>.md` copies
5. Propagates file deletions across devices

## Requirements

- **Obsidian** 1.0.0 or later
- **Shared hosting** with PHP 7.4+ and `mod_rewrite` enabled
- The backend server component: [Obsidian-Cloud-Sync-Server](https://github.com/kogortov/Obsidian-Cloud-Sync-Server)

## Installation

### Server side

1. Download or clone [Obsidian-Cloud-Sync-Server](https://github.com/kogortov/Obsidian-Cloud-Sync-Server)
2. Upload the contents of `public_html` to your hosting (e.g. `https://example.com/` or a subdirectory)
3. Make sure `mod_rewrite` is enabled and `.htaccess` is allowed (`AllowOverride All`)

### Plugin side

#### From Community Plugins (recommended)

1. Open **Settings → Community plugins → Browse**
2. Search for **Cloud Sync (Shared Hosting)**
3. Click **Install**, then **Enable**

#### Manual installation

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/kogortov/Obsidian-Cloud-Sync/releases/latest)
2. Create a folder `<vault>/.obsidian/plugins/cloud-sync-shared-hosting/`
3. Place the downloaded files into that folder
4. Restart Obsidian and enable the plugin in **Settings → Community plugins**

## Configuration

Open **Settings → Cloud Sync (Shared Hosting)** and fill in:

| Setting | Description |
|---------|-------------|
| **Server URL** | The URL where you installed the backend (e.g. `https://example.com`) |
| **Username** | Your account username (created on the server) |
| **Password** | Your account password |
| **Device name** | A label for this device (auto-generated if empty) |
| **Sync on save** | Toggle automatic sync after every file save |
| **Language** | Interface language: English or Russian |

After entering credentials, click **Login**. Once authenticated the plugin stores a session token — you don't need to re-enter the password.

## Commands

| Command | Description |
|---------|-------------|
| **Cloud Sync: Sync now** | Run a full bidirectional sync |
| **Cloud Sync: Login / reconnect** | Re-authenticate with the server |

## Backend

The server component is a standalone PHP application designed to run on any shared hosting plan:

- **No database required** — files are stored directly on disk
- **Minimal PHP dependencies** — works with standard PHP 7.4+
- **Low resource usage** — suitable for cheap shared hosting plans
- **Private** — your notes never leave your own server

Repository: [Obsidian-Cloud-Sync-Server](https://github.com/kogortov/Obsidian-Cloud-Sync-Server)

## Security

- Authentication via username/password with token-based sessions
- All API requests use Bearer token authorization
- HTTPS is strongly recommended for production use

## Development

```bash
cd obsidian-cloud-sync-plugin
npm install
npm run dev    # watch mode
npm run build  # production build
```

## License

[MIT](LICENSE)
