export interface CloudSyncSettings {
	serverUrl: string;
	username: string;
	password: string;
	vaultId: string;
	syncIntervalSeconds: number;
	authToken: string | null;
}

export const DEFAULT_SETTINGS: CloudSyncSettings = {
	serverUrl: "",
	username: "",
	password: "",
	vaultId: "",
	syncIntervalSeconds: 5,
	authToken: null,
};

export interface ServerFileInfo {
	path: string;
	hash: string;
	updated_at: number;
	deleted: boolean;
}

export interface SyncStatusResponse {
	success: boolean;
	files: ServerFileInfo[];
	server_time: number;
}

export interface AuthResponse {
	success: boolean;
	token?: string;
	error?: string;
}

export interface VaultInfo {
	id: string;
	name: string;
}

export interface VaultsResponse {
	success: boolean;
	vaults: VaultInfo[];
	error?: string;
}

export interface UploadResponse {
	success: boolean;
	hash?: string;
	error?: string;
}

export interface DownloadResponse {
	success: boolean;
	content?: string;
	hash?: string;
	error?: string;
}

export interface DeleteResponse {
	success: boolean;
	error?: string;
}
