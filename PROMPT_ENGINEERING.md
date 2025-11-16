# Prompt Engineering for The Wizard

## Core Philosophy

> "Prompting is half the battle" - User feedback

The Wizard's effectiveness depends on **two critical elements**:
1. **Clear naming conventions** (so the LLM knows what format to use)
2. **Pipeline understanding** (so the LLM knows its role and limitations)

---

## What We Added to the Prompt

### 1. **Comprehensive Naming Conventions**

#### Before:
```
CONNECTION NAMING RULES:
1. ALWAYS use Title Case with spaces for definitionNode.name
```

#### After:
```
NAMING CONVENTIONS (CRITICAL - READ CAREFULLY):
Redstring is a visual knowledge tool. Users see node names and connection 
labels directly in the UI as human-readable text, not code identifiers. 
Your naming choices directly impact usability.

DEFAULT FORMAT: Title Case With Spaces
- Node names: "Taylor Swift", "College of Engineering", "Avengers Initiative"
- Connection names: "Romantic Partnership", "Inner Circle Bond", "Coaching Relationship"

WHY THIS MATTERS:
1. Visual clarity: Names appear as labels in the graph canvas
2. Fuzzy matching: The system uses string similarity to prevent duplicates
3. Searchability: Users search by name, so "Iron Man" is more intuitive than "iron_man"
4. Consistency: Title Case creates uniform visual appearance

EXCEPTIONS (Use When Appropriate):
- Technical terms: "CPU Architecture", "HTTP Protocol", "DNA Replication"
- Proper nouns: "NASA", "FBI", "PhD Program"
- Acronyms: Keep as-is if commonly written that way (e.g., "NASA", not "Nasa")
- Brand names: Match official capitalization (e.g., "iPhone", "PlayStation")

NEVER USE:
❌ snake_case: "romantic_partnership", "inner_circle_bond"
❌ camelCase: "romanticPartnership", "innerCircleBond"  
❌ ALL_CAPS: "ROMANTIC_PARTNERSHIP" (unless it's an acronym like "NASA")
❌ lowercase: "romantic partnership" (harder to read at small scale)

EXAMPLES BY DOMAIN:
Family: "Parent-Child Bond", "Sibling Rivalry", "Extended Family"
Tech: "API Integration", "Database Connection", "Cloud Infrastructure"
Sports: "Team Captain", "Coaching Staff", "Home Stadium"
Business: "Executive Team", "Board Member", "Strategic Partnership"
```

**Key Improvement**: 
- ✅ Explains **WHY** (visual clarity, fuzzy matching, searchability)
- ✅ Covers **both nodes and connections** (not just connections)
- ✅ Provides **domain-specific examples** (Family, Tech, Sports, Business)
- ✅ Lists **exceptions** (NASA, iPhone, CPU)
- ✅ Shows **what NOT to do** (snake_case, camelCase, ALL_CAPS)

---

### 2. **Pipeline Architecture Explanation**

#### Before:
```
Redstring domain quick reference
- Graph: a workspace (tab).
- Node prototype (concept): a reusable concept definition (name, color).
- Node instance: a placed occurrence of a prototype inside a graph (with x,y,scale).
```

#### After:
```
HOW THE PIPELINE WORKS (Your Role):
You are the PLANNER in a multi-stage orchestration pipeline:

1. PLANNER (You): Decide WHAT to create (node names, relationships, colors) - NO spatial reasoning
2. EXECUTOR: Generates deterministic operations (auto-layout algorithm calculates x/y positions)
3. AUDITOR: Validates operations (schema checks, fuzzy deduplication at 80% similarity)
4. COMMITTER: Applies operations to UI (React state updates)
5. CONTINUATION: Checks if more work needed (agentic loop, max 5 iterations)

YOUR JOB: Focus on SEMANTIC data (names, relationships, colors, descriptions). The system handles:
- Spatial layout (force-directed, hierarchical, radial algorithms)
- Duplicate prevention (fuzzy matching like "Avengers" ≈ "The Avengers")
- UI updates (React mutations, graph rendering)
- Iteration control (auto-continuation until complete)

THINK IN BATCHES: Generate 5-8 nodes per iteration. The system will ask "should I continue?" 
after each batch. If the user wants a large graph, start with core concepts, then the system 
auto-continues with related concepts.
```

**Key Improvement**:
- ✅ Explicitly states **the LLM's role** (PLANNER, not executor)
- ✅ Explains **what the LLM should NOT do** (spatial reasoning, x/y positions)
- ✅ Clarifies **what the system handles automatically** (layout, deduplication, UI updates)
- ✅ Encourages **batch thinking** (5-8 nodes per iteration, not 50 at once)
- ✅ Mentions **agentic loop** (system auto-continues until complete)

---

## Why This Matters

### Before: LLM Was Confused
```json
{
  "nodes": [
    {"name": "romantic_partnership"},  // ❌ snake_case
    {"name": "inner circle bond"},     // ❌ lowercase
    {"name": "TEAM_AFFILIATION"}       // ❌ ALL_CAPS
  ]
}
```

**Result**: Visual inconsistency, fuzzy matching failures, poor searchability

### After: LLM Understands Context
```json
{
  "nodes": [
    {"name": "Romantic Partnership"},  // ✅ Title Case
    {"name": "Inner Circle Bond"},     // ✅ Title Case
    {"name": "Team Affiliation"}       // ✅ Title Case
  ]
}
```

**Result**: Visual consistency, fuzzy matching works, intuitive search

---

## The "Prompting is Half the Battle" Principle

### What Makes a Good LLM Prompt for Redstring:

1. **Explain the "Why"** (not just the "What")
   - ❌ "Use Title Case for connection names"
   - ✅ "Use Title Case because names appear as labels in the graph canvas, and fuzzy matching relies on consistent formatting"

2. **Show Examples** (don't just describe)
   - ❌ "Make names human-readable"
   - ✅ "Examples: 'Romantic Partnership' (good), 'romantic_partnership' (bad)"

3. **Clarify Roles** (what the LLM does vs what the system does)
   - ❌ "Generate nodes and edges"
   - ✅ "You generate node names and relationships. The system calculates x/y positions using auto-layout algorithms."

4. **Provide Domain Context** (show the LLM how different domains work)
   - ❌ "Name nodes appropriately"
   - ✅ "Family: 'Parent-Child Bond', Tech: 'API Integration', Sports: 'Team Captain'"

5. **Set Constraints** (boundaries prevent hallucination)
   - ❌ "Generate a graph"
   - ✅ "Generate 5-8 nodes per iteration. The system will auto-continue for larger graphs."

---

## Prompt Evolution Timeline

### v1: Basic Instruction
```
Respond with JSON. Create nodes and edges.
```
**Problem**: LLM used inconsistent naming, no understanding of pipeline

### v2: Format-Focused
```
Use Title Case for connection names.
```
**Problem**: Only covered connections, not nodes. No explanation of WHY.

### v3: Comprehensive (Current)
```
NAMING CONVENTIONS (CRITICAL - READ CAREFULLY):
Redstring is a visual knowledge tool. Users see node names and connection labels 
directly in the UI as human-readable text, not code identifiers. Your naming 
choices directly impact usability.

DEFAULT FORMAT: Title Case With Spaces
[... full section ...]

HOW THE PIPELINE WORKS (Your Role):
You are the PLANNER in a multi-stage orchestration pipeline:
[... full section ...]
```
**Result**: LLM understands its role, naming impact, and system capabilities

---

## Testing the Prompt

### Test Case 1: Naming Consistency
**User**: "make a graph of the Marvel Universe"

**Expected Output**:
```json
{
  "nodes": [
    {"name": "Avengers Initiative"},      // ✅ Title Case
    {"name": "Strategic Homeland"},        // ✅ Title Case
    {"name": "S.H.I.E.L.D."}              // ✅ Acronym exception
  ],
  "edges": [
    {
      "definitionNode": {
        "name": "Team Affiliation"         // ✅ Title Case
      }
    }
  ]
}
```

### Test Case 2: Batch Thinking
**User**: "make a comprehensive graph of all 50 US states"

**Expected Behavior**:
- Iteration 0: 8 states (core examples: California, New York, Texas...)
- Continuation: "Should I add more states?"
- Iteration 1: 8 more states (Florida, Illinois, Pennsylvania...)
- [Repeats until complete or max 5 iterations]

**NOT Expected**:
- Trying to generate all 50 states at once (token limit would truncate)

### Test Case 3: Active Graph Context
**User**: "add more" [in "Swift-Kelce Network" graph]

**Expected Output**:
```json
{
  "intent": "create_node",
  "graph": {"name": "Swift-Kelce Network"},  // ✅ Exact match from context
  "graphSpec": { ... }
}
```

**NOT Expected**:
```json
{
  "graph": {"name": "NC State University"}  // ❌ Wrong graph!
}
```

---

## Next Prompt Improvements (Future)

### 1. **Context Management Guidance**
```
CONTEXT AWARENESS:
When the user says "add more", "here", or "this graph":
1. Check the 🎯 CURRENT GRAPH context above
2. Set "graph": {"name": "{EXACT name from context}"}
3. Reference existing node names in edges (check "Example concepts")
```

### 2. **Connection Definition Strategy**
```
CONNECTION DEFINITION PRIORITY:
Define connections (with definitionNode) for:
1. ✅ Unique relationships (e.g., "Romantic Partnership", "Mother-Son Bond")
2. ✅ Domain-specific types (e.g., "API Integration", "Team Captain")
3. ❌ Skip generic connections (e.g., "related to", "connected to")

Examples:
- ✅ "Taylor Swift" → "Travis Kelce" via "Romantic Partnership" (unique, define it)
- ❌ "Node A" → "Node B" via "related to" (generic, skip definition)
```

### 3. **Fuzzy Matching Hints**
```
DUPLICATE PREVENTION:
Before creating a node, mentally check if a SIMILAR name exists in "Example concepts":
- "Avengers" vs "The Avengers" → SAME (link to existing)
- "Avengers" vs "X-Men" → DIFFERENT (create new)
- "T. Swift" vs "Taylor Swift" → SAME (use full name)

The system catches 80%+ similarity, but exact name reuse is better.
```

---

## Prompt Size Considerations

**Current Prompt Size**: ~4000 characters  
**Token Cost**: ~1000 tokens (included in EVERY planner call)  
**Budget Impact**: 1000 tokens (prompt) + 2000 tokens (output) = 3000 tokens per call

**Is This Worth It?**: YES
- Before: LLM generated inconsistent names, wrong graphs, duplicates → user frustration
- After: LLM generates clean, consistent data → better UX, fewer corrections

**Trade-off**: Larger prompt → higher token cost, BUT fewer correction loops → net savings

---

## Summary

**What Changed**:
1. ✅ Added comprehensive NAMING CONVENTIONS with WHY, examples, and exceptions
2. ✅ Explained HOW THE PIPELINE WORKS to clarify the LLM's role
3. ✅ Emphasized BATCH THINKING for large graphs
4. ✅ Covered BOTH node names AND connection names (not just connections)

**Impact**:
- LLM now understands its role as PLANNER (semantic data) vs EXECUTOR (spatial data)
- LLM defaults to Title Case With Spaces for all names
- LLM respects active graph context
- LLM thinks in batches (5-8 nodes) instead of trying to generate everything at once

**Test It**: Create a new graph and check connection names in the UI. They should now be "Romantic Partnership", not "romantic_partnership"! 🎯

