/**
 * File Access Adapter
 * 
 * Provides a unified interface for file system access that works in both
 * browser (File System Access API) and Electron (Node.js fs via IPC) environments.
 */

/**
 * Check if we're running in Electron
 */
export const isElectron = () => {
  const result = typeof window !== 'undefined' && window.electron?.isElectron === true;
  // Debug: uncomment to trace Electron detection
  // console.log('[FileAccessAdapter] isElectron check:', { 
  //   result, 
  //   hasWindow: typeof window !== 'undefined',
  //   hasElectron: !!window?.electron,
  //   isElectronFlag: window?.electron?.isElectron 
  // });
  return result;
};

// Log once on load to confirm Electron detection
if (typeof window !== 'undefined') {
  console.log('[FileAccessAdapter] Electron detection on load:', {
    isElectron: window.electron?.isElectron === true,
    hasElectronAPI: !!window.electron,
    electronAPIs: window.electron ? Object.keys(window.electron) : []
  });
}

/**
 * Check if we're running in a browser with File System Access API support
 */
export const hasFileSystemAccess = () => {
  return typeof window !== 'undefined' && 
         'showOpenFilePicker' in window && 
         'showSaveFilePicker' in window;
};

/**
 * Pick a file to open
 * @param {Object} options - File picker options
 * @returns {Promise<FileHandle|string>} - Browser: FileHandle, Electron: file path string
 */
export const pickFile = async (options = {}) => {
  if (isElectron()) {
    const filePath = await window.electron.fileSystem.pickFile(options);
    return filePath;
  } else if (hasFileSystemAccess()) {
    const [fileHandle] = await window.showOpenFilePicker({
      types: [{ description: 'Redstring Files', accept: { 'application/json': ['.redstring'] } }],
      multiple: false,
      ...options
    });
    return fileHandle;
  } else {
    throw new Error('File System Access API not available. Use Electron build or modern browser.');
  }
};

/**
 * Pick a file location to save
 * @param {Object} options - Save dialog options
 * @param {string} options.suggestedName - Suggested filename
 * @param {string} options.defaultPath - Default path (Electron only)
 * @returns {Promise<FileHandle|string>} - Browser: FileHandle, Electron: file path string
 */
export const pickSaveLocation = async (options = {}) => {
  if (isElectron()) {
    const filePath = await window.electron.fileSystem.saveAs({
      suggestedName: options.suggestedName,
      defaultPath: options.defaultPath
    });
    return filePath;
  } else if (hasFileSystemAccess()) {
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: options.suggestedName || 'untitled.redstring',
      types: [{ description: 'Redstring Files', accept: { 'application/json': ['.redstring'] } }]
    });
    return fileHandle;
  } else {
    throw new Error('File System Access API not available. Use Electron build or modern browser.');
  }
};

/**
 * Read file contents
 * @param {FileHandle|string} fileHandleOrPath - Browser: FileHandle, Electron: file path
 * @returns {Promise<string>} - File contents as string
 */
export const readFile = async (fileHandleOrPath) => {
  if (isElectron()) {
    // Electron: fileHandleOrPath must be a string path
    if (typeof fileHandleOrPath !== 'string') {
      console.error('[FileAccessAdapter] Electron readFile received non-string path:', fileHandleOrPath);
      throw new Error(`Electron readFile requires a string path, received: ${typeof fileHandleOrPath}`);
    }
    const result = await window.electron.fileSystem.readFile(fileHandleOrPath);
    return result.content;
  } else {
    // Browser: fileHandleOrPath is a FileHandle
    const file = await fileHandleOrPath.getFile();
    return await file.text();
  }
};

/**
 * Write file contents
 * @param {FileHandle|string} fileHandleOrPath - Browser: FileHandle, Electron: file path
 * @param {string} content - Content to write
 * @returns {Promise<void>}
 */
export const writeFile = async (fileHandleOrPath, content) => {
  if (isElectron()) {
    // Electron: fileHandleOrPath must be a string path
    if (typeof fileHandleOrPath !== 'string') {
      console.error('[FileAccessAdapter] Electron writeFile received non-string path:', fileHandleOrPath);
      throw new Error(`Electron writeFile requires a string path, received: ${typeof fileHandleOrPath}`);
    }
    await window.electron.fileSystem.writeFile(fileHandleOrPath, content);
  } else {
    // Browser: fileHandleOrPath is a FileHandle
    const writable = await fileHandleOrPath.createWritable();
    await writable.write(content);
    await writable.close();
  }
};

/**
 * Check if a file exists (Electron only, browsers use FileHandle directly)
 * @param {string} filePath - File path
 * @returns {Promise<boolean>}
 */
export const fileExists = async (filePath) => {
  if (isElectron()) {
    if (typeof filePath !== 'string') {
      console.warn('[FileAccessAdapter] Electron fileExists received non-string path:', filePath);
      return false;
    }
    return await window.electron.fileSystem.fileExists(filePath);
  } else {
    // In browser, if we have a FileHandle, it exists
    return true;
  }
};

/**
 * Get a stable identifier for a file handle/path
 * Used for tracking which file is associated with which universe
 * @param {FileHandle|string} fileHandleOrPath - Browser: FileHandle, Electron: file path
 * @returns {Promise<string>} - Stable identifier
 */
export const getFileIdentifier = async (fileHandleOrPath) => {
  if (isElectron()) {
    // Electron: use the path as identifier
    return fileHandleOrPath;
  } else {
    // Browser: use FileHandle's name and lastModified as identifier
    const file = await fileHandleOrPath.getFile();
    return `${file.name}-${file.lastModified}`;
  }
};

/**
 * Get file name
 * @param {FileHandle|string} fileHandleOrPath - Browser: FileHandle, Electron: file path
 * @returns {Promise<string>} - File name
 */
export const getFileName = async (fileHandleOrPath) => {
  if (isElectron()) {
    // Electron: extract filename from path
    // Note: We can't use require() in ES modules, so we'll use a simple path split
    const parts = fileHandleOrPath.split(/[/\\]/);
    return parts[parts.length - 1];
  } else {
    // Browser: get name from FileHandle
    const file = await fileHandleOrPath.getFile();
    return file.name;
  }
};

