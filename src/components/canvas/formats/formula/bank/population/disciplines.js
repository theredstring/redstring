/**
 * The disciplines the bank sorts by: Wikidata items a field (thermodynamics)
 * or a class (theorem, physical law) leads up to through subclass of / part
 * of. Listed first wins a tie. A field's roots (physics, chemistry) count only
 * for what an item is studied by; KIND_ROOTS, what kind of thing it is.
 */
export const DISCIPLINE_ROOTS = {
  Q413: 'Physics', Q214070: 'Physics', Q107715: 'Physics', Q173227: 'Physics',
  Q2329: 'Chemistry',
  Q12483: 'Statistics', Q5862903: 'Statistics',
  Q8134: 'Economics',
  Q420: 'Biology',
  Q21198: 'Computing',
  Q11023: 'Engineering',
  Q333: 'Astronomy',
  Q395: 'Mathematics', Q65943: 'Mathematics', Q24034552: 'Mathematics', Q246672: 'Mathematics',
};

/** The roots a kind of thing leads to (physical law, theorem): the rest are fields. */
export const KIND_ROOTS = new Set(['Q214070', 'Q107715', 'Q173227', 'Q65943', 'Q24034552', 'Q246672']);

/** Kinds of thing the bank leaves out, traced by subclass of alone: a unit's definition relates units, not quantities. */
export const MARKERS = { Q47574: 'unit' };
