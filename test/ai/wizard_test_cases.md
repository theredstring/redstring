# Wizard Test Cases

This document outlines the test scenarios for "The Wizard" - a robust AI agent script that interacts with Redstring via the MCP bridge.

## Scenario 1: The Creator (Graph & Node Creation)
**Goal**: Verify the ability to create a new graph and populate it with nodes.
1.  **Action**: Create a new graph named "Wizard's Playground".
2.  **Populate Graph**:
    *   **Action**: Use `create_subgraph` to add multiple nodes at once.
    *   **Input**:
        *   Nodes: "Thing" (Root), "Vehicle" (General), "Car" (Specific), "Toyota Camry" (Instance)
    *   **Expected Output**: Success message confirming creation of nodes.
6.  **Verification**: Ensure all nodes exist in the graph.

## Scenario 2: The Abstractor (Abstraction Chains)
**Goal**: Verify the ability to link nodes in an abstraction chain (Generality <-> Specificity).
1.  **Context**: Use the nodes created in Scenario 1.
2.  **Action**: Update "Vehicle" prototype to set `abstractionChains` for "Generalization Axis".
    *   Chain: `[Vehicle, Car, Toyota Camry]` (or similar structure).
    *   Note: The chain format is `[most_general_id, ..., most_specific_id]`.
3.  **Action**: Update "Car" and "Toyota Camry" to share this chain.
4.  **Verification**: Read back the node prototypes and verify `abstractionChains` property.

## Scenario 3: The Decomposer (Subgraphs & Definitions)
**Goal**: Verify the ability to create decompositions (nested graphs).
1.  **Action**: Select the "Car" node.
2.  **Action**: Create a new graph named "Car Internals".
3.  **Action**: Populate "Car Internals" with "Engine", "Wheels", "Chassis".
4.  **Action**: Link "Car" node to "Car Internals" graph as a definition.
    *   Use `updateNodePrototype` to set `definitionGraphIds`.
5.  **Verification**: Verify "Car" node has "Car Internals" in its definitions.

## Scenario 4: The Connector (Edges & Definitions)
**Goal**: Verify the ability to create typed edges and define them.
1.  **Action**: Connect "Car" to "Engine" with "has part".
2.  **Action**: Create a definition node for "has part" (if not exists).
3.  **Verification**: Ensure edge exists and has correct type/definition.

## Scenario 5: The Reader (Structure Verification)
**Goal**: Verify the agent can "see" what it built.
1.  **Action**: Call `read_graph_structure` on "Wizard's Playground".
2.  **Verification**: output should match the created structure.
