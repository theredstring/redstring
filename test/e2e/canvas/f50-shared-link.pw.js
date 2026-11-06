// F50: a shared link opens a hosted universe read-only, and a copy makes it yours.
// These boot the real app, not a fixture sandbox: the boot path is what's tested.
import fs from 'node:fs';
import { test, expect, openPieMenu, waitForCanvasReady } from './helpers.js';

const SOURCE = 'https://files.example.test/atlas.redstring';
const LINK = `/open?url=${encodeURIComponent(SOURCE)}`;
const file = fs.readFileSync(new URL('../../fixtures/canvas/small.redstring', import.meta.url));

/** The host: answers for the one file, and allows Redstring to read it. */
async function hostFile(page, { status = 200, refused = false } = {}) {
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => {
    // A host that doesn't allow the read looks like this to fetch: a bare failure.
    if (route.request().url() !== SOURCE || refused) return route.abort();
    return route.fulfill({
      status,
      body: status === 200 ? file : 'nope',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
}

// The pill pops in. Playwright scrolls what it clicks into view first, and doing
// that mid-animation can scroll the page; a person's click doesn't.
const pillSettled = (page) => page.locator('.read-only-pill-wrapper.is-visible-steady').waitFor({ timeout: 30_000 });

const store = (page) => page.evaluate(async () => {
  const { default: useGraphStore } = await import('/src/store/graphStore.js');
  const s = useGraphStore.getState();
  return {
    things: s.nodePrototypes.size,
    webs: s.graphs.size,
    names: [...s.nodePrototypes.values()].map((proto) => proto.name),
  };
});

const registry = (page) => page.evaluate(() => {
  const found = Object.keys(localStorage).filter((key) => key.includes('universes_list') || key.includes('universes-list'));
  return found.flatMap((key) => JSON.parse(localStorage.getItem(key) || '[]')).map((u) => u.name);
});

// The fixture's Alpha, by its name or by what an earlier rename left it as.
const renameAlpha = (page, name) => page.evaluate(async (newName) => {
  const { default: useGraphStore } = await import('/src/store/graphStore.js');
  const s = useGraphStore.getState();
  const proto = [...s.nodePrototypes.values()].find((p) => p.name === 'Alpha');
  s.updateNodePrototype(proto.id, (draft) => { draft.name = newName; });
}, name);

test('F50 a link opens read-only: no onboarding, edits refused, nothing remembered', async ({ page }) => {
  await hostFile(page);
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);
  await expect(page.getByText('Read Only', { exact: true })).toBeVisible();
  await expect(page.getByTestId('read-only-open-in-app')).toHaveAttribute('href', /^redstring:\/\/open\?url=/);

  const before = await store(page);
  expect(before.things).toBeGreaterThan(0);

  // Background work (no one did anything) gets no answer.
  await page.waitForTimeout(2_000);
  await expect(page.getByText('Read Only', { exact: true })).toBeVisible();

  await renameAlpha(page, 'Vandalised');
  expect((await store(page)).names).toContain('Alpha');
  expect((await store(page)).names).not.toContain('Vandalised');

  // Dragging a Thing doesn't move it.
  const node = page.locator('svg.canvas g.node').first();
  const positions = () => page.evaluate(async () => {
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    const s = useGraphStore.getState();
    return JSON.stringify([...s.graphs.get(s.activeGraphId).instances.values()].map((i) => [i.x, i.y]));
  });
  const start = await positions();
  const box = await node.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await expect(page.getByText('Make a copy to edit')).toBeVisible();
  await page.mouse.move(box.x + 180, box.y + 140, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect(await positions()).toBe(start);

  expect(await registry(page)).not.toContain('atlas');

  // A reload comes back to the same link.
  await page.reload();
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  expect(await registry(page)).not.toContain('atlas');
});

test('F50 Make a Copy makes it yours: editable, saved, and there after a reload', async ({ page }) => {
  await hostFile(page);
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);
  const viewed = await store(page);

  await pillSettled(page);

  await page.getByTestId('read-only-make-copy').click();
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  expect(new URL(page.url()).pathname).toBe('/');
  expect(new URL(page.url()).search).toBe('');
  expect((await store(page)).things).toBe(viewed.things);

  await renameAlpha(page, 'Mine Now');
  expect((await store(page)).names).toContain('Mine Now');
  await expect.poll(() => registry(page), { timeout: 10_000 }).toContain('atlas');

  // The Universes panel shows it, with no onboarding in the way.
  await expect(page.getByText('Manage your knowledge spaces')).toBeInViewport();

  // Survives a reload: it really was saved. The save waits for an idle moment.
  await page.waitForTimeout(6_000);
  await page.reload();
  await waitForCanvasReady(page);
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  expect((await store(page)).names).toContain('Mine Now');
});

test('F50 a link opened while you work: yours is saved, the visit is never remembered, closing returns', async ({ page }) => {
  await hostFile(page);
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await pillSettled(page);
  await page.getByTestId('read-only-make-copy').click();
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  await renameAlpha(page, 'Mine Now');

  // As the desktop app receives a link while running: no page load.
  const opened = await page.evaluate(async (source) => {
    const { default: backend } = await import('/src/services/universeBackend.js');
    return backend.openReadOnlyUniverse(source);
  }, SOURCE);
  expect(opened?.slug).toBeTruthy();
  await expect(page.getByTestId('read-only-bar')).toBeVisible();
  expect((await store(page)).names).not.toContain('Mine Now');
  await renameAlpha(page, 'Vandalised');
  await page.waitForTimeout(4_000); // Long enough for any save that shouldn't happen.

  // The list on disk has only your universe, still marked as the one to come back to.
  const saved = await page.evaluate(() => {
    const listKey = Object.keys(localStorage).find((key) => key.includes('universes_list') || key.includes('universes-list'));
    const activeKey = Object.keys(localStorage).find((key) => key.includes('active_universe') || key.includes('active-universe'));
    return { names: JSON.parse(localStorage.getItem(listKey)).map((u) => u.name), active: localStorage.getItem(activeKey) };
  });
  expect(saved.names).toEqual(['atlas']);
  expect(saved.active).toBe('atlas');

  await pillSettled(page);

  await page.getByTestId('read-only-close').getByRole('button').click();
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  await expect.poll(async () => (await store(page)).names).toContain('Mine Now');
  expect((await store(page)).names).not.toContain('Vandalised');
});

test('F50 a Dropbox link, as Copy link gives it, opens from a shared link and the link box', async ({ page }) => {
  const COPIED = 'https://www.dropbox.com/scl/fi/abc123/atlas.redstring?rlkey=key456&st=3099g7vb&dl=0';
  const requested = [];
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => {
    const url = route.request().url();
    requested.push(url);
    // As the real thing: only the download host lets the app read the file.
    if (url !== 'https://dl.dropboxusercontent.com/scl/fi/abc123/atlas.redstring?rlkey=key456') return route.abort();
    return route.fulfill({ body: file, headers: { 'access-control-allow-origin': '*' } });
  });

  await page.goto(`/open?url=${encodeURIComponent(COPIED)}`);
  await expect(page.getByTestId('read-only-bar')).toContainText('Read Only', { timeout: 30_000 });
  await waitForCanvasReady(page);
  expect(requested.filter((url) => url.includes('dropbox.com/'))).toEqual([]);

  // Pasted into the link box, from the File menu, with the Universes panel closed:
  // the one click has to open the box as well as the panel.
  await pillSettled(page);
  await page.getByTestId('read-only-make-copy').click();
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  await page.reload();
  await waitForCanvasReady(page);
  await expect(page.getByText('Manage your knowledge spaces')).not.toBeInViewport();
  await page.getByRole('button', { name: 'Redstring Menu' }).click();
  await page.getByText('File', { exact: true }).first().hover();
  await page.locator('.submenu-item', { hasText: 'Load from External Link' }).click();
  await page.getByPlaceholder('https://github.com/owner/repo/blob/main/path.redstring').fill(COPIED);
  await expect(page.getByText('Direct file URL detected')).toBeVisible();
  await page.getByRole('button', { name: 'Fetch & preview' }).click();
  await page.getByText("Just view (read only)").click();
  await expect(page.getByTestId('read-only-bar')).toContainText('Read Only', { timeout: 15_000 });
  expect(requested.filter((url) => url.includes('dropbox.com/'))).toEqual([]);
});

test('F50 a link that cannot be read says so and changes nothing', async ({ page }) => {
  await hostFile(page, { status: 404 });
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-failure')).toContainText(/wasn't found|private/, { timeout: 30_000 });
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  await page.getByRole('button', { name: 'Go to Redstring' }).click();
  await page.waitForURL((url) => url.pathname === '/' && url.search === '');
});

test('F50 a host that refuses the read explains itself', async ({ page }) => {
  await hostFile(page, { refused: true });
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-failure')).toContainText('allow Redstring', { timeout: 30_000 });
});

test('F50 your own universe is untouched by a visit, and closing goes back to it', async ({ page }) => {
  await hostFile(page);
  // Have a universe of your own first: make it from a link, then edit and save it.
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await pillSettled(page);
  await page.getByTestId('read-only-make-copy').click();
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  await renameAlpha(page, 'Mine Now');
  await page.waitForTimeout(6_000);

  // Visit the link again in the same browser.
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  expect((await store(page)).names).not.toContain('Mine Now');
  await page.waitForTimeout(4_000); // Long enough for any save that shouldn't happen.

  await pillSettled(page);

  await page.getByTestId('read-only-close').getByRole('button').click();
  await page.waitForURL((url) => url.pathname === '/' && url.search === '');
  await waitForCanvasReady(page);
  expect((await store(page)).names).toContain('Mine Now');
});

test('F50 a universe kept only in this browser keeps its edits across a reload', async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.goto('/');
  await page.evaluate(async () => {
    const { default: backend } = await import('/src/services/universeBackend.js');
    await backend.initialize();
    localStorage.setItem('redstring-welcome-seen', 'true');
    // As onboarding's skip makes one (gitOnboardingService.ensureUniverse).
    const made = await backend.createUniverse('Skipped', { enableLocal: false, enableGit: false, sourceOfTruth: 'browser' });
    await backend.ensureSaveCoordinator();
    await backend.forceSave(made.slug, null, { skipGit: true });
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    useGraphStore.getState().addNodePrototype({ id: 'kept', name: 'Kept Edit', color: '#800000', definitionGraphIds: [] });
  });
  await page.waitForTimeout(6_000); // The save waits for an idle moment.
  await page.reload();
  await expect.poll(async () => (await store(page)).names, { timeout: 15_000 }).toContain('Kept Edit');
});

test('F50 the panel and the menu: read-only row, copy of your own, new universe during a visit', async ({ page }) => {
  await hostFile(page);
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);

  // The panel shows what you're viewing, and no storage to fill.
  await page.evaluate(async () => {
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    useGraphStore.getState().setLeftPanelExpanded(true);
    ui.getState().openLeftPanelView('federation');
  });
  await expect(page.getByText('READ ONLY')).toBeInViewport();
  await expect(page.getByText('Nothing is saved. Make a copy to keep it and edit it.')).toBeVisible();
  await expect(page.getByText('Storage', { exact: true })).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('panel-read-only.png') });

  // Copying from the panel.
  await pillSettled(page);
  await page.locator('button[aria-label="Make a Copy"]').click();
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  await expect(page.getByText('READ ONLY')).toBeHidden();
  await expect(page.getByText('Storage', { exact: true })).toBeVisible();

  // Now a universe of your own: the row's button makes "Copy of".
  await page.getByRole('button', { name: 'Make a copy' }).click();
  await expect(page.getByText('Copy of atlas')).toBeVisible();
  expect((await store(page)).names).toContain('Alpha');

  // The Redstring menu offers it too.
  await page.getByRole('button', { name: 'Redstring Menu' }).click();
  await page.getByText('File', { exact: true }).first().hover();
  await expect(page.getByText('Make a Copy', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('menu.png') });

  // Starting a new universe during a visit ends the visit, and it can be edited.
  await page.keyboard.press('Escape');
  await page.evaluate(async (source) => {
    const { default: backend } = await import('/src/services/universeBackend.js');
    await backend.openReadOnlyUniverse(source);
    await backend.createUniverse('Fresh', { enableLocal: false, enableGit: false, sourceOfTruth: 'browser' });
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    useGraphStore.getState().addNodePrototype({ id: 'fresh', name: 'Fresh Thing', color: '#800000', definitionGraphIds: [] });
  }, SOURCE);
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  expect((await store(page)).names).toContain('Fresh Thing');
});

test('F50 read-only: Decompose is a flip-through that changes nothing; edits are dimmed', async ({ page }) => {
  await hostFile(page);
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);

  // Alpha, given two definitions behind the test's back, so there's something to flip through.
  const found = await page.evaluate(async () => {
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    const readOnly = await import('/src/store/readOnlyUniverse.js');
    const viewing = readOnly.default.getState().active;
    readOnly.setReadOnlyUniverse(null);
    const proto = [...useGraphStore.getState().nodePrototypes.values()].find((p) => p.name === 'Alpha');
    useGraphStore.getState().createAndAssignGraphDefinitionWithoutActivation(proto.id);
    useGraphStore.getState().createAndAssignGraphDefinitionWithoutActivation(proto.id);
    readOnly.setReadOnlyUniverse(viewing);
    const s = useGraphStore.getState();
    const instance = [...s.graphs.get(s.activeGraphId).instances.values()].find((i) => i.prototypeId === proto.id);
    return { id: instance.id, prototypeId: proto.id };
  });

  await openPieMenu(page, found.id);
  await page.waitForTimeout(500);
  await page.screenshot({ path: test.info().outputPath('pie-read-only.png') });
  expect(await page.locator('.pie-bubble-hover.is-disabled').count()).toBeGreaterThan(0);

  const document = () => page.evaluate(async () => {
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    const s = useGraphStore.getState();
    window.__doc = window.__doc || { graphs: s.graphs, nodePrototypes: s.nodePrototypes, edges: s.edges };
    return { same: window.__doc.graphs === s.graphs && window.__doc.nodePrototypes === s.nodePrototypes && window.__doc.edges === s.edges };
  });
  await document();

  await page.evaluate(async (nodeId) => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    ui.getState().dispatchPie({ type: 'PIE_TO_DECOMPOSE', nodeId });
  }, found.id);
  await expect.poll(() => page.evaluate(async () => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    return ui.getState().previewingNodeId;
  }), { timeout: 5_000 }).toBe(found.id);
  await page.waitForTimeout(600);
  await page.screenshot({ path: test.info().outputPath('decompose-read-only.png') });
  expect((await document()).same).toBe(true);

  // Flipping to another definition is a place to be, not an edit.
  const flipped = await page.evaluate(async (prototypeId) => {
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    const key = `${prototypeId}-${useGraphStore.getState().activeGraphId}`;
    ui.getState().setNodeDefinitionIndices((prev) => new Map(prev).set(key, 1));
    return ui.getState().nodeDefinitionIndices.get(key);
  }, found.prototypeId);
  expect(flipped).toBe(1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath('decompose-flipped.png') });
  expect((await document()).same).toBe(true);
  await page.waitForTimeout(3_000);
  expect(await registry(page)).not.toContain('atlas');
});

test('F50 Share: a link and who it opens for, or what it needs', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => {
    const url = route.request().url();
    if (url === SOURCE) return route.fulfill({ body: file, headers: { 'access-control-allow-origin': '*' } });
    if (url === 'https://api.github.com/repos/grant/open-maps') return route.fulfill({ json: { private: false }, headers: { 'access-control-allow-origin': '*' } });
    if (url === 'https://api.github.com/repos/grant/secret-maps') return route.fulfill({ json: { private: true }, headers: { 'access-control-allow-origin': '*' } });
    return route.abort();
  });
  await page.goto(LINK);
  await pillSettled(page);
  await pillSettled(page);
  await page.getByTestId('read-only-make-copy').click();
  const share = page.getByTestId('share-universe');
  await expect(share).toBeInViewport();

  // Nowhere to point yet.
  await expect(share).toContainText('Add a repository to get a link.');
  await expect(share.getByRole('button', { name: 'Add Repository' })).toBeVisible();

  const linkRepo = (repo) => page.evaluate(async (name) => {
    const { default: backend } = await import('/src/services/universeBackend.js');
    const u = backend.getActiveUniverse();
    // Not enabled: this is about the panel, not syncing to a repository that isn't there.
    await backend.updateUniverse(u.slug, { gitRepo: { ...u.gitRepo, enabled: false, linkedRepo: { type: 'github', user: 'grant', repo: name } } });
  }, repo);
  // A repository with nobody signed in asks to reconnect, once per repository.
  const dismissReconnect = async () => {
    const reconnect = page.getByText(/^Reconnect /);
    await reconnect.waitFor({ timeout: 3_000 }).catch(() => {});
    if (await reconnect.count()) await page.keyboard.press('Escape');
    await reconnect.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
    if (await reconnect.count()) await page.locator('button[aria-label="Close"], button[title="Close"]').last().click();
    await expect(reconnect).toHaveCount(0);
  };

  await linkRepo('open-maps');
  await dismissReconnect();
  await expect(share).toContainText('Anyone with the link can view');
  await page.screenshot({ path: test.info().outputPath('share-public.png') });
  await share.getByRole('button', { name: 'Copy Link' }).click();
  await expect(share.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'https://redstring.io/open?gh=grant/open-maps/main/universes/atlas/atlas.redstring'
  );

  await linkRepo('secret-maps');
  await dismissReconnect();
  await expect(share).toContainText('Only people with access to grant/secret-maps');
  await expect(share.getByRole('button', { name: 'Manage Access' })).toBeVisible();

  // The Redstring menu copies the same link.
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.getByRole('button', { name: 'Redstring Menu' }).click();
  await page.getByText('File', { exact: true }).first().hover();
  await page.locator('.submenu-item', { hasText: 'Copy Link' }).click();
  await expect(page.getByText('Link Copied', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('gh=grant/secret-maps/main/');
});

test('F50 the pill sits over the TypeList and rides on top of a control panel', async ({ page }) => {
  await hostFile(page);
  await page.goto(LINK);
  const pill = page.getByTestId('read-only-bar');
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);
  await page.waitForTimeout(600);

  const panel = page.locator('.unified-bottom-panel');
  const bottomOf = async (locator) => { const b = await locator.boundingBox(); return b.y + b.height; };
  await expect(panel).toHaveCount(0);
  const resting = await pill.boundingBox();
  expect(resting.y, 'low on the screen, not under the header').toBeGreaterThan(600);
  await page.screenshot({ path: test.info().outputPath('pill-resting.png') });
  // No second pill in the same spot.
  await expect(page.locator('.download-app-pill')).toHaveCount(0);

  const select = (names) => page.evaluate(async (wanted) => {
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    const s = useGraphStore.getState();
    const ids = [...s.graphs.get(s.activeGraphId).instances.values()]
      .filter((i) => wanted.includes(s.nodePrototypes.get(i.prototypeId)?.name)).map((i) => i.id);
    ui.getState().setSelectedInstanceIds(new Set(ids));
  }, names);
  const clearance = async () => (await panel.boundingBox()).y - await bottomOf(pill);

  // A control panel comes up: the pill clears it.
  await select(['Alpha', 'Beta']);
  await expect(panel).toHaveCount(1);
  await expect.poll(clearance, { timeout: 3_000 }).toBeGreaterThan(8);
  await page.waitForTimeout(500);
  await expect.poll(clearance).toBeLessThan(20); // Sitting on it, not floating away.
  await page.screenshot({ path: test.info().outputPath('pill-over-panel.png') });

  // A control panel of another size: still clear of it.
  await select(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Theta', 'Iota']);
  await page.waitForTimeout(400);
  await expect.poll(clearance).toBeGreaterThan(8);

  // Gone again: the pill comes back down.
  await select([]);
  await expect(panel).toHaveCount(0, { timeout: 5_000 });
  await expect.poll(async () => (await pill.boundingBox()).y, { timeout: 3_000 }).toBeGreaterThan(resting.y - 2);

  // The Universes panel offers Open in App too.
  await page.evaluate(async () => {
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    useGraphStore.getState().setLeftPanelExpanded(true);
    ui.getState().openLeftPanelView('federation');
  });
  await expect(page.locator('button[aria-label="Open in App"]')).toBeInViewport();
  await page.waitForTimeout(500);
  await page.screenshot({ path: test.info().outputPath('pill-panel-open.png') });
});

test('F50 the bar fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await hostFile(page);
  await page.goto(LINK);
  const bar = page.getByTestId('read-only-bar');
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await pillSettled(page);
  await page.waitForTimeout(2_600); // Past any nudge.
  const box = await bar.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('phone.png') });
});
