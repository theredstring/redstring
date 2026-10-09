import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import useGraphStore from '../../store/graphStore.js';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import ActionRow from './ActionRow.jsx';
import { formatBytes } from '../../utils/formatBytes.js';
import { isCapacitor } from '../../utils/capacitorAdapter.js';
import { getAutoSaveMode, setAutoSaveMode, subscribeAutoSaveMode, AUTO_SAVE_MAX_ITEMS, AUTO_SAVE_MAX_BYTES } from '../../services/autoSaveMode.js';
import { getBackupMode, setBackupMode, subscribeBackupMode, backupUsage, deleteAllBackups } from '../../services/universeBackups.js';
import { measureCachedData, clearCachedData, measureDiscoveryHistory, clearDiscoveryHistory } from '../../services/localCaches.js';
import { exportSettings, importSettings, resetSettings } from '../../services/devicePreferences.js';

/**
 * Settings → Data: how this device keeps universes, and what it keeps besides.
 * Things that belong to one universe (its file, its repository) stay in
 * Universes; this page is for the device.
 */

/** The Settings toggle, restated so this section stands on its own. */
const Toggle = ({ checked, onChange }) => (
  <label className="settings-toggle">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className="settings-toggle-track" />
    <span className="settings-toggle-thumb" />
  </label>
);

/** The pill radio group, restated for the same reason. */
const OptionGroup = ({ options, value, onChange }) => (
  <div className="settings-option-group">
    {options.map(opt => (
      <PanelIconButton
        key={opt.value}
        label={opt.label}
        labelFontSize={11}
        variant="outline"
        active={value === opt.value}
        onClick={() => onChange(opt.value)}
        style={{ padding: '5px 12px' }}
      />
    ))}
  </div>
);

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const DataSection = ({ onCloseSettings }) => {
  const autoSaveMode = useSyncExternalStore(subscribeAutoSaveMode, getAutoSaveMode);
  const backupMode = useSyncExternalStore(subscribeBackupMode, getBackupMode);

  const [backups, setBackups] = useState(null);
  const [cacheBytes, setCacheBytes] = useState(null);
  const [discovery, setDiscovery] = useState(() => measureDiscoveryHistory());
  // A line under a row once its action has run: what happened, or why not.
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(null);
  const importInput = useRef(null);

  const measure = useCallback(() => {
    backupUsage().then(setBackups).catch(() => setBackups(null));
    measureCachedData().then(({ bytes }) => setCacheBytes(bytes)).catch(() => setCacheBytes(null));
    setDiscovery(measureDiscoveryHistory());
  }, []);

  useEffect(() => { measure(); }, [measure]);

  const run = async (key, action) => {
    setBusy(key);
    setNotes((n) => ({ ...n, [key]: null }));
    try {
      const note = await action();
      if (note) setNotes((n) => ({ ...n, [key]: note }));
    } catch (error) {
      setNotes((n) => ({ ...n, [key]: error?.message || 'That did not work' }));
    } finally {
      setBusy(null);
      measure();
    }
  };

  const openBackups = () => {
    useGraphStore.getState().setLeftPanelExpanded(true);
    window.dispatchEvent(new CustomEvent('redstring:open-git-history', { detail: { tab: 'backups' } }));
    onCloseSettings?.();
  };

  const backupSummary = backups && backups.count > 0
    ? `${plural(backups.count, 'copy', 'copies')}, ${formatBytes(backups.bytes)}`
    : 'None yet';

  const showSettingsFile = !isCapacitor();

  return (
    <div>
      <div className="settings-section-subtitle">Saving</div>
      <div className="settings-row">
        <div className="settings-row-label">
          Autosave
          <div className="settings-row-description">
            {autoSaveMode === 'auto'
              ? `Off past ${AUTO_SAVE_MAX_ITEMS.toLocaleString()} items or ${Math.round(AUTO_SAVE_MAX_BYTES / (1024 * 1024))} MB`
              : autoSaveMode === 'always'
                ? 'After every change'
                : 'Only when you save'}
          </div>
        </div>
        <OptionGroup
          options={[
            { value: 'auto', label: 'Adaptive' },
            { value: 'always', label: 'Always' },
            { value: 'off', label: 'Never' }
          ]}
          value={autoSaveMode}
          onChange={setAutoSaveMode}
        />
      </div>

      <hr className="settings-section-divider" />

      <div className="settings-section-subtitle">Backups</div>
      <div className="settings-row">
        <div className="settings-row-label">
          Keep Backups
          <div className="settings-row-description">
            A copy every 10 minutes while you work. Keeps the last 10, then one a day for two weeks.
          </div>
        </div>
        <Toggle checked={backupMode === 'on'} onChange={(on) => setBackupMode(on ? 'on' : 'off')} />
      </div>
      <ActionRow
        title="Restore a Backup"
        description="In History, under Backups"
        actionLabel="Open"
        onClick={openBackups}
      />
      <ActionRow
        title="Delete Backups"
        description={notes.backups || backupSummary}
        actionLabel="Delete"
        confirmLabel="Delete all?"
        busy={busy === 'backups'}
        busyLabel="Deleting…"
        disabled={!backups || backups.count === 0}
        onClick={() => run('backups', async () => { await deleteAllBackups(); return 'Deleted'; })}
      />

      <hr className="settings-section-divider" />

      <div className="settings-section-subtitle">Repair</div>
      <ActionRow
        title="Repair Web Links"
        description={notes.repair || 'Reconnect Things to the Webs that define them'}
        actionLabel="Repair"
        busy={busy === 'repair'}
        onClick={() => run('repair', () => {
          const repaired = useGraphStore.getState().repairGraphLinkages();
          return repaired > 0 ? `Repaired ${plural(repaired, 'link', 'links')}` : 'Nothing needed repair';
        })}
      />

      <hr className="settings-section-divider" />

      <div className="settings-section-subtitle">On This Device</div>
      <ActionRow
        title="Cached Data"
        description={notes.cache || `Label images and lookups, rebuilt as needed${formatBytes(cacheBytes) ? `. ${formatBytes(cacheBytes)}` : ''}`}
        actionLabel="Clear"
        busy={busy === 'cache'}
        busyLabel="Clearing…"
        onClick={() => run('cache', async () => { await clearCachedData(); return 'Cleared'; })}
      />
      <ActionRow
        title="Discovery History"
        description={notes.discovery || (discovery.entries > 0 ? `${plural(discovery.entries, 'search', 'searches')} in Discover` : 'Nothing yet')}
        actionLabel="Clear"
        confirmLabel="Clear all?"
        disabled={discovery.entries === 0 && discovery.bytes === 0}
        onClick={() => run('discovery', () => { clearDiscoveryHistory(); return 'Cleared'; })}
      />

      {showSettingsFile && (
        <>
          <hr className="settings-section-divider" />

          <div className="settings-section-subtitle">Settings</div>
          <ActionRow
            title="Export Settings"
            description="These preferences, as a file"
            actionLabel="Export"
            onClick={exportSettings}
          />
          <ActionRow
            title="Import Settings"
            description={notes.import || 'Use the preferences in a file. Reloads.'}
            actionLabel="Import"
            busy={busy === 'import'}
            onClick={() => importInput.current?.click()}
          />
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) run('import', () => importSettings(file));
            }}
          />
          <ActionRow
            title="Reset Settings"
            description={notes.reset || 'Back to defaults. Reloads.'}
            actionLabel="Reset"
            confirmLabel="Reset all?"
            busy={busy === 'reset'}
            onClick={() => run('reset', () => resetSettings())}
          />
        </>
      )}
    </div>
  );
};

export default DataSection;
