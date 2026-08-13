import {
    App,
    PluginSettingTab,
    Setting,
    requestUrl,
} from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';

import type { Lang } from './i18n';
import type CloudSyncPlugin from './main';

export class CloudSyncSettingTab extends PluginSettingTab {
    plugin: CloudSyncPlugin;

    constructor(app: App, plugin: CloudSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    // ── Declarative settings (Obsidian 1.13.0+) ───────────────────────────────
    // Returning definitions here lets Obsidian render the tab and index it for
    // the global settings search. `display()` below is kept only as a fallback
    // for Obsidian versions older than 1.13.0, which ignore this method.

    getSettingDefinitions(): SettingDefinitionItem[] {
        const t = (key: string) => this.plugin.t(key);
        const settings = this.plugin.settings;

        return [
            // ── Intro ─────────────────────────────────────────────────────────
            {
                name: t('title'),
                desc: t('desc'),
            },

            // ── Language ──────────────────────────────────────────────────────
            {
                name: t('language'),
                desc: t('language.desc'),
                control: {
                    type: 'dropdown',
                    key: 'language',
                    options: { en: 'English', ru: 'Русский' },
                },
            },

            // ── Connection ────────────────────────────────────────────────────
            {
                type: 'group',
                heading: t('connection'),
                items: [
                    {
                        name: t('serverUrl'),
                        desc: t('serverUrl.desc'),
                        control: {
                            type: 'text',
                            key: 'serverUrl',
                            placeholder: 'https://example.com',
                        },
                    },
                    {
                        name: t('username'),
                        control: {
                            type: 'text',
                            key: 'username',
                            placeholder: 'Admin',
                        },
                    },
                    {
                        name: t('password'),
                        render: (setting) => {
                            setting.addText(text => {
                                text.inputEl.type = 'password';
                                text.setPlaceholder('********')
                                    .setValue(settings.password)
                                    .onChange(async (value) => {
                                        settings.password = value;
                                        await this.plugin.saveSettings();
                                    });
                            });
                        },
                    },
                    {
                        name: t('deviceName'),
                        desc: t('deviceName.desc'),
                        control: {
                            type: 'text',
                            key: 'deviceName',
                            placeholder: 'My laptop',
                        },
                    },
                    {
                        name: t('accountStatus'),
                        aliases: [t('login'), t('logout')],
                        render: (setting) => {
                            setting.setDesc(settings.token
                                ? t('loggedIn')
                                : t('notLoggedIn'));

                            setting.addButton(btn => btn
                                .setButtonText(settings.token ? t('reLogin') : t('login'))
                                .setCta()
                                .onClick(async () => {
                                    const ok = await this.plugin.doLogin();
                                    if (ok) {
                                        this.update();
                                    }
                                }));

                            if (settings.token) {
                                setting.addButton(btn => btn
                                    .setButtonText(t('logout'))
                                    .onClick(async () => {
                                        await this.logout();
                                        this.update();
                                    }));
                            }
                        },
                    },
                ],
            },

            // ── Sync behaviour ────────────────────────────────────────────────
            {
                type: 'group',
                heading: t('syncBehaviour'),
                items: [
                    {
                        name: t('syncOnSave'),
                        desc: t('syncOnSave.desc'),
                        control: {
                            type: 'toggle',
                            key: 'syncOnSave',
                        },
                    },
                ],
            },

            // ── Manual actions ────────────────────────────────────────────────
            {
                type: 'group',
                heading: t('manualActions'),
                items: [
                    {
                        name: t('syncNow'),
                        aliases: [t('syncNow.desc')],
                        render: (setting) => {
                            setting.setDesc(t('syncNow.desc'));
                            if (settings.lastSyncTime) {
                                const d = new Date(settings.lastSyncTime);
                                setting.descEl.createEl('div', {
                                    text: `${t('lastSync')} ${d.toLocaleString()}`,
                                });
                            }
                            setting.addButton(btn => btn
                                .setButtonText(t('syncNow'))
                                .setCta()
                                .onClick(async () => {
                                    await this.plugin.syncAll();
                                    this.update();
                                }));
                        },
                    },
                ],
            },
        ];
    }

    /** Read a persisted value for a declarative control. */
    getControlValue(key: string): unknown {
        return (this.plugin.settings as unknown as Record<string, unknown>)[key];
    }

    /** Persist a value from a declarative control. */
    async setControlValue(key: string, value: unknown): Promise<void> {
        if (key === 'serverUrl' && typeof value === 'string') {
            value = value.replace(/\/+$/, '');
        }
        (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
        await this.plugin.saveSettings();
        // Changing the language relabels every row, so re-render the whole tab.
        if (key === 'language') {
            this.update();
        }
    }

    private async logout(): Promise<void> {
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
    }

    // ── Imperative fallback (Obsidian < 1.13.0) ───────────────────────────────
    // Obsidian 1.13.0+ renders from getSettingDefinitions() and never calls
    // this. Kept so the tab still renders on the minimum supported app version.

    display(): void {
        const { containerEl } = this;
        const t = (key: string) => this.plugin.t(key);
        containerEl.empty();

        new Setting(containerEl).setName(t('title')).setHeading();
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

        new Setting(containerEl).setName(t('connection')).setHeading();

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
                .setPlaceholder('Admin')
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
                .setPlaceholder('My laptop')
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
                    await this.logout();
                    this.display();
                }));
        }

        // ── Sync behaviour ────────────────────────────────────────────────────

        new Setting(containerEl).setName(t('syncBehaviour')).setHeading();

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

        new Setting(containerEl).setName(t('manualActions')).setHeading();

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
