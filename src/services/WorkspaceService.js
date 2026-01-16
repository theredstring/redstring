/**
 * Workspace Service
 *
 * Centralized manager for the Redstring workspace.
 * - Manages the root folder handle/path.
 * - Reads/Writes `redstring.config.json` as the source of truth for the active universe.
 * - Handles creation of new universes and config updates.
 */

import { isElectron, validateFolderAccess, getFileInFolder, readFile, writeFile } from '../utils/fileAccessAdapter.js';
import { getStorageKey } from '../utils/storageUtils.js';
import * as folderPersistence from './folderPersistence.js';

const CONFIG_FILENAME = 'redstring.config.json';
const WELCOME_SEEN_KEY = getStorageKey('redstring-alpha-welcome-seen');

class WorkspaceService {
    constructor() {
        this.folderHandle = null;
        this.config = null;
    }

    /**
     * Initialize the workspace service on app startup.
     * @returns {Promise<{ status: 'READY'|'NEEDS_ONBOARDING'|'SELECT_UNIVERSE', activeUniverse?: string }>}
     */
    async initialize() {
        console.log('[WorkspaceService] Initializing...');

        // 1. Check if we have a stored folder handle
        const validation = await folderPersistence.validateStoredFolder();

        if (!validation.valid || !validation.folderHandle) {
            console.log('[WorkspaceService] No valid folder found. Setup required.');
            return { status: 'NEEDS_ONBOARDING' };
        }

        this.folderHandle = validation.folderHandle;

        // 2. Try to read redstring.config.json
        try {
            await this.loadConfig();

            if (this.config && this.config.activeUniverse) {
                console.log('[WorkspaceService] Active universe found in config:', this.config.activeUniverse);
                return { status: 'READY', activeUniverse: this.config.activeUniverse };
            } else {
                console.log('[WorkspaceService] Config loaded but no active universe set.');
                return { status: 'SELECT_UNIVERSE' };
            }

        } catch (error) {
            console.warn('[WorkspaceService] Config file not found or invalid:', error);
            // If no config exists, we don't auto-load anything.
            return { status: 'SELECT_UNIVERSE' };
        }
    }

    /**
     * Load the config file from the current folder handle.
     */
    async loadConfig() {
        if (!this.folderHandle) throw new Error('No folder handle set');

        try {
            // Try to get the config file
            // Note: getFileInFolder(handle, name, create=false)
            // We need to implement a way to check if file exists or handle error
            // Assuming getFileInFolder throws or returns null if not found (depending on adapter, let's verify)
            // In fileAccessAdapter, getFileInFolder wraps getFileHandle.

            const fileHandle = await getFileInFolder(this.folderHandle, CONFIG_FILENAME, false);
            const content = await readFile(fileHandle.handle || fileHandle); // adapter returns object or handle depending on env
            this.config = JSON.parse(content);
            console.log('[WorkspaceService] Config loaded:', this.config);
        } catch (error) {
            // Config doesn't exist or verify permissions failed on file specifically
            console.log('[WorkspaceService] No config file found (or read failed). Starting fresh config.');
            this.config = {};
        }
    }

    /**
     * Save the current config to redstring.config.json
     */
    async saveConfig() {
        if (!this.folderHandle) throw new Error('No folder handle set');

        try {
            const fileHandle = await getFileInFolder(this.folderHandle, CONFIG_FILENAME, true);
            await writeFile(fileHandle.handle || fileHandle, JSON.stringify(this.config, null, 2));
            console.log('[WorkspaceService] Config saved.');
        } catch (error) {
            console.error('[WorkspaceService] Failed to save config:', error);
            throw error;
        }
    }

    /**
     * Link a folder to the workspace (during Onboarding).
     * @param {string|DirectoryHandle} handle 
     */
    async linkFolder(handle) {
        console.log('[WorkspaceService] Linking folder...');
        await folderPersistence.storeFolderHandle(handle);
        this.folderHandle = handle;

        // Mark onboarding as seen
        if (typeof window !== 'undefined') {
            localStorage.setItem(WELCOME_SEEN_KEY, 'true');
        }

        // Load config if it exists, otherwise initialize empty
        await this.loadConfig();
    }

    /**
     * Create a new universe file and set it as active.
     * @param {string} name - Name of the universe (without extension)
     * @param {object} initialData - Initial graph data
     */
    async createUniverse(name, initialData) {
        if (!this.folderHandle) throw new Error('No folder handle set');

        const filename = name.endsWith('.redstring') ? name : `${name}.redstring`;
        console.log('[WorkspaceService] Creating universe:', filename);

        try {
            const fileHandle = await getFileInFolder(this.folderHandle, filename, true);
            await writeFile(fileHandle.handle || fileHandle, JSON.stringify(initialData, null, 2));

            // Update config
            this.config.activeUniverse = filename;
            this.config.lastOpened = Date.now();
            await this.saveConfig();

            return filename;
        } catch (error) {
            console.error('[WorkspaceService] Failed to create universe:', error);
            throw error;
        }
    }

    /**
     * Set an existing file as the active universe.
     * @param {string} filename 
     */
    async setActiveUniverse(filename) {
        this.config.activeUniverse = filename;
        this.config.lastOpened = Date.now();
        await this.saveConfig();
    }

    getFolderHandle() {
        return this.folderHandle;
    }
}

export const workspaceService = new WorkspaceService();
export default workspaceService;
