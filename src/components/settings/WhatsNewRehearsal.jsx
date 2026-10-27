import React, { useState } from 'react';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import ActionRow from './ActionRow.jsx';
import {
  APP_VERSION,
  getPreviewVersion,
  isVersion,
  previewAsVersion,
  replayUpdateLaunch,
} from '../help/whatsNewVersion.js';

/**
 * Rehearse a release before it ships: the launch an update gets, and Help ›
 * What's New as another version would show it (its changelog entry and its
 * note). Both reload the app.
 */
const WhatsNewRehearsal = () => {
  const preview = getPreviewVersion();
  const [draft, setDraft] = useState(preview || '');
  const valid = isVersion(draft);

  return (
    <>
      <ActionRow
        title="Replay Update Launch"
        description="Reload as if this device had just updated, so What's New opens on its own"
        actionLabel="Replay"
        onClick={replayUpdateLaunch}
      />
      <div className="settings-row">
        <div className="settings-row-label">
          Preview as Version
          <div className="settings-row-description">
            {preview
              ? `Standing in for ${preview}. This build is ${APP_VERSION}.`
              : `Reload as if updating from ${APP_VERSION} to this version. An [Unreleased] changelog entry shows as it.`}
          </div>
        </div>
        <input
          className="modal-input"
          aria-label="Version to preview"
          placeholder="1.0.0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && valid) previewAsVersion(draft); }}
          style={{ width: '110px', flex: '0 0 auto' }}
        />
        <PanelIconButton
          label="Preview"
          labelFontSize={11}
          variant="outline"
          disabled={!valid}
          onClick={() => previewAsVersion(draft)}
          style={{ padding: '5px 12px', flexShrink: 0 }}
        />
        {preview && (
          <PanelIconButton
            label="Stop"
            labelFontSize={11}
            variant="outline"
            onClick={() => previewAsVersion(null)}
            style={{ padding: '5px 12px', flexShrink: 0 }}
          />
        )}
      </div>
    </>
  );
};

export default WhatsNewRehearsal;
