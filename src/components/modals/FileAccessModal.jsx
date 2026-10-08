import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Key, Folder, FileText, Check, Lock, Globe, ChevronDown, Download, RefreshCw, X } from 'lucide-react';
import CanvasModal from '../CanvasModal';
import { MODAL_CLOSE_ICON_SIZE } from '../../constants.js';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import { useTheme } from '../../hooks/useTheme.js';

/**
 * Let Redstring back into the files the browser locked.
 *
 * On the web, the browser takes file access back whenever Redstring's last tab
 * closes. The handles are still saved, so nothing has to be picked again, but
 * the browser will only hand access back after a click. That click used to
 * live on a small Grant Access button inside one universe's card in the
 * Universes panel, and the workspace folder losing access was a banner in the
 * same panel. From the canvas all anyone saw was a loading card that said to
 * grant access, with no way to do it — people stalled there and left.
 *
 * This puts the click in front of them. It names exactly what is locked (the
 * workspace folder, the universe's file, or both), takes one click to ask the
 * browser for all of it, and loads the universe when access is back. For
 * Chrome it points at "Allow on every visit", the browser's own way of never
 * asking again, and it offers the desktop app, which has no such lock.
 *
 * Framed like GitReconnectModal and onboarding (full-screen CanvasModal), and
 * closes itself once everything is allowed and the universe is loaded.
 */
const AUTO_CLOSE_DELAY_MS = 600;

const FileAccessModal = ({
  isVisible,
  onClose,
  onResolved = null, // () => void — all allowed and loaded; host closes us
  access = null, // readFileAccess() shape: { universeName, folder, file }
  loaded = false, // the universe is in the store
  errorMessage = null, // the load error, for Details
  onGrant, // async () => void; must run in the click. Throws a user-facing message.
  onOpenUniverses = null,
  showChromeTip = false,
  offerDesktop = false,
  onDownloadDesktop = null
}) => {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200));
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 900));

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Natural height of the content, so the modal is sized to it. A
  // ResizeObserver because it changes in place: rows flipping to Allowed, an
  // error appearing, details expanding.
  const contentRef = useRef(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!isVisible || !el) {
      setMeasuredHeight(0);
      return undefined;
    }
    const measure = () => {
      const next = Math.ceil(el.getBoundingClientRect().height);
      setMeasuredHeight((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      setActionError(null);
      setShowDetails(false);
    }
  }, [isVisible]);

  const universeName = access?.universeName || 'this universe';
  const folder = access?.folder || null;
  const file = access?.file || null;
  const entries = [folder, file].filter(Boolean);
  const pending = entries.filter((entry) => entry.state !== 'granted');
  const blocked = entries.some((entry) => entry.state === 'denied');
  const allAllowed = pending.length === 0;

  // Done: allowed and loaded. A beat first, so the rows are seen to flip.
  // The callback rides a ref: hosts pass it inline.
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  useEffect(() => {
    if (!isVisible || !loaded || !allAllowed || busy) return undefined;
    const timer = setTimeout(() => onResolvedRef.current?.(), AUTO_CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isVisible, loaded, allAllowed, busy]);

  const grant = async () => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await onGrant?.();
    } catch (err) {
      setActionError(err?.message || 'Access couldn’t be restored.');
    } finally {
      setBusy(false);
    }
  };

  // What not having access is costing, in the person's terms.
  const consequence = (() => {
    if (allAllowed) return null;
    if (!loaded) return 'Nothing has been changed or saved while it was locked.';
    if (file && file.state !== 'granted') {
      return `Until then, changes to ${universeName} aren’t being saved to ${file.name}.`;
    }
    if (folder && folder.state !== 'granted') {
      return `Until then, new universes can’t be saved in ${folder.name}.`;
    }
    return null;
  })();

  // One primary action, whichever moves things forward from here.
  const primary = (() => {
    if (!allAllowed) {
      // The second click, when the browser granted the folder but still wants
      // its own answer for the file: name the one thing left.
      const secondStep = pending.length === 1 && entries.length > 1;
      return {
        icon: Key,
        label: busy ? 'Waiting for your browser…' : secondStep ? `Allow ${pending[0].name}` : 'Allow access',
        onClick: grant,
        disabled: busy
      };
    }
    if (!loaded) {
      return {
        icon: RefreshCw,
        label: busy ? 'Loading…' : `Load ${universeName}`,
        onClick: grant,
        disabled: busy
      };
    }
    return { icon: Check, label: 'Done', onClick: () => onResolved?.(), disabled: false };
  })();

  const isCompact = viewportWidth <= 500;
  const text = (size, extra = {}) => ({
    fontFamily: "'EmOne', sans-serif",
    color: theme.canvas.textPrimary,
    fontSize: size,
    ...extra
  });
  const panelFill = theme.darkMode ? 'rgba(255,255,255,0.05)' : '#DEDADA';

  const row = (entry, Icon, role) => {
    const allowed = entry.state === 'granted';
    const StatusIcon = allowed ? Check : Lock;
    const status = allowed ? 'Allowed' : entry.state === 'denied' ? 'Blocked' : 'Locked';
    return (
      <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
        <Icon size={18} color={theme.canvas.textSecondary} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={text('0.88rem', { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>
            {entry.name}
          </div>
          <div style={text('0.72rem', { color: theme.canvas.textSecondary })}>{role}</div>
        </div>
        <div style={text('0.75rem', {
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexShrink: 0,
          color: allowed ? theme.canvas.brandText : theme.canvas.textSecondary,
          fontWeight: allowed ? 600 : 400
        })}>
          <StatusIcon size={13} />
          {status}
        </div>
      </div>
    );
  };

  // Same frame and sizing as GitReconnectModal.
  const modalMargin = isCompact ? 12 : 20;
  const padX = isCompact ? 20 : 32;
  const padTop = isCompact ? 44 : 52;
  const padBottom = isCompact ? 22 : 28;
  const maxModalHeight = Math.max(280, viewportHeight - modalMargin * 2 - 8);
  const modalHeight = measuredHeight > 0
    ? Math.min(Math.max(measuredHeight + padTop + padBottom, 240), maxModalHeight)
    : Math.min(480, maxModalHeight);
  const modalWidth = isCompact ? Math.min(Math.max(viewportWidth - 24, 300), 540) : 520;

  return (
    <CanvasModal
      isVisible={isVisible}
      onClose={onClose}
      title=""
      width={modalWidth}
      height={modalHeight}
      position="center"
      margin={modalMargin}
      fullScreenOverlay={true}
      contentStyle={{ overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <PanelIconButton
          icon={X}
          onClick={onClose}
          title="Close"
          size={MODAL_CLOSE_ICON_SIZE}
          style={{ position: 'absolute', top: isCompact ? 12 : 16, right: isCompact ? 12 : 16, zIndex: 10 }}
        />
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
          padding: `${padTop}px ${padX}px ${padBottom}px`,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div ref={contentRef} style={{ margin: 'auto 0', width: '100%' }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <h2 style={text(isCompact ? '1.2rem' : '1.45rem', { margin: '0 0 8px 0', color: theme.canvas.brandText, fontWeight: 600 })}>
                {loaded ? 'Let Redstring back into your files' : `Reopen ${universeName}`}
              </h2>
              <p style={text(isCompact ? '0.8rem' : '0.88rem', { margin: 0, opacity: 0.8, lineHeight: 1.45 })}>
                Your browser locks Redstring out of your files whenever it closes.
                {consequence ? <> {consequence}</> : null}
              </p>
            </div>

            {entries.length > 0 && (
              <div style={{
                padding: '4px 12px',
                marginBottom: 14,
                borderRadius: 8,
                border: `1px solid ${theme.canvas.border}`,
                backgroundColor: panelFill
              }}>
                {folder && row(folder, Folder, 'Workspace folder')}
                {file && row(file, FileText, `${universeName}’s file`)}
              </div>
            )}

            {!allAllowed && !blocked && (
              <div style={text('0.82rem', { textAlign: 'center', lineHeight: 1.45, opacity: 0.85 })}>
                {showChromeTip
                  ? <>Chrome will ask next. Choose <strong>Allow on every visit</strong> and you won&rsquo;t be asked again.</>
                  : <>Your browser will ask you to confirm.</>}
              </div>
            )}

            {blocked && (
              <div style={text('0.82rem', { textAlign: 'center', lineHeight: 1.45 })}>
                Your browser is blocking file access for this site. Open the site settings beside the
                address bar, allow it to edit files, then try again.
              </div>
            )}

            {primary && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
                <PanelIconButton
                  icon={primary.icon}
                  label={primary.label}
                  labelPosition="right"
                  size={16}
                  labelFontSize={14}
                  variant="solid"
                  disabled={primary.disabled}
                  onClick={primary.onClick}
                  style={{ padding: '9px 20px' }}
                />
              </div>
            )}

            {actionError && (
              <div style={text('0.78rem', { marginTop: 10, textAlign: 'center', lineHeight: 1.45, overflowWrap: 'anywhere' })}>
                {actionError}
              </div>
            )}

            {offerDesktop && (
              <div style={{
                marginTop: 20,
                paddingTop: 14,
                borderTop: `1px solid ${theme.canvas.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: isCompact ? 'wrap' : 'nowrap'
              }}>
                <div style={text('0.78rem', { lineHeight: 1.45, opacity: 0.85 })}>
                  The desktop app keeps your files linked between sessions, so it never has to ask.
                </div>
                <PanelIconButton
                  icon={Download}
                  label="Get the desktop app"
                  size={13}
                  labelFontSize={12}
                  variant="outline"
                  onClick={onDownloadDesktop}
                  style={{ flexShrink: 0 }}
                />
              </div>
            )}

            <div style={{
              display: 'flex',
              justifyContent: 'center',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 16
            }}>
              {!allAllowed && (
                <PanelIconButton
                  label="Not now"
                  size={13}
                  labelFontSize={12}
                  variant="ghost"
                  onClick={onClose}
                />
              )}
              {onOpenUniverses && (
                <PanelIconButton
                  icon={Globe}
                  label="Go to Universes"
                  size={13}
                  labelFontSize={12}
                  variant="ghost"
                  onClick={onOpenUniverses}
                />
              )}
              {errorMessage && !loaded && (
                <PanelIconButton
                  icon={ChevronDown}
                  label={showDetails ? 'Hide details' : 'Details'}
                  size={13}
                  labelFontSize={12}
                  variant="ghost"
                  onClick={() => setShowDetails((v) => !v)}
                />
              )}
            </div>

            {showDetails && errorMessage && !loaded && (
              <div style={text('0.72rem', {
                marginTop: 8,
                padding: '8px 10px',
                borderRadius: 6,
                border: `1px solid ${theme.canvas.border}`,
                color: theme.canvas.textSecondary,
                fontFamily: 'monospace',
                overflowWrap: 'anywhere',
                maxHeight: 120,
                overflowY: 'auto'
              })}>
                {errorMessage}
              </div>
            )}
          </div>
        </div>
      </div>
    </CanvasModal>
  );
};

export default FileAccessModal;
