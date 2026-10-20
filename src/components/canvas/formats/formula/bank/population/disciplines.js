/**
 * The shape the bank is built in: 2 has sections and what each knows of. A
 * bank a device kept in an older shape is set aside for the one shipped.
 */
export const BANK_FORMAT = 2;

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

/**
 * Which discipline wins a tie, first first. Mathematics comes before computing:
 * a field that leads to both (graph theory, numerical analysis) is
 * mathematics' before it is computing's.
 */
export const DISCIPLINE_ORDER = ['Physics', 'Chemistry', 'Statistics', 'Economics', 'Biology', 'Mathematics', 'Computing', 'Engineering', 'Astronomy'];

/**
 * Whether a class is a field of study, by how Wikidata describes it ("branch
 * of mathematics", "study of graphs") or what it is called (thermodynamics,
 * graph theory): the sections a discipline is divided into, rather than the
 * things a category is about (Voltage, Georg Ohm).
 */
const FIELD_WORDS = /\b(branch|field|study|studies|discipline|subdiscipline|subfield|sub-field|area of)\b/i;
const FIELD_ENDINGS = /(ics|ology|ometry|theory|analysis|algebra|calculus|dynamics|mechanics|genetics|ecology|chemistry|statistics|economics|engineering|science|geometry|topology|arithmetic)$/i;
// Named like a field, and not one: a concept in physics, the history of geometry, 2023 in science.
const NOT_FIELDS = /^(concepts?|list|lists|history|outline|glossary|index|superseded|timeline|philosophy)\b|^\d|\bcentury\b/i;
export const isFieldLike = (label, description) => !!label && !NOT_FIELDS.test(label)
  && (FIELD_WORDS.test(description || '') || FIELD_ENDINGS.test(label));

/** The roots a kind of thing leads to (physical law, theorem): the rest are fields. */
export const KIND_ROOTS = new Set(['Q214070', 'Q107715', 'Q173227', 'Q65943', 'Q24034552', 'Q246672']);

/** Kinds of thing the bank leaves out, traced by subclass of alone: a unit's definition relates units, not quantities. */
export const MARKERS = { Q47574: 'unit' };

/**
 * The kinds of thing a section's known results are (each with its
 * subclasses): what a field has to say, whether or not Wikidata writes it as
 * a formula yet. Principle is left out: its subclasses run to law and ethics.
 */
export const RESULT_KINDS = {
  Q65943: 'theorem', Q207505: 'lemma', Q214070: 'physical law', Q408891: 'scientific law',
  Q11345: 'equation', Q976981: 'formula', Q486902: 'mathematical model',
  Q105210: 'universal law', Q25066782: 'biological rule',
};
/** Kinds whose results Wikidata often keeps as classes of their own (Lotka–Volterra equations, a kind of model). */
export const RESULT_CLASS_KINDS = new Set(['Q486902', 'Q408891', 'Q11345']);
