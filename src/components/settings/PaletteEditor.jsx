import React, { useEffect, useMemo, useState } from 'react';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import { PALETTES } from '../../ai/palettes.js';
import { getTextColor } from '../../utils/colorUtils.js';
import { getStorageKey } from '../../utils/storageUtils.js';
import { NODE_CORNER_RADIUS } from '../../constants.js';
import { LIGHT_THEME, DARK_THEME } from '../../utils/themeColors.js';
import { useDarkMode } from '../../hooks/useTheme.js';

/**
 * A scratch copy of the Wizard's palettes (src/ai/palettes.js), for tuning how
 * the name reads on each fill.
 *
 * Nothing here changes what the app uses. Each swatch is drawn the way a Thing
 * is — bold EmOne, text color from the same getTextColor the canvas uses — so
 * what you see is what a node in that color will look like. When it reads right,
 * Copy JSON puts the edited palettes on the clipboard in the same shape as
 * PALETTES, ready to paste back into the source.
 *
 * The draft lives in localStorage so a reload doesn't lose an evening's tuning.
 */

const DRAFT_KEY = 'redstring-debug-palette-draft';
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

const clonePalettes = (src) => JSON.parse(JSON.stringify(src));

const loadDraft = () => {
  try {
    const raw = localStorage.getItem(getStorageKey(DRAFT_KEY));
    if (!raw) return clonePalettes(PALETTES);
    const saved = JSON.parse(raw);
    // Lay the saved edits over the current source so palettes or colors added
    // to palettes.js since the draft was saved still show up.
    const merged = clonePalettes(PALETTES);
    for (const [key, palette] of Object.entries(merged)) {
      for (const colorKey of Object.keys(palette.colors)) {
        const hex = saved?.[key]?.colors?.[colorKey];
        if (HEX_RE.test(hex)) palette.colors[colorKey] = hex;
      }
    }
    return merged;
  } catch {
    return clonePalettes(PALETTES);
  }
};

const saveDraft = (draft) => {
  try {
    localStorage.setItem(getStorageKey(DRAFT_KEY), JSON.stringify(draft));
  } catch {
    // Storage blocked or disabled — the draft just won't survive a reload.
  }
};

/** WCAG relative luminance of a #rrggbb color. */
const luminance = (hex) => {
  const channel = (i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

const contrastRatio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const CANVAS_MODES = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'Both', value: 'both' }
];

/**
 * The fill drawn as a Thing on a patch of canvas. The corner number is the fill
 * against the canvas — how well the node's edge separates from the background,
 * which is a different question from whether its name reads.
 */
const CanvasPreview = ({ hex, label, canvas }) => {
  const edgeRatio = contrastRatio(hex, canvas.bg);
  return (
    <div style={{ background: canvas.bg, borderRadius: 8, padding: '8px 8px 4px' }}>
      <div
        style={{
          background: hex,
          color: getTextColor(hex),
          borderRadius: NODE_CORNER_RADIUS / 3,
          padding: '12px 10px',
          fontFamily: "'EmOne', sans-serif",
          fontWeight: 'bold',
          fontSize: 15,
          lineHeight: 1.2,
          textAlign: 'center',
          overflowWrap: 'break-word',
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {label}
      </div>
      <div
        title="Contrast of the fill against this canvas (WCAG)"
        style={{
          fontSize: 10,
          textAlign: 'right',
          marginTop: 3,
          color: canvas.textSecondary,
          fontWeight: edgeRatio < 1.5 ? 700 : 400
        }}
      >
        edge {edgeRatio.toFixed(1)}:1{edgeRatio < 1.5 ? ' low' : ''}
      </div>
    </div>
  );
};

/** One color: its previews on the chosen canvases, its label contrast, and the controls to change it. */
const Swatch = ({ colorKey, hex, sourceHex, sampleText, canvases, onChange }) => {
  const [text, setText] = useState(hex);
  useEffect(() => setText(hex), [hex]);

  const ratio = contrastRatio(hex, getTextColor(hex));
  const changed = hex.toLowerCase() !== sourceHex.toLowerCase();

  const commitText = (value) => {
    const v = value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`;
    if (HEX_RE.test(v)) onChange(v.toLowerCase());
    else setText(hex);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {canvases.map((canvas, i) => (
          <CanvasPreview key={i} hex={hex} label={sampleText || colorKey} canvas={canvas} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="color"
          value={hex.toLowerCase()}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          aria-label={`${colorKey} color`}
          style={{ width: 26, height: 26, padding: 0, border: 'none', background: 'none', flexShrink: 0, cursor: 'pointer' }}
        />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          spellCheck={false}
          aria-label={`${colorKey} hex`}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: 'monospace',
            fontSize: 12,
            padding: '4px 6px',
            borderRadius: 6,
            border: '1px solid var(--rs-modal-border)',
            background: 'var(--rs-modal-sunken)',
            color: 'var(--rs-modal-text)'
          }}
        />
      </div>
      <div className="settings-row-description" style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {colorKey}{changed ? ' •' : ''}
        </span>
        {/* 4.5 is WCAG AA for body text; bold labels this size pass AA at 3. */}
        <span style={{ fontWeight: ratio < 3 ? 700 : 400, flexShrink: 0 }} title="Contrast of the label against the fill (WCAG)">
          text {ratio.toFixed(1)}:1{ratio < 3 ? ' low' : ''}
        </span>
      </div>
    </div>
  );
};

const PaletteEditor = () => {
  const [draft, setDraft] = useState(loadDraft);
  const [sampleText, setSampleText] = useState('');
  const [copied, setCopied] = useState(false);
  const darkMode = useDarkMode();
  const [canvasMode, setCanvasMode] = useState(darkMode ? 'dark' : 'light');

  const canvases = canvasMode === 'both'
    ? [LIGHT_THEME.canvas, DARK_THEME.canvas]
    : [(canvasMode === 'dark' ? DARK_THEME : LIGHT_THEME).canvas];

  useEffect(() => saveDraft(draft), [draft]);

  const changedCount = useMemo(() => {
    let n = 0;
    for (const [key, palette] of Object.entries(draft)) {
      for (const [colorKey, hex] of Object.entries(palette.colors)) {
        if (hex.toLowerCase() !== PALETTES[key]?.colors?.[colorKey]?.toLowerCase()) n++;
      }
    }
    return n;
  }, [draft]);

  const setColor = (paletteKey, colorKey, hex) => {
    setDraft(prev => ({
      ...prev,
      [paletteKey]: {
        ...prev[paletteKey],
        colors: { ...prev[paletteKey].colors, [colorKey]: hex }
      }
    }));
  };

  const resetPalette = (paletteKey) => {
    setDraft(prev => ({ ...prev, [paletteKey]: clonePalettes(PALETTES[paletteKey]) }));
  };

  const copyJson = async () => {
    const json = JSON.stringify(draft, null, 4);
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      // Clipboard denied (insecure context, no focus) — the console is the fallback.
      console.log('[Palettes] Clipboard unavailable, JSON follows:\n' + json);
      console.error('[Palettes] Copy failed:', error);
    }
  };

  return (
    <div>
      <div className="settings-row">
        <div className="settings-row-label">
          Draft Palettes
          <div className="settings-row-description">
            {changedCount === 0
              ? 'Edit any color to preview how names read on it. Nothing here changes the app.'
              : `${changedCount} color${changedCount === 1 ? '' : 's'} changed from the source.`}
          </div>
        </div>
        <div className="settings-option-group">
          <PanelIconButton
            label={copied ? 'Copied' : 'Copy JSON'}
            labelFontSize={11}
            variant="outline"
            onClick={copyJson}
            style={{ padding: '5px 12px' }}
          />
          <PanelIconButton
            label="Reset All"
            labelFontSize={11}
            variant="outline"
            onClick={() => setDraft(clonePalettes(PALETTES))}
            style={{ padding: '5px 12px' }}
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          Sample Name
          <div className="settings-row-description">Shown on every swatch in place of the color's name</div>
        </div>
        <input
          type="text"
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          placeholder="Color name"
          style={{
            width: 160,
            fontSize: 13,
            padding: '5px 8px',
            borderRadius: 6,
            border: '1px solid var(--rs-modal-border)',
            background: 'var(--rs-modal-sunken)',
            color: 'var(--rs-modal-text)'
          }}
        />
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          Canvas
          <div className="settings-row-description">The background each swatch is previewed on</div>
        </div>
        <div className="settings-option-group">
          {CANVAS_MODES.map(opt => (
            <PanelIconButton
              key={opt.value}
              label={opt.label}
              labelFontSize={11}
              variant="outline"
              active={canvasMode === opt.value}
              onClick={() => setCanvasMode(opt.value)}
              style={{ padding: '5px 12px' }}
            />
          ))}
        </div>
      </div>

      {Object.entries(draft).map(([paletteKey, palette]) => (
        <div key={paletteKey} style={{ padding: '12px 0', borderBottom: '1px solid var(--rs-modal-hairline)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="settings-row-label" style={{ flex: 'none' }}>
              {palette.name}
              <span className="settings-row-description" style={{ marginLeft: 8, display: 'inline' }}>{paletteKey}</span>
            </div>
            <PanelIconButton
              label="Reset"
              labelFontSize={11}
              variant="outline"
              onClick={() => resetPalette(paletteKey)}
              style={{ padding: '3px 10px' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
            {Object.entries(palette.colors).map(([colorKey, hex]) => (
              <Swatch
                key={colorKey}
                colorKey={colorKey}
                hex={hex}
                sourceHex={PALETTES[paletteKey]?.colors?.[colorKey] ?? hex}
                sampleText={sampleText}
                canvases={canvases}
                onChange={(v) => setColor(paletteKey, colorKey, v)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default PaletteEditor;
