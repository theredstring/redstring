# Wizard AI Fixes - Context Loss & Hallucination

## Issues Fixed

### 1. **Post-Thinking Redundant Greetings**
**Problem**: Thinking models (o1/o3) would complete work, then add a greeting as if the conversation was just starting.

**Example**:
```
User: let's do something entirely new!
System: Added 8 nodes: Zeus, Hera, Poseidon...
AI: Done! The graph now has 8 nodes and 9 connections.
    Greetings! I see we have the 'Apostles' graph open. Shall we deepen our study...
```

**Root Cause**: The AI wasn't aware that tools had already been executed during the thinking phase.

**Fix**: Added explicit instruction in `bridge-daemon.js` (line 189):
```javascript
- CRITICAL (Thinking Models): If you have already executed tools or created content in response to the user's request, DO NOT add a greeting or "how can I help" message afterward. Simply acknowledge what was done (e.g., "Done! Added 8 nodes and 9 connections to the Greek Gods graph."). Never greet the user AFTER completing work.
```

---

### 2. **Continuation Loop Hallucination**
**Problem**: During multi-iteration building (iterations 2-5), the AI would completely lose context and hallucinate unrelated content.

**Example**:
```
User: sure do that (add more Olympian gods)
AI: I'll summon Apollo, Artemis, Hermes, and Hephaestus...
System: Added 2 nodes: Hermes, Hephaestus ✅
System: Continuing... (iteration 1/5)
System: Added 3 nodes: Ada Lovelace, Grace Hopper, John von Neumann ❌ (HALLUCINATION!)
System: Continuing... (iteration 2/5)
System: Added 2 nodes: Algorithm, Debugging ❌ (HALLUCINATION!)
```

**Root Cause**: The continuation prompt in `/api/ai/agent/continue` didn't include:
- The original user request ("add Apollo, Artemis, Hermes, Hephaestus")
- The graph name ("Olympian Gods")
- The conversation history

So the AI only saw:
```
Previous action: unknown
Current graph state: 2 nodes
Example nodes: Hermes, Hephaestus
```

And had NO IDEA what it was supposed to be building.

**Fixes**:

#### A. Updated Continuation Prompt (`bridge-daemon.js` lines 1059-1110)
Added critical context to the continuation prompt:
```javascript
const originalMessage = body.originalMessage || body.message || 'expand the graph';
const graphName = graphState?.name || 'the graph';
const conversationContext = Array.isArray(body.conversationHistory) && body.conversationHistory.length > 0
  ? '\n\n📝 CONVERSATION CONTEXT:\n' + body.conversationHistory.slice(-3).map(msg => `${msg.role === 'user' ? 'User' : 'You'}: ${msg.content}`).join('\n')
  : '';

continuePrompt = `
AGENTIC LOOP ITERATION ${iteration + 1}/${MAX_ITERATIONS}

🎯 ORIGINAL USER REQUEST: "${originalMessage}"
📊 GRAPH NAME: "${graphName}"
${conversationContext}

CRITICAL INSTRUCTIONS:
1. STAY ON TOPIC: You are building "${graphName}" based on the user's request: "${originalMessage}"
2. DO NOT HALLUCINATE: Only add nodes that are directly relevant to the user's request
3. CHECK EXISTING NODES: Review the "Example nodes" list above to avoid duplicates
4. SEMANTIC RELEVANCE: Every new node should help answer "What is ${graphName}?" or fulfill the user's request
...
```

#### B. Pass Context from Committer (`Committer.js` lines 390-391)
Updated the continuation call to include the original message and conversation history:
```javascript
body: JSON.stringify({
  cid: threadId,
  lastAction: { type: 'create_subgraph', nodeCount, edgeCount },
  graphState,
  iteration: currentIteration,
  originalMessage: unseen[0]?.meta?.originalMessage || unseen[0]?.meta?.message || 'expand the graph',  // CRITICAL
  conversationHistory: unseen[0]?.meta?.conversationHistory || [],  // CRITICAL
  apiConfig: apiConfig ? {
    provider: apiConfig.provider,
    endpoint: apiConfig.endpoint,
    model: apiConfig.model
  } : null,
  meta: unseen[0]?.meta
})
```

#### C. Store Context in Goal Metadata (`bridge-daemon.js` lines 2331-2332)
When the initial goal is enqueued, store the original message and conversation history:
```javascript
meta: {
  iteration: 0,
  agenticLoop: true,
  chainState: body.context?.chainState,
  apiKey: req.headers.authorization?.replace(/^Bearer\s+/i, ''),
  apiConfig: body.context?.apiConfig,
  originalMessage: body.message,  // CRITICAL: Store original user request
  conversationHistory: body.conversationHistory || []  // CRITICAL: Store conversation context
}
```

---

## 3. **Bizarre Colors in Continuation Loop**
**Problem**: During iterations 2-5, nodes were created with strange, inconsistent colors that didn't match the user's existing palette.

**Root Cause**: The continuation endpoint (`/api/ai/agent/continue`) had a **different** `extractColorPalette()` function than the initial request endpoint. The continuation version:
- Only returned the user's existing colors (up to 10)
- Did NOT calculate `avgHue`
- Did NOT generate new harmonious colors

So if the user had only 2-3 existing colors, the AI would be forced to reuse those same colors repeatedly, or worse, pick random colors not in the palette.

**Fix**: Updated the continuation endpoint to use the **same color generation logic** as the initial request:

```javascript
// Calculate average hue from existing colors
const hues = uniqueColors.map(color => {
  // RGB to HSV conversion
  const r = parseInt(color.slice(1, 3), 16) / 255;
  const g = parseInt(color.slice(3, 5), 16) / 255;
  const b = parseInt(color.slice(5, 7), 16) / 255;
  // ... hue calculation
  return h;
});

const avgHue = Math.round(hues.reduce((a, b) => a + b, 0) / hues.length);

// Generate spectrum colors around the average hue
const generateSpectrumColors = (basePalette) => {
  const userColors = basePalette?.colors || [];
  if (userColors.length >= 8) return userColors;
  
  // Generate colors ±90° around average hue
  const baseHue = basePalette.avgHue;
  const hueSteps = [
    (baseHue - 90 + 360) % 360,
    (baseHue - 60 + 360) % 360,
    // ... more hue steps
  ];
  
  // Convert hues to hex colors
  const generatedColors = hueSteps.map(h => {
    // HSV to RGB conversion
    // ...
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  });
  
  return [...userColors, ...generatedColors].slice(0, 12);
};
```

Now the continuation loop generates **harmonious colors** that match the user's existing palette style, instead of bizarre random colors.

**File Modified**: `bridge-daemon.js` (lines 951-1040)

---

## Testing

To test these fixes:

1. **Restart the bridge daemon** to apply the prompt changes:
   ```bash
   npm run bridge
   ```

2. **Test thinking model greeting suppression**:
   - Use a thinking model (o1/o3)
   - Ask: "create a graph about Greek mythology"
   - Verify: No redundant greeting after "Done!" message

3. **Test continuation context preservation**:
   - Ask: "create a graph about Olympian Gods"
   - Then: "add more gods" (should trigger multi-iteration)
   - Verify: All iterations add relevant Olympian gods, not random topics

4. **Test color consistency**:
   - Create a graph with 2-3 nodes (establishes color palette)
   - Ask: "add more nodes" (triggers continuation)
   - Verify: New nodes have harmonious colors that match the existing palette

---

## Files Modified

1. **`bridge-daemon.js`**:
   - Line 189: Added thinking model greeting suppression instruction
   - Lines 951-1040: Fixed color palette extraction and generation in continuation loop
   - Lines 1059-1110: Enhanced continuation prompt with original request and graph name
   - Lines 2331-2332: Store originalMessage and conversationHistory in goal metadata

2. **`src/services/Committer.js`**:
   - Lines 390-391: Pass originalMessage and conversationHistory to continuation endpoint

---

## Color Issue (Separate Bug)

The user also mentioned "bizarre colors" during iterations. This is likely a separate issue related to color palette extraction or generation in the continuation loop. The color palette is extracted from existing prototypes, but if the palette is empty or the generation logic is flawed, it could produce unexpected colors.

**Next Steps**: Investigate color generation in `bridge-daemon.js` around lines 1583-1650 (extractColorPalette and generateSpectrumColors functions).
