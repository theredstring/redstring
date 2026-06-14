---
compendium_version: 1
category: ai-agent-mcp
last_reviewed: 2026-06-13
---

# AI Agent and MCP — Document Index

## Summary

These documents cover the Wizard AI agent, the MCP (Model Context Protocol) server, the bridge daemon that connects Redstring's Zustand store to MCP tools, prompt engineering, and external AI client integration. The Wizard is Redstring's built-in agentic system; MCP is the protocol through which external AI clients (Claude Desktop, etc.) control the graph. Key code paths: `src/wizard/`, `redstring-mcp-server.js`, `src/services/BridgeClient.jsx`, `src/wizard/tools/`, `src/wizard/AgentLoop.js`.

**Critical cross-reference**: See [`MEMORY.md`](../../.claude/projects/-Users-granteubanks-Code-redstringuireact/memory/MEMORY.md) for session-persistent rules about MCP serialization pitfalls, stdio transport constraints, and predictive ID mismatches — those rules are derived from hard-won bugs and must be followed.

---

## Current Documents

| File | Summary | Key for |
|------|---------|---------|
| [AI_INTEGRATION_GUIDE.md](../AI_INTEGRATION_GUIDE.md) | Comprehensive MCP provider/client architecture, search-first orchestration pattern, tool categories, agent lifecycle | Any MCP work; foundational architecture read |
| [MCP_SETUP_GUIDE.md](../MCP_SETUP_GUIDE.md) | Step-by-step MCP server setup with Claude Desktop | First-time MCP configuration |
| [MCP_TOOLS_QUICK_REFERENCE.md](../MCP_TOOLS_QUICK_REFERENCE.md) | Quick reference table of all available MCP tool names, types, and signatures | Looking up tool names and parameter shapes |
| [REDSTRING_MCP_SYSTEM_PROMPT.md](../REDSTRING_MCP_SYSTEM_PROMPT.md) | The actual system prompt text to paste into an external AI client connecting via MCP | Configuring Claude Desktop or any external MCP client |
| [CLAUDE_DESKTOP_SETUP.md](../CLAUDE_DESKTOP_SETUP.md) | How to connect Claude Desktop to Redstring's MCP server | Setting up Claude Desktop integration |
| [CLAUDE_DESKTOP_ALTERNATIVE.md](../CLAUDE_DESKTOP_ALTERNATIVE.md) | Alternative connection methods when the standard setup doesn't work | Troubleshooting Claude Desktop connectivity |
| [AI_CONNECTION_GUIDE.md](../AI_CONNECTION_GUIDE.md) | Connecting other external AI clients to Redstring | Non-Claude MCP clients |
| [AI_GUIDED_WORKFLOW.md](../AI_GUIDED_WORKFLOW.md) | Workflow types available via MCP: knowledge building, semantic enrichment, auto-layout | Understanding what the Wizard can do |
| [AI_TESTING_GUIDE.md](../AI_TESTING_GUIDE.md) | Testing and debugging AI integration: test modes, expected outputs, common failures | Validating AI integration |
| [WIZARD_TESTING_GUIDE.md](../WIZARD_TESTING_GUIDE.md) | Running Wizard E2E tests, test suite structure, how to add tests | Testing the Wizard specifically |
| [AI_INTEGRATION_TROUBLESHOOTING.md](../AI_INTEGRATION_TROUBLESHOOTING.md) | Common AI integration failures and their resolutions | Debugging broken MCP connections or tool call failures |

---

## Historical Documents

Read these for context when working in the relevant area. Code already incorporates the described changes — do not treat them as current spec.

| File | Summary | Consult when |
|------|---------|--------------|
| [AGENTIC_ARCHITECTURE.md](../AGENTIC_ARCHITECTURE.md) | Explains the Planner/Executor/Auditor/Committer pipeline shape, context management, connection naming fix | Understanding why the pipeline is structured the way it is; debugging stage-transition behavior |
| [AGENTIC_BATCHING.md](../AGENTIC_BATCHING.md) | Documents how the agentic batching loop was built: token budget, retry logic, tool-call batching | Modifying the Wizard's inner loop in `AgentLoop.js` |
| [PROMPT_ENGINEERING.md](../PROMPT_ENGINEERING.md) | What was added to Wizard prompts and why: thinking tags, search-first instructions, anti-hallucination constraints | Modifying `WizardPrompt.js` or system prompt construction |
| [SELF_DIRECTED_DECOMPOSITION.md](../SELF_DIRECTED_DECOMPOSITION.md) | Documents when and how autonomous iteration was implemented | Understanding Wizard's self-directed task decomposition |
| [TOOL_CALL_VISIBILITY.md](../TOOL_CALL_VISIBILITY.md) | Documents fix for UI not receiving tool-call completion events from the bridge | Debugging silent Wizard runs (no UI updates) |
| [COMPLETION_IMPROVEMENTS.md](../COMPLETION_IMPROVEMENTS.md) | Completion message formatting and next-steps suggestion improvements | Modifying Wizard response formatting |
| [READ_THEN_CREATE.md](../READ_THEN_CREATE.md) | Documents the read-then-create orchestration pattern added to bridge-daemon; explains the "yes-and" approach | Understanding why createNode is always preceded by a search |
| [ITERATION_FIXES.md](../ITERATION_FIXES.md) | MAX_ITERATIONS reduction and smart stopping implementation | Diagnosing runaway Wizard loops |
| [WIZARD_FIXES.md](../WIZARD_FIXES.md) | Post-thinking greeting bug and continuation hallucination fixes | Debugging Wizard response anomalies |
| [WIZARD_ANALYSIS.md](../WIZARD_ANALYSIS.md) | Broad analysis of the Wizard as a product and Redstring as a platform; still accurate as high-level positioning | Understanding strategic context; writing positioning copy |
| [WIZARD_AUTO_LAYOUT_TEST.md](../WIZARD_AUTO_LAYOUT_TEST.md) | Documents Wizard + auto-layout integration: test cases, expected behavior | Testing Wizard-triggered layout |
| [AI_INTEGRATION_SUMMARY.md](../AI_INTEGRATION_SUMMARY.md) | Before/after summary of the AI integration work — **superseded-by: AI_INTEGRATION_GUIDE.md** | Historical reference only; prefer AI_INTEGRATION_GUIDE.md |
| [walkthrough.md](../walkthrough.md) | Documents Wizard runtime fixes, new MCP tools added, test run results from a specific session | Understanding which tools were added and why; reviewing historical test results |

---

## Future-Intent Documents

| File | Summary | Note |
|------|---------|------|
| [AGENT_ARCHITECTURE_VISION.md](../AGENT_ARCHITECTURE_VISION.md) | Hierarchical multi-agent system: specialized sub-agents, orchestration layer, agent-to-agent communication | **No code exists yet** — vision only; do not assume any implementation |
