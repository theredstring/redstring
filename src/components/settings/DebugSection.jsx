import React, { useEffect, useState } from 'react';
import useGraphStore from '../../store/graphStore.js';
import { getStorageKey } from '../../utils/storageUtils.js';
import debugConfig from '../../utils/debugConfig.js';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import DialogGallery from './DialogGallery.jsx';

/**
 * Debug settings, moved here from the Debug submenu in RedstringMenu.
 *
 * Same switches, one surface, and reachable on a phone — the menu version was a
 * hover-driven cascade, which is why half of these were console-only in
 * practice. Hidden behind five taps on About, the way a build-number easter egg
 * works, so it is out of the way without being developer-only.
 */

/** The Settings toggle, restated so this section stands on its own. */
const Toggle = ({ checked, onChange, disabled = false }) => (
  <label className="settings-toggle" style={disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span className="settings-toggle-track" />
    <span className="settings-toggle-thumb" />
  </label>
);

const LAYOUT_ALGORITHMS = [
  { label: 'Pattern', value: 'pattern' },
  { label: 'Force', value: 'node-driven' },
  { label: 'Euler', value: 'euler' },
  { label: 'Hybrid', value: 'hybrid' }
];

/** A row whose control is a single button: label and reason on the left. */
const ActionRow = ({ title, description, actionLabel, onClick }) => (
  <div className="settings-row">
    <div className="settings-row-label">
      {title}
      {description && <div className="settings-row-description">{description}</div>}
    </div>
    <PanelIconButton
      label={actionLabel}
      labelFontSize={11}
      variant="outline"
      onClick={onClick}
      style={{ padding: '5px 12px', flexShrink: 0 }}
    />
  </div>
);

const DebugSection = ({ onCloseSettings, onRelock }) => {
  const [settings, setSettings] = useState(() => debugConfig.getConfig());

  useEffect(() => debugConfig.addListener(setSettings), []);

  const groupLayoutAlgorithm = useGraphStore(s => s.autoLayoutSettings?.groupLayoutAlgorithm || 'node-driven');
  const showClusterHulls = useGraphStore(s => s.autoLayoutSettings?.showClusterHulls || false);

  const resetOnboarding = async () => {
    try {
      localStorage.removeItem(getStorageKey('redstring-welcome-seen'));
      localStorage.removeItem(getStorageKey('redstring_workspace_folder_path'));
      indexedDB.deleteDatabase(getStorageKey('RedstringFolderStorage'));
      sessionStorage.clear();
      console.log('[Debug] Onboarding state reset - reloading...');
      window.location.reload();
    } catch (error) {
      console.error('[Debug] Failed to reset onboarding:', error);
    }
  };

  return (
    <div>
      <div className="settings-section-subtitle">Overlays</div>
      <div className="settings-row">
        <div className="settings-row-label">
          Debug Overlay
          <div className="settings-row-description">On-canvas readout of viewport, selection, and sync state</div>
        </div>
        <Toggle
          checked={!!settings.showDebugOverlay}
          onChange={(v) => debugConfig.setDebugOverlayEnabled(v)}
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          Thing Hitboxes
          <div className="settings-row-description">Draw the region that actually receives clicks around each Thing</div>
        </div>
        <Toggle
          checked={!!settings.showNodeHitboxes}
          onChange={(v) => debugConfig.setNodeHitboxesEnabled(v)}
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          Cluster Hulls
          <div className="settings-row-description">Outline each connected group of Things on the canvas</div>
        </div>
        <Toggle
          checked={!!showClusterHulls}
          onChange={() => useGraphStore.getState().toggleShowClusterHulls?.()}
        />
      </div>

      <hr className="settings-section-divider" />

      <div className="settings-section-subtitle">Layout</div>
      <div className="settings-row">
        <div className="settings-row-label">
          Group Layout Algorithm
          <div className="settings-row-description">
            Pattern detects each component's shape and lays it out predictably, falling back to
            Force for tangled Webs and for Webs with groups. Euler places regions first.
          </div>
        </div>
        <div className="settings-option-group">
          {LAYOUT_ALGORITHMS.map(opt => (
            <PanelIconButton
              key={opt.value}
              label={opt.label}
              labelFontSize={11}
              variant="outline"
              active={groupLayoutAlgorithm === opt.value}
              onClick={() => useGraphStore.getState().setGroupLayoutAlgorithm?.(opt.value)}
              style={{ padding: '5px 12px' }}
            />
          ))}
        </div>
      </div>
      <ActionRow
        title="Generate Test Graph"
        description="Build a throwaway Web of a chosen size and shape"
        actionLabel="Open"
        onClick={() => {
          // Settings is a full-screen overlay, so it has to get out of the way
          // before the generator modal it opens is visible.
          onCloseSettings?.();
          window.dispatchEvent(new Event('redstring:open-auto-graph-modal'));
        }}
      />

      <hr className="settings-section-divider" />

      <div className="settings-section-subtitle">Features</div>
      <div className="settings-row">
        <div className="settings-row-label">
          The Wizard
          <div className="settings-row-description">The AI panel and its tool-calling loop</div>
        </div>
        <Toggle
          checked={!!settings.enableWizard}
          onChange={(v) => debugConfig.setWizardEnabled(v)}
        />
      </div>

      <hr className="settings-section-divider" />

      <div className="settings-section-subtitle">Storage</div>
      <div className="settings-row">
        <div className="settings-row-label">
          Disable Local Storage
          <div className="settings-row-description">
            Everything not already written to a file or a repo is lost on reload. For testing a
            first-run device.
          </div>
        </div>
        <Toggle
          checked={!!settings.disableLocalStorage}
          onChange={(v) => debugConfig.setLocalStorageDisabled(v)}
        />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">
          Force Git-Only Mode
          <div className="settings-row-description">Behave as if no local file access exists, whatever the device reports</div>
        </div>
        <Toggle
          checked={!!settings.forceGitOnly}
          onChange={(v) => debugConfig.setForceGitOnly(v)}
        />
      </div>

      <hr className="settings-section-divider" />

      <div className="settings-section-subtitle">Logging</div>
      <div className="settings-row">
        <div className="settings-row-label">
          Debug Logging
          <div className="settings-row-description">Verbose console output across the save, sync, and layout paths</div>
        </div>
        <Toggle
          checked={!!settings.debugMode}
          onChange={(v) => debugConfig.setDebugMode(v)}
        />
      </div>
      <ActionRow
        title="Print Debug Info"
        description="Current flags and the URL parameters that set them, to the console"
        actionLabel="Print"
        onClick={() => debugConfig.logToConsole()}
      />

      <hr className="settings-section-divider" />

      <div className="settings-section-subtitle">Maintenance</div>
      <ActionRow
        title="Repair Broken Web Links"
        description="Re-point definitions whose Web no longer exists"
        actionLabel="Repair"
        onClick={() => useGraphStore.getState().repairGraphLinkages()}
      />
      <ActionRow
        title="Reset Onboarding"
        description="Clear the welcome flag, the workspace folder, and session state, then reload"
        actionLabel="Reset"
        onClick={resetOnboarding}
      />
      <ActionRow
        title="Reset Debug Settings"
        description="Return every switch on this page to its default"
        actionLabel="Reset"
        onClick={() => debugConfig.reset()}
      />

      <hr className="settings-section-divider" />

      <div className="settings-section-subtitle">Dialogs</div>
      <div
        className="settings-row-description"
        style={{ marginTop: '-4px', marginBottom: '8px', lineHeight: 1.5 }}
      >
        Each of these normally appears only when the thing it warns about has already happened.
        Opening one here uses stand-in data and changes nothing.
      </div>
      <DialogGallery />

      <hr className="settings-section-divider" />

      <ActionRow
        title="Hide This Page"
        description="Tap About five times to bring it back"
        actionLabel="Hide"
        onClick={() => onRelock?.()}
      />
    </div>
  );
};

export default DebugSection;
