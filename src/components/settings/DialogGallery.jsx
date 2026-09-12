import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../hooks/useTheme.js';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import SlotConflictDialog from '../shared/SlotConflictDialog.jsx';
import UniverseTargetConflictDialog from '../shared/UniverseTargetConflictDialog.jsx';
import LocalFileConflictDialog from '../shared/LocalFileConflictDialog.jsx';
import MergeUniverseDialog from '../shared/MergeUniverseDialog.jsx';
import ConfirmDialog from '../shared/ConfirmDialog.jsx';
import CanvasConfirmDialog from '../shared/CanvasConfirmDialog.jsx';
import WizardIntentModal from '../wizard/WizardIntentModal.jsx';
import { SURFACES as WIZARD_SURFACES } from '../../wizard/prompts/intents.js';

/**
 * Every dialog in the app, openable on demand with stand-in data.
 *
 * These dialogs only appear when something has gone wrong — two universes
 * writing one file, a local copy disagreeing with the remote, an empty store
 * about to land on a populated one. Checking how one reads has meant staging
 * the failure it announces, on real data, which is how you lose the data. So
 * they are all reachable from here instead.
 *
 * Nothing here touches a store, a file, or a remote: the handlers close the
 * preview and note which one fired, so the row tells you which button you just
 * pressed. That readout is the point of previewing a dialog whose buttons are
 * the whole decision.
 */

const HOUR = 60 * 60 * 1000;
const now = Date.now();

/** Repo-ish paths and counts big enough that the number formatting shows. */
const FIXTURES = {
  localSlot: {
    path: '~/Documents/Redstring/nerd.redstring',
    nodeCount: 518,
    graphCount: 59,
    timestamp: now - 2 * HOUR
  },
  gitSlot: {
    repoLabel: 'grantiguess/Ontologies',
    path: 'universes/ii/ii.redstring',
    nodeCount: 512,
    graphCount: 58,
    timestamp: now - 20 * 60 * 1000
  },
  existingOption: {
    role: 'Currently Linked',
    displayPath: '~/Documents/Redstring/nerd.redstring',
    nodeCount: 518,
    edgeCount: 1204,
    lastSaved: now - 2 * HOUR
  },
  incomingOption: {
    role: 'Newly Picked',
    displayPath: '~/Downloads/nerd (1).redstring',
    nodeCount: 44,
    edgeCount: 96,
    fileModified: now - 5 * 60 * 1000
  },
  activeUniverse: { slug: 'nerd', name: 'Nerd', nodeCount: 518, graphCount: 59, connectionCount: 1204 },
  otherUniverse: { slug: 'ii', name: 'ii', nodeCount: 44, graphCount: 6, connectionCount: 96 },
  mergeReport: {
    addedPrototypeIds: new Array(41).fill('x'),
    dedupedIds: new Array(3).fill('x'),
    mergedIds: new Array(7).fill('x'),
    addedGraphIds: new Array(6).fill('x'),
    mergedGraphIds: new Array(1).fill('x'),
    addedEdgeIds: new Array(88).fill('x'),
    closeMatchCandidates: new Array(9).fill('x'),
    sameAsCandidates: new Array(2).fill('x')
  },
  // CanvasConfirmDialog bails out without a rect, since it normally reads one
  // off the live canvas element.
  containerRect: { left: 0, top: 0, width: 1200, height: 800 }
};

/**
 * @param {Function} fire - `(handlerName) => void`, closes the preview and
 *   records which button was pressed.
 */
const DIALOGS = [
  {
    key: 'slot-conflict',
    name: 'Slot Conflict',
    note: 'The local file and the git remote for one universe hold different data.',
    render: (fire) => (
      <SlotConflictDialog
        isOpen
        universeName="Nerd"
        localSlot={FIXTURES.localSlot}
        gitSlot={FIXTURES.gitSlot}
        onChooseLocal={() => fire('onChooseLocal')}
        onChooseGit={() => fire('onChooseGit')}
        onCancel={() => fire('onCancel')}
      />
    )
  },
  {
    key: 'target-collision',
    name: 'Universe Target Collision',
    note: 'Two universes are configured to write the same file, so each overwrites the other.',
    render: (fire) => (
      <UniverseTargetConflictDialog
        isOpen
        targetPath="grantiguess/Ontologies · universes/ii/ii.redstring"
        claimants={[
          { slug: 'ii', name: 'ii', nodeCount: 44, graphCount: 6 },
          { slug: 'ii-2', name: 'Nerd', nodeCount: 518, graphCount: 59 }
        ]}
        onKeep={(slug) => fire(`onKeep("${slug}")`)}
        onCancel={() => fire('onCancel')}
      />
    )
  },
  {
    key: 'local-file-conflict',
    name: 'Local File Conflict',
    note: 'More than one local file claims to be the same universe.',
    render: (fire) => (
      <LocalFileConflictDialog
        isOpen
        universeName="Nerd"
        existingOption={FIXTURES.existingOption}
        incomingOption={FIXTURES.incomingOption}
        onChooseExisting={() => fire('onChooseExisting')}
        onOverwrite={() => fire('onOverwrite')}
        onCancel={() => fire('onCancel')}
      />
    )
  },
  {
    key: 'merge-choose',
    name: 'Merge Universes — choose',
    note: 'Picking which universe the combined result lives in.',
    render: (fire, { mergeDest, setMergeDest, foldSameAs, setFoldSameAs }) => (
      <MergeUniverseDialog
        isOpen
        phase="choose"
        activeUniverse={FIXTURES.activeUniverse}
        otherUniverse={FIXTURES.otherUniverse}
        destSlug={mergeDest}
        onDestChange={setMergeDest}
        foldSameAs={foldSameAs}
        onFoldSameAsChange={setFoldSameAs}
        onConfirm={() => fire('onConfirm')}
        onClose={() => fire('onClose')}
      />
    )
  },
  {
    key: 'merge-working',
    name: 'Merge Universes — working',
    note: 'The spinner phase. Its scrim ignores clicks, so use Close Preview.',
    render: (fire) => (
      <MergeUniverseDialog
        isOpen
        phase="working"
        activeUniverse={FIXTURES.activeUniverse}
        otherUniverse={FIXTURES.otherUniverse}
        incomingUniverse={FIXTURES.otherUniverse}
        onClose={() => fire('onClose')}
      />
    )
  },
  {
    key: 'merge-result',
    name: 'Merge Universes — result',
    note: 'The report, including the possible-duplicates handoff to the merge modal.',
    render: (fire) => (
      <MergeUniverseDialog
        isOpen
        phase="result"
        activeUniverse={FIXTURES.activeUniverse}
        otherUniverse={FIXTURES.otherUniverse}
        destination={FIXTURES.activeUniverse}
        incomingUniverse={FIXTURES.otherUniverse}
        report={FIXTURES.mergeReport}
        onDisconnectSource={() => fire('onDisconnectSource')}
        onReviewDuplicates={() => fire('onReviewDuplicates')}
        onClose={() => fire('onClose')}
      />
    )
  },
  {
    key: 'merge-result-error',
    name: 'Merge Universes — failed',
    note: 'The same phase when the merge threw. Nothing was changed.',
    render: (fire) => (
      <MergeUniverseDialog
        isOpen
        phase="result"
        activeUniverse={FIXTURES.activeUniverse}
        otherUniverse={FIXTURES.otherUniverse}
        destination={FIXTURES.activeUniverse}
        incomingUniverse={FIXTURES.otherUniverse}
        error="Could not read “ii”: the file is not valid Redstring data."
        onClose={() => fire('onClose')}
      />
    )
  },
  {
    key: 'confirm-default',
    name: 'Confirm — default',
    note: 'The ordinary yes/no.',
    render: (fire) => (
      <ConfirmDialog
        isOpen
        title="Leave this Web?"
        message="You have unsaved changes to the layout."
        confirmLabel="Leave"
        cancelLabel="Stay"
        onConfirm={() => fire('onConfirm')}
        onCancel={() => fire('onCancel')}
        onClose={() => fire('onClose')}
      />
    )
  },
  {
    key: 'confirm-danger',
    name: 'Confirm — danger, with details',
    note: 'The destructive variant, with the detail block that carries the specifics.',
    render: (fire) => (
      <ConfirmDialog
        isOpen
        variant="danger"
        title="Delete this Thing?"
        message="“Semiotics” is used in 4 Webs. Deleting it removes every instance and the connections that reach them."
        details={'4 Webs · 11 instances · 26 connections\nThis cannot be undone from the file, only from history.'}
        confirmLabel="Delete"
        onConfirm={() => fire('onConfirm')}
        onCancel={() => fire('onCancel')}
        onClose={() => fire('onClose')}
      />
    )
  },
  {
    key: 'confirm-input',
    name: 'Confirm — with input',
    note: 'The naming variant. Confirm stays disabled until the field has something in it.',
    render: (fire) => (
      <ConfirmDialog
        isOpen
        title="Name this Web"
        message="This Web will hold the definition of “Semiotics”."
        inputField={{ label: 'Web name', placeholder: 'Untitled Web', defaultValue: '' }}
        confirmLabel="Create"
        onConfirm={(value) => fire(`onConfirm("${value}")`)}
        onCancel={() => fire('onCancel')}
        onClose={() => fire('onClose')}
      />
    )
  },
  {
    key: 'canvas-confirm',
    name: 'Canvas Confirm',
    note: 'The lighter on-canvas ask, with a third option and the don’t-ask-again checkbox.',
    render: (fire, { dontAsk, setDontAsk }) => (
      <CanvasConfirmDialog
        isOpen
        title="Add to group?"
        message="“Peirce” was dropped inside “Pragmatists”. Add it to the group, or leave it sitting on top?"
        confirmLabel="Add"
        cancelLabel="Leave it"
        secondaryConfirmLabel="Add all 3"
        containerRect={FIXTURES.containerRect}
        showDontAskAgain
        dontAskAgainChecked={dontAsk}
        onDontAskAgainChange={setDontAsk}
        onConfirm={() => fire('onConfirm')}
        onSecondaryConfirm={() => fire('onSecondaryConfirm')}
        onCancel={() => fire('onCancel')}
        onClose={() => fire('onClose')}
      />
    )
  },
  {
    key: 'wizard-intent',
    name: 'Ask The Wizard',
    note: 'The intent picker. Default pre-selected, an always-present Other box, and a sticky add-to-current checkbox.',
    render: (fire, { wizardDestination, setWizardDestination }) => (
      <WizardIntentModal
        isOpen
        surface={WIZARD_SURFACES.THING}
        facts={{ webInstanceCount: 6, hasLadder: true }}
        subjectLabel={'"Rotterdam"'}
        destination={wizardDestination}
        onDestinationChange={setWizardDestination}
        onConfirm={() => fire('onConfirm')}
        onClose={() => fire('onClose')}
      />
    )
  }
];

const DialogGallery = () => {
  const theme = useTheme();
  const [openKey, setOpenKey] = useState(null);
  const [lastAction, setLastAction] = useState({});

  // Controlled bits some dialogs need so their inputs actually respond.
  const [mergeDest, setMergeDest] = useState('nerd');
  const [foldSameAs, setFoldSameAs] = useState(true);
  const [dontAsk, setDontAsk] = useState(false);
  const [wizardDestination, setWizardDestination] = useState('new');

  const open = useMemo(() => DIALOGS.find((d) => d.key === openKey) || null, [openKey]);

  // Several of these call a choice handler and then `onClose` in the same click,
  // so only the first one through says what was actually pressed.
  const firedRef = useRef(false);

  const openPreview = (key) => {
    firedRef.current = false;
    setOpenKey(key);
  };

  const fire = (handlerName) => {
    if (firedRef.current) return;
    firedRef.current = true;
    setLastAction((prev) => ({ ...prev, [openKey]: handlerName }));
    setOpenKey(null);
  };

  return (
    <div>
      {DIALOGS.map((dialog) => (
        <div className="settings-row" key={dialog.key}>
          <div className="settings-row-label">
            {dialog.name}
            <div className="settings-row-description">
              {dialog.note}
              {lastAction[dialog.key] && (
                <span style={{ color: theme.canvas.textPrimary }}>
                  {' '}Last pressed: <strong>{lastAction[dialog.key]}</strong>
                </span>
              )}
            </div>
          </div>
          <PanelIconButton
            label="Show"
            labelFontSize={11}
            variant="outline"
            onClick={() => openPreview(dialog.key)}
            style={{ padding: '5px 12px', flexShrink: 0 }}
          />
        </div>
      ))}

      {open && typeof document !== 'undefined' && createPortal(
        // Settings sits at z-index 20201 and every dialog here asks for 10000,
        // so a preview would open behind the page that launched it. The wrapper
        // takes a stacking context above Settings and the dialog's own z-index
        // then applies inside it.
        <div style={{ position: 'relative', zIndex: 30000 }}>
          {open.render(fire, { mergeDest, setMergeDest, foldSameAs, setFoldSameAs, dontAsk, setDontAsk, wizardDestination, setWizardDestination })}
          {/* The working phase of a merge deliberately swallows scrim clicks,
              and a dialog under review may have no dismiss at all. */}
          <button
            type="button"
            onClick={() => setOpenKey(null)}
            style={{
              position: 'fixed',
              top: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '6px 14px',
              borderRadius: 8,
              border: `2px solid ${theme.canvas.textPrimary}`,
              backgroundColor: theme.canvas.bg,
              color: theme.canvas.textPrimary,
              fontFamily: "'EmOne', sans-serif",
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: 'pointer'
            }}
          >
            Close Preview
          </button>
        </div>,
        document.body
      )}
    </div>
  );
};

export default DialogGallery;
