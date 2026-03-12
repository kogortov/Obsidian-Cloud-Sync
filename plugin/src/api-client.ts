import { requestUrl, RequestUrlParam } from "obsidian";
import {
	AuthResponse,
	VaultsResponse,
	SyncStatusResponse,
	UploadResponse,
	DownloadResponse,
	DeleteResponse,
} from "./types";

export class ApiClient {
	private serverUrl: string;
	private token: string | null;

	constructor(serverUrl: string, token: string | null) {
		this.serverUrl = serverUrl.replace(/\/+$/, "");
		this.token = token;
	}

	setToken(token: string | null): void {
		this.token = token;
	}

	setServerUrl(url: string): void {
		this.serverUrl = url.replace(/\/+$/, "");
	}

	private buildUrl(endpoint: string): string {
		return `${this.serverUrl}/api.php?action=${endpoint}`;
	}

	private getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.token) {
			headers["Authorization"] = `Bearer ${this.token}`;
		}
		return headers;
	}

	private async request(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
		const params: RequestUrlParam = {
			url: this.buildUrl(endpoint),
			method: "POST",
			headers: this.getHeaders(),
			body: JSON.stringify(body),
		};
		const response = await requestUrl(params);
		return response.json;
	}

	async login(username: string, password: string): Promise<AuthResponse> {
		return (await this.request("login", { username, password })) as AuthResponse;
	}

	async register(username: string, password: string): Promise<AuthResponse> {
		return (await this.request("register", { username, password })) as AuthResponse;
	}

	async listVaults(): Promise<VaultsResponse> {
		return (await this.request("vaults", {})) as VaultsResponse;
	}

	async createVault(name: string): Promise<{ success: boolean; vault_id?: string; error?: string }> {
		return (await this.request("create_vault", { name })) as {
			success: boolean;
			vault_id?: string;
			error?: string;
		};
	}

	async getSyncStatus(vaultId: string, since: number): Promise<SyncStatusResponse> {
		return (await this.request("sync_status", {
			vault_id: vaultId,
			since,
		})) as SyncStatusResponse;
	}

	async uploadFile(
		vaultId: string,
		filePath: string,
		content: string,
		hash: string
	): Promise<UploadResponse> {
		return (await this.request("upload", {
			vault_id: vaultId,
			path: filePath,
			content,
			hash,
		})) as UploadResponse;
	}

	async downloadFile(vaultId: string, filePath: string): Promise<DownloadResponse> {
		return (await this.request("download", {
			vault_id: vaultId,
			path: filePath,
		})) as DownloadResponse;
	}

	async deleteFile(vaultId: string, filePath: string): Promise<DeleteResponse> {
		return (await this.request("delete_file", {
			vault_id: vaultId,
			path: filePath,
		})) as DeleteResponse;
	}
}
