const assert = require('assert');

const { default: useGraphStore } = require('../../src/store/graphStore.js');

// Two things make the panels exclusive, and the store is where both are
// answered so that EVERY path into a panel obeys them — not just the toggle
// buttons, but the node double-click, the pie action, the header tabs.
//
//   a narrow window  — there is no room on screen for two
//   controller mode  — there is no room in the HAND for two: the d-pad is the
//                      panels' one instrument, and it needs one unambiguous
//                      answer to "which panel am I in"
//
// jsdom's window is 1024px wide, which is already below
// EXCLUSIVE_PANEL_MODE_THRESHOLD — so every test here states the width it means
// rather than inheriting one.
describe('panel exclusivity', () => {
  const st = () => useGraphStore.getState();

  const WIDE = 1600;
  const NARROW = 900;

  const setWidth = (px) => {
    Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
  };

  const start = ({ width, inputMode, left, right }) => {
    setWidth(width);
    useGraphStore.setState({
      inputMode,
      leftPanelExpanded: left,
      rightPanelExpanded: right,
    }, false, 'test_reset');
  };

  const panels = () => ({ left: st().leftPanelExpanded, right: st().rightPanelExpanded });

  afterEach(() => setWidth(1024));

  it('lets both panels be open on a wide window with a mouse', () => {
    start({ width: WIDE, inputMode: 'mouse', left: true, right: false });
    st().toggleRightPanel();
    assert.deepStrictEqual(panels(), { left: true, right: true });
  });

  it('closes the other panel when a controller opens one, however wide the window', () => {
    start({ width: WIDE, inputMode: 'gamepad', left: true, right: false });
    st().toggleRightPanel();
    assert.deepStrictEqual(panels(), { left: false, right: true });
  });

  // The same rule has to hold for the paths that ask for a panel by name —
  // double-clicking a node opens the right panel without going near a toggle.
  it('closes the other panel on a direct open in controller mode', () => {
    start({ width: WIDE, inputMode: 'gamepad', left: true, right: false });
    st().setRightPanelExpanded(true);
    assert.deepStrictEqual(panels(), { left: false, right: true });

    st().setLeftPanelExpanded(true);
    assert.deepStrictEqual(panels(), { left: true, right: false });
  });

  it('still closes the other panel on a narrow window with a mouse', () => {
    start({ width: NARROW, inputMode: 'mouse', left: true, right: false });
    st().toggleRightPanel();
    assert.deepStrictEqual(panels(), { left: false, right: true });
  });

  // Exclusivity is about OPENING. Closing a panel must never drag the other
  // one open, or shutting the last panel would be impossible.
  it('leaves the other panel alone when one closes', () => {
    start({ width: WIDE, inputMode: 'gamepad', left: true, right: false });
    st().toggleLeftPanel();
    assert.deepStrictEqual(panels(), { left: false, right: false });

    st().setRightPanelExpanded(false);
    assert.deepStrictEqual(panels(), { left: false, right: false });
  });
});
