/**
 * This device's Settings as a file, and back to their defaults
 * (Settings → Data → Settings).
 *
 * An allowlist, never a sweep of localStorage. Next to the preferences live
 * the things that must never leave the device or be reset with them: API
 * keys and GitHub tokens, the universe list and file links, Git state, and
 * the save guards' floors. Only the keys named here are read, written or
 * removed. A new preference that should travel gets added here.
 *
 * The app reads preferences once, when it starts, so importing or resetting
 * reloads the window. Unsaved work is saved first, or the change is refused.
 */

// Shown in Settings. Raw localStorage keys, as the store writes them.
export const PREFERENCE_KEYS = [
  // Display
  'redstring_dark_mode',
  'redstring_canvas_color',
  'redstring_edge_glow_mode',
  'redstring_edge_glow_intensity',
  'redstring_lifted_thing_shadow',
  'redstring_show_hover_preview',
  'redstring_hover_preview_zoom_only',
  'redstring_hover_preview_size',
  'redstring_show_zoom_bar',
  'redstring_zoom_bar_position',
  // Panels
  'redstring_show_node_cp',
  'redstring_show_multi_node_cp',
  'redstring_show_connection_cp',
  'redstring_show_group_cp',
  'redstring_open_definitions_in_place',
  'redstring_show_abstraction_cp',
  'redstring_landscape_shell_mode',
  // Grid
  'redstring_grid_mode',
  'redstring_grid_size',
  'redstring_grid_snap',
  'redstring_grid_appearance',
  // Size
  'redstring_text_font_size',
  'redstring_text_line_spacing',
  'redstring_node_scale',
  'redstring_connection_width',
  'redstring_plus_sign_scale',
  'redstring_pie_menu_scale',
  // Connections
  'redstring_enable_auto_routing',
  'redstring_routing_style',
  'redstring_manhattan_bends',
  'redstring_clean_lane_spacing',
  'redstring_lombardi_curvature',
  'redstring_multi_connection_curve_v2',
  'redstring_connection_label_size',
  'redstring_show_connection_names',
  'redstring_connection_label_color_mode',
  'redstring_connection_label_outer_ring',
  'redstring_connection_label_ring_width',
  'redstring_connection_label_move_fade',
  'redstring_connection_label_truncate',
  'redstring_connection_label_sprites',
  // Input
  'redstring_drag_zoom_enabled',
  'redstring_drag_zoom_amount',
  'redstring_focus_on_select_enabled',
  'redstring_focus_on_select_zoom_amount',
  'redstring_keyboard_zoom_sensitivity',
  'redstring_keyboard_pan_sensitivity',
  'redstring_middle_mouse_zoom_enabled',
  'redstring_node_drag_edge_pan_enabled',
  'redstring_connection_draw_edge_pan_enabled',
  'redstring_marquee_edge_pan_enabled',
  'redstring_mouse_glide_enabled',
  'redstring_mouse_glide_strength_v2',
  'redstring_node_lift_delay',
  'redstring_gamepad_scheme',
  'redstring_gamepad_panel_resize_binding',
  'redstring_gamepad_crosshair_scale',
  'redstring_gamepad_zoom_sensitivity',
  'redstring_gamepad_pan_sensitivity',
  'redstring_gamepad_panel_resize',
  'redstring_gamepad_menu_repeat',
  'redstring_gamepad_stick_deadzone',
  'redstring_touch_zoom_sensitivity',
  'redstring_touch_pan_sensitivity',
  'redstring_touch_glide_enabled',
  'redstring_touch_glide_strength',
  'redstring_touch_pinch_glide_enabled',
  'redstring_touch_pinch_glide_strength',
  'redstring_trackpad_zoom_sensitivity_v2',
  'redstring_trackpad_pan_sensitivity',
  'redstring_trackpad_zoom_glide_enabled',
  'redstring_trackpad_zoom_glide_strength_v2',
  'redstring_trackpad_pan_glide_enabled',
  'redstring_trackpad_pan_glide_strength',
  // Data
  'redstring_auto_save_mode',
  'redstring_backups',
  // AI (the choices, never the keys)
  'rs.wizard.mode',
  'redstring_wizard_destination',
  'rs.wizard.maxIterationsLocal',
  'rs.wizard.maxIterationsCloud'
];

// Older names the store still reads. Reset removes them too, or they would
// come back as the value of their newer key.
const LEGACY_KEYS = ['redstring_show_edge_glow', 'redstring_connection_label_zoom_fade'];

const FILE_KIND = 'redstring-settings';
const FILE_VERSION = 1;
const MAX_VALUE_CHARS = 10000;

/** This device's preferences, as a settings file's contents. */
export function buildSettingsFile(now = new Date()) {
  const settings = {};
  for (const key of PREFERENCE_KEYS) {
    let value = null;
    try { value = localStorage.getItem(key); } catch { /* unreadable is unset */ }
    if (value !== null) settings[key] = value;
  }
  return { kind: FILE_KIND, version: FILE_VERSION, exportedAt: now.toISOString(), settings };
}

/**
 * The preferences in a settings file, checked against the allowlist. Anything
 * else in the file is ignored.
 *
 * @param {string} text
 * @returns {Object<string, string>}
 * @throws {Error} when it isn't a Redstring settings file
 */
export function readSettingsFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not a Redstring settings file');
  }
  if (!parsed || parsed.kind !== FILE_KIND || typeof parsed.settings !== 'object' || !parsed.settings) {
    throw new Error('That file is not a Redstring settings file');
  }
  if (parsed.version > FILE_VERSION) {
    throw new Error('Those settings come from a newer version of Redstring');
  }
  const settings = {};
  for (const key of PREFERENCE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(parsed.settings, key)) continue;
    const value = parsed.settings[key];
    if (typeof value === 'string' && value.length <= MAX_VALUE_CHARS) settings[key] = value;
  }
  return settings;
}

/** Save the file: a download, which Electron turns into a save dialog. */
export function exportSettings() {
  const blob = new Blob([JSON.stringify(buildSettingsFile(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Redstring Settings.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// The workspace config keeps its own copy of dark mode and restores it on
// launch (graphStore loadUISettingsFromWorkspace), so it has to agree.
const syncWorkspaceDarkMode = async (darkMode) => {
  try {
    await window.__workspaceService?.setUISettings?.({ darkMode });
  } catch { /* the reload still applies localStorage */ }
};

// The window reloads to apply preferences; nothing unsaved may go with it.
// Checked before anything is written, so a refusal changes nothing.
const ensureSaved = async () => {
  const { saveCoordinator } = await import('./SaveCoordinator.js');
  if (!saveCoordinator.hasUnsavedChanges()) return;
  try { await saveCoordinator.flush('settings-reload'); } catch { /* checked below */ }
  if (saveCoordinator.hasUnsavedChanges()) {
    throw new Error('Save the open universe first, then try again');
  }
};

/** Put the device's preferences back to how Redstring ships. */
export async function resetSettings() {
  await ensureSaved();
  for (const key of [...PREFERENCE_KEYS, ...LEGACY_KEYS]) {
    try { localStorage.removeItem(key); } catch { /* nothing to remove */ }
  }
  await syncWorkspaceDarkMode(false);
  window.location.reload();
}

/** Make this device's preferences the ones in a settings file. */
export async function importSettings(file) {
  const settings = readSettingsFile(await file.text());
  await ensureSaved();
  for (const key of [...PREFERENCE_KEYS, ...LEGACY_KEYS]) {
    try {
      if (Object.prototype.hasOwnProperty.call(settings, key)) localStorage.setItem(key, settings[key]);
      else localStorage.removeItem(key);
    } catch { /* storage refused; the rest still apply */ }
  }
  await syncWorkspaceDarkMode(settings.redstring_dark_mode === 'true');
  window.location.reload();
}
