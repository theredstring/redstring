---
compendium_version: 1
category: ai-agent-mcp
last_reviewed: 2026-08-27
---

# AI Agent and MCP — Document Index

## Summary

These documents cover the Wizard AI agent, the MCP (Model Context Protocol) server, the bridge daemon that connects Redstring's Zustand store to MCP tools, prompt engineering, and external AI client integration. The Wizard is Redstring's built-in agentic system; MCP is the protocol through which external AI clients (Claude Desktop, etc.) control the graph. Key code paths: `src/wizard/`, `redstring-mcp-server.js`, `src/services/BridgeClient.jsx`, `src/wizard/tools/`, `src/wizard/AgentLoop.js`.

**Two systems live here, and they are separate.** The **Wizard** is an agent loop with conversation state (`src/wizard/AgentLoop.js`). **One-shot calls** are stateless single-question model calls that replace heuristics (`src/services/oneShot.js`) — no loop, no state. Do not merge them.

**Critical cross-reference**: session-persistent rules about MCP serialization pitfalls, stdio transport constraints, and predictive ID mismatches live in the user's Claude Code project memory at `~/.claude/projects/-Users-granteubanks-Code-redstringuireact/memory/MEMORY.md` (outside this repo — not a relative path). Those rules are derived from hard-won bugs and must be followed.

---

## Current Documents

| File | Summary | Key for |
|------|---------|---------|
| [AI_INTEGRATION_GUIDE.md](../documentation/ai-agent-mcp/AI_INTEGRATION_GUIDE.md) | Comprehensive MCP provider/client architecture, search-first orchestration pattern, tool categories, agent lifecycle | Any MCP work; foundational architecture read |
| [ONE_SHOT_CALLS.md](../documentation/ai-agent-mcp/ONE_SHOT_CALLS.md) | The one-shot constrained-call pattern: the four-part design contract (null on failure, mandatory heuristic fallback, never throws, every call logged), the `oneShotChoice`/`Boolean`/`Label`/`List` primitives, and every wired call site across `src/wizard/tools/utils/`, `DuplicateManager.jsx`, and `NodeCanvas.jsx` | Adding or modifying any one-shot call; understanding `resolveNodeSmart`, shape classification, structure review, or suggestion prefills |
| [MCP_SETUP_GUIDE.md](../documentation/ai-agent-mcp/MCP_SETUP_GUIDE.md) | Step-by-step MCP server setup with Claude Desktop | First-time MCP configuration |
| [MCP_TOOLS_QUICK_REFERENCE.md](../documentation/ai-agent-mcp/MCP_TOOLS_QUICK_REFERENCE.md) | Quick reference table of all available MCP tool names, types, and signatures | Looking up tool names and parameter shapes |
| [REDSTRING_MCP_SYSTEM_PROMPT.md](../documentation/ai-agent-mcp/REDSTRING_MCP_SYSTEM_PROMPT.md) | The actual system prompt text to paste into an external AI client connecting via MCP | Configuring Claude Desktop or any external MCP client |
| [CLAUDE_DESKTOP_SETUP.md](../documentation/ai-agent-mcp/CLAUDE_DESKTOP_SETUP.md) | How to connect Claude Desktop to Redstring's MCP server | Setting up Claude Desktop integration |
| [CLAUDE_DESKTOP_ALTERNATIVE.md](../documentation/ai-agent-mcp/CLAUDE_DESKTOP_ALTERNATIVE.md) | Alternative connection methods when the standard setup doesn't work | Troubleshooting Claude Desktop connectivity |
| [AI_CONNECTION_GUIDE.md](../documentation/ai-agent-mcp/AI_CONNECTION_GUIDE.md) | Connecting other external AI clients to Redstring | Non-Claude MCP clients |
| [AI_GUIDED_WORKFLOW.md](../documentation/ai-agent-mcp/AI_GUIDED_WORKFLOW.md) | Workflow types available via MCP: knowledge building, semantic enrichment, auto-layout | Understanding what the Wizard can do |
| [AI_TESTING_GUIDE.md](../documentation/ai-agent-mcp/AI_TESTING_GUIDE.md) | Testing and debugging AI integration: test modes, expected outputs, common failures | Validating AI integration |
| [WIZARD_TESTING_GUIDE.md](../documentation/ai-agent-mcp/WIZARD_TESTING_GUIDE.md) | Running Wizard E2E tests, test suite structure, how to add tests | Testing the Wizard specifically |
| [AI_INTEGRATION_TROUBLESHOOTING.md](../documentation/ai-agent-mcp/AI_INTEGRATION_TROUBLESHOOTING.md) | Common AI integration failures and their resolutions | Debugging broken MCP connections or tool call failures |
| `../documentation/ai-agent-mcp/claude-redstring-system-prompt.txt` | A second external-client system prompt, referenced from `../documentation/ai-agent-mcp/CLAUDE_DESKTOP_SETUP.md`. Emphasises spatial reasoning (`get_spatial_map`, cluster detection, panel-aware positioning). ⚠️ **Overlaps heavily with `../documentation/ai-agent-mcp/REDSTRING_MCP_SYSTEM_PROMPT.md`** — two prompts for the same job, and editing one does not update the other. Reconcile them before relying on either | Configuring Claude Desktop; check both files when changing external-client prompt behavior |

---

## Historical Documents

Read these for context when working in the relevant area. Code already incorporates the described changes — do not treat them as current spec.

| File | Summary | Consult when |
|------|---------|--------------|
| [AGENTIC_ARCHITECTURE.md](../documentation/ai-agent-mcp/AGENTIC_ARCHITECTURE.md) | Explains the Planner/Executor/Auditor/Committer pipeline shape, context management, connection naming fix | Understanding why the pipeline is structured the way it is; debugging stage-transition behavior |
| [AGENTIC_BATCHING.md](../documentation/ai-agent-mcp/AGENTIC_BATCHING.md) | Documents how the agentic batching loop was built: token budget, retry logic, tool-call batching | Modifying the Wizard's inner loop in `AgentLoop.js` |
| [PROMPT_ENGINEERING.md](../documentation/ai-agent-mcp/PROMPT_ENGINEERING.md) | What was added to Wizard prompts and why: thinking tags, search-first instructions, anti-hallucination constraints | Modifying `WizardPrompt.js` or system prompt construction |
| [SELF_DIRECTED_DECOMPOSITION.md](../documentation/ai-agent-mcp/SELF_DIRECTED_DECOMPOSITION.md) | Documents when and how autonomous iteration was implemented | Understanding Wizard's self-directed task decomposition |
| [TOOL_CALL_VISIBILITY.md](../documentation/ai-agent-mcp/TOOL_CALL_VISIBILITY.md) | Documents fix for UI not receiving tool-call completion events from the bridge | Debugging silent Wizard runs (no UI updates) |
| [COMPLETION_IMPROVEMENTS.md](../documentation/ai-agent-mcp/COMPLETION_IMPROVEMENTS.md) | Completion message formatting and next-steps suggestion improvements | Modifying Wizard response formatting |
| [READ_THEN_CREATE.md](../documentation/ai-agent-mcp/READ_THEN_CREATE.md) | Documents the read-then-create orchestration pattern added to bridge-daemon; explains the "yes-and" approach | Understanding why createNode is always preceded by a search |
| [ITERATION_FIXES.md](../documentation/ai-agent-mcp/ITERATION_FIXES.md) | MAX_ITERATIONS reduction and smart stopping implementation | Diagnosing runaway Wizard loops |
| [WIZARD_FIXES.md](../documentation/ai-agent-mcp/WIZARD_FIXES.md) | Post-thinking greeting bug and continuation hallucination fixes | Debugging Wizard response anomalies |
| [WIZARD_ANALYSIS.md](../documentation/ai-agent-mcp/WIZARD_ANALYSIS.md) | Broad analysis of the Wizard as a product and Redstring as a platform; still accurate as high-level positioning | Understanding strategic context; writing positioning copy |
| [WIZARD_AUTO_LAYOUT_TEST.md](../documentation/ai-agent-mcp/WIZARD_AUTO_LAYOUT_TEST.md) | Documents Wizard + auto-layout integration: test cases, expected behavior | Testing Wizard-triggered layout |

> **Removed 2026-08-27** (recoverable from git history): `AI_INTEGRATION_SUMMARY.md` (superseded by `../documentation/ai-agent-mcp/AI_INTEGRATION_GUIDE.md`), `walkthrough.md` (a session transcript), and the four small-model handoff prompts `ONESHOT_HANDOFF{,_2,_3}.md` + `SMALL_MODEL_FIXES_HANDOFF.md`. The handoffs were task instructions for an agent, not documentation, and all their work shipped — verified against `src/services/oneShot.js`, the seven `src/wizard/tools/utils/` modules, `strictRequired` in `LLMClient.js:250`, and the small-model `planTask` tier exclusion at `schemas.js:1252`. Their durable content is now `../documentation/ai-agent-mcp/ONE_SHOT_CALLS.md` (what was built) and `../documentation/ai-agent-mcp/SMALL_MODEL_ROADMAP.md` (what wasn't).

---

## Future-Intent Documents

| File | Summary | Note |
|------|---------|------|
| [AGENT_ARCHITECTURE_VISION.md](../documentation/ai-agent-mcp/AGENT_ARCHITECTURE_VISION.md) | Hierarchical multi-agent system: specialized sub-agents, orchestration layer, agent-to-agent communication | **No code exists yet** — vision only; do not assume any implementation |
| [SMALL_MODEL_ROADMAP.md](../documentation/ai-agent-mcp/SMALL_MODEL_ROADMAP.md) | Backlog of heuristics that are candidates for one-shot replacement, each with file and approximate line references: tool-tier keyword gating (`schemas.js`), `cognitiveAgent.js` keyword NLU, Wikipedia disambiguation, tabular column detection, reuse-selector ranking (`UnifiedSelector.jsx`), entity-matching fuzzy verdicts, semantic-web ranking, merge survivor recommendation, semantic seed selection, and the AgentLoop task-like check | **Not implemented.** Line references were accurate when written — re-verify before starting. Follow the contract in `../documentation/ai-agent-mcp/ONE_SHOT_CALLS.md` for anything built from this list |
