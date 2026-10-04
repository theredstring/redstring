/**
 * Read the prompt space from a .redstring file (Node). The app imports the
 * shipped file instead; see promptSpace.js.
 */

import fs from 'node:fs';
import { promptSpaceFrom } from './promptSpace.js';

export function loadPromptSpace(filePath) {
  let json = null;
  try {
    if (filePath && fs.existsSync(filePath)) json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { json = null; }
  return promptSpaceFrom(json, filePath);
}
