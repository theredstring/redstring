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
  await expect(page.getByTestId('read-only-bar').getByText('Read Only', { exact: true })).toBeVisible();
  await expect(page.getByTestId('read-only-open-in-app')).toHaveAttribute('href', /^redstring:\/\/open\?url=/);

  const before = await store(page);
  expect(before.things).toBeGreaterThan(0);

  // Background work (no one did anything) gets no answer.
  await page.waitForTimeout(2_000);
  await expect(page.getByTestId('read-only-bar').getByText('Read Only', { exact: true })).toBeVisible();

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
  await page.waitForTimeout(700);
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

  await page.getByRole('button', { name: 'Close', exact: true }).click();
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

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/' && url.search === '');
  await waitForCanvasReady(page);
  expect((await store(page)).names).toContain('Mine Now');
});

test('F50 while a link loads, the screen names that universe, not yours', async ({ page }) => {
  await hostFile(page);
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await pillSettled(page);
  await page.getByTestId('read-only-make-copy').click();
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  await page.waitForTimeout(6_000);

  // Another link, held on the way so the loading screen stays up.
  const other = 'https://files.example.test/elsewhere.redstring';
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route(other, async (route) => {
    await held;
    await route.fulfill({ body: file, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto(`/open?url=${encodeURIComponent(other)}`);
  await expect(page.getByText('Loading elsewhere')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_000);
  await expect(page.getByText('Loading elsewhere')).toBeVisible();
  await expect(page.getByText('Loading atlas')).toBeHidden();

  release();
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
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

  // A visit opens on Universes: what you're viewing, and no storage to fill.
  await expect(page.getByText('READ ONLY', { exact: true })).toBeInViewport();
  await expect(page.getByText('Nothing is saved. Make a copy to keep it and edit it.')).toBeVisible();
  await expect(page.getByText('Storage', { exact: true })).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('panel-read-only.png') });

  // Copying from the panel.
  await pillSettled(page);
  await page.locator('button[aria-label="Make a Copy"]').click();
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  await expect(page.getByText('READ ONLY', { exact: true })).toBeHidden();
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
    useGraphStore.getState().setLeftPanelExpanded(false); // It opens over Alpha.
    const s = useGraphStore.getState();
    const instance = [...s.graphs.get(s.activeGraphId).instances.values()].find((i) => i.prototypeId === proto.id);
    return { id: instance.id, prototypeId: proto.id };
  });

  await expect(page.getByText('READ ONLY', { exact: true })).not.toBeInViewport();
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

  // Gone again: the pill comes back down, starting while the panel is still leaving.
  const startedDownWhileLeaving = page.evaluate(() => new Promise((resolve) => {
    const wrapper = document.querySelector('.read-only-pill-wrapper');
    const start = wrapper.style.bottom;
    const check = () => {
      if (!document.querySelector('.unified-bottom-panel')) return resolve(false);
      if (document.querySelector('.unified-bottom-panel.exiting') && wrapper.style.bottom !== start) return resolve(true);
      return requestAnimationFrame(check);
    };
    check();
  }));
  await select([]);
  expect(await startedDownWhileLeaving).toBe(true);
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

test('F50 nothing to make or remove: no plus sign, no keys, no formula, nothing to import', async ({ page }) => {
  await hostFile(page);
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);
  await pillSettled(page);
  const before = await store(page);

  // Empty canvas, clear of the panel and the pill.
  await page.mouse.click(1000, 600);
  await page.waitForTimeout(400);
  await page.mouse.click(1000, 600);
  await page.waitForTimeout(400);
  await expect(page.locator('svg.canvas g[data-plus-sign="true"]')).toHaveCount(0);

  // A selection stays through the keys that would change it.
  const selected = () => page.evaluate(async () => {
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    return [...ui.getState().selectedInstanceIds];
  });
  await page.evaluate(async () => {
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    const { default: ui } = await import('/src/store/canvasUIStore.js');
    const s = useGraphStore.getState();
    const beta = [...s.graphs.get(s.activeGraphId).instances.values()].find((i) => s.nodePrototypes.get(i.prototypeId)?.name === 'Beta');
    ui.getState().setSelectedInstanceIds(new Set([beta.id]));
  });
  const selection = await selected();
  expect(selection).toHaveLength(1);
  await page.keyboard.press('ControlOrMeta+c');
  for (const key of ['Delete', 'Backspace', 'ControlOrMeta+x', 'ControlOrMeta+v']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
    expect(await selected(), key).toEqual(selection);
  }
  expect(await store(page)).toEqual(before);

  // The formula box's own way of building, called directly.
  const web = await page.evaluate(async () => {
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    const { buildFormulaInWeb } = await import('/src/components/canvas/formats/formula/buildFormula.js');
    const { openFormulaComposer } = await import('/src/components/canvas/formats/formatsStore.js');
    const { activeGraphId } = useGraphStore.getState();
    try { buildFormulaInWeb('F = m a', activeGraphId, { x: 0, y: 0 }, undefined, {}); } catch { /* Refused is fine. */ }
    openFormulaComposer(activeGraphId, { x: 0, y: 0 });
    const s = useGraphStore.getState();
    return { same: s.activeGraphId === activeGraphId, there: s.graphs.has(s.activeGraphId) };
  });
  expect(web).toEqual({ same: true, there: true });
  expect(await store(page)).toEqual(before);
  await page.waitForTimeout(200);
  await expect(page.locator('.formula-selector')).toHaveCount(0);

  // Loads and merges from anywhere but the switch that opened it, the backend's own too.
  const refused = await page.evaluate(async () => {
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    const { default: backend } = await import('/src/services/universeBackend.js');
    const s = useGraphStore.getState();
    const empty = () => ({ graphs: new Map(), nodePrototypes: new Map(), edges: new Map(), edgePrototypes: new Map() });
    backend.storeOperations.loadUniverseFromFile(empty());
    return {
      load: s.loadUniverseFromFile(empty()),
      merge: s.mergeUniverseState(empty()),
    };
  });
  expect(refused).toEqual({ load: false, merge: null });
  expect(await store(page)).toEqual(before);

  // The menu says so.
  await page.getByRole('button', { name: 'Redstring Menu' }).click();
  await page.getByText('File', { exact: true }).first().hover();
  const importOntology = page.locator('.submenu-item', { hasText: 'Import Ontology' });
  await expect(importOntology).toHaveCSS('opacity', '0.4');
  await page.screenshot({ path: test.info().outputPath('menu-read-only.png') });
});

test('F50 an attempted edit says Read Only at the bottom right, and moving around does not', async ({ page }) => {
  await hostFile(page);
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);
  await pillSettled(page);

  const notice = page.locator('.save-status-display');
  const opacity = () => notice.evaluate((el) => Number(getComputedStyle(el).opacity));
  await expect(notice).toHaveText('Read Only');
  await expect.poll(opacity).toBe(0);
  const answers = () => page.evaluate(async () => {
    const { default: readOnly } = await import('/src/store/readOnlyUniverse.js');
    return readOnly.getState().nudge;
  });
  const before = await answers();

  // Looking around: clicks, the wheel, panning, a held drag on a Thing, other webs.
  const center = async (locator) => { const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  await page.mouse.click(1000, 600);
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -200);
  await page.mouse.wheel(120, 80);
  await page.mouse.move(1000, 600);
  await page.mouse.down();
  await page.mouse.move(900, 500, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const thing = await center(page.locator('svg.canvas g.node').nth(2));
  await page.mouse.move(thing.x, thing.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.move(thing.x + 150, thing.y + 150, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.mouse.click(1000, 600);
  await page.getByText('Small Web B').first().click();
  await page.waitForTimeout(600);
  await page.getByText('Small Web A').first().click();
  await page.waitForTimeout(1_500);
  expect(await answers()).toBe(before);
  expect(await opacity()).toBe(0);

  // An attempt: it comes up quickly, stays for a moment, and goes.
  const node = await center(page.locator('svg.canvas g.node').first());
  await page.mouse.click(node.x, node.y);
  await page.waitForTimeout(500);
  expect(await opacity()).toBe(0);
  await page.keyboard.press('Delete');
  await expect.poll(opacity, { timeout: 500, intervals: [50] }).toBe(1);
  await page.screenshot({ path: test.info().outputPath('read-only-notice.png') });
  await page.waitForTimeout(600);
  expect(await opacity()).toBe(1);
  await expect.poll(opacity, { timeout: 2_500, intervals: [100] }).toBe(0);
  expect(await answers()).toBe(before + 1);
});

test('F50 a link arriving in the app on a fresh install goes ahead of setting up', async ({ page }) => {
  await hostFile(page);
  await page.goto('/');
  const welcome = page.getByText('Welcome to Redstring');
  await expect(welcome).toBeVisible({ timeout: 30_000 });

  // As the desktop app receives a link: no page load, and nothing of yours yet.
  await page.evaluate(async (source) => {
    const { default: backend } = await import('/src/services/universeBackend.js');
    await backend.openReadOnlyUniverse(source);
  }, SOURCE);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await expect(welcome).toBeHidden();
  await pillSettled(page);

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('read-only-bar')).toBeHidden({ timeout: 30_000 });
  await expect(welcome).toBeVisible({ timeout: 30_000 });
});

test('F50 a narrow panel keeps Universes inside its cards', async ({ page }) => {
  // What sticks out of the box around this text, and that box's width.
  const spill = (text) => page.getByText(text, { exact: true }).first().evaluate((el) => {
    let box = el;
    while (box && !['6px', '8px'].includes(getComputedStyle(box).borderTopLeftRadius)) box = box.parentElement;
    const right = box.getBoundingClientRect().right;
    return [...box.querySelectorAll('*')]
      .filter((node) => node.getBoundingClientRect().right > right + 0.5)
      .map((node) => `${node.tagName} ${(node.textContent || '').slice(0, 20)}`);
  });
  const source = 'https://files.example.test/a-rather-long-universe-name-indeed.redstring';
  await hostFile(page);
  await page.route(source, (route) => route.fulfill({ body: file, headers: { 'access-control-allow-origin': '*' } }));
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto(`/open?url=${encodeURIComponent(source)}`);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);
  await pillSettled(page);

  const atWidth = async (width) => {
    await page.evaluate((w) => localStorage.setItem('panelWidth_left', String(w)), width);
    await page.reload();
    await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    expect((await page.locator('.panel-left-tab-strip').boundingBox()).width, 'the panel is that wide').toBe(width);
  };

  for (const width of [180, 210, 250, 300, 360]) {
    await atWidth(width);
    expect(await spill('READ ONLY'), `read-only card at ${width}`).toEqual([]);
    expect(await spill('Workspace Folder'), `workspace folder at ${width}`).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`universes-${width}.png`) });
  }

  // Above ultra slim the Workspace Folder's button stays beside its text; at it,
  // under. The read-only row's close is beside its name, not on a line of its own.
  const buttonUnderText = async () => {
    const text = await page.getByText('Workspace Folder', { exact: true }).first().boundingBox();
    const choose = await page.getByRole('button', { name: 'Choose workspace folder' }).boundingBox();
    return choose.y > text.y + text.height;
  };
  await atWidth(360);
  expect(await buttonUnderText()).toBe(false);
  await atWidth(300);
  expect(await buttonUnderText()).toBe(true);
  await atWidth(180);
  expect(await buttonUnderText()).toBe(true);
  const close = await page.getByRole('button', { name: 'Close', exact: true }).boundingBox();
  const name = await page.getByText('a-rather-long-universe-name-indeed', { exact: true }).boundingBox();
  expect(close.y).toBeLessThan(name.y + name.height);
  expect(close.x).toBeGreaterThan(name.x);

  // A universe of your own at that width: its Share section and storage too.
  await pillSettled(page);
  await page.getByTestId('read-only-make-copy').click();
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  await expect(page.getByTestId('share-universe')).toBeVisible();
  expect(await spill('ACTIVE'), 'your own card at 180').toEqual([]);
  await page.screenshot({ path: test.info().outputPath('universes-own-180.png') });
});

test('F50 links racing: the newest opens, and closing returns to yours', async ({ page }) => {
  await hostFile(page);
  // A universe of your own to come back to.
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await pillSettled(page);
  await page.getByTestId('read-only-make-copy').click();
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  await renameAlpha(page, 'Mine Now');
  await page.waitForTimeout(6_000);
  await page.reload();
  await waitForCanvasReady(page);
  expect((await store(page)).names).toContain('Mine Now');

  const fulfil = (route) => route.fulfill({ body: file, headers: { 'access-control-allow-origin': '*' } });
  const first = 'https://files.example.test/first.redstring';
  const second = 'https://files.example.test/second.redstring';
  let releaseFirst;
  const firstHeld = new Promise((resolve) => { releaseFirst = resolve; });
  await page.route(first, async (route) => { await firstHeld; await fulfil(route); });
  await page.route(second, fulfil);

  const opened = await page.evaluate(([one, two]) => import('/src/services/universeBackend.js').then(({ default: backend }) => {
    window.__first = backend.openReadOnlyUniverse(one);
    return backend.openReadOnlyUniverse(two);
  }), [first, second]);
  expect(opened?.slug).toBeTruthy();
  releaseFirst();
  expect(await page.evaluate(() => window.__first)).toBe(null);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('second', { exact: true })).toBeVisible();
  await expect(page.getByText('first', { exact: true })).toHaveCount(0);

  await pillSettled(page);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('read-only-bar')).toBeHidden({ timeout: 30_000 });
  await expect.poll(async () => (await store(page)).names).toContain('Mine Now');
});

test('F50 a second link that fails leaves the visit up', async ({ page }) => {
  await hostFile(page);
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);
  await pillSettled(page);
  await page.evaluate(() => import('/src/services/universeBackend.js').then(({ default: backend }) => backend.openReadOnlyUniverse('https://files.example.test/gone.redstring')));
  await expect(page.getByTestId('read-only-failure')).toBeVisible();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.getByTestId('read-only-failure')).toBeHidden();
  await page.waitForTimeout(800);
  await expect(page.getByTestId('read-only-bar')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/open');
});

test('F50 what can\'t be done isn\'t offered, and the pill stays quiet about it', async ({ page }) => {
  await hostFile(page);
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);
  await pillSettled(page);
  const nudges = () => page.evaluate(async () => {
    const { default: readOnly } = await import('/src/store/readOnlyUniverse.js');
    return readOnly.getState().nudge;
  });
  const before = await nudges();

  // The header's add and bookmark are there, faded, and do nothing.
  for (const key of ['Make a copy to edit']) {
    const faded = page.locator(`header .header-action-btn[title="${key}"]`);
    await expect(faded).toHaveCount(3); // Auto Layout, bookmark, add.
    for (const button of await faded.all()) {
      await expect(button).toHaveAttribute('data-disabled', 'true');
      await button.click({ force: true });
    }
  }
  await expect(page.locator('[data-testid="new-web-prompt"], .unified-selector')).toHaveCount(0);

  // A quick drag off a Thing is as if it can't be done: no line, nothing said.
  const box = await page.locator('svg.canvas g.node').nth(2).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 120, box.y + box.height + 120, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await nudges()).toBe(before);

  // A Thing with no definition has nothing to open, and none to make.
  const proto = await page.evaluate(async () => {
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    const s = useGraphStore.getState();
    const bare = [...s.graphs.get(s.activeGraphId).instances.values()]
      .map((inst) => s.nodePrototypes.get(inst.prototypeId))
      .find((thing) => thing && !thing.definitionGraphIds?.length);
    s.setRightPanelExpanded(true);
    s.openRightPanelNodeTab(bare.id, bare.name);
    return bare.name;
  });
  const panel = page.locator('.panel-container.right');
  await expect(panel.getByRole('button', { name: new RegExp(`Define ${proto}`) })).toBeDisabled();
  await expect(panel.locator('[title="No definition to open"]').first()).toBeVisible();
  expect(await nudges()).toBe(before);

  // Keys have no fade: they answer bottom right, and the pill says what it says.
  await page.locator('svg.canvas g.node').nth(2).click();
  await page.keyboard.press('Delete');
  await expect.poll(nudges).toBe(before + 1);
  await expect(page.getByTestId('read-only-bar')).toContainText('Read Only');
  await expect(page.getByTestId('read-only-bar')).not.toContainText('Make a copy to edit');
});

test('F50 the Wizard is offered only what looks', async ({ page }) => {
  await hostFile(page);
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);
  await pillSettled(page);
  await page.evaluate(async () => {
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    const s = useGraphStore.getState();
    const inst = [...s.graphs.get(s.activeGraphId).instances.values()][0];
    s.setRightPanelExpanded(true);
    s.openRightPanelNodeTab(inst.prototypeId);
  });
  await page.locator('.panel-container.right [title="Ask The Wizard"]').first().click();
  await expect(page.getByText('Explain this Thing')).toBeVisible();
  await expect(page.getByText('Ask something specific…')).toBeVisible();
  await expect(page.getByText(/abstraction ladder/)).toHaveCount(0);
  await expect(page.getByText('Fill in details')).toHaveCount(0);
});

test('F50 a second link takes over the address, so a reload comes back to it', async ({ page }) => {
  const second = 'https://files.example.test/second.redstring';
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => {
    const url = route.request().url();
    return url === SOURCE || url === second
      ? route.fulfill({ status: 200, body: file, headers: { 'access-control-allow-origin': '*' } })
      : route.abort();
  });
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);
  await page.evaluate((source) => import('/src/services/universeBackend.js').then(({ default: backend }) => backend.openReadOnlyUniverse(source)), second);
  await expect.poll(() => new URL(page.url()).search).toBe(`?url=${encodeURIComponent(second)}`);
  await page.reload();
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('second', { exact: true }).first()).toBeAttached();
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

  // The panel doesn't cover the universe here, but it's on Universes when opened.
  await expect(page.getByText('READ ONLY', { exact: true })).not.toBeInViewport();
  await page.evaluate(async () => {
    const { default: useGraphStore } = await import('/src/store/graphStore.js');
    useGraphStore.getState().setLeftPanelExpanded(true);
  });
  await expect(page.getByText('READ ONLY', { exact: true })).toBeInViewport();
});

test('F50 the pill hides and the visit goes on; Universes is the way out', async ({ page }) => {
  await hostFile(page);
  await page.goto(LINK);
  await expect(page.getByTestId('read-only-bar')).toBeVisible({ timeout: 30_000 });
  await waitForCanvasReady(page);
  await pillSettled(page);
  const before = await store(page);

  await page.getByTestId('read-only-hide').getByRole('button').click();
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  expect(new URL(page.url()).pathname).toBe('/open');
  expect(await store(page)).toEqual(before);
  await expect(page.getByText('READ ONLY', { exact: true })).toBeInViewport();

  // Refused edits don't bring it back.
  await renameAlpha(page, 'Vandalised');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('read-only-bar')).toBeHidden();
  expect(await store(page)).toEqual(before);

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/' && url.search === '');
});
