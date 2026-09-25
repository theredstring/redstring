/**
 * Routing a wizard intent to the wizard surface that handles it (moved
 * verbatim from NodeCanvas's runWizardIntent).
 */
import { DEFAULT_ABSTRACTION_DIMENSION } from '../../../wizard/tools/utils/abstractionSpec.js';
import { buildAuditWebPrompt, buildConnectThingPrompt, buildConnectionGapsPrompt, buildExplainConnectionPrompt, buildExplainThingPrompt, buildFillDetailsPrompt, buildFreeTextPrompt, buildSummarizeWebPrompt } from '../../../wizard/prompts/intentPrompts.js';
import { policyForIntent } from '../../../wizard/prompts/intents.js';

export async function dispatchWizardIntent({ intent, destination, payload, freeText }, ctx) {
  const {
    openAbstractionWizardWithPrompt, openGrowGraphWizardWithPrompt, openNodeWizardWithPrompt, openWizardAsk, openWizardWithPrompt,
  } = ctx;
  const newConversation = destination !== 'current';
  const toolPolicy = policyForIntent(intent);

  switch (intent.id) {
    // The original four, unchanged.
    case 'refine-connection':
      return openWizardWithPrompt(payload.edges, { newConversation });
    case 'define-components':
      return openNodeWizardWithPrompt(payload.prototype, { newConversation });
    case 'ladder-build':
      return openAbstractionWizardWithPrompt(payload.prototype, payload.dimension, { newConversation });
    case 'thing-ladder':
      // Same ask reached from the Thing's own menu rather than the carousel.
      return openAbstractionWizardWithPrompt(payload.prototype, DEFAULT_ABSTRACTION_DIMENSION, { newConversation });
    case 'grow-web':
      return openGrowGraphWizardWithPrompt({ newConversation });
    default:
      break;
  }

  const build = () => {
    switch (intent.id) {
      case 'explain-thing': return buildExplainThingPrompt(payload.prototype);
      case 'connect-into-web': return buildConnectThingPrompt(payload.prototype);
      case 'fill-in-details': return buildFillDetailsPrompt(payload.prototype);
      case 'explain-connection': return buildExplainConnectionPrompt(payload.edges);
      case 'connection-gaps': return buildConnectionGapsPrompt(payload.edges);
      case 'summarize-web': return buildSummarizeWebPrompt();
      case 'audit-web': return buildAuditWebPrompt();
      default:
        if (intent.tier === 'freetext') return buildFreeTextPrompt(intent.surface, payload, freeText);
        return null;
    }
  };
  return openWizardAsk(build, { newConversation, toolPolicy });
}
