import React from 'react';
import { Layers } from 'lucide-react';
import Dialog, { DialogButton } from '../shared/Dialog.jsx';
import { useTheme } from '../../hooks/useTheme.js';

// The URIs that say what a thing is: Wikidata's instance of (P31) and
// subclass of (P279), RDF's type and RDFS's subClassOf.
const TYPE_URIS = new Set([
  'http://www.wikidata.org/prop/direct/P31',
  'http://www.wikidata.org/prop/direct/P279',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  'http://www.w3.org/2000/01/rdf-schema#subClassOf'
]);
// The same claim by name, squashed to letters so case, spaces, prefixes and
// camelCase don't matter: "Type Of", "rdf:type", "subClassOf", "is a".
const TYPE_NAMES = new Set([
  'instanceof', 'isinstanceof', 'isaninstanceof', 'aninstanceof',
  'subclassof', 'isasubclassof', 'asubclassof', 'rdfssubclassof',
  'typeof', 'isatypeof', 'atypeof', 'subtypeof', 'isasubtypeof',
  'kindof', 'isakindof', 'akindof', 'sortof', 'isasortof',
  'isa', 'isan', 'type', 'hastype', 'rdftype'
]);
const squash = (s) => (typeof s === 'string' ? s.toLowerCase().replace(/[^a-z]/g, '') : '');
const isTypeName = (s) => {
  if (typeof s !== 'string') return false;
  // A property id ("P31", "wdt:P279") is matched by its number; squashed, it would be "p".
  return /(^|:)P(31|279)$/i.test(s.trim()) || TYPE_NAMES.has(squash(s));
};

/**
 * True for a connection that says what the seed IS: an outgoing "instance of",
 * "subclass of", "type of", "is a" and their like. Its other end can be the
 * seed's type as well as, or instead of, a Thing beside it.
 */
export function isTypeStatement(c) {
  if (!c || c.direction !== 'out') return false;
  const uri = String(c.predicateUri || '').replace(/^https:/, 'http:');
  return TYPE_URIS.has(uri) || isTypeName(c.predicateKey) || isTypeName(c.predicate);
}

/**
 * The question an "instance of" / "subclass of" row asks before it's added:
 * make the other end the seed's type (the default, and Enter), draw it in the
 * Web as the connection, or both.
 *
 * @param {Object} props
 * @param {string} props.seedName
 * @param {string} props.typeName
 * @param {string} props.predicate - the row's label, e.g. "instance of"
 * @param {string|null} props.currentTypeName - the seed's type now, when it's something other than Thing
 * @param {boolean} props.typeBlocked - the type would loop back to the seed
 * @param {(choice: 'type'|'web'|'both') => void} props.onChoose
 * @param {() => void} props.onClose
 */
const TypeStatementDialog = ({
  seedName, typeName, predicate, currentTypeName, typeBlocked, onChoose, onClose
}) => {
  const theme = useTheme();
  const choose = (choice) => { onChoose(choice); onClose(); };

  return (
    <Dialog
      onScrimClick={onClose}
      icon={Layers}
      title={`Add ${typeName}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !typeBlocked && e.target === e.currentTarget) {
          e.preventDefault();
          choose('type');
        }
      }}
      footer={
        <>
          <DialogButton label="Both" disabled={typeBlocked} onClick={() => choose('both')} />
          <DialogButton label="In the Web" onClick={() => choose('web')} />
          <DialogButton label="As the Type" tone="accent" disabled={typeBlocked} onClick={() => choose('type')} />
        </>
      }
    >
      <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.5, color: theme.canvas.textPrimary }}>
        {typeBlocked
          ? `${typeName} can't be the type: it's already a kind of ${seedName}.`
          : `${seedName} ${predicate} ${typeName}.${currentTypeName ? ` As the type, it replaces ${currentTypeName}.` : ''}`}
      </p>
    </Dialog>
  );
};

export default TypeStatementDialog;
