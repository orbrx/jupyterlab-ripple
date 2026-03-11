// Copyright (c) Orange Bricks
// Distributed under the terms of the MIT License.

import {
  buildGraph,
  getDownstreamCells,
  detectCycles,
  findConflicts,
  hashSource
} from '../dag';
import type { ICellAnalysis } from '../dag';

/**
 * Helper to build an ICellAnalysis object.
 */
function cell(
  cellId: string,
  defines: string[],
  references: string[]
): ICellAnalysis {
  return {
    cellId,
    defines: new Set(defines),
    references: new Set(references),
    sourceHash: hashSource(cellId)
  };
}

// ---------------------------------------------------------------------------
// buildGraph
// ---------------------------------------------------------------------------
describe('buildGraph', () => {
  it('builds a linear chain A -> B -> C', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['y'], ['x']),
      cell('C', ['z'], ['y'])
    ];
    const graph = buildGraph(analyses, ['A', 'B', 'C']);

    expect(graph.variableOwner.get('x')).toBe('A');
    expect(graph.variableOwner.get('y')).toBe('B');
    expect(graph.variableOwner.get('z')).toBe('C');

    expect(graph.downstreamEdges.get('A')).toEqual(new Set(['B']));
    expect(graph.downstreamEdges.get('B')).toEqual(new Set(['C']));
    expect(graph.downstreamEdges.get('C')).toEqual(new Set());

    expect(graph.upstreamEdges.get('A')).toEqual(new Set());
    expect(graph.upstreamEdges.get('B')).toEqual(new Set(['A']));
    expect(graph.upstreamEdges.get('C')).toEqual(new Set(['B']));
  });

  it('builds branching dependencies A -> B, A -> C', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['y'], ['x']),
      cell('C', ['z'], ['x'])
    ];
    const graph = buildGraph(analyses, ['A', 'B', 'C']);

    expect(graph.downstreamEdges.get('A')).toEqual(new Set(['B', 'C']));
    expect(graph.upstreamEdges.get('B')).toEqual(new Set(['A']));
    expect(graph.upstreamEdges.get('C')).toEqual(new Set(['A']));
  });

  it('builds a diamond A -> B, A -> C, B -> D, C -> D', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['y'], ['x']),
      cell('C', ['z'], ['x']),
      cell('D', ['w'], ['y', 'z'])
    ];
    const graph = buildGraph(analyses, ['A', 'B', 'C', 'D']);

    expect(graph.downstreamEdges.get('A')).toEqual(new Set(['B', 'C']));
    expect(graph.downstreamEdges.get('B')).toEqual(new Set(['D']));
    expect(graph.downstreamEdges.get('C')).toEqual(new Set(['D']));
    expect(graph.upstreamEdges.get('D')).toEqual(new Set(['B', 'C']));
  });

  it('handles independent cells with no edges', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['y'], []),
      cell('C', ['z'], [])
    ];
    const graph = buildGraph(analyses, ['A', 'B', 'C']);

    expect(graph.downstreamEdges.get('A')).toEqual(new Set());
    expect(graph.downstreamEdges.get('B')).toEqual(new Set());
    expect(graph.downstreamEdges.get('C')).toEqual(new Set());
  });

  it('uses last-definition-wins for variable ownership', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['x'], []),
      cell('C', ['y'], ['x'])
    ];
    const graph = buildGraph(analyses, ['A', 'B', 'C']);

    expect(graph.variableOwner.get('x')).toBe('B');
    expect(graph.downstreamEdges.get('A')).toEqual(new Set());
    expect(graph.downstreamEdges.get('B')).toEqual(new Set(['C']));
  });

  it('self-reference does not create a self-edge', () => {
    const analyses = [cell('A', ['x'], ['x'])];
    const graph = buildGraph(analyses, ['A']);

    expect(graph.downstreamEdges.get('A')).toEqual(new Set());
    expect(graph.upstreamEdges.get('A')).toEqual(new Set());
  });

  it('ignores analyses not present in cellOrder', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('ORPHAN', ['y'], ['x'])
    ];
    const graph = buildGraph(analyses, ['A']);

    expect(graph.cells.size).toBe(1);
    expect(graph.downstreamEdges.get('A')).toEqual(new Set());
  });
});

// ---------------------------------------------------------------------------
// getDownstreamCells
// ---------------------------------------------------------------------------
describe('getDownstreamCells', () => {
  it('returns single downstream cell', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['y'], ['x'])
    ];
    const graph = buildGraph(analyses, ['A', 'B']);

    expect(getDownstreamCells('A', graph)).toEqual(['B']);
  });

  it('returns transitive chain in topological order', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['y'], ['x']),
      cell('C', ['z'], ['y'])
    ];
    const graph = buildGraph(analyses, ['A', 'B', 'C']);
    const downstream = getDownstreamCells('A', graph);

    expect(downstream).toEqual(['B', 'C']);
  });

  it('returns branching fan-out', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['y'], ['x']),
      cell('C', ['z'], ['x'])
    ];
    const graph = buildGraph(analyses, ['A', 'B', 'C']);
    const downstream = getDownstreamCells('A', graph);

    expect(downstream).toHaveLength(2);
    expect(downstream).toContain('B');
    expect(downstream).toContain('C');
  });

  it('returns diamond in valid topological order', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['y'], ['x']),
      cell('C', ['z'], ['x']),
      cell('D', ['w'], ['y', 'z'])
    ];
    const graph = buildGraph(analyses, ['A', 'B', 'C', 'D']);
    const downstream = getDownstreamCells('A', graph);

    expect(downstream).toHaveLength(3);
    expect(downstream.indexOf('D')).toBeGreaterThan(downstream.indexOf('B'));
    expect(downstream.indexOf('D')).toBeGreaterThan(downstream.indexOf('C'));
  });

  it('returns empty array when no downstream cells exist', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['y'], [])
    ];
    const graph = buildGraph(analyses, ['A', 'B']);

    expect(getDownstreamCells('A', graph)).toEqual([]);
  });

  it('does not include the trigger cell itself', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['y'], ['x'])
    ];
    const graph = buildGraph(analyses, ['A', 'B']);
    const downstream = getDownstreamCells('A', graph);

    expect(downstream).not.toContain('A');
  });

  it('handles triggering from a mid-chain cell', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['y'], ['x']),
      cell('C', ['z'], ['y'])
    ];
    const graph = buildGraph(analyses, ['A', 'B', 'C']);

    expect(getDownstreamCells('B', graph)).toEqual(['C']);
  });
});

// ---------------------------------------------------------------------------
// detectCycles
// ---------------------------------------------------------------------------
describe('detectCycles', () => {
  it('returns empty array for acyclic graph', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['y'], ['x']),
      cell('C', ['z'], ['y'])
    ];
    const graph = buildGraph(analyses, ['A', 'B', 'C']);

    expect(detectCycles(graph)).toEqual([]);
  });

  it('detects a simple two-node cycle', () => {
    // A defines x, refs y; B defines y, refs x → A <-> B
    const analyses = [
      cell('A', ['x'], ['y']),
      cell('B', ['y'], ['x'])
    ];
    const graph = buildGraph(analyses, ['A', 'B']);
    const cycles = detectCycles(graph);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].sort()).toEqual(['A', 'B']);
  });

  it('detects a three-node cycle', () => {
    const analyses = [
      cell('A', ['x'], ['z']),
      cell('B', ['y'], ['x']),
      cell('C', ['z'], ['y'])
    ];
    const graph = buildGraph(analyses, ['A', 'B', 'C']);
    const cycles = detectCycles(graph);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].sort()).toEqual(['A', 'B', 'C']);
  });

  it('does not include non-cycle nodes in cycle SCCs', () => {
    // D depends on A but is not part of the A<->B cycle
    const analyses = [
      cell('A', ['x'], ['y']),
      cell('B', ['y'], ['x']),
      cell('D', ['w'], ['x'])
    ];
    const graph = buildGraph(analyses, ['A', 'B', 'D']);
    const cycles = detectCycles(graph);

    expect(cycles).toHaveLength(1);
    const cycleNodes = new Set(cycles[0]);
    expect(cycleNodes.has('A')).toBe(true);
    expect(cycleNodes.has('B')).toBe(true);
    expect(cycleNodes.has('D')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findConflicts
// ---------------------------------------------------------------------------
describe('findConflicts', () => {
  it('returns empty when no conflicts exist', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['y'], [])
    ];

    expect(findConflicts(analyses)).toEqual([]);
  });

  it('detects a single variable conflict', () => {
    const analyses = [
      cell('A', ['x'], []),
      cell('B', ['x'], [])
    ];
    const conflicts = findConflicts(analyses);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].variable).toBe('x');
    expect(conflicts[0].cellIds.sort()).toEqual(['A', 'B']);
  });

  it('detects multiple conflicts', () => {
    const analyses = [
      cell('A', ['x', 'y'], []),
      cell('B', ['x'], []),
      cell('C', ['y'], [])
    ];
    const conflicts = findConflicts(analyses);

    expect(conflicts).toHaveLength(2);
    const vars = conflicts.map(c => c.variable).sort();
    expect(vars).toEqual(['x', 'y']);
  });

  it('does not flag variables unique to one cell', () => {
    const analyses = [
      cell('A', ['x', 'shared'], []),
      cell('B', ['y', 'shared'], [])
    ];
    const conflicts = findConflicts(analyses);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].variable).toBe('shared');
  });
});

// ---------------------------------------------------------------------------
// hashSource
// ---------------------------------------------------------------------------
describe('hashSource', () => {
  it('is deterministic', () => {
    expect(hashSource('hello')).toBe(hashSource('hello'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashSource('hello')).not.toBe(hashSource('world'));
  });

  it('returns a string', () => {
    expect(typeof hashSource('test')).toBe('string');
  });

  it('handles empty string', () => {
    expect(typeof hashSource('')).toBe('string');
  });
});
