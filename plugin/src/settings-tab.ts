import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type CloudSyncPlugin from "./main";

export class CloudSyncSettingTab extends PluginSettingTab {
	plugin: CloudSyncPlugin;

	constructor(app: App, plugin: CloudSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Cloud Sync Settings" });

		new Setting(containerEl)
			.setName("Server URL")
			.setDesc("The address of your sync server (e.g. https://example.com)")
			.addText((text) =>
				text
					.setPlaceholder("https://your-server.com")
					.setValue(this.plugin.settings.serverUrl)
					.onChange(async (value) => {
						this.plugin.settings.serverUrl = value.replace(/\/+$/, "");
						await this.plugin.saveSettings();
						this.plugin.updateApiClient();
					})
			);

		new Setting(containerEl)
			.setName("Username")
			.setDesc("Your account username")
			.addText((text) =>
				text
					.setPlaceholder("username")
					.setValue(this.plugin.settings.username)
					.onChange(async (value) => {
						this.plugin.settings.username = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Password")
			.setDesc("Your account password")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("password")
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Login")
			.setDesc("Authenticate with the server")
			.addButton((btn) =>
				btn.setButtonText("Login").onClick(async () => {
					await this.plugin.login();
					this.display();
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Register").onClick(async () => {
					await this.plugin.register();
					this.display();
				})
			);

		if (this.plugin.settings.authToken) {
			containerEl.createEl("p", {
				text: "✓ Authenticated",
				cls: "cloud-sync-status-ok",
			});

			new Setting(containerEl)
				.setName("Vault")
				.setDesc("Select a vault to sync or create a new one")
				.addDropdown(async (dropdown) => {
					dropdown.addOption("", "-- Select vault --");

					try {
						const result = await this.plugin.api.listVaults();
						if (result.success) {
							for (const vault of result.vaults) {
								dropdown.addOption(vault.id, vault.name);
							}
						}
					} catch (e) {
						console.error("Failed to load vaults", e);
					}

					dropdown.setValue(this.plugin.settings.vaultId);
					dropdown.onChange(async (value) => {
						this.plugin.settings.vaultId = value;
						await this.plugin.saveSettings();
						this.plugin.syncEngine.setVaultId(value);
					});
				})
				.addButton((btn) =>
					btn.setButtonText("Create New").onClick(async () => {
						const name = prompt("Enter vault name:");
						if (!name) return;
						try {
							const result = await this.plugin.api.createVault(name);
							if (result.success && result.vault_id) {
								this.plugin.settings.vaultId = result.vault_id;
								await this.plugin.saveSettings();
								this.plugin.syncEngine.setVaultId(result.vault_id);
								new Notice(`Vault "${name}" created`);
								this.display();
							} else {
								new Notice(`Error: ${result.error}`);
							}
						} catch (e) {
							new Notice("Failed to create vault");
						}
					})
				);

			new Setting(containerEl)
				.setName("Sync interval")
				.setDesc("How often to check for changes (seconds)")
				.addText((text) =>
					text
						.setValue(String(this.plugin.settings.syncIntervalSeconds))
						.onChange(async (value) => {
							const num = parseInt(value, 10);
							if (!isNaN(num) && num >= 1) {
								this.plugin.settings.syncIntervalSeconds = num;
								await this.plugin.saveSettings();
								this.plugin.restartSyncInterval();
							}
						})
				);

			new Setting(containerEl)
				.setName("Full sync")
				.setDesc("Force a complete sync of all files")
				.addButton((btn) =>
					btn.setButtonText("Sync Now").onClick(async () => {
						await this.plugin.syncEngine.performFullSync();
					})
				);
		}
	}
}
