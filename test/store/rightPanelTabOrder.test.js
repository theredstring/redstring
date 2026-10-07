import { describe, it, expect, beforeEach } from 'vitest';
import useGraphStore from '../../src/store/graphStore.js';

// A Thing's type opened from that Thing's page lands just right of the page,
// not at the far end of the strip. Other opens still append.
describe('right panel tab ordering', () => {
  const st = () => useGraphStore.getState();
  const proto = (id) => [id, { id, name: id.toUpperCase(), definitionGraphIds: [] }];

  beforeEach(() => {
    useGraphStore.setState({
      nodePrototypes: new Map([proto('a'), proto('b'), proto('c'), proto('t')]),
      rightPanelTabs: [{ type: 'home', isActive: true }],
    }, false, 'test_reset');
    st().openRightPanelNodeTab('a');
    st().openRightPanelNodeTab('b');
    st().openRightPanelNodeTab('c');
    st().activateRightPanelTab(1); // back on A
  });

  const order = () => st().rightPanelTabs.map(t => t.nodeId || t.type);
  const active = () => st().rightPanelTabs.find(t => t.isActive)?.nodeId;

  it('appends by default', () => {
    st().openRightPanelNodeTab('t');
    expect(order()).toEqual(['home', 'a', 'b', 'c', 't']);
    expect(active()).toBe('t');
  });

  it('with afterActive, opens just right of the tab you were on', () => {
    st().openRightPanelNodeTab('t', 'T', { afterActive: true });
    expect(order()).toEqual(['home', 'a', 't', 'b', 'c']);
    expect(active()).toBe('t');
  });

  it('activates an already-open tab where it is', () => {
    st().openRightPanelNodeTab('c', 'C', { afterActive: true });
    expect(order()).toEqual(['home', 'a', 'b', 'c']);
    expect(active()).toBe('c');
  });
});
