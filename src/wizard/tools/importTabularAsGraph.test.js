import { describe, it, expect } from 'vitest';
import { importTabularAsGraph } from './importTabularAsGraph.js';

const mockTabularData = [
  {
    filename: 'employees.csv',
    format: 'csv',
    columns: ['name', 'department', 'role', 'reports_to'],
    rows: [
      { name: 'Alice', department: 'Engineering', role: 'Manager', reports_to: '' },
      { name: 'Bob', department: 'Engineering', role: 'Developer', reports_to: 'Alice' },
      { name: 'Carol', department: 'Marketing', role: 'Manager', reports_to: '' },
      { name: 'Dave', department: 'Marketing', role: 'Designer', reports_to: 'Carol' },
      { name: 'Eve', department: 'Engineering', role: 'Developer', reports_to: 'Alice' },
    ],
    totalRows: 5,
    isSampled: false,
    metadata: {},
    profile: {
      columnTypes: { name: 'string', department: 'string', role: 'string', reports_to: 'string' },
      uniqueCounts: { name: 5, department: 2, role: 3, reports_to: 3 },
      nullCounts: { name: 0, department: 0, role: 0, reports_to: 2 },
      sampleValues: {},
    },
  },
];

const makeGraphState = (data) => ({ _tabularData: data });

describe('importTabularAsGraph', () => {
  it('creates entity_list graph', async () => {
    const result = await importTabularAsGraph(
      {
        graphName: 'Employee Graph',
        description: 'Test graph',
        dataShape: 'entity_list',
        mapping: {
          nodeNameColumn: 'name',
          nodeDescriptionColumns: ['role'],
          groupByColumn: 'department',
        },
      },
      makeGraphState(mockTabularData)
    );

    expect(result.action).toBe('importTabularAsGraph');
    expect(result.graphName).toBe('Employee Graph');
    expect(result.spec.nodes).toHaveLength(5);
    expect(result.spec.groups).toHaveLength(2); // Engineering + Marketing
    expect(result.stats.importedNodes).toBe(5);

    // Verify group structure
    const engGroup = result.spec.groups.find(g => g.name === 'Engineering');
    expect(engGroup).toBeTruthy();
    expect(engGroup.memberNames).toContain('Alice');
    expect(engGroup.memberNames).toContain('Bob');
    expect(engGroup.memberNames).toContain('Eve');

    const mktGroup = result.spec.groups.find(g => g.name === 'Marketing');
    expect(mktGroup.memberNames).toContain('Carol');
    expect(mktGroup.memberNames).toContain('Dave');
  });

  it('creates edge_list graph', async () => {
    const edgeData = [
      {
        filename: 'edges.csv',
        format: 'csv',
        columns: ['source', 'target', 'relationship'],
        rows: [
          { source: 'Alice', target: 'Bob', relationship: 'manages' },
          { source: 'Alice', target: 'Eve', relationship: 'manages' },
          { source: 'Carol', target: 'Dave', relationship: 'manages' },
        ],
        totalRows: 3,
        isSampled: false,
        metadata: {},
        profile: {
          columnTypes: { source: 'string', target: 'string', relationship: 'string' },
          uniqueCounts: {},
          nullCounts: {},
          sampleValues: {},
        },
      },
    ];

    const result = await importTabularAsGraph(
      {
        graphName: 'Edge Graph',
        description: 'Test edge graph',
        dataShape: 'edge_list',
        mapping: {
          sourceColumn: 'source',
          targetColumn: 'target',
          edgeLabelColumn: 'relationship',
        },
      },
      makeGraphState(edgeData)
    );

    expect(result.action).toBe('importTabularAsGraph');
    expect(result.spec.nodes).toHaveLength(5); // Alice, Bob, Eve, Carol, Dave
    expect(result.spec.edges).toHaveLength(3);
    expect(result.spec.edges[0].type).toBe('manages');
  });

  it('creates adjacency_matrix graph', async () => {
    const matrixData = [
      {
        filename: 'matrix.csv',
        format: 'csv',
        columns: ['entity', 'Alice', 'Bob', 'Carol'],
        rows: [
          { entity: 'Alice', Alice: 0, Bob: 1, Carol: 1 },
          { entity: 'Bob', Alice: 1, Bob: 0, Carol: 0 },
          { entity: 'Carol', Alice: 1, Bob: 0, Carol: 0 },
        ],
        totalRows: 3,
        isSampled: false,
        metadata: {},
        profile: {
          columnTypes: { entity: 'string', Alice: 'number', Bob: 'number', Carol: 'number' },
          uniqueCounts: {},
          nullCounts: {},
          sampleValues: {},
        },
      },
    ];

    const result = await importTabularAsGraph(
      {
        graphName: 'Matrix Graph',
        description: 'Adjacency test',
        dataShape: 'adjacency_matrix',
        mapping: { labelColumn: 'entity' },
      },
      makeGraphState(matrixData)
    );

    expect(result.spec.nodes).toHaveLength(3);
    // 4 non-zero, non-self edges: Alice→Bob, Alice→Carol, Bob→Alice, Carol→Alice
    expect(result.spec.edges.length).toBeGreaterThanOrEqual(4);
  });

  it('creates relational graph with foreign keys', async () => {
    const result = await importTabularAsGraph(
      {
        graphName: 'Relational Graph',
        description: 'Test relational',
        dataShape: 'relational',
        mapping: {
          nodeNameColumn: 'name',
          nodeDescriptionColumns: ['role'],
          groupByColumn: 'department',
          foreignKeyMappings: [
            { column: 'reports_to', edgeLabel: 'Reports To' },
          ],
        },
      },
      makeGraphState(mockTabularData)
    );

    expect(result.spec.nodes).toHaveLength(5);
    // Bob→Alice, Eve→Alice, Dave→Carol (3 edges from reports_to)
    expect(result.spec.edges).toHaveLength(3);
    expect(result.spec.edges[0].type).toBe('Reports To');
  });

  it('returns error when no tabular data', async () => {
    const result = await importTabularAsGraph(
      { graphName: 'Test', description: 'x', dataShape: 'entity_list', mapping: {} },
      {}
    );
    expect(result.error).toContain('No tabular data found');
  });

  it('returns error when mapping is missing required column', async () => {
    const result = await importTabularAsGraph(
      {
        graphName: 'Test',
        description: 'x',
        dataShape: 'entity_list',
        mapping: {}, // missing nodeNameColumn
      },
      makeGraphState(mockTabularData)
    );
    expect(result.error).toContain('nodeNameColumn is required');
  });

  it('respects maxNodes limit', async () => {
    const result = await importTabularAsGraph(
      {
        graphName: 'Limited',
        description: 'x',
        dataShape: 'entity_list',
        mapping: { nodeNameColumn: 'name' },
        maxNodes: 2,
      },
      makeGraphState(mockTabularData)
    );
    expect(result.spec.nodes).toHaveLength(2);
  });

  it('deduplicates nodes by name', async () => {
    const dupeData = [
      {
        filename: 'dupes.csv',
        format: 'csv',
        columns: ['name', 'value'],
        rows: [
          { name: 'Alice', value: 1 },
          { name: 'alice', value: 2 }, // same name different case
          { name: 'Bob', value: 3 },
        ],
        totalRows: 3,
        isSampled: false,
        metadata: {},
        profile: { columnTypes: {}, uniqueCounts: {}, nullCounts: {}, sampleValues: {} },
      },
    ];

    const result = await importTabularAsGraph(
      {
        graphName: 'Dedup',
        description: 'x',
        dataShape: 'entity_list',
        mapping: { nodeNameColumn: 'name' },
      },
      makeGraphState(dupeData)
    );
    expect(result.spec.nodes).toHaveLength(2); // Alice + Bob
  });
});
