import { Vault, TFile, TAbstractFile, Notice, normalizePath } from "obsidian";
import { ApiClient } from "./api-client";
import { ServerFileInfo } from "./types";

export class SyncEngine {
	private vault: Vault;
	private api: ApiClient;
	private vaultId: string;
	private localHashes: Map<string, string> = new Map();
	private syncing = false;
	private lastSyncTime = 0;
	private pendingChanges: Map<string, "upload" | "delete"> = new Map();

	constructor(vault: Vault, api: ApiClient, vaultId: string) {
		this.vault = vault;
		this.api = api;
		this.vaultId = vaultId;
	}

	setVaultId(vaultId: string): void {
		this.vaultId = vaultId;
	}

	async computeHash(content: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(content);
		const hashBuffer = await crypto.subtle.digest("SHA-256", data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	}

	onFileChange(file: TAbstractFile): void {
		if (file instanceof TFile && !this.isPluginFile(file.path)) {
			this.pendingChanges.set(file.path, "upload");
		}
	}

	onFileCreate(file: TAbstractFile): void {
		if (file instanceof TFile && !this.isPluginFile(file.path)) {
			this.pendingChanges.set(file.path, "upload");
		}
	}

	onFileDelete(file: TAbstractFile): void {
		if (file instanceof TFile && !this.isPluginFile(file.path)) {
			this.pendingChanges.set(file.path, "delete");
			this.localHashes.delete(file.path);
		}
	}

	onFileRename(file: TAbstractFile, oldPath: string): void {
		if (file instanceof TFile && !this.isPluginFile(file.path)) {
			this.pendingChanges.set(oldPath, "delete");
			this.pendingChanges.set(file.path, "upload");
			this.localHashes.delete(oldPath);
		}
	}

	private isPluginFile(path: string): boolean {
		return path.startsWith(".obsidian/");
	}

	async performSync(): Promise<void> {
		if (this.syncing || !this.vaultId) return;
		this.syncing = true;

		try {
			await this.pushPendingChanges();
			await this.pullRemoteChanges();
		} catch (e) {
			console.error("Cloud Sync: sync error", e);
		} finally {
			this.syncing = false;
		}
	}

	async performFullSync(): Promise<void> {
		if (this.syncing || !this.vaultId) return;
		this.syncing = true;

		try {
			new Notice("Cloud Sync: starting full sync...");

			// Build local hash index
			const files = this.vault.getFiles();
			for (const file of files) {
				if (this.isPluginFile(file.path)) continue;
				const content = await this.vault.read(file);
				const hash = await this.computeHash(content);
				this.localHashes.set(file.path, hash);
			}

			// Get all remote files
			const status = await this.api.getSyncStatus(this.vaultId, 0);
			if (!status.success) {
				new Notice("Cloud Sync: failed to get server status");
				return;
			}

			this.lastSyncTime = status.server_time;
			const serverFiles = new Map<string, ServerFileInfo>();
			for (const f of status.files) {
				serverFiles.set(f.path, f);
			}

			// Upload local files missing on server or with different hash
			for (const file of files) {
				if (this.isPluginFile(file.path)) continue;
				const localHash = this.localHashes.get(file.path);
				const serverFile = serverFiles.get(file.path);

				if (!serverFile || serverFile.deleted) {
					await this.uploadFile(file);
				} else if (localHash && serverFile.hash !== localHash) {
					// Conflict: server has different version
					// Strategy: server wins on full sync (pull)
					await this.downloadAndWrite(file.path);
				}
			}

			// Download server files missing locally
			for (const [path, info] of serverFiles) {
				if (info.deleted) continue;
				const localFile = this.vault.getAbstractFileByPath(normalizePath(path));
				if (!localFile) {
					await this.downloadAndWrite(path);
				}
			}

			new Notice("Cloud Sync: full sync complete");
		} catch (e) {
			console.error("Cloud Sync: full sync error", e);
			new Notice("Cloud Sync: full sync failed");
		} finally {
			this.syncing = false;
		}
	}

	private async pushPendingChanges(): Promise<void> {
		const changes = new Map(this.pendingChanges);
		this.pendingChanges.clear();

		for (const [path, action] of changes) {
			try {
				if (action === "delete") {
					await this.api.deleteFile(this.vaultId, path);
				} else {
					const file = this.vault.getAbstractFileByPath(normalizePath(path));
					if (file instanceof TFile) {
						await this.uploadFile(file);
					}
				}
			} catch (e) {
				console.error(`Cloud Sync: failed to push ${path}`, e);
				// Re-queue the change for the next cycle
				this.pendingChanges.set(path, action);
			}
		}
	}

	private async pullRemoteChanges(): Promise<void> {
		const status = await this.api.getSyncStatus(this.vaultId, this.lastSyncTime);
		if (!status.success) return;

		this.lastSyncTime = status.server_time;

		for (const fileInfo of status.files) {
			const localFile = this.vault.getAbstractFileByPath(normalizePath(fileInfo.path));

			if (fileInfo.deleted) {
				if (localFile instanceof TFile) {
					await this.vault.delete(localFile);
				}
				continue;
			}

			if (localFile instanceof TFile) {
				const localContent = await this.vault.read(localFile);
				const localHash = await this.computeHash(localContent);
				if (localHash !== fileInfo.hash) {
					await this.downloadAndWrite(fileInfo.path);
				}
			} else if (!localFile) {
				await this.downloadAndWrite(fileInfo.path);
			}
		}
	}

	private async uploadFile(file: TFile): Promise<void> {
		const content = await this.vault.read(file);
		const hash = await this.computeHash(content);

		const encoded = btoa(
			new Uint8Array(new TextEncoder().encode(content)).reduce(
				(data, byte) => data + String.fromCharCode(byte),
				""
			)
		);

		const result = await this.api.uploadFile(this.vaultId, file.path, encoded, hash);
		if (result.success) {
			this.localHashes.set(file.path, hash);
		}
	}

	private async downloadAndWrite(path: string): Promise<void> {
		const result = await this.api.downloadFile(this.vaultId, path);
		if (!result.success || result.content === undefined) return;

		const content = new TextDecoder().decode(
			Uint8Array.from(atob(result.content), (c) => c.charCodeAt(0))
		);

		const normalized = normalizePath(path);
		const dir = normalized.substring(0, normalized.lastIndexOf("/"));
		if (dir) {
			await this.ensureDirectory(dir);
		}

		const existing = this.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFile) {
			await this.vault.modify(existing, content);
		} else {
			await this.vault.create(normalized, content);
		}

		const hash = result.hash || (await this.computeHash(content));
		this.localHashes.set(path, hash);
	}

	private async ensureDirectory(dirPath: string): Promise<void> {
		const parts = dirPath.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const existing = this.vault.getAbstractFileByPath(normalizePath(current));
			if (!existing) {
				await this.vault.createFolder(normalizePath(current));
			}
		}
	}
}
