# Testing Onboarding Flow

## Test Mode

Redstring supports a special "test mode" that uses completely separate storage, allowing you to test the first-time user experience without affecting your main session.

### How to Use Test Mode

#### Web/Localhost
Add `?test=true` to your URL:
```
http://localhost:5173/?test=true
```

This will:
- Use separate localStorage keys (prefixed with `test_`)
- Use separate IndexedDB database (`test_RedstringFolderStorage`)
- Not interfere with your main session

#### Electron
Launch Electron with a test flag (you'll need to add command-line argument support):
```bash
npm run electron -- --test
```

Or manually add `?test=true` to the initial URL in your Electron main process.

### What Test Mode Does

When `?test=true` is in the URL, Redstring will:

1. **Use separate storage keys:**
   - `test_redstring-alpha-welcome-seen` instead of `redstring-alpha-welcome-seen`
   - `test_redstring_workspace_folder_path` instead of `redstring_workspace_folder_path`
   - `test_RedstringFolderStorage` IndexedDB instead of `RedstringFolderStorage`

2. **Show first-time onboarding flow:**
   - Welcome modal appears
   - Storage setup modal appears
   - Can test folder selection and universe creation

3. **Keep your real data safe:**
   - Your actual workspace folder is untouched
   - Your actual universe files are not affected
   - Your main session preferences are preserved

### Testing Workflow

1. **Open test mode:**
   ```
   http://localhost:5173/?test=true
   ```

2. **Go through onboarding:**
   - Click "Get Started"
   - Choose a test folder (create a separate "RedstringTest" folder)
   - Test the universe creation flow

3. **Test returning user flow:**
   - Reload with `?test=true`
   - Should load directly into your test universe

4. **Reset test mode:**
   - Use Debug menu → "Reset Onboarding Flow"
   - Or manually clear: `localStorage.removeItem('test_redstring-alpha-welcome-seen')`

5. **Return to normal mode:**
   - Remove `?test=true` from URL
   - Your regular session loads normally

### Manual Storage Clearing

If you need to manually reset test mode:

```javascript
// Clear test mode onboarding flag
localStorage.removeItem('test_redstring-alpha-welcome-seen');

// Clear test mode folder
localStorage.removeItem('test_redstring_workspace_folder_path');

// Clear test mode IndexedDB
indexedDB.deleteDatabase('test_RedstringFolderStorage');

// Reload
window.location.reload();
```

### Debug Menu Option

The Debug menu includes "Reset Onboarding Flow" which will:
- Clear the onboarding completion flag
- Clear stored folder handles
- Reload the page

This works in both normal and test mode depending on which mode you're in.

## Recommended Test Folder Structure

Create a separate test folder to avoid confusion:

```
~/Documents/
  ├── Redstring/           # Your real workspace
  │   ├── default.redstring
  │   └── project.redstring
  └── RedstringTest/       # Test mode workspace
      └── default.redstring
```

This way you can safely test onboarding without risking your actual data.
