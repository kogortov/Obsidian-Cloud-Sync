import {
    Notice,
    Plugin,
    TFile,
    TFolder,
    requestUrl,
} from 'obsidian';

import { i18n } from './i18n';
import {
    CloudSyncSettings,
    ServerFile,
    SyncDiff,
    EMPTY_DIR_HASH,
    DEFAULT_SETTINGS,
} from './types';
import { CloudSyncSettingTab } from './settings-tab';

export default class CloudSyncPlugin extends Plugin {
    settings: CloudSyncSettings;
    private statusBarEl: HTMLElement;
    private pendingUpload: Set<string> = new Set();
    private isSyncing = false;
    private pendingFolderUpload: Set<string> = new Set();
    /** Paths being deleted by the sync engine — suppress vault delete events for these. */
    private syncDeletingPaths: Set<string> = new Set();

    t(key: string): string {
        return i18n[this.settings.language]?.[key] ?? i18n['en'][key] ?? key;
    }

    async onload() {
        await this.loadSettings();

        // Status bar item
        this.statusBarEl = this.addStatusBarItem();
        this.setStatus('idle');

        // Ribbon icon
        this.addRibbonIcon('refresh-cw', 'Sync now', () => {
            void this.syncAll();
        });

        // Command palette
        this.addCommand({
            id: 'sync-now',
            name: 'Sync now',
            callback: () => { void this.syncAll(); },
        });

        this.addCommand({
            id: 'login',
            name: 'Login / reconnect',
            callback: () => { void this.doLogin(); },
        });

        // Settings tab
        this.addSettingTab(new CloudSyncSettingTab(this.app, this));

        // File event listeners
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && this.settings.syncOnSave) {
                    this.pendingUpload.add(file.path);
                    this.debouncedSync();
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (file instanceof TFile) {
                    this.pendingUpload.add(file.path);
                    this.debouncedSync();
                } else if (file instanceof TFolder) {
                    this.pendingFolderUpload.add(file.path);
                    this.debouncedSync();
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                const serverPath = file instanceof TFolder
                    ? this.toServerPath(file.path + '/')
                    : this.toServerPath(file.path);
                // Skip if this deletion was triggered by the sync engine itself
                // (server already knows about it).
                if (this.syncDeletingPaths.has(serverPath)) {
                    this.syncDeletingPaths.delete(serverPath);
                    return;
                }
                if (file instanceof TFile || file instanceof TFolder) {
                    void this.trackDelete(serverPath).then(() => this.deleteRemote(serverPath));
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                if (file instanceof TFile) {
                    void this.trackDelete(this.toServerPath(oldPath))
                        .then(() => this.deleteRemote(this.toServerPath(oldPath)));
                    this.pendingUpload.add(file.path);
                    this.debouncedSync();
                } else if (file instanceof TFolder) {
                    void this.trackDelete(this.toServerPath(oldPath + '/'))
                        .then(() => this.deleteRemote(this.toServerPath(oldPath + '/')));
                    this.pendingFolderUpload.add(file.path);
                    this.debouncedSync();
                }
            })
        );

        // Initial sync on startup — wait for Obsidian to finish indexing the vault
        if (this.settings.token && this.settings.serverUrl) {
            this.app.workspace.onLayoutReady(() => {
                // Additional small delay after layout ready to ensure file cache is populated
                setTimeout(() => { void this.syncAll(); }, 1000);
            });
        }
    }

    onunload() {
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        if (!this.settings.deviceName) {
            this.settings.deviceName = this.generateDeviceName();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private generateDeviceName(): string {
        return `Device-${Math.random().toString(36).slice(2, 7)}`;
    }

    // ── Status bar ────────────────────────────────────────────────────────────

    private setStatus(state: 'idle' | 'syncing' | 'error' | 'ok', detail = '') {
        const labels: Record<string, string> = {
            idle:    'Cloud Sync',
            syncing: this.t('syncing'),
            error:   'Cloud Sync [!]',
            ok:      'Cloud Sync',
        };
        this.statusBarEl.setText(labels[state] + (detail ? ' ' + detail : ''));
        this.statusBarEl.title = detail || 'Cloud Sync';
    }

    private debounceTimer: number | null = null;
    private debouncedSync() {
        if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
        this.debounceTimer = window.setTimeout(() => {
            this.debounceTimer = null;
            // Use full sync instead of uploadPending so that every save goes
            // through conflict detection (compares hashes, creates conflict
            // copies when both devices edited the same file).
            void this.syncAll();
        }, 2000);
    }

    // ── HTTP helpers ──────────────────────────────────────────────────────────

    private baseUrl(): string {
        return this.settings.serverUrl.replace(/\/+$/, '') + '/api';
    }

    /** Check if response body looks like HTML instead of JSON (server misconfiguration). */
    private checkHtmlResponse(text: string): void {
        if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
            throw new Error('HTML_RESPONSE');
        }
    }

    private async apiGet<T>(path: string): Promise<T> {
        const res = await requestUrl({
            url: `${this.baseUrl()}/${path}`,
            method: 'GET',
            headers: { Authorization: `Bearer ${this.settings.token}` },
            throw: false,
        });
        this.checkHtmlResponse(res.text);
        if (res.status === 401) throw new Error('AUTH');
        if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
        return res.json as T;
    }

    private async apiPost<T>(path: string, body: unknown): Promise<T> {
        const res = await requestUrl({
            url: `${this.baseUrl()}/${path}`,
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.settings.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            throw: false,
        });
        this.checkHtmlResponse(res.text);
        if (res.status === 401) throw new Error('AUTH');
        if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
        return res.json as T;
    }

    private async uploadFile(filePath: string, data: ArrayBuffer, mtime: number): Promise<void> {
        const res = await requestUrl({
            url: `${this.baseUrl()}/vault/file`,
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.settings.token}`,
                'Content-Type': 'application/octet-stream',
                'X-File-Path': encodeURIComponent(filePath),
                'X-File-Mtime': String(mtime),
            },
            body: data,
            throw: false,
        });
        if (res.status === 401) throw new Error('AUTH');
        if (res.status >= 400) throw new Error(`Upload HTTP ${res.status}`);
    }

    private async downloadFile(filePath: string): Promise<ArrayBuffer> {
        const res = await requestUrl({
            url: `${this.baseUrl()}/vault/file?path=${encodeURIComponent(filePath)}`,
            method: 'GET',
            headers: { Authorization: `Bearer ${this.settings.token}` },
            throw: false,
        });
        if (res.status === 401) throw new Error('AUTH');
        if (res.status >= 400) throw new Error(`Download HTTP ${res.status}`);
        return res.arrayBuffer;
    }

    // ── Auth ──────────────────────────────────────────────────────────────────

    async doLogin(): Promise<boolean> {
        if (!this.settings.serverUrl || !this.settings.username || !this.settings.password) {
            new Notice('Cloud Sync: ' + this.t('fillCredentials'));
            return false;
        }

        try {
            const res = await requestUrl({
                url: `${this.baseUrl()}/auth/login`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: this.settings.username,
                    password: this.settings.password,
                    device_name: this.settings.deviceName,
                }),
                throw: false,
            });

            this.checkHtmlResponse(res.text);

            if (res.status === 200 && res.json?.token) {
                this.settings.token = res.json.token;
                await this.saveSettings();
                new Notice('Cloud Sync: ' + this.t('loggedInOk'));
                return true;
            }

            new Notice('Cloud Sync: ' + this.t('loginFailed') + ' — ' + (res.json?.error ?? 'Unknown error'));
            return false;
        } catch (e) {
            const msg = e instanceof Error && e.message === 'HTML_RESPONSE'
                ? this.t('serverHtmlError')
                : this.t('cannotReach') + ' — ' + String(e);
            new Notice('Cloud Sync: ' + msg, 10000);
            return false;
        }
    }

    // ── Core sync operations ──────────────────────────────────────────────────

    /** Full bidirectional sync. */
    async syncAll(retried = false): Promise<void> {
        if (this.isSyncing) return;
        if (!this.settings.token || !this.settings.serverUrl) return;

        this.isSyncing = true;
        this.setStatus('syncing');

        try {
            // Build local file list (includes empty folders)
            const localFiles = await this.buildLocalManifest();

            // Send pending deletes alongside the manifest
            const deletedPaths = [...this.settings.pendingDeletes];

            // Get diff from server (scoped to this vault)
            const diff = await this.apiPost<SyncDiff>('vault/sync', {
                vault: this.vaultName(),
                files: localFiles,
                deleted: deletedPaths,
            });

            let ops = 0;

            // Upload what server needs (diff.upload paths are server-prefixed)
            for (const serverPath of diff.upload) {
                await this.uploadLocalFile(this.toLocalPath(serverPath));
                ops++;
            }

            // Download what we need (applyRemoteFile converts internally)
            for (const sf of diff.download) {
                await this.applyRemoteFile(sf);
                ops++;
            }

            // Delete locally what server says is gone (paths are server-prefixed)
            for (const serverPath of diff.delete_local) {
                await this.deleteLocalFile(this.toLocalPath(serverPath));
                ops++;
            }

            // Build the post-sync hash snapshot so future syncs can detect
            // whether a local file was modified since the last sync.
            const syncedHashes: Record<string, string> = {};
            // Files that were already in sync or just uploaded — use local hash
            for (const lf of localFiles) {
                syncedHashes[lf.path] = lf.hash;
            }
            // Files just downloaded — use the server hash
            for (const sf of diff.download) {
                syncedHashes[sf.file_path] = sf.file_hash;
            }
            // Remove entries for deleted files
            for (const serverPath of diff.delete_local) {
                delete syncedHashes[serverPath];
            }
            for (const dp of deletedPaths) {
                delete syncedHashes[dp];
            }

            // Clear pending deletes after successful sync
            this.settings.pendingDeletes = [];
            this.settings.lastSyncTime = Date.now();
            this.settings.lastSyncedHashes = syncedHashes;
            await this.saveSettings();

            const msg = ops > 0 ? `${ops} ${this.t('changes')}` : this.t('upToDate');
            this.setStatus('ok', msg);
            setTimeout(() => this.setStatus('idle'), 3000);

        } catch (e: unknown) {
            const msg = String(e);
            if (msg === 'Error: AUTH') {
                console.warn('Cloud Sync: token rejected by server, attempting re-login');
                // Try auto re-login with stored credentials (only once to avoid loops)
                if (!retried && this.settings.username && this.settings.password) {
                    new Notice('Cloud Sync: ' + this.t('sessionExpired'));
                    const ok = await this.doLogin();
                    if (ok) {
                        // Retry sync with the new token
                        this.isSyncing = false;
                        return this.syncAll(true);
                    } else {
                        this.setStatus('error', this.t('expired'));
                    }
                } else {
                    this.setStatus('error', this.t('expired'));
                    new Notice('Cloud Sync: ' + this.t('reLoginFailed'));
                }
            } else if (e instanceof Error && e.message === 'HTML_RESPONSE') {
                this.setStatus('error', this.t('syncFailed'));
                new Notice('Cloud Sync: ' + this.t('serverHtmlError'), 10000);
            } else {
                this.setStatus('error', this.t('syncFailed'));
                console.error('CloudSync sync error:', e);
            }
        } finally {
            this.isSyncing = false;
        }
    }

    /** Upload only pending (modified) files and newly created empty folders. */
    private async uploadPending(): Promise<void> {
        if (this.isSyncing || !this.settings.token) return;
        if (this.pendingUpload.size === 0 && this.pendingFolderUpload.size === 0) return;

        // Filter out files that are pending deletion — another device (or this
        // one) may have deleted them and the upload would resurrect the file.
        const deletedSet = new Set(this.settings.pendingDeletes);
        const filePaths = Array.from(this.pendingUpload)
            .filter(p => !deletedSet.has(this.toServerPath(p)));
        const folderPaths = Array.from(this.pendingFolderUpload)
            .filter(p => !deletedSet.has(this.toServerPath(p + '/')));
        this.pendingUpload.clear();
        this.pendingFolderUpload.clear();

        this.setStatus('syncing');
        let ok = 0;
        for (const path of filePaths) {
            try {
                await this.uploadLocalFile(path);
                ok++;
            } catch (e) {
                console.warn('Cloud Sync: failed to upload', path, e);
            }
        }
        for (const path of folderPaths) {
            try {
                await this.uploadLocalFile(path + '/');
                ok++;
            } catch (e) {
                console.warn('Cloud Sync: failed to upload folder', path, e);
            }
        }
        this.setStatus('ok', `${ok}`);
        setTimeout(() => this.setStatus('idle'), 2000);
    }

    // ── File helpers ──────────────────────────────────────────────────────────

    private async buildLocalManifest(): Promise<Array<{ path: string; hash: string; mtime: number }>> {
        const files = this.app.vault.getFiles();
        const result = [];

        // Track which folders contain files
        const foldersWithFiles = new Set<string>();

        const MAX_READ_RETRIES = 2;
        for (const file of files) {
            let success = false;
            for (let attempt = 0; attempt <= MAX_READ_RETRIES && !success; attempt++) {
                try {
                    const data = await this.app.vault.readBinary(file);
                    const hash = await this.sha256hex(data);
                    result.push({
                        path: this.toServerPath(file.path),
                        hash,
                        mtime: file.stat.mtime,
                    });
                    // Mark all parent folders as non-empty
                    const parts = file.path.split('/');
                    parts.pop();
                    let cur = '';
                    for (const part of parts) {
                        cur = cur ? cur + '/' + part : part;
                        foldersWithFiles.add(cur);
                    }
                    success = true;
                } catch (e) {
                    if (attempt < MAX_READ_RETRIES) {
                        // Brief delay before retry
                        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
                    } else {
                        console.warn(`Cloud Sync: failed to read file "${file.path}" after ${MAX_READ_RETRIES + 1} attempts, skipping:`, e);
                    }
                }
            }
        }

        // Add empty folders to the manifest
        const allFolders = this.getAllFolders(this.app.vault.getRoot());
        for (const folderPath of allFolders) {
            if (!foldersWithFiles.has(folderPath)) {
                result.push({
                    path: this.toServerPath(folderPath + '/'),
                    hash: EMPTY_DIR_HASH,
                    mtime: Date.now(),
                });
            }
        }

        return result;
    }

    private getAllFolders(folder: TFolder): string[] {
        const result: string[] = [];
        for (const child of folder.children) {
            if (child instanceof TFolder) {
                result.push(child.path);
                result.push(...this.getAllFolders(child));
            }
        }
        return result;
    }

    private async trackDelete(path: string): Promise<void> {
        if (!this.settings.pendingDeletes.includes(path)) {
            this.settings.pendingDeletes.push(path);
            await this.saveSettings();
        }
    }

    private async uploadLocalFile(localPath: string): Promise<void> {
        const serverPath = this.toServerPath(localPath);
        // Handle empty folder upload
        if (localPath.endsWith('/')) {
            const folderPath = localPath.slice(0, -1);
            const folder = this.app.vault.getAbstractFileByPath(folderPath);
            if (!(folder instanceof TFolder)) return;
            await this.uploadFile(serverPath, new ArrayBuffer(0), Date.now());
            return;
        }
        const file = this.app.vault.getAbstractFileByPath(localPath);
        if (!(file instanceof TFile)) return;
        const data = await this.app.vault.readBinary(file);
        await this.uploadFile(serverPath, data, file.stat.mtime);
    }

    private async applyRemoteFile(sf: ServerFile): Promise<void> {
        const localPath = this.toLocalPath(sf.file_path);

        // Handle empty folder download
        if (localPath.endsWith('/') || sf.file_hash === EMPTY_DIR_HASH) {
            const folderPath = localPath.replace(/\/$/, '');
            if (!this.app.vault.getAbstractFileByPath(folderPath)) {
                try {
                    await this.app.vault.createFolder(folderPath);
                } catch { /* already exists */ }
            }
            return;
        }

        const data = await this.downloadFile(sf.file_path); // server path used for URL
        const existing = this.app.vault.getAbstractFileByPath(localPath);

        if (existing instanceof TFile) {
            // Check if our local version conflicts
            const localData = await this.app.vault.readBinary(existing);
            const localHash = await this.sha256hex(localData);

            if (localHash !== sf.file_hash) {
                // Local content differs from server. Determine whether the
                // local file was modified since the last sync by comparing
                // with the hash we recorded after the previous sync.
                const lastKnown = this.settings.lastSyncedHashes[sf.file_path];
                const locallyModified = lastKnown ? localHash !== lastKnown : true;

                if (locallyModified) {
                    // True conflict: both sides changed — keep local copy
                    const conflictPath = this.conflictPath(localPath, this.settings.deviceName);
                    await this.app.vault.createBinary(conflictPath, localData);
                    new Notice(`Cloud Sync: ${this.t('conflict')}\n${conflictPath}`);
                }
            }

            await this.app.vault.modifyBinary(existing, data);
        } else {
            // Create directories if needed
            await this.ensureDir(localPath);
            await this.app.vault.createBinary(localPath, data);
        }
    }

    private async deleteLocalFile(path: string): Promise<void> {
        // Mark path so the vault 'delete' event handler skips redundant
        // trackDelete + deleteRemote (server already knows about this deletion).
        const serverPath = this.toServerPath(path);
        this.syncDeletingPaths.add(serverPath);

        // Handle folder deletion
        if (path.endsWith('/')) {
            const folderPath = path.slice(0, -1);
            const folder = this.app.vault.getAbstractFileByPath(folderPath);
            if (folder instanceof TFolder) {
                try {
                    await this.app.fileManager.trashFile(folder);
                } catch { /* ignore */ }
            } else {
                this.syncDeletingPaths.delete(serverPath);
            }
            return;
        }
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            try {
                await this.app.fileManager.trashFile(file);
            } catch { /* ignore */ }
        } else {
            this.syncDeletingPaths.delete(serverPath);
        }
    }

    // ── Vault-path helpers ────────────────────────────────────────────────────

    /** Vault name used as top-level directory on the server, isolating multiple vaults per user. */
    private vaultName(): string {
        return this.app.vault.getName();
    }

    /** Convert a local (vault-relative) path to the server-side path: `{vaultName}/{localPath}`. */
    private toServerPath(localPath: string): string {
        return this.vaultName() + '/' + localPath;
    }

    /** Strip the vault-name prefix from a server path to get the local (vault-relative) path. */
    private toLocalPath(serverPath: string): string {
        const prefix = this.vaultName() + '/';
        return serverPath.startsWith(prefix) ? serverPath.slice(prefix.length) : serverPath;
    }

    private async deleteRemote(path: string): Promise<void> {
        if (!this.settings.token) return;
        try {
            const res = await requestUrl({
                url: `${this.baseUrl()}/vault/file?path=${encodeURIComponent(path)}`,
                method: 'DELETE',
                headers: { Authorization: `Bearer ${this.settings.token}` },
                throw: false,
            });
            if (res.status === 401) {
                console.warn('Cloud Sync: deleteRemote auth failed, will retry on next sync');
            }
        } catch (e) {
            console.warn('Cloud Sync: deleteRemote error', e);
        }
    }

    private async ensureDir(filePath: string): Promise<void> {
        const parts = filePath.split('/');
        parts.pop(); // remove filename
        let current = '';
        for (const part of parts) {
            current = current ? current + '/' + part : part;
            if (!this.app.vault.getAbstractFileByPath(current)) {
                try {
                    await this.app.vault.createFolder(current);
                } catch { /* already exists */ }
            }
        }
    }

    private conflictPath(path: string, device: string): string {
        const dotIdx = path.lastIndexOf('.');
        const dateStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
        if (dotIdx > 0) {
            return `${path.slice(0, dotIdx)} (conflict ${device} ${dateStr})${path.slice(dotIdx)}`;
        }
        return `${path} (conflict ${device} ${dateStr})`;
    }

    private async sha256hex(data: ArrayBuffer): Promise<string> {
        const hashBuf = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
}
