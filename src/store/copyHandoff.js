/**
 * A copy being made, for the Universes panel and the read-only pill to show.
 *
 * `phase` is 'copying' from the click until the copy is open, then 'landing'
 * while its row in Universes opens up. `slug` is the copy, once it exists.
 * Written by makeCopyOfOpenUniverse.
 */

import { create } from 'zustand';

const useCopyHandoff = create(() => ({ phase: null, slug: null }));

export default useCopyHandoff;
