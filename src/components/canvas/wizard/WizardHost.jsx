/**
 * The Ask The Wizard picker and the window events that open it (P5.06b, moved
 * from NodeCanvas). State and openers live in canvasWizard.js.
 */
import { useEffect } from 'react';
import useGraphStore from '../../../store/graphStore.js';
import WizardIntentModal from '../../wizard/WizardIntentModal.jsx';
import { SURFACES as WIZARD_SURFACES } from '../../../wizard/prompts/intents.js';
import { thingFacts, ladderFacts } from '../../../wizard/prompts/facts.js';
import {
  useCanvasWizardStore, setAskWizardPicker, chooseWizardDestination, runWizardIntent, openWizardPicker,
} from './canvasWizard.js';

export default function WizardHost() {
  const askWizardPicker = useCanvasWizardStore((s) => s.picker);
  const wizardDestination = useCanvasWizardStore((s) => s.destination);

  // "Ask The Wizard" on a Thing, dispatched from the right panel and the pie menu.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (e) => {
      const protoId = e?.detail?.prototypeId;
      if (!protoId) return;
      const proto = useGraphStore.getState().nodePrototypes.get(protoId);
      if (!proto) {
        console.error('[NodeCanvas] rs-ask-wizard-define-node: prototype not found:', protoId);
        return;
      }
      openWizardPicker(WIZARD_SURFACES.THING, { prototype: proto }, {
        facts: thingFacts(proto),
        subjectLabel: `"${proto.name || 'this Thing'}"`
      });
    };
    window.addEventListener('rs-ask-wizard-define-node', handler);
    return () => window.removeEventListener('rs-ask-wizard-define-node', handler);
  }, []);

  // "Ask The Wizard" from the abstraction carousel. This surface has a single
  // intent, so openWizardPicker fires it directly and no modal ever appears.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (e) => {
      const protoId = e?.detail?.prototypeId;
      const dimension = e?.detail?.dimension;
      if (!protoId || !dimension) return;
      const proto = useGraphStore.getState().nodePrototypes.get(protoId);
      if (!proto) {
        console.error('[NodeCanvas] rs-ask-wizard-abstraction: prototype not found:', protoId);
        return;
      }
      openWizardPicker(WIZARD_SURFACES.LADDER, { prototype: proto, dimension }, {
        facts: ladderFacts(proto, dimension),
        subjectLabel: `"${proto.name || 'this Thing'}" · ${dimension}`
      });
    };
    window.addEventListener('rs-ask-wizard-abstraction', handler);
    return () => window.removeEventListener('rs-ask-wizard-abstraction', handler);
  }, []);

  // Ask The Wizard — one picker for every entry point. Replaces four
  // near-identical confirm dialogs that only ever asked new-or-current.
  return (
    <WizardIntentModal
      isOpen={!!askWizardPicker}
      surface={askWizardPicker?.surface}
      facts={askWizardPicker?.facts}
      subjectLabel={askWizardPicker?.subjectLabel}
      destination={wizardDestination}
      onDestinationChange={chooseWizardDestination}
      onClose={() => setAskWizardPicker(null)}
      onConfirm={({ intent, destination, freeText }) => {
        const payload = askWizardPicker?.payload;
        setAskWizardPicker(null);
        runWizardIntent({ intent, destination, payload, freeText });
      }}
    />
  );
}
