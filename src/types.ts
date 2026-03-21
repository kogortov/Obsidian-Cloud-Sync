import type { Lang } from './i18n';

export interface CloudSyncSettings {
    serverUrl: string;
    username: string;
    password: string;
    token: string;
    deviceName: string;
    syncOnSave: boolean;
    lastSyncTime: number;
    language: Lang;
    pendingDeletes: string[];
    /** Hash of each file as of the last successful sync (server path -> sha256). */
    lastSyncedHashes: Record<string, string>;
}

export interface ServerFile {
    file_path: string;
    file_hash: string;
    file_size: number;
    client_mtime: number;
    server_mtime: number;
    is_deleted: number;
}

export interface SyncDiff {
    upload: string[];
    download: ServerFile[];
    delete_local: string[];
}

export const EMPTY_DIR_HASH = '__empty_dir__';

export const DEFAULT_SETTINGS: CloudSyncSettings = {
    serverUrl: '',
    username: '',
    password: '',
    token: '',
    deviceName: '',
    syncOnSave: true,
    lastSyncTime: 0,
    language: 'en',
    pendingDeletes: [],
    lastSyncedHashes: {},
};
