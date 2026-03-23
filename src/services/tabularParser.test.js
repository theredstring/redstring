import { describe, it, expect } from 'vitest';
import {
  parseCSVText,
  parseJSONText,
  profileData,
  detectDataShape,
  suggestMapping,
  buildLLMSummary,
  sampleRows,
} from './tabularParser.js';

describe('tabularParser', () => {
  describe('parseCSVText', () => {
    it('parses simple CSV with headers', async () => {
      const csv = `name,age,department
Alice,30,Engineering
Bob,25,Marketing
Carol,35,Engineering`;

      const result = await parseCSVText(csv, { filename: 'test.csv' });
      expect(result.filename).toBe('test.csv');
      expect(result.format).toBe('csv');
      expect(result.columns).toEqual(['name', 'age', 'department']);
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0].name).toBe('Alice');
      expect(result.rows[0].age).toBe(30);
      expect(result.totalRows).toBe(3);
      expect(result.isSampled).toBe(false);
    });

    it('parses TSV with tab delimiter', async () => {
      const tsv = `name\tage\nAlice\t30\nBob\t25`;
      const result = await parseCSVText(tsv, { delimiter: '\t', filename: 'test.tsv' });
      expect(result.format).toBe('tsv');
      expect(result.columns).toEqual(['name', 'age']);
      expect(result.rows).toHaveLength(2);
    });

    it('handles empty CSV', async () => {
      const csv = `name,age`;
      const result = await parseCSVText(csv, { filename: 'empty.csv' });
      expect(result.columns).toEqual(['name', 'age']);
      expect(result.rows).toHaveLength(0);
    });

    it('handles quoted values with commas', async () => {
      const csv = `name,description
"Smith, John","A person, indeed"
Bob,Simple`;
      const result = await parseCSVText(csv, { filename: 'quoted.csv' });
      expect(result.rows[0].name).toBe('Smith, John');
      expect(result.rows[0].description).toBe('A person, indeed');
    });
  });

  describe('parseJSONText', () => {
    it('parses array of objects', () => {
      const json = JSON.stringify([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);
      const result = parseJSONText(json, { filename: 'test.json' });
      expect(result.format).toBe('json');
      expect(result.columns).toEqual(['name', 'age']);
      expect(result.rows).toHaveLength(2);
    });

    it('extracts array from top-level object', () => {
      const json = JSON.stringify({
        metadata: 'test',
        data: [{ name: 'Alice' }, { name: 'Bob' }],
      });
      const result = parseJSONText(json, { filename: 'wrapped.json' });
      expect(result.rows).toHaveLength(2);
    });

    it('throws on non-array JSON', () => {
      expect(() => parseJSONText('{"key": "value"}', { filename: 'bad.json' })).toThrow(
        'JSON must be an array of objects'
      );
    });

    it('throws on array of primitives', () => {
      expect(() => parseJSONText('[1, 2, 3]', { filename: 'prims.json' })).toThrow(
        'JSON array must contain objects'
      );
    });

    it('handles empty array', () => {
      const result = parseJSONText('[]', { filename: 'empty.json' });
      expect(result.rows).toHaveLength(0);
      expect(result.columns).toEqual([]);
    });
  });

  describe('profileData', () => {
    it('infers column types correctly', () => {
      const parsed = {
        columns: ['name', 'age', 'active', 'mixed'],
        rows: [
          { name: 'Alice', age: 30, active: true, mixed: 'hello' },
          { name: 'Bob', age: 25, active: false, mixed: 42 },
        ],
      };
      const profile = profileData(parsed);
      expect(profile.columnTypes.name).toBe('string');
      expect(profile.columnTypes.age).toBe('number');
      expect(profile.columnTypes.active).toBe('boolean');
      expect(profile.columnTypes.mixed).toBe('mixed');
    });

    it('counts unique values and nulls', () => {
      const parsed = {
        columns: ['dept', 'note'],
        rows: [
          { dept: 'Eng', note: null },
          { dept: 'Eng', note: 'ok' },
          { dept: 'Mkt', note: '' },
        ],
      };
      const profile = profileData(parsed);
      expect(profile.uniqueCounts.dept).toBe(2);
      expect(profile.nullCounts.note).toBe(2); // null and ''
    });
  });

  describe('detectDataShape', () => {
    it('detects entity_list by default', () => {
      const parsed = {
        columns: ['name', 'age', 'department'],
        rows: [{ name: 'Alice', age: 30, department: 'Eng' }],
        profile: {
          columnTypes: { name: 'string', age: 'number', department: 'string' },
          uniqueCounts: { name: 1, age: 1, department: 1 },
          nullCounts: { name: 0, age: 0, department: 0 },
          sampleValues: {},
        },
      };
      const result = detectDataShape(parsed);
      expect(result.shape).toBe('entity_list');
    });

    it('detects edge_list with source/target columns', () => {
      const parsed = {
        columns: ['source', 'target', 'relationship'],
        rows: [{ source: 'A', target: 'B', relationship: 'knows' }],
        profile: {
          columnTypes: { source: 'string', target: 'string', relationship: 'string' },
          uniqueCounts: { source: 1, target: 1, relationship: 1 },
          nullCounts: {},
          sampleValues: {},
        },
      };
      const result = detectDataShape(parsed);
      expect(result.shape).toBe('edge_list');
      expect(result.details.sourceColumn).toBe('source');
      expect(result.details.targetColumn).toBe('target');
    });

    it('detects edge_list with from/to columns', () => {
      const parsed = {
        columns: ['from', 'to', 'weight'],
        rows: [{ from: 'A', to: 'B', weight: 5 }],
        profile: {
          columnTypes: { from: 'string', to: 'string', weight: 'number' },
          uniqueCounts: {},
          nullCounts: {},
          sampleValues: {},
        },
      };
      const result = detectDataShape(parsed);
      expect(result.shape).toBe('edge_list');
    });

    it('detects adjacency_matrix', () => {
      const parsed = {
        columns: ['entity', 'Alice', 'Bob', 'Carol'],
        rows: [
          { entity: 'Alice', Alice: 0, Bob: 1, Carol: 1 },
          { entity: 'Bob', Alice: 1, Bob: 0, Carol: 0 },
          { entity: 'Carol', Alice: 1, Bob: 0, Carol: 0 },
        ],
        profile: {
          columnTypes: { entity: 'string', Alice: 'number', Bob: 'number', Carol: 'number' },
          uniqueCounts: { entity: 3, Alice: 2, Bob: 2, Carol: 2 },
          nullCounts: {},
          sampleValues: {},
        },
      };
      const result = detectDataShape(parsed);
      expect(result.shape).toBe('adjacency_matrix');
    });

    it('detects relational with _id columns', () => {
      const parsed = {
        columns: ['name', 'department_id', 'role'],
        rows: [
          { name: 'Alice', department_id: 'Engineering', role: 'Dev' },
        ],
        profile: {
          columnTypes: { name: 'string', department_id: 'string', role: 'string' },
          uniqueCounts: { name: 1, department_id: 1, role: 1 },
          nullCounts: {},
          sampleValues: {},
        },
      };
      const result = detectDataShape(parsed);
      expect(result.shape).toBe('relational');
    });
  });

  describe('suggestMapping', () => {
    it('suggests name column for entity_list', () => {
      const parsed = {
        columns: ['name', 'age', 'department'],
        profile: {
          columnTypes: { name: 'string', age: 'number', department: 'string' },
          uniqueCounts: { name: 10, age: 8, department: 3 },
          nullCounts: {},
          sampleValues: {},
        },
      };
      const shape = { shape: 'entity_list', details: {} };
      const mapping = suggestMapping(parsed, shape);
      expect(mapping.nodeNameColumn).toBe('name');
      expect(mapping.groupByColumn).toBe('department');
    });

    it('maps source/target for edge_list', () => {
      const parsed = {
        columns: ['source', 'target', 'type'],
        profile: { columnTypes: {}, uniqueCounts: {}, nullCounts: {}, sampleValues: {} },
      };
      const shape = {
        shape: 'edge_list',
        details: { sourceColumn: 'source', targetColumn: 'target', labelColumn: 'type' },
      };
      const mapping = suggestMapping(parsed, shape);
      expect(mapping.sourceColumn).toBe('source');
      expect(mapping.targetColumn).toBe('target');
      expect(mapping.edgeLabelColumn).toBe('type');
    });
  });

  describe('buildLLMSummary', () => {
    it('generates markdown summary', () => {
      const parsed = {
        filename: 'test.csv',
        format: 'csv',
        columns: ['name', 'age'],
        rows: [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ],
        totalRows: 2,
        isSampled: false,
        metadata: {},
        profile: {
          columnTypes: { name: 'string', age: 'number' },
          uniqueCounts: { name: 2, age: 2 },
          nullCounts: { name: 0, age: 0 },
          sampleValues: { name: ['Alice', 'Bob'], age: ['30', '25'] },
        },
      };
      const summary = buildLLMSummary(parsed);
      expect(summary).toContain('## Tabular Data: test.csv');
      expect(summary).toContain('2 rows x 2 columns');
      expect(summary).toContain('name');
      expect(summary).toContain('age');
      expect(summary).toContain('analyzeTabularData');
    });
  });

  describe('sampleRows', () => {
    it('returns all rows if under limit', () => {
      const parsed = { rows: [{ a: 1 }, { a: 2 }] };
      expect(sampleRows(parsed, 10)).toHaveLength(2);
    });

    it('samples when over limit', () => {
      const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const parsed = { rows };
      const result = sampleRows(parsed, 10);
      expect(result.length).toBeLessThanOrEqual(10);
      expect(result[0].id).toBe(0); // first row preserved
    });
  });
});
