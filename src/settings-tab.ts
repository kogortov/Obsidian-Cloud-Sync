import {
    App,
    PluginSettingTab,
    Setting,
    requestUrl,
} from 'obsidian';

import type { Lang } from './i18n';
import type CloudSyncPlugin from './main';

export class CloudSyncSettingTab extends PluginSettingTab {
    plugin: CloudSyncPlugin;

    constructor(app: App, plugin: CloudSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        const t = (key: string) => this.plugin.t(key);
        containerEl.empty();

        containerEl.createEl('h2', { text: t('title') });
        containerEl.createEl('p', {
            text: t('desc'),
            cls: 'setting-item-description',
        });

        // ── Language ──────────────────────────────────────────────────────────

        new Setting(containerEl)
            .setName(t('language'))
            .setDesc(t('language.desc'))
            .addDropdown(dd => dd
                .addOption('en', 'English')
                .addOption('ru', 'Русский')
                .setValue(this.plugin.settings.language)
                .onChange(async (value) => {
                    this.plugin.settings.language = value as Lang;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        // ── Connection ────────────────────────────────────────────────────────

        containerEl.createEl('h3', { text: t('connection') });

        new Setting(containerEl)
            .setName(t('serverUrl'))
            .setDesc(t('serverUrl.desc'))
            .addText(text => text
                .setPlaceholder('https://example.com')
                .setValue(this.plugin.settings.serverUrl)
                .onChange(async (value) => {
                    this.plugin.settings.serverUrl = value.replace(/\/+$/, '');
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('username'))
            .addText(text => text
                .setPlaceholder('admin')
                .setValue(this.plugin.settings.username)
                .onChange(async (value) => {
                    this.plugin.settings.username = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(t('password'))
            .addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder('********')
                    .setValue(this.plugin.settings.password)
                    .onChange(async (value) => {
                        this.plugin.settings.password = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName(t('deviceName'))
            .setDesc(t('deviceName.desc'))
            .addText(text => text
                .setPlaceholder('My Laptop')
                .setValue(this.plugin.settings.deviceName)
                .onChange(async (value) => {
                    this.plugin.settings.deviceName = value;
                    await this.plugin.saveSettings();
                }));

        const loginSetting = new Setting(containerEl)
            .setName(t('accountStatus'))
            .setDesc(this.plugin.settings.token
                ? t('loggedIn')
                : t('notLoggedIn'));

        loginSetting.addButton(btn => btn
            .setButtonText(this.plugin.settings.token ? t('reLogin') : t('login'))
            .setCta()
            .onClick(async () => {
                const ok = await this.plugin.doLogin();
                if (ok) {
                    this.display();
                }
            }));

        if (this.plugin.settings.token) {
            loginSetting.addButton(btn => btn
                .setButtonText(t('logout'))
                .onClick(async () => {
                    try {
                        await requestUrl({
                            url: `${this.plugin.settings.serverUrl.replace(/\/+$/, '')}/api/auth/logout`,
                            method: 'POST',
                            headers: { Authorization: `Bearer ${this.plugin.settings.token}` },
                            throw: false,
                        });
                    } catch { /* best-effort server logout */ }
                    this.plugin.settings.token = '';
                    await this.plugin.saveSettings();
                    this.display();
                }));
        }

        // ── Sync behaviour ────────────────────────────────────────────────────

        containerEl.createEl('h3', { text: t('syncBehaviour') });

        new Setting(containerEl)
            .setName(t('syncOnSave'))
            .setDesc(t('syncOnSave.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.syncOnSave)
                .onChange(async (value) => {
                    this.plugin.settings.syncOnSave = value;
                    await this.plugin.saveSettings();
                }));

        // ── Manual sync ───────────────────────────────────────────────────────

        containerEl.createEl('h3', { text: t('manualActions') });

        new Setting(containerEl)
            .setName(t('syncNow'))
            .setDesc(t('syncNow.desc'))
            .addButton(btn => btn
                .setButtonText(t('syncNow'))
                .setCta()
                .onClick(async () => {
                    await this.plugin.syncAll();
                    this.display();
                }));

        if (this.plugin.settings.lastSyncTime) {
            const d = new Date(this.plugin.settings.lastSyncTime);
            containerEl.createEl('p', {
                text: `${t('lastSync')} ${d.toLocaleString()}`,
                cls: 'setting-item-description',
            });
        }
    }
}
