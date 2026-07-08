import React from 'react';
import { sanitizeHtml } from '../../../utils/sanitizeHtml.js';
import { Bot, Key, Settings, RotateCcw, Undo2, Send, User, Square, Copy, Brain, Wrench, Plus, X, ChevronDown, Paperclip, FileText } from 'lucide-react';
import * as fileStorage from '../../../store/fileStorage.js';
import mcpClient from '../../../services/mcpClient.js';
import apiKeyManager from '../../../services/apiKeyManager.js';
import MultipleChoiceOverlay from '../../../ai/components/MultipleChoiceOverlay.jsx';
import PlanCard from '../../../ai/components/PlanCard.jsx';
import ThinkingBlock from '../../../ai/components/ThinkingBlock.jsx';
import { bridgeFetch, bridgeEventSource } from '../../../services/bridgeConfig.js';
import StandardDivider from '../../StandardDivider.jsx';
import { HEADER_HEIGHT, NODE_DEFAULT_COLOR } from '../../../constants.js';
import ToolCallCard from '../../ToolCallCard.jsx';
import WizardActionChip from '../../wizard/WizardActionChip.jsx';
import { resolveGraphId } from '../../../wizard/tools/resolveGraphId.js';
import ConfirmDialog from '../../shared/ConfirmDialog.jsx';
import { DRUID_SYSTEM_PROMPT } from '../../../services/agent/DruidPrompt.js';
import useGraphStore from '../../../store/graphStore.js';
import { applyOffscreenLayout } from '../../../services/offscreenLayout.js';
import { applyToolResultToStore, configureToolResultApplier, setWizardProvenanceContext } from '../../../services/toolResultApplier.js';
import DruidInstance from '../../../services/DruidInstance.js';
import { getTextColor } from '../../../utils/colorUtils.js';
import { useTheme } from '../../../hooks/useTheme.js';
import { queueThumbnailFetch } from '../../../services/imageCache.js';
import headSvg from '../../../assets/svg/wizard/head.svg';
import { getFileCategory, isTabularFile, readFileAsDataUrl, readFileAsText, readPdfAsText, readTabularFile, buildContentBlocks, SUPPORTED_IMAGE_TYPES, SUPPORTED_DOC_TYPES, MAX_FILE_SIZE } from '../../../ai/fileAttachmentUtils.js';
import { getAllTabularData, clearTabularData } from '../../../services/tabularDataStore.js';

// Shared Components
import PanelIconButton from '../../shared/PanelIconButton.jsx';

/**
 * Build the update object for a node from a server enrichment match.
 * Shared between single and batch enrichment.
 */
function buildEnrichmentUpdates(nodeProto, searchResult, confidence, { overwriteDescription = false } = {}) {
  const hasExistingDescription = !overwriteDescription && nodeProto.description && nodeProto.description.trim().length > 10;

  // Compute aspect ratio from API-provided thumbnail dimensions (survives save/load)
  const tw = searchResult.page.thumbnailWidth;
  const th = searchResult.page.thumbnailHeight;
  const imageAspectRatio = (tw && th) ? (th / tw) : undefined;

  const updates = {
    ...(hasExistingDescription ? {} : { description: searchResult.page.description }),
    semanticMetadata: {
      ...nodeProto.semanticMetadata,
      wikipediaUrl: searchResult.page.url,
      wikipediaTitle: searchResult.page.title,
      wikipediaThumbnail: searchResult.page.thumbnail,
      wikipediaEnriched: true,
      wikipediaEnrichedAt: new Date().toISOString(),
      autoEnriched: true,
      autoEnrichConfidence: confidence,
      ...(imageAspectRatio ? { imageAspectRatio } : {})
    }
  };

  const currentLinks = nodeProto.externalLinks || [];
  if (!currentLinks.some(link => String(link).includes('wikipedia.org'))) {
    updates.externalLinks = [searchResult.page.url, ...currentLinks];
  }

  return updates;
}

/**
 * Enrich a single node with Wikipedia data via server endpoint.
 * Used for explicit wizard tool calls (not batch).
 */
async function enrichNodeWithWikipedia(nodeName, _graphId, options = {}) {
  const { minConfidence = 0.40, overwriteDescription = false } = options;

  try {
    console.log(`[Auto-Enrich] Starting Wikipedia enrichment for "${nodeName}" (via server, minConfidence=${minConfidence}, overwrite=${overwriteDescription})`);

    const resp = await bridgeFetch('/api/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeName, minConfidence })
    });
    if (!resp.ok) {
      console.warn(`[Auto-Enrich] Server returned ${resp.status} for "${nodeName}"`);
      return null;
    }

    const data = await resp.json();
    if (!data.ok || !data.matches || data.matches.length === 0) {
      console.warn(`[Auto-Enrich] No Wikipedia match for "${nodeName}" (ok=${data.ok}, matches=${data.matches?.length || 0})`);
      return null;
    }

    const { searchResult, confidence } = data.matches[0];
    console.log(`[Auto-Enrich] ✅ Match for "${nodeName}": "${searchResult.page.title}" (${confidence.toFixed(2)}), thumb=${!!searchResult.page.thumbnail}, desc=${(searchResult.page.description || '').length}ch`);

    // Find and update the node in the store
    const store = useGraphStore.getState();
    let targetNodeProtoId = null;
    for (const [protoId, proto] of store.nodePrototypes) {
      if (proto.name.toLowerCase().trim() === nodeName.toLowerCase().trim()) {
        targetNodeProtoId = protoId;
      }
    }

    if (!targetNodeProtoId) {
      console.warn(`[Auto-Enrich] Node "${nodeName}" not found in store — available: ${Array.from(store.nodePrototypes.values()).slice(0, 10).map(p => p.name).join(', ')}`);
      return null;
    }

    const nodeProto = store.nodePrototypes.get(targetNodeProtoId);
    const updates = buildEnrichmentUpdates(nodeProto, searchResult, confidence, { overwriteDescription });
    console.log(`[Auto-Enrich] Built updates for "${nodeName}": desc=${!!updates.description}, wikiUrl=${updates.semanticMetadata?.wikipediaUrl}, links=${updates.externalLinks?.length || 'unchanged'}`);

    // Store original image URL in metadata for lazy loading
    if (searchResult.page.originalImage) {
      updates.semanticMetadata = {
        ...updates.semanticMetadata,
        wikipediaOriginalImage: searchResult.page.originalImage
      };
    }

    // Apply metadata immediately
    store.updateNodePrototype(targetNodeProtoId, (draft) => {
      Object.assign(draft, updates);
    });
    console.log(`[Auto-Enrich] Applied metadata to prototype ${targetNodeProtoId}`);

    // Queue thumbnail fetch — creates blob URL for SVG <image> rendering
    const thumbUrl = searchResult.page.thumbnail;
    if (thumbUrl) {
      const tw = searchResult.page.thumbnailWidth;
      const th = searchResult.page.thumbnailHeight;
      const ratio = (tw && th) ? (th / tw) : 1;
      console.log(`[Auto-Enrich] Queueing thumbnail for "${nodeName}": ${thumbUrl.substring(0, 80)}... (ratio=${ratio.toFixed(2)})`);
      queueThumbnailFetch(targetNodeProtoId, thumbUrl, ratio, nodeName);
    } else {
      console.log(`[Auto-Enrich] No thumbnail available for "${nodeName}"`);
    }

    console.log(`[Auto-Enrich] Successfully enriched "${nodeName}"`);
    return { success: true, nodeName, confidence, wikipediaUrl: searchResult.page.url };

  } catch (error) {
    console.warn(`[Auto-Enrich] Failed to enrich "${nodeName}":`, error);
    return null;
  }
}

// Image caching is handled by queueThumbnailFetch from imageCache.js
// It fetches the Wikipedia thumbnail, creates a blob URL (same-origin for SVG <image>),
// and stores it in the separate image cache store (never serialized/saved).

/**
 * Enrich multiple nodes from Wikipedia via server endpoint.
 *
 * Phase 1: Single POST to /api/enrich — server handles all Wikipedia API calls.
 * Phase 2: Apply metadata updates in a single batch setState.
 * Phase 3: Queue image fetches for background processing (trickle in one by one).
 *
 * This is near-instant: one HTTP call + a single store write.
 * Images appear progressively as they're fetched in the background.
 */
async function enrichMultipleNodes(nodeNames, _graphId, { overwriteDescription = false } = {}) {
  console.log(`[Auto-Enrich] 🚀 Starting enrichment for ${nodeNames.length} nodes (via server)`);

  // ── Phase 1: Server-side batch Wikipedia lookup ──
  let matches = [];
  try {
    const resp = await bridgeFetch('/api/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeNames, minConfidence: 0.40 })
    });
    if (!resp.ok) {
      console.warn(`[Auto-Enrich] Server returned ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    matches = data.matches || [];
  } catch (err) {
    console.warn(`[Auto-Enrich] Server enrichment failed:`, err.message);
    return [];
  }

  console.log(`[Auto-Enrich] 📊 ${matches.length}/${nodeNames.length} Wikipedia matches from server`);
  if (matches.length === 0) return [];

  // Wait for nodes to be fully created in store
  await new Promise(resolve => setTimeout(resolve, 1000));

  // ── Phase 2: Build metadata updates + single batch setState ──
  const pendingUpdates = [];
  const imageJobs = []; // queued for background

  for (const { nodeName, searchResult, confidence } of matches) {
    const store = useGraphStore.getState();
    let targetProtoId = null;
    for (const [protoId, proto] of store.nodePrototypes) {
      if (proto.name.toLowerCase().trim() === nodeName.toLowerCase().trim()) {
        targetProtoId = protoId;
      }
    }

    if (!targetProtoId) {
      console.warn(`[Auto-Enrich] "${nodeName}" not found in store, skipping`);
      continue;
    }

    const nodeProto = store.nodePrototypes.get(targetProtoId);
    const updates = buildEnrichmentUpdates(nodeProto, searchResult, confidence, { overwriteDescription });

    // Store image URLs in metadata
    if (searchResult.page.originalImage || searchResult.page.thumbnail) {
      updates.semanticMetadata = {
        ...updates.semanticMetadata,
        wikipediaOriginalImage: searchResult.page.originalImage || null
      };
      // Queue direct URL caching (no data URL conversion needed)
      if (searchResult.page.thumbnail && !nodeProto.thumbnailSrc) {
        imageJobs.push({
          protoId: targetProtoId,
          thumbUrl: searchResult.page.thumbnail,
          thumbWidth: searchResult.page.thumbnailWidth,
          thumbHeight: searchResult.page.thumbnailHeight,
          nodeName
        });
      }
    }

    pendingUpdates.push({ protoId: targetProtoId, updates, nodeName });
  }

  // Apply all metadata in one shot (descriptions, links, Wikipedia URLs)
  console.log(`[Auto-Enrich] 💾 Applying ${pendingUpdates.length} metadata updates`);
  useGraphStore.setState((state) => {
    const nextPrototypes = new Map(state.nodePrototypes);
    for (const { protoId, updates, nodeName } of pendingUpdates) {
      const existing = nextPrototypes.get(protoId);
      if (existing) {
        nextPrototypes.set(protoId, { ...existing, ...updates });
        console.log(`[Auto-Enrich] ✅ "${nodeName}" metadata applied`);
      }
    }
    return { nodePrototypes: nextPrototypes };
  });

  // ── Phase 3: Queue thumbnail fetches (blob URLs for SVG rendering) ──
  console.log(`[Auto-Enrich] 🖼️ Queuing ${imageJobs.length} thumbnail fetches`);
  for (const job of imageJobs) {
    const ratio = (job.thumbWidth && job.thumbHeight) ? (job.thumbHeight / job.thumbWidth) : 1;
    queueThumbnailFetch(job.protoId, job.thumbUrl, ratio, job.nodeName);
  }

  console.log(`[Auto-Enrich] ✅ Enrichment complete — thumbnails loading in background`);
  return pendingUpdates.map(u => ({ status: 'fulfilled', value: { success: true, nodeName: u.nodeName } }));
}

// Wire the extracted tool-result applier (src/services/toolResultApplier.js)
// with this browser's Wikipedia-backed enrichment. A headless Node host leaves
// these hooks as no-ops, so the applier stays pure there.
configureToolResultApplier({ enrich: enrichNodeWithWikipedia, enrichMultiple: enrichMultipleNodes });


// Wizard loading strings and scramble component
const WIZARD_LOADING_STRINGS = [
  "Perusing ancient tomes",
  "Visiting the gnomes",
  "Bubbling cauldron",
  "Pondering my orb",
  "Deep in meditation",
  "Deciphering runes",
  "Cooking perpetual stew",
  "Channeling arcane energies",
  "Connecting the dots",
  "Taking a water break",
  "Getting esoteric",
  "Folding origami",
  "Wandering the groves",
  "Sleeping in",
  "Making a bracelet",
  "Asking spirits",
  "Casting spells",
  "Having fun",
  "Skipping stones",
  "Breathing in noosphere",
  "Producing house music",
  "Grinding pipe-weed",
  "Polishing crystal ball",
  "Weaving web of fate",
  "Opening portals",
  "Shuffling tarot cards",
  "Accessing Akashic Records",
  "Stirring the pot",
  "Building schemas",
  "Betting on jousting",
  "Waxing and waning",
  "Taking deep breath",
  "Picking mushrooms",
  "Hiding secrets",
  "Minimizing slop",
  "Performing divination",
  "Fetching water",
  "Prancing through the forest",
  "Looking out the castle window",
  "Doodling in margins",
  "Casting a cantrip",
  "Kissing the Blarney Stone",
  "Cracking the case",
  "Performing exorcism",
  "Consulting the oracle",
  "Returning to dust",
  "Considering necromancy",
  "Growing herbs in my garden",
  "Contemplating the mystical",
  "Burning a candle",
  "Reading aura",
  "Feeding the birds",
  "Summoning entities",
  "Brewing potion of insight",
  "Gazing into the abyss",
  "Pumping iron",
  "Fighting evil",
  "Foraging for berries",
  "Distracting you",
  "Writing doom-scrolls",
  "Getting existential",
  "Muttering incantations",
  "Weaving a tapestry",
  "Locking in",
  "Opening crypt",
  "Staying up late",
  "Checking my phone",
  "Shaking 8 ball",
  "Gaming",
  "Trying new things",
  "Doing taxes",
  "Playing tennis",
  "Adjusting pointy hat",
  "Breaking curses",
  "Aligning chakras",
  "Taking a nap",
  "Booking a trip",
  "Upgrading wand",
  "Cleaning monocle",
  "Unfurling thesaurus",
  "Turning lead into gold",
  "Playing cards",
  "Doing yoga",
  "Levitating",
  "Charging crystals",
  "Waving wand around",
  "Manufacturing sparkles",
  "Scrying",
  "Lunch break",
  "Herding ontological cats",
  "Connecting cosmic dots",
  "Tracing invisible threads",
  "Stroking beard",
  "Binding with enchantment",
];

const ARCANE_GLYPHS = '◈◇△▽✧⊕∴⌘◬⟁⊛⊜⊝※⌬⍟⎔⏣⏥⏦⊶⊷⋈⋉⋊⟐⟟⟠';

function WizardLoadingText() {
  const [displayText, setDisplayText] = React.useState(() =>
    WIZARD_LOADING_STRINGS[Math.floor(Math.random() * WIZARD_LOADING_STRINGS.length)]
  );
  const currentRef = React.useRef(displayText);

  React.useEffect(() => {
    let scrambleInterval = null;
    let cycleTimeout = null;

    const pickNext = () => {
      let next;
      do {
        next = WIZARD_LOADING_STRINGS[Math.floor(Math.random() * WIZARD_LOADING_STRINGS.length)];
      } while (next === currentRef.current && WIZARD_LOADING_STRINGS.length > 1);
      return next;
    };

    const scrambleTo = (target) => {
      const source = currentRef.current;
      let ticks = 0;
      const maxTicks = 18;
      const corruptEnd = 7;  // ticks 1-7: corrupt source text
      const corrupted = new Array(source.length).fill(false);
      const randGlyph = () => ARCANE_GLYPHS[Math.floor(Math.random() * ARCANE_GLYPHS.length)];

      scrambleInterval = setInterval(() => {
        ticks++;
        if (ticks >= maxTicks) {
          clearInterval(scrambleInterval);
          scrambleInterval = null;
          currentRef.current = target;
          setDisplayText(target);
          return;
        }

        // Length morphs smoothly across the ENTIRE animation
        const lenProgress = ticks / (maxTicks - 1);
        const curLen = Math.round(source.length + (target.length - source.length) * lenProgress);

        if (ticks <= corruptEnd) {
          // Phase 1: Corrupt source characters randomly
          const realPositions = [];
          for (let i = 0; i < source.length; i++) {
            if (!corrupted[i] && source[i] !== ' ') realPositions.push(i);
          }
          const toCorrupt = Math.ceil(realPositions.length / (corruptEnd - ticks + 1));
          for (let n = 0; n < toCorrupt && realPositions.length > 0; n++) {
            const pick = Math.floor(Math.random() * realPositions.length);
            corrupted[realPositions[pick]] = true;
            realPositions.splice(pick, 1);
          }

          let scrambled = '';
          for (let i = 0; i < curLen; i++) {
            if (i < source.length && source[i] === ' ') {
              scrambled += ' ';
            } else if (i < source.length && !corrupted[i]) {
              scrambled += source[i];
            } else {
              scrambled += randGlyph();
            }
          }
          setDisplayText(scrambled);
        } else {
          // Phase 2: Reveal target left-to-right, length still morphing
          const revealProgress = (ticks - corruptEnd) / (maxTicks - corruptEnd - 1);
          const revealCount = Math.floor(revealProgress * target.length);
          let scrambled = '';
          for (let i = 0; i < curLen; i++) {
            if (i < revealCount) {
              scrambled += target[i] || '';
            } else if (i < target.length && target[i] === ' ') {
              scrambled += ' ';
            } else {
              scrambled += randGlyph();
            }
          }
          setDisplayText(scrambled);
        }
      }, 30);
    };

    const scheduleCycle = () => {
      cycleTimeout = setTimeout(() => {
        const next = pickNext();
        scrambleTo(next);
        scheduleCycle();
      }, 3500);
    };

    scheduleCycle();

    return () => {
      if (scrambleInterval) clearInterval(scrambleInterval);
      if (cycleTimeout) clearTimeout(cycleTimeout);
    };
  }, []);

  return <span className="wizard-loading-text">{displayText}</span>;
}

// Internal AI Collaboration View component (migrated from src/ai/AICollaborationPanel.jsx)
const LeftAIView = ({ compact = false,
  active = true,
  activeGraphId,
  graphsMap,
  edgesMap,
  nodePrototypesMap
}) => {
  const theme = useTheme();
  const [isConnected, setIsConnected] = React.useState(false);
  const [messages, setMessages] = React.useState([]);
  const [currentInput, setCurrentInput] = React.useState('');
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [currentApiConfig, setCurrentApiConfig] = React.useState(null);
  const [showToolsDropdown, setShowToolsDropdown] = React.useState(false);
  const [wizardTools, setWizardTools] = React.useState([]);
  const [selectedTestTool, setSelectedTestTool] = React.useState(null);
  const [testToolArgs, setTestToolArgs] = React.useState('');
  const [hasAPIKey, setHasAPIKey] = React.useState(false);
  const [apiKeyInfo, setApiKeyInfo] = React.useState(null);
  const [viewMode, setViewMode] = React.useState('wizard'); // 'wizard', 'chat', 'druid'
  const [showModeMenu, setShowModeMenu] = React.useState(false);
  const modeMenuRef = React.useRef(null);

  // Load current API config when advanced options are shown
  React.useEffect(() => {
    if (showAdvanced) {
      apiKeyManager.getAPIKeyInfo().then(setCurrentApiConfig);
    }
  }, [showAdvanced]);

  // Close mode menu when clicking outside
  React.useEffect(() => {
    if (!showModeMenu) return;
    const handleClickOutside = (event) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(event.target)) {
        setShowModeMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showModeMenu]);
  const [currentAgentRequest, setCurrentAgentRequest] = React.useState(null);
  const [wizardStage, setWizardStage] = React.useState(null); // Track current wizard stage
  const [druidInstance, setDruidInstance] = React.useState(null); // Druid cognitive state manager
  // Synchronously hydrate conversations from localStorage to avoid async race conditions.
  // On web, localStorage is the only persistence layer so this gives us the full picture immediately.
  // On Electron, this provides a fast initial load; the mount effect below may override with workspace data.
  const [conversationInit] = React.useState(() => {
    try {
      // Assign legacy (unscoped) conversations to the current graph so they only appear there,
      // not in every definition graph the user navigates to.
      const initGraphId = useGraphStore.getState().activeGraphId || null;
      const manifestStr = localStorage.getItem('rs.aiChat.manifest');
      if (manifestStr) {
        const manifest = JSON.parse(manifestStr);
        if (manifest && manifest.conversations && manifest.conversations.length > 0) {
          const hydrated = manifest.conversations.map(c => {
            try {
              const localData = localStorage.getItem(`rs.aiChat.messages.${c.id}`);
              if (localData) {
                const data = JSON.parse(localData);
                return { ...c, messages: data.messages || [], graphId: c.graphId || initGraphId };
              }
            } catch { }
            return { ...c, messages: [], graphId: c.graphId || initGraphId };
          });
          return {
            conversations: hydrated,
            activeId: manifest.activeConversationId || hydrated[0].id
          };
        }
      }
    } catch { }
    return null;
  });
  const [conversations, setConversations] = React.useState(
    conversationInit?.conversations || [{ id: 'default', title: 'New Chat', messages: [], timestamp: new Date().toISOString() }]
  );
  const [activeConversationId, setActiveConversationId] = React.useState(
    conversationInit?.activeId || 'default'
  );
  // Mirror live state into refs for the once-mounted telemetry listener
  // (registered with [] deps) and the stable upsertToolCall callback, so they
  // read current values instead of their first-render closure.
  const activeConversationIdRef = React.useRef(activeConversationId);
  React.useEffect(() => { activeConversationIdRef.current = activeConversationId; }, [activeConversationId]);
  const messagesRef = React.useRef(messages);
  React.useEffect(() => { messagesRef.current = messages; }, [messages]);
  // Stable ref for conversations (avoid stale closures in effects/event handlers).
  const conversationsRef = React.useRef(conversations);
  React.useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  // Conversation that owns the in-flight agent run. Telemetry arrives as a
  // GLOBAL window event with no conversation id, so without this a run started
  // in tab A dumps its tool chips into tab B after a tab switch.
  const telemetryConversationIdRef = React.useRef(null);
  const [editingTabId, setEditingTabId] = React.useState(null);
  const [editingTabTitle, setEditingTabTitle] = React.useState('');
  // On web, localStorage init above is sufficient — mark as hydrated immediately.
  // On Electron, the mount effect below may load from workspace files asynchronously.
  const [isHydrated, setIsHydrated] = React.useState(!fileStorage.isElectron());
  const [chatUndoMessageId, setChatUndoMessageId] = React.useState(null);
  const [isChatUndoOpen, setIsChatUndoOpen] = React.useState(false);

  // File/image attachment state (per-message, never in Zustand)
  const [pendingAttachments, setPendingAttachments] = React.useState([]);
  const [showAttachMenu, setShowAttachMenu] = React.useState(false);
  const attachMenuRef = React.useRef(null);
  const fileInputRef = React.useRef(null);

  // Close attach menu when clicking outside
  React.useEffect(() => {
    if (!showAttachMenu) return;
    const handleClickOutside = (event) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(event.target)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAttachMenu]);

  // Persistent context items (Cursor-style @ chips)
  const [contextItems, setContextItems] = React.useState([
    { type: 'activeGraph', id: null, label: 'Active Graph', enabled: true }
  ]);

  // Context window usage estimation
  const contextUsage = React.useMemo(() => {
    // Known context windows by model pattern (tokens)
    const getContextWindow = (model) => {
      if (!model) return 128000;
      const m = model.toLowerCase();
      if (m.includes('gemini-2') || m.includes('gemini-pro-1.5') || m.includes('gemini-1.5')) return 1000000;
      if (m.includes('claude-3') || m.includes('claude-4') || m.includes('sonnet') || m.includes('haiku') || m.includes('opus')) return 200000;
      if (m.includes('gpt-4o') || m.includes('gpt-4-turbo')) return 128000;
      if (m.includes('gpt-3.5')) return 16000;
      if (m.includes('llama-3') || m.includes('llama3')) return 128000;
      if (m.includes('mixtral')) return 32000;
      if (m.includes('deepseek')) return 64000;
      return 128000;
    };

    const estimateTokens = (text) => text ? Math.ceil(text.length / 4) : 0;

    const model = apiKeyInfo?.model || '';
    const contextWindow = getContextWindow(model);

    // Estimate system prompt + graph context (~3000-5000 tokens typically)
    const systemPromptTokens = 3500;

    // Estimate conversation history tokens
    let conversationTokens = 0;
    for (const msg of messages) {
      conversationTokens += estimateTokens(msg.content || '');
      if (msg.contentBlocks) {
        for (const block of msg.contentBlocks) {
          if (block.type === 'tool_call') {
            conversationTokens += estimateTokens(block.name || '') + estimateTokens(JSON.stringify(block.args || {}));
            conversationTokens += estimateTokens(JSON.stringify(block.result || {}));
          }
        }
      }
      // Estimate tokens for sent attachments
      const attachments = msg.metadata?.attachments;
      if (attachments) {
        for (const att of attachments) {
          if (att.category === 'image') {
            conversationTokens += 1000; // ~1000 tokens per image for vision models
          } else if (att.category === 'document') {
            conversationTokens += att.extractedTextLength
              ? Math.ceil(att.extractedTextLength / 4)
              : 500; // fallback for messages stored before this fix
          }
        }
      }
    }

    // Estimate tokens for pending attachments (we have full data for these)
    let pendingTokens = 0;
    for (const att of pendingAttachments) {
      if (att.category === 'image') {
        pendingTokens += 1000;
      } else if (att.category === 'document' && att.extractedText) {
        pendingTokens += estimateTokens(att.extractedText);
      }
    }

    // Graph context estimate
    const graphContextTokens = contextItems.some(i => i.type === 'activeGraph' && i.enabled) ? 3750 : 0;

    const totalUsed = systemPromptTokens + conversationTokens + pendingTokens + graphContextTokens;
    const percent = Math.min(Math.round((totalUsed / contextWindow) * 100), 100);

    return { totalUsed, contextWindow, percent, conversationTokens };
  }, [messages, apiKeyInfo?.model, contextItems, pendingAttachments]);

  const [fileStatus, setFileStatus] = React.useState(null);
  React.useEffect(() => {
    let mounted = true;
    const fetchFileStatus = async () => {
      try {
        const mod = fileStorage;
        if (typeof mod.getFileStatus === 'function') {
          const status = mod.getFileStatus();
          if (mounted) setFileStatus(status);
        }
      } catch { }
    };
    fetchFileStatus();
    const t = setInterval(fetchFileStatus, 3000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  // Auto-sync context chips with active graph
  React.useEffect(() => {
    const graph = activeGraphId && graphsMap?.has(activeGraphId)
      ? graphsMap.get(activeGraphId)
      : null;
    // Resolve the defining node's color (the node whose definition graph this is)
    const definingNodeId = graph?.definingNodeIds?.[0];
    const definingNode = definingNodeId ? nodePrototypesMap?.get(definingNodeId) : null;
    const chipColor = definingNode?.color || graph?.color || NODE_DEFAULT_COLOR;
    setContextItems(prev => prev.map(item => {
      if (item.type === 'activeGraph') {
        return {
          ...item,
          id: activeGraphId || null,
          label: graph ? `${graph.name || 'Unnamed'} (Web)` : 'No Active Web',
          color: graph ? chipColor : null
        };
      }
      return item;
    }));
  }, [activeGraphId, graphsMap, nodePrototypesMap]);

  // Load conversations from workspace on mount (Electron only).
  // On web, conversations are already hydrated synchronously from localStorage in the useState initializer above.
  React.useEffect(() => {
    if (!fileStorage.isElectron()) return; // Web is already hydrated synchronously

    const loadConversations = async () => {
      try {
        let manifest = null;
        try {
          const projectDir = await fileStorage.getProjectDirectory();
          if (projectDir) {
            const convDir = `${projectDir}/conversations`;
            const manifestPath = `${convDir}/manifest.json`;
            const manifestRes = await fileStorage.readFile(manifestPath);
            if (manifestRes) {
              const content = typeof manifestRes === 'string' ? manifestRes : manifestRes.content;
              if (content) {
                manifest = JSON.parse(content);
                console.log('[AI Collaboration] Loaded manifest from workspace');
              }
            }
          }
        } catch (e) {
          console.log('[AI Collaboration] No workspace manifest found, trying localStorage');
        }

        // Fallback to localStorage on Electron if no workspace manifest
        if (!manifest) {
          const manifestStr = localStorage.getItem('rs.aiChat.manifest');
          if (manifestStr) {
            manifest = JSON.parse(manifestStr);
          }
        }

        if (manifest && manifest.conversations) {
          // Legacy conversations (no graphId) get assigned to the current graph at load time
          // so they don't bleed into every definition graph the user navigates to.
          const loadGraphId = activeGraphId || null;
          const hydratedConversations = await Promise.all(manifest.conversations.map(async (c) => {
            const resolvedGraphId = c.graphId || loadGraphId;
            try {
              const projectDir = await fileStorage.getProjectDirectory();
              if (projectDir) {
                const filePath = `${projectDir}/conversations/${c.id}.json`;
                const fileRes = await fileStorage.readFile(filePath);
                if (fileRes) {
                  const content = typeof fileRes === 'string' ? fileRes : fileRes.content;
                  if (content) {
                    const data = JSON.parse(content);
                    return { ...c, messages: data.messages || [], graphId: resolvedGraphId };
                  }
                }
              }
              // Fallback to localStorage
              const localData = localStorage.getItem(`rs.aiChat.messages.${c.id}`);
              if (localData) {
                const data = JSON.parse(localData);
                return { ...c, messages: data.messages || [], graphId: resolvedGraphId };
              }
            } catch (e) {
              console.warn(`[AI Collaboration] Failed to hydrate conversation ${c.id}:`, e);
              try {
                const localData = localStorage.getItem(`rs.aiChat.messages.${c.id}`);
                if (localData) {
                  const data = JSON.parse(localData);
                  return { ...c, messages: data.messages || [], graphId: resolvedGraphId };
                }
              } catch { }
            }
            return { ...c, messages: [], graphId: resolvedGraphId };
          }));

          setConversations(hydratedConversations);
          setActiveConversationId(manifest.activeConversationId || (hydratedConversations.length > 0 ? hydratedConversations[0].id : 'default'));
        }
        setIsHydrated(true);
      } catch (err) {
        console.warn('[AI Collaboration] Failed to load conversations:', err);
        setIsHydrated(true);
      }
    };
    loadConversations();
  }, []); // Electron only; component remounts on file switch

  // NOTE: Wizard conversation tabs are intentionally NOT tied to the active graph.
  // Switching the active graph (e.g. navigating into a definition graph) must leave the
  // current tab and the full tab list untouched — the conversation is the user's context,
  // not the graph's. The AI still receives the *current* graph context at query time
  // (see effectiveActiveGraphId in the wizard request), so graph awareness is preserved
  // without coupling tab visibility/selection to activeGraphId.

  // Sync messages with active conversation
  const lastActiveIdRef = React.useRef(activeConversationId);
  React.useEffect(() => {
    const activeConv = conversations.find(c => c.id === activeConversationId);
    if (activeConv) {
      const isTabSwitch = lastActiveIdRef.current !== activeConversationId;
      // Load messages if tab switched, OR if we just hydrated and current messages are empty
      // Added check for activeConv.messages?.length > 0 to prevent infinite loop with empty [] arrays
      if (isTabSwitch || (isHydrated && messages.length === 0 && activeConv.messages?.length > 0)) {
        setMessages(activeConv.messages || []);
      }
    }
    lastActiveIdRef.current = activeConversationId;
  }, [activeConversationId, isHydrated, conversations]); // conversations added to catch hydration updates

  // Sync active conversation with messages and save
  const lastMessagesRef = React.useRef(messages);
  React.useEffect(() => {
    if (lastMessagesRef.current === messages) return;
    lastMessagesRef.current = messages;

    // IMMEDIATE localStorage backup for the active conversation's messages
    if (messages.length > 0) {
      localStorage.setItem(`rs.aiChat.messages.${activeConversationId}`, JSON.stringify({
        id: activeConversationId,
        messages,
        timestamp: new Date().toISOString()
      }));
    }

    setConversations(prev => {
      const updated = prev.map(c =>
        c.id === activeConversationId ? { ...c, messages, timestamp: new Date().toISOString() } : c
      );

      // Save manifest to localStorage
      const manifest = {
        conversations: updated.map(c => ({ id: c.id, title: c.title, timestamp: c.timestamp, graphId: c.graphId || null })),
        activeConversationId
      };
      localStorage.setItem('rs.aiChat.manifest', JSON.stringify(manifest));

      // Also save manifest to workspace if possible (Electron only — web uses localStorage above)
      const saveManifestToWorkspace = async () => {
        if (!fileStorage.isElectron()) return;
        try {
          const projectDir = await fileStorage.getProjectDirectory();
          if (!projectDir) return;
          const convDir = `${projectDir}/conversations`;
          const exists = await window.electron.fileSystem.folderExists(convDir);
          if (!exists) await fileStorage.mkdir(convDir);
          const manifestPath = `${convDir}/manifest.json`;
          console.log('[AI Collaboration] Saving manifest to:', manifestPath);
          await fileStorage.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
        } catch (err) {
          console.error('[AI Collaboration] Failed to save manifest to workspace:', err);
        }
      };
      saveManifestToWorkspace();

      return updated;
    });
  }, [messages, activeConversationId]);

  const messagesEndRef = React.useRef(null);
  const inputRef = React.useRef(null);

  // Auto-resize textarea when currentInput changes programmatically (send, undo, clear)
  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + 'px';
    }
  }, [currentInput]);

  // Recalculate textarea height when panel width changes (e.g. resizing the panel narrow then wide)
  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    let prevWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== prevWidth) {
        prevWidth = el.clientWidth;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 200) + 'px';
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleChatUndo = (targetMessageId) => {
    const messageIndex = messages.findIndex(m => m.id === targetMessageId);
    if (messageIndex === -1) return;

    // The messages to remove (target and all subsequent)
    const messagesToRemove = messages.slice(messageIndex);

    // Find all tool calls in ai messages that need to be undone
    const store = useGraphStore.getState();
    // Go in reverse order to undo newest first
    for (let i = messagesToRemove.length - 1; i >= 0; i--) {
      const msg = messagesToRemove[i];
      if (msg.sender === 'ai' && msg.contentBlocks) {
        // Go through blocks in reverse
        for (let j = msg.contentBlocks.length - 1; j >= 0; j--) {
          const block = msg.contentBlocks[j];
          if (block.type === 'tool_call' && block.status === 'completed' && !block.isUndone && block.id) {
            store.revertWizardAction(block.id);
          }
        }
      }
    }

    // Get the target user message's text
    const targetMessage = messagesToRemove[0];
    let textToRestore = '';
    if (targetMessage.contentBlocks) {
      textToRestore = targetMessage.contentBlocks
        .filter(b => b.type === 'text')
        .map(b => b.content)
        .join('\n');
    } else if (targetMessage.content) {
      textToRestore = targetMessage.content;
    }

    // Keep messages before the target
    const newMessages = messages.slice(0, messageIndex);

    setMessages(newMessages);
    setCurrentInput(textToRestore);

    // Update conversations array
    setConversations(prev => prev.map(c =>
      c.id === activeConversationId ? { ...c, messages: newMessages, timestamp: new Date().toISOString() } : c
    ));

    if (inputRef.current) {
      setTimeout(() => inputRef.current.focus(), 0);
    }
  };

  // handleClearConversation updated for the new tab system
  const handleClearConversation = () => {
    if (messages.length === 0) return;
    if (window.confirm('Clear entire conversation? This cannot be undone.')) {
      setMessages([]);
      lastMessagesRef.current = []; // Prevent potential race conditions

      // Update conversations array so the cleared state is reflected in other tabs/reloads
      setConversations(prev => prev.map(c =>
        c.id === activeConversationId ? { ...c, messages: [], timestamp: new Date().toISOString() } : c
      ));

      // Also clear from immediate localStorage
      localStorage.removeItem(`rs.aiChat.messages.${activeConversationId}`);
    }
  };

  // Auto-name generation helper
  const generateConversationTitle = (text) => {
    if (!text) return 'New Chat';
    let cleanText = text.replace(/^[^a-zA-Z0-9]+/, '').trim();
    if (!cleanText) return 'New Chat';
    if (cleanText.length > 25) {
      return cleanText.substring(0, 25).trim() + '…';
    }
    return cleanText;
  };

  // Tab renaming handlers
  const handleTabDoubleClick = (id, currentTitle) => {
    setEditingTabId(id);
    setEditingTabTitle(currentTitle);
  };

  const handleTabRenameChange = (e) => {
    setEditingTabTitle(e.target.value);
  };

  const handleTabRenameCommit = () => {
    if (editingTabId) {
      const newTitle = editingTabTitle.trim() || 'New Chat';
      setConversations(prev => prev.map(c =>
        c.id === editingTabId ? { ...c, title: newTitle } : c
      ));
      setEditingTabId(null);
    }
  };

  const handleTabRenameKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleTabRenameCommit();
    } else if (e.key === 'Escape') {
      setEditingTabId(null);
    }
  };

  // CRITICAL: Subscribe to SSE for real-time chat updates (e.g., executor errors)
  React.useEffect(() => {
    let eventSource;
    try {
      eventSource = bridgeEventSource('/events/stream');

      eventSource.addEventListener('chat', (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[AI Collaboration] Received chat event:', data);

          // Add message to chat immediately (real-time update)
          setMessages(prev => {
            // Check if message already exists (avoid duplicates)
            const alreadyExists = prev.some(m =>
              Math.abs(new Date(m.timestamp).getTime() - data.ts) < 1000 && m.content === data.text
            );

            if (alreadyExists) return prev;

            // Add new message
            const newMessage = {
              id: `${data.ts || Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              sender: data.role === 'user' ? 'user' : data.role === 'ai' ? 'ai' : 'system',
              content: data.text || '',
              timestamp: new Date(data.ts || Date.now()).toISOString(),
              metadata: data,
              toolCalls: []
            };

            return [...prev, newMessage];
          });
        } catch (err) {
          console.warn('[AI Collaboration] Failed to process chat event:', err);
        }
      });

      eventSource.onerror = () => {
        // Silently handle SSE errors - server may not be available
        // Connection errors are expected when bridge server isn't running
      };
    } catch (err) {
      console.warn('[AI Collaboration] Failed to establish SSE:', err);
    }

    return () => {
      // Cleanup global getters
      delete window.__rs_getTabs;
      delete window.__rs_getWizardStatus;

      if (eventSource) {
        try {
          eventSource.close();
        } catch (err) {
          console.warn('[AI Collaboration] Failed to close SSE:', err);
        }
      }
    };
  }, []);

  // Defensive cleanup: abort active agent request if component ever unmounts
  React.useEffect(() => {
    return () => {
      if (currentAgentRequest) {
        currentAgentRequest.abort();
      }
    };
  }, [currentAgentRequest]);

  // Set up event listeners for direct UI control (e.g., from MCP server or Bridge)
  React.useEffect(() => {
    // These need to re-bind when state changes so they have access to latest state
    // but the `useEffect` above for SSE only runs once. We'll use refs or simply update these getters
    window.__rs_getTabs = () => ({
      conversations,
      activeConversationId
    });
    window.__rs_getWizardStatus = () => ({ hasAPIKey, isConnected, isProcessing, activeGraphId });
    // Lets dispatchers (e.g., NodeCanvas Ask The Wizard) check whether this conversation
    // already saw a wizard-action-chip of a given action so they can ship a shorter prompt
    // instead of repeating the full instructions block.
    window.__rs_wizardConversationHasAction = (action) => {
      if (!action) return false;
      try {
        return messages.some(m => m?.metadata?.kind === 'wizard-action-chip' && m?.metadata?.action === action);
      } catch {
        return false;
      }
    };

    const handleSendWizardMsg = (e) => {
      if (e.detail && typeof e.detail.message === 'string') {
        const opts = (e.detail.displayContent || e.detail.replayContent || e.detail.displayMetadata)
          ? {
              displayContent: e.detail.displayContent,
              displayMetadata: e.detail.displayMetadata,
              replayContent: e.detail.replayContent
            }
          : undefined;
        handleSendMessage(e.detail.message, opts);
      }
    };

    const handleSwitchTab = (e) => {
      if (e.detail && e.detail.id) {
        handleTabSwitch(e.detail.id);
      }
    };

    const handleNewTab = () => {
      handleNewConversation();
    };

    const handleToolFailed = (e) => {
      const detail = e?.detail || {};
      const tool = detail.tool || 'tool';
      const reason = detail.reason || 'no further detail';
      const parts = [`⚠️ The "${tool}" call did not apply: ${reason}`];
      if (detail.sourceName || detail.targetName) {
        parts.push(`(source: ${detail.sourceName || '?'}, target: ${detail.targetName || '?'})`);
      }
      const content = parts.join(' ');
      setMessages(prev => ([
        ...prev,
        {
          id: `wizard-tool-failed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sender: 'system',
          content,
          timestamp: new Date().toISOString(),
          metadata: { kind: 'tool-failure-warning', ...detail },
          toolCalls: []
        }
      ]));
    };

    window.addEventListener('rs-send-wizard-message', handleSendWizardMsg);
    window.addEventListener('rs-switch-wizard-tab', handleSwitchTab);
    window.addEventListener('rs-new-wizard-tab', handleNewTab);
    window.addEventListener('rs-wizard-tool-failed', handleToolFailed);

    return () => {
      window.removeEventListener('rs-send-wizard-message', handleSendWizardMsg);
      window.removeEventListener('rs-switch-wizard-tab', handleSwitchTab);
      window.removeEventListener('rs-new-wizard-tab', handleNewTab);
      window.removeEventListener('rs-wizard-tool-failed', handleToolFailed);
    };
  }, [conversations, activeConversationId, hasAPIKey, isConnected, isProcessing, activeGraphId]);

  React.useEffect(() => {
    // Fetch wizard tools on load
    const fetchWizardTools = async () => {
      try {
        const res = await bridgeFetch('/api/wizard/tools');
        if (res.ok) {
          const data = await res.json();
          if (data.tools) setWizardTools(data.tools);
        }
      } catch (err) {
        console.warn('Failed to fetch wizard tools:', err);
      }
    };
    fetchWizardTools();
  }, []);

  React.useEffect(() => {
    // Auto-scroll to bottom when messages update.
    // Programmatic Ask The Wizard chips: teleport (instant), since the panel may
    // have just expanded from a button click and we want the user to see their
    // action immediately. Other messages: smooth scroll as before. We rAF the
    // chip case so the layout is settled before measuring scroll position.
    if (!messagesEndRef.current) return;
    const last = messages[messages.length - 1];
    const isWizardChip = last?.metadata?.kind === 'wizard-action-chip';
    if (isWizardChip) {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
      });
    } else {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  React.useEffect(() => { checkAPIKey(); }, []);

  // Listen for API key changes from Settings modal
  React.useEffect(() => {
    const handler = () => checkAPIKey();
    window.addEventListener('aiKeyConfigChanged', handler);
    return () => window.removeEventListener('aiKeyConfigChanged', handler);
  }, []);

  const checkAPIKey = async () => {
    try {
      const hasKey = await apiKeyManager.hasAPIKey();
      const keyInfo = await apiKeyManager.getAPIKeyInfo();
      setHasAPIKey(hasKey);
      setApiKeyInfo(keyInfo);
    } catch (error) { console.error('Failed to check API key:', error); }
  };

  // Initialize DruidInstance when switching to Druid mode
  React.useEffect(() => {
    if (viewMode === 'druid' && !druidInstance) {
      console.log('[Druid] Initializing DruidInstance...');
      const instance = new DruidInstance(useGraphStore);

      // Ensure workspace is ready
      instance.ensureWorkspace().then(() => {
        console.log('[Druid] Workspace initialized');
        setDruidInstance(instance);
      }).catch(err => {
        console.error('[Druid] Failed to initialize workspace:', err);
      });
    }
  }, [viewMode, druidInstance]);

  const addMessage = (sender, content, metadata = {}, targetId = activeConversationId) => {
    // Strip trailing newlines/whitespace from user messages (users often add them after tool calls)
    const normalizedContent = sender === 'user' && typeof content === 'string'
      ? content.trimEnd()
      : content;
    content = normalizedContent;

    // Shared logic to build the message object
    const buildMessage = (prevMessages) => {
      const isDuplicate = prevMessages.some(m =>
        m.sender === sender &&
        m.content === content &&
        Math.abs(new Date(m.timestamp).getTime() - Date.now()) < 500 // Stricter duplicate check
      );
      if (isDuplicate) return prevMessages;

      const metaToolCalls = (metadata.toolCalls || []).map(tc => ({ ...tc, type: 'tool_call', expanded: false }));
      const blocks = [
        ...(content ? [{ type: 'text', content }] : []),
        ...metaToolCalls
      ];
      const message = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        sender,
        content,
        timestamp: new Date().toISOString(),
        metadata,
        contentBlocks: blocks,
        toolCalls: metaToolCalls
      };
      return [...prevMessages, message];
    };

    // Update global conversations ALWAYS
    setConversations(prev => prev.map(c =>
      c.id === targetId ? { ...c, messages: buildMessage(c.messages || []), timestamp: new Date().toISOString() } : c
    ));

    // Update active UI ONLY if we targets the active tab
    setMessages(prev => {
      if (activeConversationId === targetId) {
        return buildMessage(prev);
      }
      return prev;
    });
  };

  // Simple markdown renderer for chat messages
  const renderMarkdown = (text) => {
    if (!text) return text;
    text = text.trimStart();

    const escapeHtml = (str) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    // Escape any HTML first to avoid injection when we swap in tags below
    let html = escapeHtml(text);

    // Code blocks - use theme-aware background
    html = html.replace(/```([\s\S]*?)```/g, `<pre style="background:${theme.canvas.inactive};padding:8px;border-radius:4px;overflow-x:auto;"><code>$1</code></pre>`);
    // Inline code - use theme-aware background
    html = html.replace(/`([^`]+)`/g, `<code style="background:${theme.canvas.inactive};padding:2px 4px;border-radius:3px;">$1</code>`);

    // Headers
    html = html.replace(/^#### (.*$)/gim, '<h4 style="margin:10px 0 6px;font-size:1.05em;font-weight:600;">$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3 style="margin:12px 0 8px;font-size:1.15em;font-weight:600;">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 style="margin:14px 0 8px;font-size:1.25em;font-weight:700;">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 style="margin:16px 0 8px;font-size:1.4em;font-weight:700;">$1</h1>');

    // Horizontal Rule — use a styled <div> instead of void <hr> element.
    // <hr> can cause layout collapse between consecutive dividers in flex/pre-wrap contexts.
    html = html.replace(/^---$/gim, `<div style="border-top:1px solid ${theme.canvas.border};margin:10px 0;height:0;line-height:0;font-size:0;"></div>`);

    // Normalize * bullet lines to - bullet lines when 2+ consecutive are found.
    // Runs BEFORE emphasis processing so leading * isn't consumed by *italic* regex.
    // Splits around <pre> blocks to avoid corrupting code examples.
    html = html.split(/(<pre[\s\S]*?<\/pre>)/i).map(part => {
      if (part.startsWith('<pre')) return part;
      return part.replace(/((?:^[ \t]*\* .+$\n?){2,})/gm, (block) =>
        block.replace(/^([ \t]*)\* /gm, '$1- ')
      );
    }).join('');

    // ***bold+italic***
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    // **bold**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // *italic*
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Unordered Lists - added margin-bottom for better spacing within the list
    html = html.replace(/^\s*-\s+(.*)$/gim, '<li style="margin-left:20px;margin-bottom:4px;">$1</li>');

    // Wrap consecutive <li> elements in <ul> - regex now safely catches trailing newlines
    html = html.replace(/(?:<li[^>]*>.*?<\/li>\s*)+/g, (match) => {
      // Remove any spurious newlines inside the match to prevent them becoming <br> inside ul
      const cleanMatch = match.replace(/\n\s*</g, '<');
      return `<ul style="margin:4px 0;padding:0;list-style-type:disc;">${cleanMatch}</ul>`;
    });

    // Remove empty newlines right after block-level tags so they don't turn into excessive <br>'s
    html = html.replace(/<\/(ul|div|h1|h2|h3|h4)>\n+/g, '</$1>');
    html = html.replace(/\n+<(ul|div|h1|h2|h3|h4)/g, '<$1');

    // Replace remaining newlines with <br> for layout consistency (skip inside pre/ul tags)
    html = html.split(/(<pre[\s\S]*?<\/pre>|<ul[\s\S]*?<\/ul>)/i).map(part => {
      if (part.startsWith('<pre') || part.startsWith('<ul')) return part;
      return part.replace(/\n/g, '<br>');
    }).join('');

    // Collapse any run of 2+ <br> tags immediately after a list or divider into a single <br>
    html = html.replace(/(<\/ul>|<\/div>)(\s*<br>\s*){2,}/g, '$1<br>');
    // Also strip a leading <br> right before a <ul> that creates a gap above the list
    html = html.replace(/(<br>\s*)+(<ul)/g, '$2');

    return html;
  };

  const upsertToolCall = React.useCallback((toolUpdate, targetId) => {
    const resolvedTarget = targetId ?? activeConversationIdRef.current;
    const updateMsgArray = (currMessages) => {
      const updated = [...currMessages];
      let idx = updated.length - 1;
      while (idx >= 0 && updated[idx].sender !== 'ai') idx--;
      if (idx < 0) {
        updated.push({ id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, sender: 'ai', content: '', timestamp: new Date().toISOString(), contentBlocks: [] });
        idx = updated.length - 1;
      }
      const msg = { ...updated[idx] };
      const blocks = Array.isArray(msg.contentBlocks) ? [...msg.contentBlocks] : [];

      const matchIndex = blocks.findIndex(b => b.type === 'tool_call' && (
        (toolUpdate.id && b.id === toolUpdate.id)
        || (toolUpdate.cid && b.cid === toolUpdate.cid && b.name === toolUpdate.name)
        || (!toolUpdate.cid && !toolUpdate.id && b.name === toolUpdate.name)
      ));
      if (matchIndex >= 0) {
        blocks[matchIndex] = { ...blocks[matchIndex], ...toolUpdate };
      } else {
        blocks.push({ type: 'tool_call', expanded: false, status: toolUpdate.status || 'running', ...toolUpdate });
      }
      msg.contentBlocks = blocks;
      updated[idx] = msg;
      return updated;
    };

    // Update global conversations ALWAYS
    setConversations(prev => prev.map(c =>
      c.id === resolvedTarget ? { ...c, messages: updateMsgArray(c.messages || []), timestamp: new Date().toISOString() } : c
    ));

    // Update active UI ONLY if this targets the visible tab
    setMessages(prev => {
      if (activeConversationIdRef.current === resolvedTarget) {
        return updateMsgArray(prev);
      }
      return prev;
    });
  }, []);

  // Stable so React.memo(ToolCallCard) actually skips unchanged cards — an
  // inline closure here would change identity every render and defeat the memo.
  const handleToolCallUndo = React.useCallback((id) => {
    useGraphStore.getState().revertWizardAction(id);
    upsertToolCall({ id, isUndone: true });
  }, [upsertToolCall]);
  React.useEffect(() => {
    const handler = (e) => {
      const items = Array.isArray(e.detail) ? e.detail : [];
      items.forEach((t) => {
        // Handle wizard stage updates
        if (t.type === 'wizard_stage') {
          if (t.status === 'start') {
            setWizardStage({ stage: t.stage, toolName: t.data?.toolName });
          } else if (t.status === 'success' || t.status === 'error') {
            setWizardStage(null); // Clear stage when complete
          }
          return;
        }
        if (t.type === 'tool_call') {
          const status = t.status || (t.leased ? 'running' : 'running');
          upsertToolCall({
            id: t.id,
            name: t.name || 'tool',
            status,
            args: t.args,
            result: t.result,
            error: t.error,
            executionTime: t.executionTime,
            timestamp: t.ts,
            cid: t.cid,
            isUndone: t.isUndone || false
          }, telemetryConversationIdRef.current || activeConversationIdRef.current);

          // When tool completes successfully with a result, apply it to the store
          // Note: Telemetry events for completed tool calls send the result back
          if (status === 'completed' && t.result) {
            // Check if it's already been applied (e.g. via direct execute API vs telemetry)
            // LeftAIView handles tool execution natively via bridgeFetch or handles telemetry
            // We'll rely on handleAutonomousAgent applying direct results OR telemetry
          }
          return;
        }
        if (t.type === 'agent_queued') {
          if (messagesRef.current.length > 0) upsertToolCall({ name: 'agent', status: 'queued', args: { queued: t.queued, graphId: t.graphId }, cid: t.cid }, telemetryConversationIdRef.current || activeConversationIdRef.current);
          return;
        }
        if (t.type === 'info') {
          upsertToolCall({ name: t.name || 'info', status: 'completed', result: t.message, cid: t.cid }, telemetryConversationIdRef.current || activeConversationIdRef.current);
          return;
        }
        if (t.type === 'agent_answer') {
          const finalText = (t.text || '').trim();
          const targetId = telemetryConversationIdRef.current || activeConversationIdRef.current; // Route to the run's owning conversation, not whatever tab is active now

          const updateMsgs = (prev) => {
            const isDefault = /\bwhat will we (make|build) today\?/i.test(finalText);
            if (prev.length === 0 && isDefault) return prev;
            const updated = [...prev];
            let idx = updated.length - 1;
            while (idx >= 0 && updated[idx].sender !== 'ai') idx--;
            if (idx >= 0) {
              const currentContent = updated[idx].content || '';
              if (!currentContent.endsWith(finalText)) {
                updated[idx] = {
                  ...updated[idx],
                  content: currentContent ? `${currentContent}\n${finalText}` : finalText
                };
              }
              return updated;
            }
            if (updated.length === 0 && isDefault) return updated;
            return [...updated, { id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, sender: 'ai', content: finalText, timestamp: new Date().toISOString(), toolCalls: [] }];
          };

          setConversations(prev => prev.map(c =>
            c.id === targetId ? { ...c, messages: updateMsgs(c.messages || []), timestamp: new Date().toISOString() } : c
          ));

          setMessages(prev => {
            if (activeConversationIdRef.current === targetId) return updateMsgs(prev);
            return prev;
          });
          return;
        }
      });
    };
    window.addEventListener('rs-telemetry', handler);
    return () => window.removeEventListener('rs-telemetry', handler);
  }, []);

  React.useEffect(() => {
    if (hasAPIKey && !isConnected && !isProcessing) {
      if (mcpClient && mcpClient.isConnected) { setIsConnected(true); return; }
      initializeConnection();
    }
  }, [hasAPIKey]);

  const initializeConnection = async () => {
    try {
      setIsProcessing(true);
      await mcpClient.connect();
      setIsConnected(true);
    } catch (error) {
      console.error('[AI Collaboration] Connection failed:', error);
      setIsConnected(false);
      addMessage('system', `Connection failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Bridge connection refresh disabled
  const refreshBridgeConnection = async () => {
    try {
      setIsProcessing(true);
      const [healthRes, stateRes] = await Promise.all([
        bridgeFetch('/api/bridge/health').catch((error) => { throw new Error(error.message || 'Bridge health request failed'); }),
        bridgeFetch('/api/bridge/state').catch(() => null)
      ]);

      if (!healthRes || !healthRes.ok) {
        throw new Error('Bridge daemon is unreachable. Make sure it is running on :3001.');
      }
      const health = await healthRes.json();
      let summary = `Bridge daemon online (${health.source || 'bridge-daemon'})`;

      if (stateRes && stateRes.ok) {
        const bridgeState = await stateRes.json();
        const graphCount = Array.isArray(bridgeState?.graphs) ? bridgeState.graphs.length : 0;
        const pending = Array.isArray(bridgeState?.pendingActions) ? bridgeState.pendingActions.length : 0;
        summary += ` • Graphs mirrored: ${graphCount}${pending ? ` • Pending actions: ${pending}` : ''}`;
      }

      await mcpClient.connect();
      setIsConnected(true);
      addMessage('system', `${summary}\nConnection refreshed.`);
    } catch (e) {
      console.error('[AI Collaboration] Bridge refresh failed:', e);
      setIsConnected(false);
      addMessage('system', `Bridge refresh failed: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle files selected from the attach menu file picker
  const handleFilesSelected = async (files) => {
    setShowAttachMenu(false);
    for (const file of files) {
      const category = getFileCategory(file);
      if (category === 'unknown') {
        addMessage('system', `Unsupported file type: ${file.name}`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        addMessage('system', `File too large: ${file.name} (max 5MB)`);
        continue;
      }

      const attachment = {
        id: `attach-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        name: file.name,
        type: file.type,
        size: file.size,
        category,
      };

      if (category === 'image') {
        try {
          attachment.dataUrl = await readFileAsDataUrl(file);
          attachment.previewUrl = attachment.dataUrl;
        } catch (e) {
          addMessage('system', `Could not read image ${file.name}: ${e.message}`);
          continue;
        }
      }

      if (category === 'document') {
        try {
          const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
          if (isTabularFile(file)) {
            // Parse tabular files into structured data; store full data for tool access
            const { extractedText } = await readTabularFile(file, attachment.id);
            attachment.extractedText = extractedText;
            attachment.isTabular = true;
          } else if (isPdf) {
            attachment.extractedText = await readPdfAsText(file);
          } else {
            attachment.extractedText = await readFileAsText(file);
          }
        } catch (e) {
          addMessage('system', `Could not read ${file.name}: ${e.message}`);
          continue;
        }
      }

      setPendingAttachments(prev => [...prev, attachment]);
    }
  };

  const handleSendMessage = async (overrideInput, sendOptions) => {
    const inputToUse = typeof overrideInput === 'string' ? overrideInput : currentInput;
    if ((!inputToUse.trim() && pendingAttachments.length === 0) || isProcessing) return;
    // Optional display-override path used by programmatic dispatchers (e.g., the Ask The Wizard
    // chip). When set, the UI shows displayContent (a short summary) and the LLM's
    // conversation-history replay uses replayContent (defaults to displayContent), while the
    // model still receives the full overrideInput on this turn as the actual user payload.
    const displayContent = sendOptions?.displayContent;
    const displayMetadata = sendOptions?.displayMetadata;
    const replayContent = sendOptions?.replayContent ?? displayContent;

    // Trigger active mode for faster polling
    if (window.redstringStoreActions && window.redstringStoreActions._markActive) {
      window.redstringStoreActions._markActive();
    }
    const userMessage = inputToUse.trim();



    // Handle slash commands
    if (userMessage.startsWith('/')) {
      const command = userMessage.slice(1).split(' ')[0].toLowerCase();
      const args = userMessage.slice(1).split(' ').slice(1);

      if (command === 'test') {
        addMessage('user', userMessage);
        setCurrentInput('');
        setIsProcessing(true);

        try {
          // Determine test mode from args
          const mode = args.includes('--auto-discover') ? 'auto' :
            args.includes('--dry-run') ? 'dry' :
              'full';

          const modeDesc = mode === 'auto' ? 'Auto-discovery mode (testing all 12 tools)' :
            mode === 'dry' ? 'Dry-run mode (connectivity check only)' :
              'Full test mode (intent detection tests)';

          addMessage('system', `🧪 Running wizard tests in ${modeDesc}...`);

          // Get API key to pass to test process
          const apiKey = await apiKeyManager.getAPIKey();
          if (!apiKey && mode !== 'dry') {
            addMessage('system', '⚠️ No API key configured. Running in dry-run mode (connectivity check only).');
          }

          // Trigger tests via bridge
          const response = await bridgeFetch('/api/bridge/run-tests', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
            },
            body: JSON.stringify({ mode })
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const result = await response.json();

          if (result.success) {
            addMessage('system', '✅ Tests started successfully!');
            addMessage('system', 'Watch this chat for results, or check your terminal for detailed output.');
          } else {
            addMessage('system', `⚠️ Tests started but returned: ${result.message || 'Unknown status'}`);
          }

        } catch (error) {
          addMessage('system', `❌ Failed to run tests: ${error.message}`);
          addMessage('system', 'Make sure the bridge daemon is running (npm run bridge)');
        } finally {
          setIsProcessing(false);
        }
        return;
      }



      // Unknown command
      addMessage('user', userMessage);
      addMessage('system', `Unknown command: /${command}\n\nAvailable commands:\n  /test [--dry-run|--auto-discover] - Run wizard tests`);
      setCurrentInput('');
      return;
    }

    // Normal message handling

    // Auto-name if first message in a generic tab
    const currentConv = conversations.find(c => c.id === activeConversationId);
    if (currentConv && currentConv.messages.length === 0 && (currentConv.title === 'New Chat' || (activeGraphId && graphsMap?.get(activeGraphId)?.name === currentConv.title))) {
      const newTitle = generateConversationTitle(userMessage);
      setConversations(prev => prev.map(c =>
        c.id === activeConversationId ? { ...c, title: newTitle } : c
      ));
    }

    // Capture attachments before clearing (they're per-message)
    const sentAttachments = [...pendingAttachments];
    const messagePayload = sentAttachments.length > 0
      ? buildContentBlocks(userMessage, sentAttachments)
      : userMessage;

    // Store attachment metadata for chat display (no base64 data — just name/type/preview)
    const attachmentMeta = sentAttachments.length > 0
      ? sentAttachments.map(a => ({
        name: a.name,
        category: a.category,
        type: a.type,
        previewUrl: a.category === 'image' ? a.previewUrl : null,
        extractedTextLength: a.extractedText ? a.extractedText.length : 0,
      }))
      : undefined;

    // Build metadata: attachment info + content blocks for conversation history
    const messageMetadata = {};
    if (attachmentMeta) messageMetadata.attachments = attachmentMeta;
    if (sentAttachments.length > 0 && Array.isArray(messagePayload)) {
      // Store content blocks so follow-up messages retain PDF text in history.
      // Cap document text to 100k chars (~25k tokens) to prevent memory bloat.
      const MAX_DOC_CHARS = 100000;
      messageMetadata.contentBlocksForHistory = messagePayload.map(block => {
        if (block.type === 'document_text' && block.text && block.text.length > MAX_DOC_CHARS) {
          return { ...block, text: block.text.slice(0, MAX_DOC_CHARS) + '\n\n[...document truncated for context history...]' };
        }
        return block;
      });
    }
    // If a display override is provided, the chat shows the short summary and the
    // conversation-history replay also uses the short summary — the rich overrideInput
    // is only sent to the model on THIS turn as the user payload (handleAutonomousAgent below).
    if (displayContent) {
      const overrideMetadata = { ...messageMetadata, ...(displayMetadata || {}) };
      if (replayContent != null) {
        overrideMetadata.contentBlocksForHistory = replayContent;
      }
      addMessage('user', displayContent, overrideMetadata);
    } else {
      addMessage('user', userMessage, Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined);
    }
    setCurrentInput('');
    setPendingAttachments([]);
    setIsProcessing(true);

    // Druid Mode (Placeholder for full switch)
    if (viewMode === 'druid') {
      try {
        // Reuse the autonomous agent handler but with Druid prompt
        await handleAutonomousAgent(messagePayload, 'druid');
      } catch (error) {
        console.error('Druid error:', error);
        addMessage('system', `Druid error: ${error.message}`);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    // Wizard / Chat Mode
    try {
      if (!hasAPIKey) {
        addMessage('system', 'No API key configured. Please set up your OpenRouter or Anthropic API key below to use the Wizard.');
        setShowAPIKeySetup(true);
        setIsProcessing(false);
        return;
      }
      if (!mcpClient.isConnected) { await initializeConnection(); if (!mcpClient.isConnected) { setIsProcessing(false); return; } }

      if (viewMode === 'wizard') {
        await handleAutonomousAgent(messagePayload);
      } else {
        await handleQuestion(messagePayload);
      }
    } catch (error) {
      console.error('[AI Collaboration] Error processing message:', error);
      addMessage('system', `Error: ${error.message}`);
    } finally {
      setIsProcessing(false);
      setCurrentAgentRequest(null);
    }
  };

  const handleStopAgent = () => {
    if (currentAgentRequest) {
      currentAgentRequest.abort();
      setCurrentAgentRequest(null);
      setIsProcessing(false);
      addMessage('system', 'Agent execution stopped by user.');
    }
  };

  const getGraphInfo = () => {
    if (!activeGraphId || !graphsMap || typeof graphsMap.has !== 'function' || !graphsMap.has(activeGraphId)) {
      return { name: 'No active graph', nodeCount: 0, edgeCount: 0 };
    }
    const graph = graphsMap.get(activeGraphId);
    if (!graph) {
      return { name: 'No active graph', nodeCount: 0, edgeCount: 0 };
    }
    const nodeCount = graph.instances && typeof graph.instances.size === 'number' ? graph.instances.size : (graph.instances ? Object.keys(graph.instances).length : 0);
    const edgeCount = Array.isArray(graph.edgeIds) ? graph.edgeIds.length : 0;
    return {
      name: graph.name || 'Unnamed graph',
      nodeCount,
      edgeCount
    };
  };
  const graphInfo = getGraphInfo();
  const graphCount = graphsMap && typeof graphsMap.size === 'number' ? graphsMap.size : 0;

  const handleAutonomousAgent = async (question, persona = 'wizard') => {
    // Clear this tab's durable plan at the start of each new request — plans from prior
    // turns shouldn't contaminate new tasks. The conversation ID is stable per tab.
    useGraphStore.getState().clearWizardPlanForConversation(activeConversationIdRef.current);

    // Bind this run's (globally-broadcast) telemetry to the conversation that
    // started it, so its tool chips don't leak into a tab the user switches to.
    telemetryConversationIdRef.current = activeConversationIdRef.current;
    const callId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    console.log('[SSE Debug] handleAutonomousAgent CALLED:', callId, 'persona:', persona);

    // Message ID for streaming updates — defined before try/catch so error handler can reference it
    const streamingMessageId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const _preCreatedConvId = activeConversationId;
    // _preCreated tracks whether we've added the AI bubble yet (set just before fetch)
    let _preCreated = false;

    try {
      const apiConfig = await apiKeyManager.getAPIKeyInfo();
      const apiKey = await apiKeyManager.getAPIKey();
      if (!apiKey) {
        addMessage('system', 'No API key configured. Please set up your OpenRouter or Anthropic API key below to use the Wizard.');
        setShowAPIKeySetup(true);
        return;
      }
      if (!apiConfig) {
        addMessage('system', 'API configuration not found. Please set up your API key below.');
        setShowAPIKeySetup(true);
        return;
      }
      // Pre-create the AI message so telemetry tool_call events (which fire after the
      // fetch starts) land in this bubble rather than creating a second AI message bubble.
      const _preCreatedMsg = { id: streamingMessageId, sender: 'ai', content: '', timestamp: new Date().toISOString(), contentBlocks: [], isStreaming: true };
      setMessages(prev => [...prev, _preCreatedMsg]);
      setConversations(prev => prev.map(c => c.id === _preCreatedConvId
        ? { ...c, messages: [...(c.messages || []), _preCreatedMsg], timestamp: new Date().toISOString() }
        : c
      ));
      _preCreated = true;
      const abortController = new AbortController();
      setCurrentAgentRequest(abortController);

      // Send recent conversation history for context memory
      const recentMessages = messages.slice(-10).map(msg => ({
        role: msg.sender === 'user' ? 'user' : msg.sender === 'ai' ? 'assistant' : 'system',
        content: msg.metadata?.contentBlocksForHistory || msg.content
      }));

      // Prepend a hidden context line about the current active graph so the LLM
      // always knows what the user is looking at (including after refreshes)
      if (activeGraphId && graphsMap?.has(activeGraphId)) {
        const ctxGraph = graphsMap.get(activeGraphId);
        const ctxInstances = ctxGraph.instances instanceof Map
          ? Array.from(ctxGraph.instances.values())
          : Array.isArray(ctxGraph.instances) ? ctxGraph.instances : [];
        const ctxNodeNames = ctxInstances
          .map(inst => nodePrototypesMap?.get(inst.prototypeId)?.name)
          .filter(Boolean)
          .slice(0, 15);
        const ctxEdgeCount = ctxGraph.edgeIds?.length || 0;
        const ctxLine = `[Active web: "${ctxGraph.name || 'Unnamed'}" — ${ctxInstances.length} node${ctxInstances.length !== 1 ? 's' : ''}, ${ctxEdgeCount} connection${ctxEdgeCount !== 1 ? 's' : ''}${ctxNodeNames.length > 0 ? '. Nodes: ' + ctxNodeNames.join(', ') : ''}]`;
        recentMessages.unshift({ role: 'system', content: ctxLine });
      }

      // Build rich context with actual graph data (not just ID)
      let effectiveActiveGraphId = activeGraphId;
      if (persona === 'druid' && druidInstance?.workspaceGraphId) {
        effectiveActiveGraphId = druidInstance.workspaceGraphId;
      }

      const activeGraphData = effectiveActiveGraphId && graphsMap && graphsMap.has(effectiveActiveGraphId)
        ? graphsMap.get(effectiveActiveGraphId)
        : null;

      // Extract nodes and edges for LLM context (token-limited to top 50 nodes)
      let graphStructure = null;
      if (activeGraphData) {
        const instances = activeGraphData.instances instanceof Map
          ? Array.from(activeGraphData.instances.values())
          : Array.isArray(activeGraphData.instances)
            ? activeGraphData.instances
            : Object.values(activeGraphData.instances || {});

        // Extract nodes and edges for LLM context
        // Adaptive token limit: Use a character budget instead of hard 50-node limit
        const CHAR_BUDGET = 15000; // Approx 3k-4k tokens
        let currentChars = 0;
        const nodeNames = [];
        let truncated = false;

        for (const inst of instances) {
          const name = inst.name || `Node ${inst.id?.slice(-4) || ''}`;
          if (currentChars + name.length > CHAR_BUDGET) {
            truncated = true;
            break;
          }
          nodeNames.push(name);
          currentChars += name.length + 2; // +2 for separator overhead
        }

        const edgeCount = Array.isArray(activeGraphData.edgeIds) ? activeGraphData.edgeIds.length : 0;

        graphStructure = {
          id: effectiveActiveGraphId,
          name: activeGraphData.name || 'Unnamed',
          nodeCount: instances.length,
          edgeCount,
          nodes: nodeNames,
          truncated
        };
      }

      // Build graph state for new Wizard endpoint
      // CRITICAL: Convert Map objects to arrays for JSON serialization
      const graphState = {
        graphs: effectiveActiveGraphId && graphsMap ? Array.from(graphsMap.values()).map(g => {
          // Convert instances Map to array for serialization
          const instancesArray = g.instances instanceof Map
            ? Array.from(g.instances.values())
            : Array.isArray(g.instances)
              ? g.instances
              : Object.values(g.instances || {});

          return {
            id: g.id,
            name: g.name,
            instances: instancesArray,
            edgeIds: g.edgeIds || [],
            definingNodeIds: Array.isArray(g.definingNodeIds) ? g.definingNodeIds : [],
            groups: g.groups instanceof Map
              ? Array.from(g.groups.values())
              : Array.isArray(g.groups)
                ? g.groups
                : Object.values(g.groups || {})
          };
        }) : [],
        // Build all nodePrototypes: instance prototypes + definition node prototypes from edges
        // The definition node prototype is what carries the human-readable connection type name.
        nodePrototypes: activeGraphData && nodePrototypesMap ? (() => {
          const protoIds = new Set();

          // Collect prototypes from ALL graphs in the universe to ensure definition graphs can always find their parents
          Array.from(graphsMap.values()).forEach(g => {
            const instances = g.instances instanceof Map
              ? Array.from(g.instances.values())
              : Array.isArray(g.instances)
                ? g.instances
                : Object.values(g.instances || {});

            instances.forEach(inst => {
              if (inst.prototypeId) protoIds.add(inst.prototypeId);
            });

            const edgeIds = g.edgeIds || [];
            edgeIds.forEach(edgeId => {
              const edge = edgesMap ? edgesMap.get(edgeId) : null;
              if (edge && Array.isArray(edge.definitionNodeIds)) {
                edge.definitionNodeIds.forEach(id => protoIds.add(id));
              }
            });
          });

          return Array.from(protoIds)
            .map(id => {
              const proto = nodePrototypesMap.get(id);
              if (!proto) return null;
              return {
                id: proto.id,
                name: proto.name || '',
                color: proto.color || '',
                description: proto.description || '',
                definitionGraphIds: Array.isArray(proto.definitionGraphIds) ? proto.definitionGraphIds : []
              };
            })
            .filter(Boolean);
        })() : [],
        // Extract edges from ALL graphs so themeGraph can find edges for any target graph
        edges: edgesMap && graphsMap ? (() => {
          const allEdgeIds = new Set();
          Array.from(graphsMap.values()).forEach(g => {
            (g.edgeIds || []).forEach(id => allEdgeIds.add(id));
          });
          return Array.from(allEdgeIds).map(edgeId => {
            const edge = edgesMap.get(edgeId);
            if (!edge) return null;
            return {
              id: edgeId,
              sourceId: edge.sourceId,
              destinationId: edge.destinationId,
              // definitionNodeIds[0] points to the prototype whose name is the connection type
              definitionNodeIds: Array.isArray(edge.definitionNodeIds) ? edge.definitionNodeIds : [],
              // Keep type as a fallback for edges that predate definitionNodeIds
              type: edge.type || edge.connectionType || ''
            };
          }).filter(Boolean);
        })() : [],
        activeGraphId: effectiveActiveGraphId || null,
        // Seed durable wizard plan so small models can resume after context clears.
        // Plans are keyed by conversation/tab ID so tabs don't contaminate each other.
        _currentPlan: (() => {
          const st = useGraphStore.getState();
          const entry = st.wizardPlansByConversation?.[activeConversationIdRef.current];
          if (entry?.steps && entry.graphId === effectiveActiveGraphId) {
            return entry.steps;
          }
          return undefined;
        })()
      };

      console.log('[Wizard] Starting request to /api/wizard', {
        apiKey: apiKey ? 'present' : 'missing',
        apiConfig,
        historyLength: recentMessages.length
      });

      // Auto-correct provider if key mismatches (fixes common 401 error)
      let effectiveProvider = apiConfig?.provider;
      if (apiKey?.startsWith('sk-ant-') && (!effectiveProvider || effectiveProvider === 'openrouter')) {
        console.warn('[LeftAIView] Detected Anthropic key with OpenRouter config. Auto-switching to Anthropic.');
        effectiveProvider = 'anthropic';
      } else if (apiKey?.startsWith('sk-proj-') && (!effectiveProvider || effectiveProvider === 'openrouter')) {
        effectiveProvider = 'openai';
      } else if (apiKey?.startsWith('AIza') && (!effectiveProvider || effectiveProvider === 'openrouter')) {
        console.warn('[LeftAIView] Detected Google API key with OpenRouter config. Auto-switching to Google.');
        effectiveProvider = 'google';
      }

      // Collect any tabular data from attachments for tool access
      const tabularEntries = getAllTabularData();
      const tabularData = tabularEntries.length > 0
        ? tabularEntries.map(e => ({ attachId: e.attachId, ...e.data, profile: e.data.profile }))
        : undefined;

      // Use new Wizard endpoint with SSE streaming
      const response = await bridgeFetch('/api/wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          message: question,
          graphState,
          contextItems: contextItems.filter(item => item.enabled),
          conversationHistory: recentMessages, // Include conversation history for context
          tabularData, // Parsed tabular data for tool access
          config: {
            cid: `wizard-${Date.now()}`,
            systemPrompt: persona === 'druid' ? DRUID_SYSTEM_PROMPT : undefined,
            persona: persona,
            apiConfig: apiConfig ? {
              provider: effectiveProvider || apiConfig.provider,
              endpoint: apiConfig.endpoint,
              model: apiConfig.model,
              settings: {
                ...apiConfig.settings,
                maxIterationsLocal: Number(localStorage.getItem('rs.wizard.maxIterationsLocal')) || 177,
                maxIterationsCloud: Number(localStorage.getItem('rs.wizard.maxIterationsCloud')) || 77,
              },
              modelTier: apiConfig.modelTier || 'large'
            } : null
          }
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Wizard request failed (${response.status}): ${errorBody}`);
      }

      // Process SSE stream
      const callId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      console.log('[SSE Debug] Starting SSE reader loop:', callId);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // Track processed event IDs to prevent duplicates (React StrictMode safety)
      const processedEvents = new Set();
      let eventCounter = 0;
      // Track top-level step statuses to detect step-level vs substep-level changes
      let lastTopLevelStepStatuses = null;
      let planCardCounter = 0;

      const targetConversationId = activeConversationId;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              try {
                const event = JSON.parse(data);

                // Generate unique event ID for deduplication
                const eventId = `${event.type}-${event.id || eventCounter++}-${event.content?.length || 0}`;
                console.log('[SSE Debug]', callId, 'Parsed:', event.type, event.id || event.name, 'eventId:', eventId, 'alreadyProcessed:', processedEvents.has(eventId));
                if (processedEvents.has(eventId)) {
                  console.log('[SSE Debug]', callId, '⚠️ SKIPPING DUPLICATE:', event.type, eventId);
                  continue;
                }
                processedEvents.add(eventId);

                // Apply tool results to store OUTSIDE the state updater
                if (event.type === 'tool_result') {
                  // Stamp wizard-authored entities with PROV provenance (P2.6)
                  setWizardProvenanceContext({
                    model: apiConfig?.model || undefined,
                    conversationId: targetConversationId
                  });
                  applyToolResultToStore(event.name, event.result, event.id || event.toolCallId, targetConversationId);
                  setWizardProvenanceContext(null);
                }

                // Pre-compute plan card decision BEFORE updateMsgInArray so both
                // setConversations and setMessages apply the same action
                let planUpdate = null;
                if (event.type === 'tool_result' && event.name === 'planTask' && event.result?.steps) {
                  const incomingTopStatuses = event.result.steps.map(s => s.status);
                  const frozenSteps = JSON.parse(JSON.stringify(event.result.steps));
                  const planNow = Date.now();
                  if (lastTopLevelStepStatuses === null) {
                    planCardCounter++;
                    planUpdate = { action: 'create', steps: frozenSteps, id: `plan-${planCardCounter}-${streamingMessageId}`, timestamp: planNow };
                  } else {
                    const topLevelChanged =
                      incomingTopStatuses.length !== lastTopLevelStepStatuses.length ||
                      incomingTopStatuses.some((s, i) => lastTopLevelStepStatuses[i] !== s);
                    if (topLevelChanged) {
                      planCardCounter++;
                      planUpdate = { action: 'freeze_and_create', steps: frozenSteps, id: `plan-${planCardCounter}-${streamingMessageId}`, timestamp: planNow };
                    } else {
                      planUpdate = { action: 'update_in_place', steps: frozenSteps, timestamp: planNow };
                    }
                  }
                  lastTopLevelStepStatuses = incomingTopStatuses;
                }

                // Internal updater function to apply changes to a message array
                const updateMsgInArray = (currMessages) => {
                  const updated = [...currMessages];
                  let idx = updated.findIndex(m => m.id === streamingMessageId);
                  if (idx < 0) {
                    updated.push({
                      id: streamingMessageId,
                      sender: 'ai',
                      content: '',
                      timestamp: new Date().toISOString(),
                      contentBlocks: [],
                      isStreaming: true
                    });
                    idx = updated.length - 1;
                  }

                  const msg = { ...updated[idx] };
                  const blocks = Array.isArray(msg.contentBlocks) ? [...msg.contentBlocks] : [];

                  if (event.type === 'tool_call_start') {
                    const now = Date.now();
                    console.log('[Wizard] tool_call_start received:', event.name, event.id, 'at', now);
                    // Collapse any open thinking block when a tool call starts
                    const openThinkIdx = blocks.findLastIndex(b => b.type === 'thinking' && !b.collapsed);
                    if (openThinkIdx >= 0) blocks[openThinkIdx] = { ...blocks[openThinkIdx], collapsed: true };
                    const existingIndex = blocks.findIndex(b => b.type === 'tool_call' && b.id === event.id);
                    if (existingIndex >= 0) {
                      if (event.name) blocks[existingIndex] = { ...blocks[existingIndex], name: event.name };
                    } else {
                      blocks.push({ type: 'tool_call', id: event.id, name: event.name || 'Resolving spell...', args: {}, status: 'running', expanded: false, timestamp: now });
                      console.log('[Wizard] Created tool_call block:', event.name, 'status: running, timestamp:', now);
                    }
                  } else if (event.type === 'tool_call') {
                    const now = Date.now();
                    console.log('[Wizard] tool_call received:', event.name, event.id, 'args:', Object.keys(event.args || {}), 'at', now);
                    const existingIndex = blocks.findIndex(b => b.type === 'tool_call' && b.id === event.id);
                    if (existingIndex >= 0) {
                      blocks[existingIndex] = { ...blocks[existingIndex], name: event.name, args: event.args, status: 'running' };
                      const elapsed = now - (blocks[existingIndex].timestamp || now);
                      console.log('[Wizard] Updated existing tool_call block, elapsed since start:', elapsed, 'ms');
                    } else {
                      blocks.push({ type: 'tool_call', id: event.id, name: event.name, args: event.args, status: 'running', expanded: false, timestamp: now });
                      console.log('[Wizard] Created new tool_call block (no tool_call_start received)');
                    }
                  } else if (event.type === 'tool_result') {
                    const now = Date.now();
                    console.log('[Wizard] tool_result received:', event.id, 'error:', !!event.result?.error, 'at', now);
                    const toolIndex = blocks.findIndex(b => b.type === 'tool_call' && b.id === event.id);
                    if (toolIndex >= 0) {
                      const newStatus = event.result?.error ? 'failed' : 'completed';
                      const elapsed = now - (blocks[toolIndex].timestamp || now);
                      blocks[toolIndex] = { ...blocks[toolIndex], status: newStatus, result: event.result, error: event.result?.error };
                      console.log('[Wizard] Updated tool_call to status:', newStatus, 'total elapsed:', elapsed, 'ms');
                    } else {
                      console.warn('[Wizard] tool_result received but no matching tool_call block found!', event.id);
                    }
                    // Apply pre-computed plan card decision (computed outside updateMsgInArray)
                    if (planUpdate) {
                      if (planUpdate.action === 'create') {
                        blocks.push({ type: 'plan', id: planUpdate.id, steps: planUpdate.steps, timestamp: planUpdate.timestamp, frozen: false });
                      } else if (planUpdate.action === 'freeze_and_create') {
                        const latestPlanIdx = blocks.reduce((last, b, idx) => b.type === 'plan' && !b.frozen ? idx : last, -1);
                        if (latestPlanIdx >= 0) blocks[latestPlanIdx] = { ...blocks[latestPlanIdx], frozen: true };
                        blocks.push({ type: 'plan', id: planUpdate.id, steps: planUpdate.steps, timestamp: planUpdate.timestamp, frozen: false });
                      } else if (planUpdate.action === 'update_in_place') {
                        const latestPlanIdx = blocks.reduce((last, b, idx) => b.type === 'plan' && !b.frozen ? idx : last, -1);
                        if (latestPlanIdx >= 0) {
                          blocks[latestPlanIdx] = { ...blocks[latestPlanIdx], steps: planUpdate.steps, timestamp: planUpdate.timestamp };
                        }
                      }
                    }
                  } else if (event.type === 'thinking') {
                    // Thinking tokens from reasoning models (Ollama: delta.thinking_content)
                    // Accumulate into a single thinking block; collapse once response starts
                    const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
                    if (lastBlock && lastBlock.type === 'thinking') {
                      blocks[blocks.length - 1] = { ...lastBlock, content: (lastBlock.content || '') + (event.content || '') };
                    } else {
                      blocks.push({ type: 'thinking', content: event.content || '' });
                    }
                  } else if (event.type === 'response') {
                    // Collapse any open thinking block when the real response starts
                    const thinkIdx = blocks.findIndex(b => b.type === 'thinking' && !b.collapsed);
                    if (thinkIdx >= 0) blocks[thinkIdx] = { ...blocks[thinkIdx], collapsed: true };
                    const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
                    if (lastBlock && lastBlock.type === 'text') {
                      blocks[blocks.length - 1] = { ...lastBlock, content: (lastBlock.content || '') + (event.content || '') };
                    } else {
                      blocks.push({ type: 'text', content: event.content || '' });
                    }
                    msg.content = (msg.content || '') + (event.content || '');
                  } else if (event.type === 'error') {
                    blocks.push({ type: 'text', content: `Error: ${event.message}` });
                    msg.content = `Error: ${event.message}`;
                    msg.isStreaming = false;
                  } else if (event.type === 'done') {
                    msg.isStreaming = false;
                    msg.iterations = event.iterations;
                    // Collapse any thinking blocks still open when run ends
                    blocks.forEach((b, i) => { if (b.type === 'thinking' && !b.collapsed) blocks[i] = { ...b, collapsed: true }; });
                    const lastTextIdx = blocks.length - 1;
                    if (lastTextIdx >= 0 && blocks[lastTextIdx].type === 'text' && blocks[lastTextIdx].content) {
                      blocks[lastTextIdx] = { ...blocks[lastTextIdx], content: blocks[lastTextIdx].content.trimEnd() };
                    }
                    if (msg.content) msg.content = msg.content.trimEnd();
                    // Show a subtle system note for incomplete plans, not as AI text
                    if (event.reason === 'max_iterations' && event.planTotal > 0 && event.planDone < event.planTotal) {
                      blocks.push({ type: 'system_note', content: `Reached iteration limit — plan ${event.planDone}/${event.planTotal} complete. Try "continue" to pick up where this left off.` });
                    }

                    if (persona === 'druid' && druidInstance) {
                      druidInstance.processMessage(msg.content, [...updated, msg].map(m => ({
                        role: m.sender === 'ai' ? 'assistant' : 'user', content: m.content
                      })));
                    }
                  }

                  msg.contentBlocks = blocks;
                  updated[idx] = msg;
                  return updated;
                };

                // Update the background conversations list ALWAYS
                setConversations(prev => prev.map(c =>
                  c.id === targetConversationId ? { ...c, messages: updateMsgInArray(c.messages || []), timestamp: new Date().toISOString() } : c
                ));

                // Update the active UI messages ONLY if we are still on that tab
                setMessages(prev => {
                  if (activeConversationId === targetConversationId) {
                    return updateMsgInArray(prev);
                  }
                  return prev;
                });

              } catch (e) {
                console.warn('[Wizard] Failed to parse SSE event:', e, data);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      setIsConnected(true);
    } catch (error) {
      if (error.name === 'AbortError') {
        if (!_preCreated) return; // bailed before pre-creation (no API key) — nothing to clean up
        // On cancel: remove the pre-created message if still empty, otherwise mark done
        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === streamingMessageId);
          if (idx < 0) return prev;
          const hasContent = prev[idx].contentBlocks?.some(b => b.content);
          if (!hasContent) return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
          const updated = [...prev];
          updated[idx] = { ...updated[idx], isStreaming: false };
          return updated;
        });
        setConversations(prev => prev.map(c => c.id === _preCreatedConvId
          ? { ...c, messages: (() => {
              const msgs = c.messages || [];
              const idx = msgs.findIndex(m => m.id === streamingMessageId);
              if (idx < 0) return msgs;
              const hasContent = msgs[idx].contentBlocks?.some(b => b.content);
              if (!hasContent) return [...msgs.slice(0, idx), ...msgs.slice(idx + 1)];
              return msgs.map((m, i) => i === idx ? { ...m, isStreaming: false } : m);
            })() }
          : c
        ));
      } else {
        console.error('[AI Collaboration] Autonomous agent failed:', error);
        // Update the pre-created streaming message with the error
        setMessages(prev => {
          const updated = [...prev];
          const idx = updated.findIndex(m => m.id === streamingMessageId);
          const errorBlock = { type: 'text', content: `Error: ${error.message}` };
          if (idx >= 0) {
            const msg = { ...updated[idx] };
            const blocks = Array.isArray(msg.contentBlocks) ? [...msg.contentBlocks, errorBlock] : [errorBlock];
            msg.contentBlocks = blocks;
            msg.content = `Error: ${error.message}`;
            msg.isStreaming = false;
            updated[idx] = msg;
            return updated;
          }
          return [...prev, { id: streamingMessageId, sender: 'ai', content: `Error: ${error.message}`, timestamp: new Date().toISOString(), contentBlocks: [errorBlock], isStreaming: false }];
        });
      }
    } finally {
      setCurrentAgentRequest(null);
    }
  };

  const handleQuestion = async (question) => {
    const targetConversationId = activeConversationId;
    try {
      const apiConfig = await apiKeyManager.getAPIKeyInfo();
      if (!apiConfig) { addMessage('ai', 'Please set up your API key first by clicking the key icon in the header.', {}, targetConversationId); return; }
      const apiKey = await apiKeyManager.getAPIKey();
      if (!apiKey) { addMessage('ai', 'No API key found. Please set one via the key icon.', {}, targetConversationId); return; }
      // Auto-correct provider if key mismatches
      let chatProvider = apiConfig?.provider;
      if (apiKey?.startsWith('sk-ant-') && (!chatProvider || chatProvider === 'openrouter')) chatProvider = 'anthropic';
      else if (apiKey?.startsWith('sk-proj-') && (!chatProvider || chatProvider === 'openrouter')) chatProvider = 'openai';
      else if (apiKey?.startsWith('AIza') && (!chatProvider || chatProvider === 'openrouter')) chatProvider = 'google';

      const response = await bridgeFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          message: question,
          systemPrompt: 'You are a concise Redstring copilot. Reference the active graph when possible and keep answers grounded.',
          context: {
            activeGraphId: activeGraphId || null,
            graphInfo,
            graphCount,
            apiConfig: apiConfig ? { provider: chatProvider || apiConfig.provider, endpoint: apiConfig.endpoint, model: apiConfig.model, settings: apiConfig.settings } : null
          },
          model: apiConfig?.model || undefined
        })
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Chat request failed (${response.status}): ${errorBody}`);
      }
      const data = await response.json();
      addMessage('ai', data.response || 'No response received from the model.', {}, targetConversationId);
      setIsConnected(true);
    } catch (error) {
      console.error('[AI Collaboration] Question handling failed:', error);
      addMessage('ai', error.message?.includes('API key') ? error.message : 'I encountered an error while processing your question. Please try again or check your bridge connection.', {}, targetConversationId);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  const typeListMode = useGraphStore(state => state.typeListMode);
  const toggleClearance = typeListMode === 'closed' ? HEADER_HEIGHT + 10 : 0;

  // Save active conversation messages to file (Electron only — web uses localStorage via the messages sync effect above)
  React.useEffect(() => {
    const saveToFile = async () => {
      if (messages.length === 0) return;
      if (!fileStorage.isElectron()) return; // Web uses localStorage only (handled by messages sync effect)
      try {
        const projectDir = await fileStorage.getProjectDirectory();
        if (!projectDir) return;

        const convDir = `${projectDir}/conversations`;
        const exists = await window.electron.fileSystem.folderExists(convDir);
        if (!exists) {
          console.log('[AI Collaboration] Creating conversations directory:', convDir);
          await fileStorage.mkdir(convDir);
        }

        const filePath = `${convDir}/${activeConversationId}.json`;
        console.log('[AI Collaboration] Saving conversation to:', filePath);

        const convData = {
          id: activeConversationId,
          messages,
          timestamp: new Date().toISOString()
        };
        const content = JSON.stringify(convData, null, 2);

        await fileStorage.writeFile(filePath, content);
        console.log('[AI Collaboration] Save Successful!');

        // Backup to localStorage
        localStorage.setItem(`rs.aiChat.messages.${activeConversationId}`, content);
      } catch (err) {
        console.error('[AI Collaboration] Failed to save conversation to file:', err);
        // Fallback to localStorage on error
        localStorage.setItem(`rs.aiChat.messages.${activeConversationId}`, JSON.stringify({
          id: activeConversationId,
          messages,
          timestamp: new Date().toISOString()
        }));
      }
    };

    const debounceTimer = setTimeout(saveToFile, 3000); // 3s debounce for saving to disk
    return () => clearTimeout(debounceTimer);
  }, [messages, activeConversationId]);

  const handleTabSwitch = (id) => {
    if (id === activeConversationId) return;

    // Find the conversation we are switching to
    const targetConv = conversations.find(c => c.id === id);
    if (!targetConv) return;

    // 1. Update the lastMessagesRef to match the target's messages
    // This prevents the save effect from thinking messages changed during the state update
    lastMessagesRef.current = targetConv.messages || [];

    // 2. Clear messages state (or set to target messages) immediately
    setMessages(targetConv.messages || []);

    // 3. Switch the ID
    setActiveConversationId(id);
  };

  const handleNewConversation = () => {
    const newId = `conv_${Date.now()}`;
    const activeGraphData = activeGraphId && graphsMap ? graphsMap.get(activeGraphId) : null;
    const defaultTitle = activeGraphData?.name ? activeGraphData.name : 'New Chat';

    const newConv = {
      id: newId,
      title: defaultTitle,
      messages: [],
      timestamp: new Date().toISOString(),
      graphId: activeGraphId || null
    };

    // Urgent: insert the tab and move the selection so they paint immediately.
    setConversations(prev => [newConv, ...prev]);
    setActiveConversationId(newId);

    // Deferred: swap the message content in a transition so unmounting the old
    // conversation's (possibly heavy) list doesn't block the selection paint.
    // Old cards are React.memo'd, so the urgent commit above stays cheap.
    // Keep lastMessagesRef on the CURRENT messages so the save-effect guard
    // (lastMessagesRef.current === messages) stays true and doesn't write the
    // old tab's messages into the new conversation before the transition fires.
    lastMessagesRef.current = messages;
    React.startTransition(() => { setMessages([]); });
  };

  const handleCloseConversation = (id, e) => {
    if (e) e.stopPropagation();
    // Prevent closing the last remaining tab
    if (conversations.length <= 1) return;

    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== id);
      if (activeConversationId === id && filtered.length > 0) {
        // Switch to the most recent remaining conversation after removing this one
        handleTabSwitch(filtered[0].id);
      }
      return filtered;
    });
  };

  const handleCopyConversation = () => {
    const conversationText = messages.map(msg => {
      const sender = msg.sender === 'user' ? 'User' : msg.sender === 'ai' ? 'AI' : 'System';
      const parts = [];

      // Render content blocks in order for faithful chronological copy
      const blocks = msg.contentBlocks || [];
      if (blocks.length > 0) {
        let toolCounter = 0;
        for (const block of blocks) {
          if (block.type === 'text' && block.content) {
            parts.push(block.content);
          } else if (block.type === 'tool_call') {
            toolCounter++;
            const lines = [`  [Tool ${toolCounter}] ${block.name || 'unknown'} (${block.status || 'unknown'})`];
            if (block.args) {
              lines.push(`       Args: ${JSON.stringify(block.args, null, 2).replace(/\n/g, '\n       ')}`);
            }
            if (block.result) {
              lines.push(`       Result: ${JSON.stringify(block.result, null, 2).replace(/\n/g, '\n       ')}`);
            }
            if (block.error) {
              lines.push(`       Error: ${block.error}`);
            }
            parts.push(lines.join('\n'));
          } else if (block.type === 'plan' && block.steps) {
            const stepLines = block.steps.map((step, i) => {
              const status = step.status ? step.status.toUpperCase() : 'TODO';
              let line = `  ${i + 1}. [${status}] ${step.description || ''}`;
              if (Array.isArray(step.substeps) && step.substeps.length > 0) {
                const subLines = step.substeps.map(sub => {
                  const subStatus = sub.status ? sub.status.toUpperCase() : 'TODO';
                  return `       - [${subStatus}] ${sub.description || ''}`;
                });
                line += '\n' + subLines.join('\n');
              }
              return line;
            });
            parts.push(`  [Plan]\n${stepLines.join('\n')}`);
          }
        }
      } else if (msg.content) {
        // Fallback for old-format messages
        parts.push(msg.content);
      }

      let text = `${sender}: ${parts.join('\n')}`;

      const meta = [];
      if (msg.metadata) {
        if (msg.metadata.mode) {
          meta.push(`\n  Mode: ${msg.metadata.mode}`);
        }
        if (msg.metadata.iterations) {
          meta.push(`\n  Iterations: ${msg.metadata.iterations}`);
        }
        if (msg.metadata.isComplete !== undefined) {
          meta.push(`\n  Complete: ${msg.metadata.isComplete}`);
        }
      }

      if (meta.length > 0) {
        text += meta.join('');
      }

      return text;
    }).join('\n\n');

    navigator.clipboard.writeText(conversationText).then(() => {
      addMessage('system', '📋 Conversation copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy:', err);
      addMessage('system', '❌ Failed to copy conversation');
    });
  };

  // Tabs are global and NOT scoped to the active graph — switching graphs must not
  // hide, clear, or reorder the user's conversation tabs. (graphId is kept on each
  // conversation only as metadata; it no longer gates visibility.)
  const visibleConversations = conversations;

  const headerActionsEl = (
    <div className="ai-header-actions">
      <PanelIconButton
        icon={Plus}
        size={18}
        onClick={handleNewConversation}
        title="New Conversation"
      />
      <PanelIconButton
        icon={Key}
        size={18}
        active={false}
        onClick={() => {
          window.dispatchEvent(new CustomEvent('openSettingsModal', {
            detail: { section: 'ai' }
          }));
        }}
        title={hasAPIKey ? 'Manage API Key' : 'Setup API Key'}
      />
      <PanelIconButton
        icon={Copy}
        size={18}
        onClick={() => {
          const formatPlanSteps = (steps) => {
            const lines = [];
            const done = steps.filter(s => s.status === 'done').length;
            lines.push(`Plan (${done}/${steps.length})`);
            for (const step of steps) {
              const icon = step.status === 'done' ? '✓' : step.status === 'in_progress' ? '▸' : '○';
              lines.push(`${icon} ${step.description}`);
              if (step.substeps) {
                for (const sub of step.substeps) {
                  const si = sub.status === 'done' ? '✓' : sub.status === 'in_progress' ? '▸' : '○';
                  lines.push(`  ${si} ${sub.description}`);
                }
              }
            }
            return lines.join('\n');
          };
          const lines = [];
          for (const msg of messages) {
            if (msg.metadata?.kind === 'wizard-action-chip') continue;
            const sender = msg.sender === 'user' ? 'User' : msg.sender === 'ai' ? 'AI' : 'System';
            const time = new Date(msg.timestamp).toLocaleTimeString();
            lines.push(`[${sender}] ${time}`);
            if (msg.contentBlocks && msg.contentBlocks.length > 0) {
              for (const block of msg.contentBlocks) {
                if (block.type === 'text' && block.content) lines.push(block.content);
                else if (block.type === 'plan' && block.steps) lines.push(formatPlanSteps(block.steps));
                else if (block.type === 'tool_call' && block.error) lines.push(`Error: ${typeof block.error === 'string' ? block.error : JSON.stringify(block.error)}`);
              }
            } else if (msg.content) {
              lines.push(msg.content);
            }
            lines.push('');
          }
          navigator.clipboard.writeText(lines.join('\n').trim());
        }}
        title="Copy conversation"
      />
      <PanelIconButton
        icon={RotateCcw}
        size={18}
        className={isConnected ? 'ai-refresh-button' : 'ai-connect-button'}
        onClick={refreshBridgeConnection}
        title={isConnected ? 'Bridge connected' : 'Reconnect bridge daemon'}
        disabled={isProcessing}
      />
    </div>
  );

  return (
    <div className="ai-collaboration-panel">
      <div className="ai-panel-header">
        {!compact ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="ai-status-indicator-wrapper">
                <div className={`ai-status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
              </div>
              <div ref={modeMenuRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowModeMenu(!showModeMenu)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    background: 'none',
                    color: theme.canvas.textPrimary,
                    border: 'none',
                    borderRadius: 4,
                    padding: '2px 4px 2px 0',
                    fontFamily: 'EmOne, sans-serif',
                    fontSize: '1.1rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    transition: 'opacity 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  {viewMode === 'wizard' ? 'The Wizard' : 'Chat'}
                  <ChevronDown size={13} style={{ opacity: 0.8, transition: 'transform 0.15s ease', transform: showModeMenu ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                </button>
                {showModeMenu && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: 4,
                    backgroundColor: theme.canvas.bg,
                    border: `1px solid ${theme.canvas.border}`,
                    borderRadius: 6,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    zIndex: 1000,
                    minWidth: 160
                  }}>
                    {[{ value: 'wizard', label: 'The Wizard' }, { value: 'chat', label: 'Chat' }].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { setViewMode(opt.value); setShowModeMenu(false); }}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          border: 'none',
                          background: viewMode === opt.value ? theme.canvas.inactive : 'none',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          fontWeight: viewMode === opt.value ? 700 : 600,
                          color: viewMode === opt.value ? theme.canvas.textPrimary : theme.canvas.textSecondary,
                          fontFamily: 'EmOne, sans-serif',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}
                        onMouseEnter={e => { if (viewMode !== opt.value) e.currentTarget.style.backgroundColor = theme.canvas.hover; }}
                        onMouseLeave={e => { if (viewMode !== opt.value) e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {headerActionsEl}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="ai-status-indicator-wrapper">
                <div className={`ai-status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
              </div>
              <div ref={modeMenuRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowModeMenu(!showModeMenu)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    background: 'none',
                    color: theme.canvas.textPrimary,
                    border: 'none',
                    borderRadius: 4,
                    padding: '2px 4px 2px 0',
                    fontFamily: 'EmOne, sans-serif',
                    fontSize: '1.1rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    transition: 'opacity 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  {viewMode === 'wizard' ? 'The Wizard' : 'Chat'}
                  <ChevronDown size={13} style={{ opacity: 0.8, transition: 'transform 0.15s ease', transform: showModeMenu ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                </button>
                {showModeMenu && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: 4,
                    backgroundColor: theme.canvas.bg,
                    border: `1px solid ${theme.canvas.border}`,
                    borderRadius: 6,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    zIndex: 1000,
                    minWidth: 160
                  }}>
                    {[{ value: 'wizard', label: 'The Wizard' }, { value: 'chat', label: 'Chat' }].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { setViewMode(opt.value); setShowModeMenu(false); }}
                        style={{
                          width: '100%',
                          padding: '7px 10px',
                          border: 'none',
                          background: viewMode === opt.value ? theme.canvas.inactive : 'none',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          fontWeight: viewMode === opt.value ? 700 : 600,
                          color: viewMode === opt.value ? theme.canvas.textPrimary : theme.canvas.textSecondary,
                          fontFamily: 'EmOne, sans-serif',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}
                        onMouseEnter={e => { if (viewMode !== opt.value) e.currentTarget.style.backgroundColor = theme.canvas.hover; }}
                        onMouseLeave={e => { if (viewMode !== opt.value) e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 8, paddingLeft: 6 }}>
              {headerActionsEl}
            </div>
          </div>
        )}
      </div>

      {/* Advanced Options Panel */}
      {showAdvanced && (
        <div className="ai-advanced-panel" style={{
          padding: '12px',
          backgroundColor: theme.canvas.inactive,
          borderBottom: `1px solid ${theme.canvas.border}`,
          fontSize: '12px',
          color: theme.canvas.textSecondary,
          animation: 'slideDown 0.2s ease-out'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Settings size={14} />
              Advanced Configuration
            </div>
            <button
              onClick={() => setShowAdvanced(false)}
              style={{ background: 'none', border: 'none', color: theme.canvas.textSecondary, cursor: 'pointer', padding: '2px' }}
            >
              <X size={14} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '4px 8px' }}>
            <span style={{ color: theme.canvas.textSecondary }}>Provider:</span>
            <span style={{ fontFamily: 'monospace' }}>{currentApiConfig?.provider || 'None'}</span>

            <span style={{ color: theme.canvas.textSecondary }}>Model:</span>
            <span style={{ fontFamily: 'monospace' }}>{currentApiConfig?.model || 'Default'}</span>

            <span style={{ color: theme.canvas.textSecondary }}>Endpoint:</span>
            <span style={{
              fontFamily: 'monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }} title={currentApiConfig?.endpoint}>
              {currentApiConfig?.endpoint || 'Default'}
            </span>
          </div>

          <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: `1px solid ${theme.canvas.border}`, display: 'flex', gap: '8px' }}>
            <button
              className="ai-flat-button"
              style={{ fontSize: '11px', padding: '4px 8px' }}
              onClick={() => {
                setShowAPIKeySetup(true);
                setShowAdvanced(false);
              }}
            >
              Change Config
            </button>
          </div>
        </div>
      )}


      {/* Tabs Bar */}
      <div className="ai-tabs-bar">
        <div
          className="ai-tabs-scroll"
          onWheel={(e) => {
            if (e.deltaY !== 0) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
        >
          {visibleConversations.map(conv => (
            <div
              key={conv.id}
              className={`ai-tab ${activeConversationId === conv.id ? 'active' : ''}`}
              onClick={() => handleTabSwitch(conv.id)}
              onDoubleClick={() => handleTabDoubleClick(conv.id, conv.title)}
            >
              {editingTabId === conv.id ? (
                <input
                  className="ai-tab-title-input"
                  value={editingTabTitle}
                  onChange={handleTabRenameChange}
                  onBlur={handleTabRenameCommit}
                  onKeyDown={handleTabRenameKeyDown}
                  autoFocus
                  onFocus={e => e.target.select()}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="ai-tab-title">{conv.title}</span>
              )}
              {visibleConversations.length > 1 && (
                <button
                  className="ai-tab-close"
                  onClick={(e) => handleCloseConversation(conv.id, e)}
                  title="Close"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {selectedTestTool && (
        <div className="ai-tool-tester-modal" style={{
          position: 'absolute', top: '50px', right: '12px',
          width: '320px', backgroundColor: theme.canvas.inactive,
          border: `1px solid ${theme.canvas.border}`, borderRadius: '8px', padding: '12px', zIndex: 1000,
          boxShadow: `0 8px 24px ${theme.darkMode ? 'rgba(0,0,0,0.4)' : 'rgba(38,0,0,0.15)'}`,
          display: 'flex', flexDirection: 'column'
        }}>
          <h3 style={{ margin: '0 0 8px 0', color: theme.canvas.textPrimary, fontSize: '13px', borderBottom: `1px solid ${theme.canvas.border}`, paddingBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Test: {selectedTestTool.name}</span>
            <span style={{ fontSize: '10px', color: theme.canvas.textSecondary, fontWeight: 'normal', backgroundColor: theme.canvas.inactive, padding: '2px 4px', borderRadius: '4px' }}>
              {selectedTestTool.isMcpTool ? 'MCP' : 'WIZARD'}
            </span>
          </h3>
          <div style={{ color: theme.canvas.textSecondary, fontSize: '11px', marginBottom: '12px', flexShrink: 0, lineHeight: '1.3' }}>{selectedTestTool.description}</div>
          <div style={{ fontSize: '11px', color: theme.canvas.textSecondary, marginBottom: '6px', fontWeight: '500' }}>Arguments (JSON)</div>
          <textarea
            value={testToolArgs}
            onChange={(e) => setTestToolArgs(e.target.value)}
            style={{
              width: '100%', height: '120px', backgroundColor: theme.canvas.bg,
              color: theme.canvas.textPrimary, fontFamily: 'monospace', fontSize: '11px', padding: '8px',
              border: `1px solid ${theme.canvas.border}`, borderRadius: '4px', marginBottom: '12px',
              resize: 'vertical', outline: 'none'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexShrink: 0 }}>
            <button onClick={() => setSelectedTestTool(null)} className="ai-flat-button" style={{ padding: '6px 12px', fontSize: '11px', color: theme.canvas.textSecondary }}>Cancel</button>
            <button disabled={isProcessing} onClick={async () => {
              const toolName = selectedTestTool.name;
              const isMcpTool = selectedTestTool.isMcpTool;
              let parsedArgs = {};
              try {
                parsedArgs = JSON.parse(testToolArgs);
              } catch (e) {
                alert('Invalid JSON in arguments');
                return;
              }

              try {
                setIsProcessing(true);
                setSelectedTestTool(null);
                addMessage('user', `Manual execution: ${toolName}`);
                addMessage('system', `Executing tool manually: ${toolName}...`);

                if (isMcpTool) {
                  const result = await mcpClient.callTool(toolName, parsedArgs);
                  addMessage('system', `**Result for ${toolName}:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
                } else {
                  const graphState = {
                    activeGraphId,
                    graphs: activeGraphId && graphsMap ? Array.from(graphsMap.values()).map(g => ({
                      id: g.id, name: g.name,
                      instances: g.instances instanceof Map ? Array.from(g.instances.values()) : Object.values(g.instances || {}),
                      edgeIds: g.edgeIds || [],
                      definingNodeIds: Array.isArray(g.definingNodeIds) ? g.definingNodeIds : [],
                      groups: g.groups instanceof Map ? Array.from(g.groups.values()) : Object.values(g.groups || {})
                    })) : [],
                    nodePrototypes: nodePrototypesMap ? Array.from(nodePrototypesMap.values()).map(proto => ({
                      id: proto.id,
                      name: proto.name || '',
                      color: proto.color || '',
                      description: proto.description || '',
                      definitionGraphIds: Array.isArray(proto.definitionGraphIds) ? proto.definitionGraphIds : []
                    })) : [],
                    edges: edgesMap && graphsMap ? (() => {
                      const allEdgeIds = new Set();
                      Array.from(graphsMap.values()).forEach(g => {
                        (g.edgeIds || []).forEach(id => allEdgeIds.add(id));
                      });
                      return Array.from(allEdgeIds).map(edgeId => {
                        const edge = edgesMap.get(edgeId);
                        if (!edge) return null;
                        return {
                          id: edgeId, sourceId: edge.sourceId, destinationId: edge.destinationId,
                          definitionNodeIds: Array.isArray(edge.definitionNodeIds) ? edge.definitionNodeIds : [],
                          type: edge.type || edge.connectionType || 'relates to'
                        };
                      }).filter(Boolean);
                    })() : []
                  };

                  const apiKey = await apiKeyManager.getAPIKey();
                  const headers = { 'Content-Type': 'application/json' };
                  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

                  const response = await bridgeFetch('/api/wizard/execute-tool', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ name: toolName, args: parsedArgs, graphState })
                  });

                  if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Tool execution failed (${response.status}): ${errText}`);
                  }
                  const result = await response.json();
                  addMessage('system', `**Result for ${toolName}:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
                }
              } catch (e) {
                addMessage('system', `❌ Error executing ${toolName}:\n${e.message}`);
              } finally {
                setIsProcessing(false);
              }
            }} className="ai-flat-button" style={{ backgroundColor: theme.canvas.inactive, padding: '6px 12px', fontSize: '11px', border: `1px solid ${theme.canvas.border}`, borderRadius: '4px', cursor: 'pointer', color: theme.canvas.textPrimary }}>
              Execute {selectedTestTool.name}
            </button>
          </div>
        </div>
      )}



      <div className="ai-panel-content">
        <ConfirmDialog
          isOpen={isChatUndoOpen}
          onClose={() => setIsChatUndoOpen(false)}
          onConfirm={() => {
            if (chatUndoMessageId) handleChatUndo(chatUndoMessageId);
          }}
          title="Revert Conversation"
          message="Are you sure you want to revert to this point? All subsequent actions will be undone, and the conversation will be restored."
          confirmLabel="Revert"
          variant="danger"
        />
        <div className="ai-chat-mode">
          <div className="ai-messages" style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: messages.length === 0 ? 'center' : 'flex-start' }}>
            {isHydrated && isConnected && messages.length === 0 && (
              <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0' }}>
                <svg id="wizard-full-body" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 58.23 81.25" style={{ width: '150px', marginBottom: '16px' }}>
                  <g>
                    <path fill="var(--canvas-text-muted)" d="M45.09,31.34c5.28-.91,13.15-2.94,13.15-6.96,0-5.33-13.65-7.2-18.8-7.72L30.17.61c-.22-.38-.62-.61-1.05-.61s-.84.23-1.05.61l-9.27,16.05c-5.15.52-18.8,2.39-18.8,7.72,0,4.02,7.87,6.05,13.15,6.96.59,2.89,2.46,5.33,5.05,6.68-2.59,2.75-4.39,2.46-4.41,2.46-.56-.15-1.16.11-1.41.64-.26.52-.11,1.16.36,1.51,1.91,1.44,3.77,2.38,5.55,2.82l-.53,3.03c-1.25,1.66-3.73,4.14-7.27,4.01-1.29-.68-2.84-.84-4.25-.45l-3.22-12c-.18-.65-.84-1.04-1.49-.86-.65.18-1.04.84-.86,1.49l3.38,12.58c-1.22,1.07-1.94,2.61-1.94,4.28,0,3.15,2.56,5.72,5.71,5.72,1.06,0,2.07-.3,2.95-.84.91-.06,2.75-.32,4.77-1.32l-3.28,18.74c-.06.36.04.71.27.99.23.27.57.43.93.43h31.31c.36,0,.7-.16.93-.43s.33-.64.27-.99l-3.27-18.69c1.88.91,3.6,1.19,4.57,1.27.88.55,1.89.85,2.96.85h.01v16.79c0,.67.54,1.21,1.21,1.21s1.21-.54,1.21-1.21v-17.34c1.96-.93,3.27-2.94,3.27-5.17s-1.32-4.25-3.27-5.17v-11.5c1.77-.52,3.07-2.16,3.07-4.1,0-2.36-1.92-4.28-4.28-4.28s-4.27,1.92-4.27,4.28c0,1.93,1.29,3.57,3.06,4.1v10.95h-.01c-.94,0-1.86.24-2.67.68-3.23.09-5.58-1.96-7.04-3.83l-.56-3.21c1.79-.44,3.65-1.38,5.55-2.82.46-.35.62-.98.36-1.51-.26-.52-.85-.79-1.41-.64-.02,0-1.81.31-4.42-2.48.88-.46,1.7-1.04,2.4-1.74,1.35-1.35,2.27-3.08,2.66-4.93h0ZM29.12,3.65l7.37,12.76c-.07,0-6.82-.54-14.73,0l7.37-12.76h0ZM2.43,24.38c0-1.52,5.47-4.28,17.22-5.36,6.11-.57,13.06-.55,18.93,0,11.75,1.08,17.22,3.83,17.22,5.36,0,1.03-2.89,3.08-10.55,4.46,0-.03-.02-.06-.02-.09-.29-1.62-1.75-2.82-3.37-2.82h-.05l-1.1-4c-.13-.46-.52-.81-1-.88-7.12-1.04-15.26-1.03-21.23,0-.46.08-.84.42-.96.88l-1.1,4h-.05c-.91,0-1.77.36-2.43,1-.52.52-.87,1.26-.96,1.91-7.65-1.39-10.55-3.44-10.55-4.46h0ZM21.16,38.3c.32-.4.64-.86,1.06-1.48.49-.74,1.24-1.24,2-1.34,1.21-.14,2.4.51,3.52,1.96-1.57,3.55-4.09,6.06-7.95,5.82-.99-.12-2.04-.46-3.13-1.01,1.29-.63,2.84-1.8,4.5-3.95h0ZM28.34,59.15c.58-3.01-1.37-5.71-3.9-7.11-2.05-1.28-3.02-3.95-3.32-6.32,3.51-.22,6.21-2.64,8-5.67,1.77,3,4.44,5.41,7.91,5.66-.56,5.7-3.94,10.36-8.69,13.43h0ZM4.54,57.53c0-1.86,1.52-3.29,3.28-3.29s3.29,1.41,3.29,3.29-1.48,3.29-3.29,3.29-3.28-1.48-3.28-3.29ZM13.22,59.42c.52-1.48.42-3.23-.41-4.7h0c1.66-.37,3.06-1.14,4.21-2.03l-.88,5.02-.04.19c-.98.74-1.99,1.22-2.89,1.53h0ZM18.41,58.79s0,0,0-.02l1.48-8.47c.78,1.65,1.91,3.02,3.47,3.94,1.49.89,2.78,2.37,2.62,4.1-.1,1.07-.74,2.13-1.43,2.95-.35.42-.38,1.03-.06,1.48.22.32.64.53,1.04.51.5-.02,1.91-.78,2.34-1.02,0,1.61-.03,14.79-.04,16.55h-12.94l3.5-20.03h0ZM30.29,78.82l.04-18.08c3.58-2.53,6.54-5.98,8.06-10.11,7.29,41.58,4.1,23.39,4.94,28.19h-13.04ZM49.61,36.76c0-1.02.82-1.85,1.84-1.85s1.85.83,1.85,1.85-.83,1.84-1.85,1.84-1.84-.82-1.84-1.84ZM53.5,57.53c0,1.47-.98,2.77-2.41,3.16-.27.08-.56.12-.88.12-1.8,0-3.28-1.47-3.28-3.29s1.47-3.29,3.28-3.29,3.29,1.48,3.29,3.29h0ZM45.26,54.7s0,.02-.01.02c-.82,1.46-.95,3.19-.43,4.67-.84-.3-1.76-.74-2.67-1.4l-.91-5.21c1.11.84,2.46,1.57,4.03,1.93h0ZM41.57,42.25c-2.13,1.09-3.14.99-3.36,1.04-4.46.38-6.88-3.94-7.72-5.84,1.12-1.45,2.3-2.11,3.52-1.96.77.09,1.52.59,2,1.34.32.49.66.97,1.05,1.46,1.67,2.16,3.22,3.34,4.51,3.97h0ZM38.46,36.09c-.14-.2-.28-.4-.41-.6-.89-1.35-2.25-2.23-3.74-2.41-2.03-.25-3.82.71-5.2,2.23-1.37-1.51-3.14-2.49-5.2-2.23-1.49.18-2.85,1.06-3.73,2.41-.14.21-.26.39-.38.56-.02.02-.03.04-.04.06-2.39-1.05-4.07-3.3-4.35-5.94-.07-.61-.12-1.13.24-1.49.48-.47,1.02-.23,1.7-.3.55,0,1.03-.37,1.17-.89l1.14-4.14c5.43-.84,12.52-.83,18.92.02l1.13,4.12c.34,1.22,1.75.82,2.14.89.55,0,1,.45,1,1,0,2.03-.83,3.87-2.15,5.19-.65.65-1.41,1.17-2.24,1.53h0ZM24.99,27.66v1.6c0,.67-.54,1.21-1.21,1.21s-1.21-.54-1.21-1.21v-1.6c0-.67.54-1.21,1.21-1.21s1.21.54,1.21,1.21ZM35.67,27.66v1.6c0,.67-.54,1.21-1.21,1.21s-1.21-.54-1.21-1.21v-1.6c0-.67.54-1.21,1.21-1.21s1.21.54,1.21,1.21Z" />
                  </g>
                </svg>
                <div style={{ color: 'var(--canvas-text-muted)', fontFamily: "'EmOne', sans-serif", fontSize: '14px' }}>What will we build today?</div>
              </div>
            )}
            {/* Only emit the message-list DOM when this view is the active tab.
                The agent loop, streaming, and `messages` state above keep running
                while hidden — we just stop React from reconciling hundreds of
                ToolCallCards into a display:none panel on every store write
                (zoom-settle, force-sim ticks), which janks the canvas. */}
            {active && messages.map((message, idx) => {
              const prevMessage = idx > 0 ? messages[idx - 1] : null;
              const isNewSection = prevMessage && prevMessage.sender !== message.sender;

              // Programmatic Ask The Wizard actions render as a compact right-aligned card
              // visually identical to the AI's tool-call cards (just on the user side).
              // No avatar, no bubble — the card itself is the message.
              if (message.metadata?.kind === 'wizard-action-chip') {
                return (
                  <div
                    key={message.id}
                    style={{
                      alignSelf: 'flex-end',
                      maxWidth: '85%',
                      marginTop: isNewSection ? '24px' : '8px'
                    }}
                  >
                    <WizardActionChip message={message} />
                  </div>
                );
              }

              const hasDefinitiveContent = (() => {
                if (message.contentBlocks && message.contentBlocks.length > 0) {
                  return message.contentBlocks.some(b =>
                    (b.type === 'text' && b.content) ||
                    (b.type === 'tool_call' && b.name !== 'planTask') ||
                    b.type === 'plan' ||
                    (b.type === 'thinking' && b.content) ||
                    (b.type === 'system_note' && b.content)
                  );
                }
                return !!message.content;
              })();

              return (
                <div
                  key={message.id}
                  className={`ai-message ai-message-${message.sender}`}
                  style={{
                    alignSelf: message.sender === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    marginTop: isNewSection ? '24px' : '8px'
                  }}
                >
                  <div className="ai-message-avatar">
                    {message.sender === 'user' ? <User size={24} /> : message.sender === 'system' ? null : <img src={headSvg} alt="Wizard" style={{ width: 40, height: 40 }} />}
                  </div>
                  <div className="ai-message-content">
                    {/* Render attachment previews (images/files) */}
                    {message.metadata?.attachments?.length > 0 && (
                      <div className="ai-attachment-preview">
                        {message.metadata.attachments.map((att, i) => (
                          att.category === 'image' && att.previewUrl ? (
                            <img key={i} src={att.previewUrl} alt={att.name} />
                          ) : (
                            <div key={i} className="ai-attachment-preview-file">
                              <FileText size={14} /> {att.name}
                            </div>
                          )
                        ))}
                      </div>
                    )}
                    {/* Render content blocks in chronological order */}
                    {message.contentBlocks && message.contentBlocks.length > 0 ? (
                      message.contentBlocks.map((block, i) => {
                        if (block.type === 'text' && block.content) {
                          return (
                            <div
                              key={`text-${i}`}
                              className="ai-message-text"
                              style={{ userSelect: 'text', cursor: 'text' }}
                              dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderMarkdown(block.content)) }}
                            />
                          );
                        }
                        if (block.type === 'tool_call') {
                          if (block.name === 'planTask') return null;
                          return (
                            <ToolCallCard
                              key={block.id || `tc-${i}`}
                              toolCallId={block.id}
                              toolName={block.name}
                              status={block.status || 'running'}
                              args={block.args}
                              result={block.result}
                              error={block.error}
                              timestamp={block.timestamp}
                              executionTime={block.executionTime}
                              isUndone={block.isUndone}
                              onUndo={handleToolCallUndo}
                            />
                          );
                        }
                        if (block.type === 'plan') {
                          return (
                            <PlanCard
                              key={block.id || `plan-${i}`}
                              steps={block.steps}
                              frozen={!!block.frozen}
                            />
                          );
                        }
                        if (block.type === 'thinking' && block.content) {
                          return (
                            <ThinkingBlock
                              key={`think-${i}`}
                              content={block.content}
                              contentHtml={block.collapsed ? renderMarkdown(block.content) : undefined}
                              collapsed={!!block.collapsed}
                            />
                          );
                        }
                        if (block.type === 'system_note' && block.content) {
                          return (
                            <div key={`note-${i}`} style={{ fontSize: '11px', opacity: 0.5, fontStyle: 'italic', padding: '4px 0', userSelect: 'text' }}>
                              {block.content}
                            </div>
                          );
                        }
                        return null;
                      })
                    ) : message.content ? (
                      /* Fallback for old-format messages without contentBlocks */
                      <div
                        className="ai-message-text"
                        style={{ userSelect: 'text', cursor: 'text' }}
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(renderMarkdown(message.content)) }}
                      />
                    ) : message.isStreaming ? (
                      <span className="ai-thinking-dots">
                        <span>•</span><span>•</span><span>•</span>
                      </span>
                    ) : null}
                    {hasDefinitiveContent && <div className="ai-message-timestamp" style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', justifyContent: message.sender === 'user' ? 'flex-end' : 'flex-start' }}>
                      {new Date(message.timestamp).toLocaleTimeString()}
                      {message.sender === 'user' && (
                        <button
                          onClick={() => {
                            setChatUndoMessageId(message.id);
                            setIsChatUndoOpen(true);
                          }}
                          style={{
                            background: 'transparent', border: 'none', color: theme.canvas.textPrimary,
                            padding: '0', cursor: 'pointer', opacity: 0.8, display: 'flex', alignItems: 'center',
                            marginTop: '-2px'
                          }}
                          title="Revert conversation to here"
                        >
                          <Undo2 size={16} />
                        </button>
                      )}
                      {message.sender === 'ai' && (
                        <button
                          onClick={() => {
                            const formatPlanSteps = (steps) => {
                              const done = steps.filter(s => s.status === 'done').length;
                              const lines = [`Plan (${done}/${steps.length})`];
                              for (const step of steps) {
                                const icon = step.status === 'done' ? '✓' : step.status === 'in_progress' ? '▸' : '○';
                                lines.push(`${icon} ${step.description}`);
                                if (step.substeps) {
                                  for (const sub of step.substeps) {
                                    const si = sub.status === 'done' ? '✓' : sub.status === 'in_progress' ? '▸' : '○';
                                    lines.push(`  ${si} ${sub.description}`);
                                  }
                                }
                              }
                              return lines.join('\n');
                            };
                            const parts = [];
                            if (message.contentBlocks && message.contentBlocks.length > 0) {
                              for (const block of message.contentBlocks) {
                                if (block.type === 'text' && block.content) {
                                  parts.push(block.content);
                                } else if (block.type === 'plan' && block.steps) {
                                  parts.push(formatPlanSteps(block.steps));
                                } else if (block.type === 'tool_call' && block.error) {
                                  parts.push(`Error: ${typeof block.error === 'string' ? block.error : JSON.stringify(block.error)}`);
                                }
                              }
                            } else if (message.content) {
                              parts.push(message.content);
                            }
                            navigator.clipboard.writeText(parts.join('\n\n'));
                          }}
                          style={{
                            background: 'transparent', border: 'none', color: theme.canvas.textPrimary,
                            padding: '0', cursor: 'pointer', opacity: 0.8, display: 'flex', alignItems: 'center',
                            marginTop: '-2px'
                          }}
                          title="Copy message"
                        >
                          <Copy size={16} />
                        </button>
                      )}
                    </div>}
                  </div>
                </div>
              );
            })}
            {isProcessing && (() => {
              // Find the streaming message to check if it has content
              const streamingMsg = messages.find(m => m.isStreaming);
              const hasStreamingContent = streamingMsg && (streamingMsg.contentBlocks?.length > 0);

              // Definitive content = something visible is already rendered in the bubble.
              // When there's no definitive content, the bubble itself shows inline dots —
              // suppress the external dots row to avoid duplication.
              const streamingMsgHasDefinitiveContent = streamingMsg?.contentBlocks?.some(b =>
                (b.type === 'text' && b.content) ||
                (b.type === 'tool_call' && b.name !== 'planTask') ||
                b.type === 'plan' ||
                (b.type === 'thinking' && b.content) ||
                (b.type === 'system_note' && b.content)
              ) || !!streamingMsg?.content;
              const hasInlineDots = streamingMsg && !streamingMsgHasDefinitiveContent;

              // Show thinking dots:
              // - Chat/druid: when no streaming content yet (original behavior)
              // - Wizard: hide only when text is actively streaming back (tool calls still show dots)
              //   Also show when the last block is a completed tool call — the model just finished
              //   executing a tool and is now thinking about what to do next (between iterations).
              const hasStreamingText = streamingMsg?.contentBlocks?.some(b => b.type === 'text' && b.content);
              const hasActiveThinking = streamingMsg?.contentBlocks?.some(b => b.type === 'thinking' && !b.collapsed);
              const lastContentBlock = streamingMsg?.contentBlocks?.[streamingMsg.contentBlocks.length - 1];
              // Show dots when the last block is a completed tool_call OR a plan card —
              // plan cards are always pushed after planTask completes, so they signal the
              // same "model finished something, now thinking about the next step" state.
              const awaitingNextIteration =
                (lastContentBlock?.type === 'tool_call' && (lastContentBlock?.status === 'completed' || lastContentBlock?.status === 'failed')) ||
                lastContentBlock?.type === 'plan';
              // Suppress external dots when inline bubble dots are already showing.
              // Hide dots while thinking is actively streaming — the thinking block itself
              // shows progress. Show once thinking collapses (response is starting).
              const showDots = !hasInlineDots && (viewMode === 'wizard'
                ? (!hasStreamingText || awaitingNextIteration) && !hasActiveThinking
                : !hasStreamingContent);

              if (viewMode === 'wizard') {
                // Always render in wizard mode to keep WizardLoadingText mounted
                // (unmounting resets the scramble animation timer, so transitions never play)
                return (
                  <div className="ai-thinking-row" style={showDots ? undefined : { display: 'none' }}>
                    <div className="ai-message-avatar"><img src={headSvg} alt="Wizard" style={{ width: 40, height: 40 }} /></div>
                    <WizardLoadingText />
                    <span className="ai-thinking-dots">
                      <span>•</span>
                      <span>•</span>
                      <span>•</span>
                    </span>
                  </div>
                );
              }

              if (showDots) {
                return (
                  <div className="ai-thinking-row">
                    <div className="ai-message-avatar"><img src={headSvg} alt="Wizard" style={{ width: 40, height: 40 }} /></div>
                    <span className="ai-thinking-dots">
                      <span>•</span>
                      <span>•</span>
                      <span>•</span>
                    </span>
                  </div>
                );
              }
              return null;
            })()}
            <div ref={messagesEndRef} />
          </div>

          {(() => {
            const lastMessage = messages[messages.length - 1];
            if (!lastMessage || lastMessage.sender !== 'ai' || !lastMessage.contentBlocks) return null;

            // Find the last tool call in this message
            const toolCalls = lastMessage.contentBlocks.filter(b => b.type === 'tool_call');
            const lastBlock = toolCalls[toolCalls.length - 1];

            if (lastBlock && lastBlock.name === 'askMultipleChoice' && lastBlock.result && lastBlock.result.__requiresUserInput && !lastBlock.isUndone && !lastBlock.isDismissed) {
              return (
                <MultipleChoiceOverlay
                  question={lastBlock.result.question}
                  options={lastBlock.result.options}
                  onSelect={(option) => {
                    // We don't need to change currentInput, we just send it
                    setCurrentInput('');
                    handleSendMessage(option);
                  }}
                  onDismiss={() => {
                    upsertToolCall({ id: lastBlock.id, isDismissed: true });
                  }}
                />
              );
            }
            return null;
          })()}

          {/* Persistent context chips (node-style) */}
          <div className="ai-context-bar">
            {/* Attach "+" button with upward dropdown */}
            <div ref={attachMenuRef} style={{ position: 'relative', display: 'inline-flex' }}>
              <PanelIconButton
                icon={Plus}
                size={16}
                onClick={() => setShowAttachMenu(!showAttachMenu)}
                title="Add files or photos"
                active={showAttachMenu}
              />
              {showAttachMenu && (
                <div className="ai-attach-menu" style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  marginBottom: 4,
                  background: '#DEDADA',
                  border: '2px solid maroon',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                  zIndex: 1000,
                  minWidth: 180,
                  overflow: 'hidden',
                }}>
                  <button
                    className="ai-attach-menu-item"
                    onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '8px 12px',
                      background: 'none', border: 'none',
                      color: 'maroon',
                      fontSize: '0.85rem', fontFamily: "'EmOne', sans-serif", fontWeight: 'bold',
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'background-color 0.1s ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(128, 0, 0, 0.1)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <Paperclip size={14} color="maroon" /> Add Files or Photos
                  </button>
                </div>
              )}
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/gif,image/webp,.txt,.md,.json,.csv,.tsv,.xlsx,.xls,.pdf,application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files?.length) handleFilesSelected(Array.from(e.target.files));
                e.target.value = '';
              }}
            />

            {/* Pending attachment chips (per-message, stick out to the right of +) */}
            {pendingAttachments.map(att => (
              <span key={att.id} className="ai-context-chip active ai-attachment-chip">
                {att.category === 'image' && att.previewUrl && (
                  <img src={att.previewUrl} alt="" className="ai-attachment-thumb" />
                )}
                {att.category === 'document' && <FileText size={12} />}
                <span className="ai-attachment-name">{att.name} ({att.category === 'image' ? 'Image' : 'File'})</span>
                <button
                  className="ai-attachment-remove"
                  onClick={() => setPendingAttachments(prev => prev.filter(a => a.id !== att.id))}
                  title={`Remove ${att.name}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}

            {/* Existing context chips */}
            {contextItems.map((item, idx) => (
              <button
                key={item.type + idx}
                className={`ai-context-chip ${item.enabled ? 'active' : 'disabled'}`}
                style={item.color && item.enabled ? {
                  backgroundColor: item.color,
                  color: getTextColor(item.color),
                  borderColor: item.color,
                } : undefined}
                onClick={() => {
                  setContextItems(prev => prev.map((ci, i) =>
                    i === idx ? { ...ci, enabled: !ci.enabled } : ci
                  ));
                }}
                title={item.enabled ? `Click to exclude ${item.label} from context` : `Click to include ${item.label} in context`}
              >
                <span className="ai-context-chip-label">{item.label}</span>
                <span className="ai-context-chip-toggle">{item.enabled ? '×' : '+'}</span>
              </button>
            ))}
            {messages.length > 0 && (
              <div className="ai-context-usage" title={`~${contextUsage.totalUsed.toLocaleString()} / ${contextUsage.contextWindow.toLocaleString()} tokens used`}>
                <div className="ai-context-usage-bar">
                  <div
                    className={`ai-context-usage-fill${contextUsage.percent >= 80 ? ' warning' : ''}${contextUsage.percent >= 95 ? ' critical' : ''}`}
                    style={{ width: `${contextUsage.percent}%` }}
                  />
                </div>
                <span className="ai-context-usage-label">{contextUsage.percent}%</span>
              </div>
            )}
          </div>

          <div className="ai-input-container" style={{ marginBottom: toggleClearance }}>
            <textarea ref={inputRef} value={currentInput} onChange={(e) => {
              setCurrentInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
            }} onKeyPress={handleKeyPress} placeholder={viewMode === 'druid' ? "Share an observation and I'll build upon it..." : viewMode === 'wizard' ? "Ask anything and I'll cast my spells..." : "Ask me anything about your Universe..."} disabled={isProcessing} className="ai-input" rows={1} />
            {isProcessing && currentAgentRequest ? (
              <button onClick={handleStopAgent} className="ai-stop-button" title="Stop Agent"><Square /></button>
            ) : (
              <button onClick={handleSendMessage} disabled={(!currentInput.trim() && pendingAttachments.length === 0) || isProcessing} className="ai-send-button"><Send /></button>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};

export default LeftAIView;
