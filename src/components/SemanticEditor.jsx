import React, { useMemo, useState } from 'react';
import { Search, X, Tags, CheckCircle, CircleArrowUp } from 'lucide-react';
import Dropdown from './Dropdown.jsx';
import PanelIconButton from './shared/PanelIconButton.jsx';
import PanelCard, { usePanelCardTokens } from './shared/PanelCard.jsx';
import InfoPopover from './shared/InfoPopover.jsx';
import { RDF_SCHEMA_INTRO, CLASSIFICATION_INTRO } from './semanticWebCopy.js';
import useGraphStore from '../store/graphStore.js';

const FONT = "'EmOne', sans-serif";

/**
 * A literal value — a name, a URI, a comment pulled off the node.
 *
 * Deliberately NOT a <code> element in a tinted box: the browser's default
 * monospace is a terminal font that belongs to no part of this interface, and
 * boxing every value turns a short list into a wall of chips. Weight and colour
 * carry the distinction instead, in the same typeface as everything else.
 */
const Literal = ({ children, muted = false, tokens, style = {} }) => (
  <span style={{
    fontFamily: FONT,
    color: muted ? tokens.muted : tokens.text,
    wordBreak: 'break-word',
    ...style
  }}>
    {children}
  </span>
);

/** Label above (or beside) a value. Brand-coloured, small, quiet. */
const FieldLabel = ({ children, tokens, style = {} }) => (
  <div style={{
    fontFamily: FONT,
    fontSize: '11px',
    fontWeight: 'bold',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: tokens.brand,
    marginBottom: 4,
    ...style
  }}>
    {children}
  </div>
);

const RDFSchemaPropertiesSection = ({ nodeData, isUltraSlim }) => {
  const tokens = usePanelCardTokens();

  return (
    <PanelCard
      title="RDF Schema"
      icon={Tags}
      compact={isUltraSlim}
      rightEl={
        <InfoPopover label="About RDF Schema" size={13}>
          {RDF_SCHEMA_INTRO}
        </InfoPopover>
      }
    >
      {/* Auto-synced RDF properties, as a definition list rather than a run of
          boxed literals — the property name is the label, the node's value is
          the content. */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ marginBottom: 8 }}>
          <FieldLabel tokens={tokens}>rdfs:label</FieldLabel>
          <Literal tokens={tokens} style={{ fontSize: '14px' }}>
            {nodeData.name || 'Untitled'}
          </Literal>
        </div>
        <div>
          <FieldLabel tokens={tokens}>rdfs:comment</FieldLabel>
          <Literal tokens={tokens} muted={!nodeData.description} style={{ fontSize: '14px' }}>
            {nodeData.description
              ? `${nodeData.description.substring(0, 120)}${nodeData.description.length > 120 ? '…' : ''}`
              : 'No description'}
          </Literal>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4, marginTop: 8,
          // Wraps under its own icon rather than overflowing the card when the
          // panel is narrower than the sentence.
          flexWrap: 'wrap', minWidth: 0,
          color: tokens.muted, fontSize: '12px', fontFamily: FONT
        }}>
          <CheckCircle size={13} style={{ color: tokens.muted, flexShrink: 0 }} /> Kept in sync with this Thing
        </div>
      </div>

      {/* The rdfs:seeAlso input that used to sit here wrote
          nodeData['rdfs:seeAlso'], a key the exporter overwrites with
          externalLinks and the importer never reads back — so anything typed
          into it was discarded on the next save. The real rdfs:seeAlso is the
          identifier list in About. */}
    </PanelCard>
  );
};

const titleCase = (s = '') => s
  .split(/\s+|_/)
  .filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  .join(' ');

/**
 * Split a class URI into the vocabulary it belongs to and the term itself, so a
 * mapping can be shown as a labelled value ("SCHEMA / Person") rather than one
 * undifferentiated string. Handles both CURIEs (`schema:Person`) and full URIs.
 */
const splitClassUri = (uri = '') => {
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    try {
      const u = new URL(uri);
      const local = (u.hash ? u.hash.slice(1) : u.pathname.split('/').filter(Boolean).pop()) || uri;
      return { prefix: u.hostname.replace(/^www\./, ''), local: decodeURIComponent(local) };
    } catch {
      return { prefix: 'uri', local: uri };
    }
  }
  const idx = uri.indexOf(':');
  if (idx > 0) return { prefix: uri.slice(0, idx), local: uri.slice(idx + 1) };
  return { prefix: 'term', local: uri };
};

const SemanticClassificationSection = ({ nodeData, onUpdate, isUltraSlim }) => {
  const tokens = usePanelCardTokens();
  // Store access for types
  const nodePrototypesMap = useGraphStore(state => state.nodePrototypes);
  const addNodePrototype = useGraphStore(state => state.addNodePrototype);
  const setNodeType = useGraphStore(state => state.setNodeType);

  const equivalentClasses = nodeData.equivalentClasses || [];
  const abstractionChains = nodeData.abstractionChains || {};

  const typePrototype = useMemo(() => {
    if (!nodeData.typeNodeId) return null;
    return nodePrototypesMap.get(nodeData.typeNodeId) || null;
  }, [nodeData.typeNodeId, nodePrototypesMap]);

  const addEquivalentClass = (uri, source = 'manual') => {
    const updatedClasses = [...equivalentClasses, { "@id": uri, "source": source }];
    onUpdate({
      ...nodeData,
      equivalentClasses: updatedClasses
    });
  };

  const removeEquivalentClass = (uri) => {
    const updatedClasses = equivalentClasses.filter(cls => cls['@id'] !== uri);
    onUpdate({
      ...nodeData,
      equivalentClasses: updatedClasses
    });
  };

  const deriveNameFromUri = (uri) => {
    if (!uri) return 'Type';
    let raw = uri;
    const colonIdx = uri.indexOf(':');
    if (colonIdx > -1) raw = uri.slice(colonIdx + 1);
    try {
      raw = decodeURIComponent(raw);
    } catch { }
    raw = raw.split('/').pop() || raw;
    raw = raw.replace(/_/g, ' ');
    return titleCase(raw);
  };

  const promoteClassToType = (uri) => {
    const prettyName = deriveNameFromUri(uri);
    // Try to find existing prototype by normalized name (case-insensitive)
    let existing = null;
    for (const proto of nodePrototypesMap.values()) {
      if ((proto.name || '').toLowerCase() === prettyName.toLowerCase()) {
        existing = proto;
        break;
      }
    }
    let targetTypeId = existing?.id;
    if (!targetTypeId) {
      // Create new type prototype (avoid bloat by reusing name; user can merge later if needed)
      const newTypeId = `type-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      addNodePrototype({
        id: newTypeId,
        name: prettyName,
        description: '',
        color: '#8B0000',
        typeNodeId: null,
        definitionGraphIds: []
      });
      targetTypeId = newTypeId;
    }
    // Set as primary type
    setNodeType(nodeData.id, targetTypeId);
  };

  // Common ontology mappings. These carried per-vocabulary brand colours
  // (Google blue/green/red) that belonged to nothing else in the interface;
  // the vocabulary now reads as a prefix instead.
  const commonOntologies = [
    { id: 'schema:Person' },
    { id: 'foaf:Person' },
    { id: 'dbo:Person' },
    { id: 'schema:Organization' },
    { id: 'foaf:Organization' },
    { id: 'schema:CreativeWork' },
    { id: 'schema:Thing' }
  ];

  const availableOntologies = commonOntologies.filter(
    onto => !equivalentClasses.some(cls => cls['@id'] === onto.id)
  );


  return (
    <PanelCard
      title="Semantic Classification"
      icon={Search}
      compact={isUltraSlim}
      rightEl={
        <InfoPopover label="About semantic classification" size={13}>
          {CLASSIFICATION_INTRO}
        </InfoPopover>
      }
    >
      {/* The Primary Type row that used to sit here duplicated the type
          button under the panel title, which is the canonical control for the
          same fact. The classification below is the different statement: what
          other vocabularies call this KIND of thing. */}
      {/* Add a mapping from the common vocabularies, one at a time. Sits above
          the list, like the input in External References — and so the dropdown's
          menu opens over the list rather than off the end of the section. */}
      {availableOntologies.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <FieldLabel tokens={tokens}>Add Equivalent Class</FieldLabel>
          {/* Fluid: the dropdown's own 140px floor is both wider than a
              narrow panel and narrower than this card, so it fills the card
              instead of standing at a fixed size inside it. */}
          <Dropdown
            className="fluid"
            options={availableOntologies.map(onto => {
              const { prefix, local } = splitClassUri(onto.id);
              return { value: onto.id, label: `${local} · ${prefix}` };
            })}
            value=""
            placeholder="Choose a vocabulary term…"
            onChange={(uri) => uri && addEquivalentClass(uri, 'quick-select')}
          />
        </div>
      )}

      {/* Equivalent classes. Rows, not chips: a vocabulary prefix reads as a
          label and the term reads as content, which is what they are — a grid
          of coloured pills gave every mapping the same shouting weight and told
          you nothing about which vocabulary it came from. */}
      {equivalentClasses.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <FieldLabel tokens={tokens}>Equivalent Classes ({equivalentClasses.length})</FieldLabel>
          {equivalentClasses.map((cls, index) => {
            const uri = cls['@id'];
            const { prefix, local } = splitClassUri(uri);
            // The class this node's type came from cannot be removed here —
            // dropping it used to strip the row that offered "Promote to Type",
            // leaving no way to set a type from this section at all.
            const isPrimary = !!typePrototype
              && deriveNameFromUri(uri).toLowerCase() === (typePrototype.name || '').toLowerCase();
            return (
              <div
                key={index}
                style={{
                  display: 'flex',
                  // Narrow, the two buttons drop under the term instead of
                  // squeezing it: a vocabulary prefix and a class name are
                  // what the row is for, and they lose to ~56px of controls on
                  // a shared line.
                  flexDirection: isUltraSlim ? 'column' : 'row',
                  alignItems: isUltraSlim ? 'stretch' : 'center',
                  justifyContent: 'space-between',
                  gap: isUltraSlim ? 4 : 8,
                  padding: '6px 0',
                  borderTop: index === 0 ? 'none' : `1px solid ${tokens.hairline}`
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{
                      fontFamily: FONT, fontSize: '10px', fontWeight: 'bold',
                      letterSpacing: '0.04em', textTransform: 'uppercase', color: tokens.brand
                    }}>
                      {prefix}
                    </span>
                    <Literal tokens={tokens} style={{ fontSize: '13px' }}>{local}</Literal>
                    {isPrimary && (
                      <span style={{ fontFamily: FONT, fontSize: '11px', color: tokens.muted }}>
                        · primary type
                      </span>
                    )}
                  </div>
                  {cls.source && (
                    <div style={{ fontFamily: FONT, fontSize: '11px', color: tokens.muted, marginTop: 2 }}>
                      via {cls.source}
                    </div>
                  )}
                </div>
                <div style={{
                  display: 'flex',
                  gap: 2,
                  flexShrink: 0,
                  justifyContent: isUltraSlim ? 'flex-end' : undefined
                }}>
                  {!isPrimary && (
                    // Not ArrowUpFromDot — that glyph means "generalise"
                    // everywhere else in the app.
                    <PanelIconButton
                      icon={CircleArrowUp}
                      size={14}
                      onClick={() => promoteClassToType(uri)}
                      title="Make this the primary type"
                    />
                  )}
                  {!isPrimary && (
                    // Plain ghost variant, like every other remove button in
                    // the panel. Destructive actions are not colour-coded here;
                    // the maroon accent is the only hover ring in the panel.
                    <PanelIconButton
                      icon={X}
                      size={14}
                      onClick={() => removeEquivalentClass(uri)}
                      title="Remove this classification"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Abstraction Chains - Future Feature */}
      {Object.keys(abstractionChains).length > 0 && (
        <div style={{ marginTop: '15px' }}>
          <FieldLabel tokens={tokens}>Abstraction Chains</FieldLabel>
          <div style={{
            fontFamily: FONT,
            fontSize: '12px',
            color: tokens.muted,
            fontStyle: 'italic'
          }}>
            Future: These will be automatically mapped to rdfs:subClassOf relationships
          </div>
        </div>
      )}
    </PanelCard>
  );
};

/**
 * The Semantic Web section: the two statements about a node that are genuinely
 * ontology work.
 *
 * Everything else that used to live here has gone. External references moved to
 * About, where they belong — they are what the world calls this thing, not a
 * vocabulary exercise. Mass Import, Resolve Links, the Wikipedia helper, the
 * enrichment/progress/results displays and the read-write-consolidate pipeline
 * were all unreachable: the `showAdvanced` toggle that gated them had been
 * commented out, so `showAdvanced` was permanently false and roughly 1,100
 * lines of this file could not execute.
 */
const SemanticEditor = ({ nodeData, onUpdate, isUltraSlim = false }) => {
  if (!nodeData) return null;

  return (
    <div style={{ padding: '0 0 10px 0', fontFamily: FONT }}>
      <RDFSchemaPropertiesSection nodeData={nodeData} isUltraSlim={isUltraSlim} />
      <SemanticClassificationSection
        nodeData={nodeData}
        onUpdate={onUpdate}
        isUltraSlim={isUltraSlim}
      />
    </div>
  );
};

export default SemanticEditor;