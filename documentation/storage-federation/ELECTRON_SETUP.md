# Electron Build Setup Guide

This document explains how to build and run Redstring as an Electron desktop application.

## Overview

Redstring now supports running as an Electron desktop app with:
- **Native file system access** - Direct file read/write without browser permissions
- **Persistent storage** - File paths and settings are remembered across sessions
- **Default Redstring folder** - Automatic `~/Documents/Redstring` folder for your files
- **Custom protocol handler** - `redstring://` protocol for OAuth callbacks
- **Unified codebase** - Same React codebase works in both browser and Electron

## Architecture

The Electron build uses an **Adapter Pattern** to abstract file system access:

- **Browser**: Uses File System Access API (`showOpenFilePicker`, `showSaveFilePicker`)
- **Electron**: Uses Node.js `fs` module via IPC handlers

The application automatically detects the environment and uses the appropriate adapter.

## Development

### Prerequisites

- Node.js 20+ (or 22+)
- npm or yarn

### Running Electron in Development

1. **Start the Electron app:**
   ```bash
   npm run electron:dev
   ```

   This will:
   - Start Vite dev server on `http://localhost:4001`
   - Wait for Vite to be ready
   - Launch Electron window pointing to the dev server
   - Open DevTools automatically

2. **Development workflow:**
   - Make changes to React code → Hot reloads automatically
   - Make changes to Electron code (`electron/main.cjs`, `electron/preload.cjs`) → Restart Electron
   - The Electron window will automatically reload when Vite rebuilds

### File Structure

```
electron/
  ├── main.cjs      # Main Electron process (window management, IPC handlers)
  └── preload.cjs   # Context bridge (exposes safe APIs to renderer)

src/
  ├── services/
  │   └── fileHandlePersistence.js  # File path storage (Electron + browser)
  └── utils/
      ├── fileAccessAdapter.js      # Unified file system interface
      ├── electronStorage.js        # Electron localStorage replacement
      └── oauthAdapter.js           # Unified OAuth interface
```

## Building for Production

### Build for Current Platform

```bash
npm run electron:build
```

### Build for Specific Platforms

```bash
# macOS (DMG)
npm run electron:build:mac

# Windows (NSIS installer)
npm run electron:build:win

# Linux (AppImage)
npm run electron:build:linux
```

Built applications will be in `dist-electron/` directory.

## Features

### File System Access

In Electron, file operations use native Node.js APIs:

- **Pick file**: Opens native file dialog, defaults to `~/Documents/Redstring`
- **Save file**: Opens native save dialog, defaults to `~/Documents/Redstring`
- **Read/Write**: Direct file system access (no permission prompts)

The `UniverseBackend` service automatically detects Electron and uses the appropriate file access methods.

### Persistent Storage

Electron uses file-based persistent storage instead of browser localStorage/IndexedDB:

**Data Directory**: `~/Library/Application Support/Redstring/RedstringData` (macOS) or equivalent on other platforms

Stored files:
- `fileHandles.json` - Linked file paths for each universe
- `settings.json` - Application settings
- `universes.json` - Universe metadata

This ensures that:
- File paths are remembered across app restarts
- Universes automatically reconnect to their files
- Settings persist without browser storage limitations

### Default Folder

On first launch, Electron creates:
- `~/Documents/Redstring` - Default location for `.redstring` files

File dialogs automatically open to this folder for convenience.

### OAuth Protocol Handler

Electron registers `redstring://` as a custom protocol for OAuth callbacks:

1. User initiates GitHub OAuth
2. System browser opens GitHub authorization page
3. GitHub redirects to `redstring://auth?code=...`
4. Electron captures the callback via protocol handler
5. OAuth code is sent to renderer process via IPC

**Note**: The OAuth server configuration needs to redirect to `redstring://auth` instead of a web URL when running in Electron. This may require environment-specific OAuth configuration.

## Platform-Specific Notes

### macOS

- Protocol handler registration happens automatically on first launch
- DMG installer includes code signing (if configured)
- Universal binary supports both Intel and Apple Silicon

### Windows

- NSIS installer registers protocol handler during installation
- Requires admin privileges for protocol registration
- Supports x64 and ia32 architectures

### Linux

- AppImage format (portable, no installation required)
- Protocol handler registration requires desktop integration
- May need manual `.desktop` file configuration for protocol handling

## Troubleshooting

### Electron window doesn't open

- Check that Vite dev server is running on port 4001
- Check console for errors in the terminal running `npm run electron:dev`
- Try killing any existing Electron processes: `pkill -f electron`

### File picker doesn't work

- Ensure `electron/preload.cjs` is properly loaded (check DevTools console)
- Verify `window.electron.fileSystem` is available in renderer
- Check Electron main process console for IPC errors

### File paths not remembered

- Check that `~/Library/Application Support/Redstring/RedstringData` exists (macOS)
- Verify `fileHandles.json` contains your universe data
- In DevTools console, check for storage errors: `[FileHandlePersistence]`

### Save status showing "Not Saved" or incorrect

- Open DevTools and check for errors related to `saveToLinkedLocalFile`
- Verify the file handle is stored: check `window.electron.storage.getAll('fileHandles')` in console
- Ensure the file path still exists on disk

### OAuth callback not received

- Verify protocol handler is registered: Check system settings (macOS) or registry (Windows)
- Test protocol manually: `open redstring://auth?code=test` (macOS) or `start redstring://auth?code=test` (Windows)
- Check Electron main process console for protocol handler errors

### Build fails

- Ensure `npm run build` succeeds first (Vite build must complete)
- Check `electron-builder.json` configuration
- Verify all dependencies are installed: `npm install`

## Configuration

### Electron Builder Config

Edit `electron-builder.json` to customize:
- App ID and product name
- Output directories
- Platform-specific targets
- Protocol handler registration

### Environment Variables

- `NODE_ENV=development` - Enables dev mode (auto-detected if not packaged)
- `VITE_DEV_PORT` - Override Vite dev server port (default: 4001)

## Next Steps

- [ ] Configure code signing for macOS/Windows releases
- [ ] Set up auto-updater for Electron app
- [ ] Add OAuth server configuration for Electron protocol callbacks
- [ ] Test protocol handler on all platforms
- [ ] Add Electron-specific UI enhancements (menu bar, dock integration)

