import { Plugin, Notice } from "obsidian";
import { CloudSyncSettings, DEFAULT_SETTINGS } from "./types";
import { ApiClient } from "./api-client";
import { SyncEngine } from "./sync-engine";
import { CloudSyncSettingTab } from "./settings-tab";

export default class CloudSyncPlugin extends Plugin {
	settings: CloudSyncSettings = DEFAULT_SETTINGS;
	api: ApiClient = new ApiClient("", null);
	syncEngine: SyncEngine = new SyncEngine(null as never, this.api, "");
	private syncIntervalId: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.api = new ApiClient(this.settings.serverUrl, this.settings.authToken);
		this.syncEngine = new SyncEngine(this.app.vault, this.api, this.settings.vaultId);

		this.addSettingTab(new CloudSyncSettingTab(this.app, this));

		this.addCommand({
			id: "cloud-sync-now",
			name: "Sync now",
			callback: () => this.syncEngine.performSync(),
		});

		this.addCommand({
			id: "cloud-sync-full",
			name: "Full sync",
			callback: () => this.syncEngine.performFullSync(),
		});

		// Register file events
		this.registerEvent(this.app.vault.on("modify", (file) => this.syncEngine.onFileChange(file)));
		this.registerEvent(this.app.vault.on("create", (file) => this.syncEngine.onFileCreate(file)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.syncEngine.onFileDelete(file)));
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => this.syncEngine.onFileRename(file, oldPath))
		);

		// Start sync interval if authenticated
		if (this.settings.authToken && this.settings.vaultId) {
			this.startSyncInterval();
		}
	}

	onunload(): void {
		this.stopSyncInterval();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	updateApiClient(): void {
		this.api.setServerUrl(this.settings.serverUrl);
		this.api.setToken(this.settings.authToken);
	}

	async login(): Promise<void> {
		if (!this.settings.serverUrl || !this.settings.username || !this.settings.password) {
			new Notice("Please fill in server URL, username and password");
			return;
		}

		try {
			this.updateApiClient();
			const result = await this.api.login(this.settings.username, this.settings.password);
			if (result.success && result.token) {
				this.settings.authToken = result.token;
				this.api.setToken(result.token);
				await this.saveSettings();
				new Notice("Login successful");
			} else {
				new Notice(`Login failed: ${result.error || "Unknown error"}`);
			}
		} catch (e) {
			new Notice("Login failed: connection error");
			console.error("Cloud Sync login error", e);
		}
	}

	async register(): Promise<void> {
		if (!this.settings.serverUrl || !this.settings.username || !this.settings.password) {
			new Notice("Please fill in server URL, username and password");
			return;
		}

		try {
			this.updateApiClient();
			const result = await this.api.register(this.settings.username, this.settings.password);
			if (result.success && result.token) {
				this.settings.authToken = result.token;
				this.api.setToken(result.token);
				await this.saveSettings();
				new Notice("Registration successful");
			} else {
				new Notice(`Registration failed: ${result.error || "Unknown error"}`);
			}
		} catch (e) {
			new Notice("Registration failed: connection error");
			console.error("Cloud Sync register error", e);
		}
	}

	startSyncInterval(): void {
		this.stopSyncInterval();
		const ms = this.settings.syncIntervalSeconds * 1000;
		this.syncIntervalId = window.setInterval(() => {
			this.syncEngine.performSync();
		}, ms);
		this.registerInterval(this.syncIntervalId);
	}

	stopSyncInterval(): void {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}
	}

	restartSyncInterval(): void {
		if (this.settings.authToken && this.settings.vaultId) {
			this.startSyncInterval();
		}
	}
}
