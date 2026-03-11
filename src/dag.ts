// Copyright (c) Orange Bricks
// Distributed under the terms of the MIT License.

/**
 * Analysis result for a single notebook cell.
 */
export interface ICellAnalysis {
  /**
   * Unique cell identifier.
   */
  cellId: string;

  /**
   * Set of variable names this cell defines.
   */
  defines: Set<string>;

  /**
   * Set of variable names this cell references (excluding self-defined).
   */
  references: Set<string>;

  /**
   * Hash of the cell source for cache invalidation.
   */
  sourceHash: string;
}

/**
 * A directed dependency graph for notebook cells.
 */
export interface IDependencyGraph {
  /**
   * Map from cellId to its analysis.
   */
  cells: Map<string, ICellAnalysis>;

  /**
   * Map from variable name to the cellId that defines it.
   * If multiple cells define the same variable, the last one wins.
   */
  variableOwner: Map<string, string>;

  /**
   * Map from cellId to the set of cellIds that depend on it (downstream).
   */
  downstreamEdges: Map<string, Set<string>>;

  /**
   * Map from cellId to the set of cellIds it depends on (upstream).
   */
  upstreamEdges: Map<string, Set<string>>;
}

/**
 * A variable conflict: a variable defined in multiple cells.
 */
export interface IVariableConflict {
  variable: string;
  cellIds: string[];
}

/**
 * Build a dependency graph from cell analyses.
 *
 * @param analyses - Array of cell analyses.
 * @param cellOrder - Array of cell IDs in notebook order (used as tiebreaker).
 * @returns The dependency graph.
 */
export function buildGraph(
  analyses: ICellAnalysis[],
  cellOrder: string[]
): IDependencyGraph {
  const cells = new Map<string, ICellAnalysis>();
  const variableOwner = new Map<string, string>();
  const downstreamEdges = new Map<string, Set<string>>();
  const upstreamEdges = new Map<string, Set<string>>();

  // Populate cells map and variable ownership.
  // Process in notebook order so later cells override earlier ones for
  // variable ownership (last-definition-wins).
  for (const cellId of cellOrder) {
    const analysis = analyses.find(a => a.cellId === cellId);
    if (!analysis) {
      continue;
    }
    cells.set(cellId, analysis);
    downstreamEdges.set(cellId, new Set());
    upstreamEdges.set(cellId, new Set());

    for (const varName of analysis.defines) {
      variableOwner.set(varName, cellId);
    }
  }

  // Build edges based on variable references.
  for (const [cellId, analysis] of cells) {
    for (const ref of analysis.references) {
      const ownerCellId = variableOwner.get(ref);
      if (ownerCellId && ownerCellId !== cellId) {
        // cellId depends on ownerCellId
        downstreamEdges.get(ownerCellId)!.add(cellId);
        upstreamEdges.get(cellId)!.add(ownerCellId);
      }
    }
  }

  return { cells, variableOwner, downstreamEdges, upstreamEdges };
}

/**
 * Get all transitive downstream dependents of a cell in topological order.
 *
 * Uses Kahn's algorithm on the subgraph of reachable nodes.
 *
 * @param cellId - The cell that was executed.
 * @param graph - The dependency graph.
 * @returns Array of cell IDs in execution order (excludes the trigger cell).
 */
export function getDownstreamCells(
  cellId: string,
  graph: IDependencyGraph
): string[] {
  // First, find all reachable downstream cells via BFS.
  const reachable = new Set<string>();
  const queue: string[] = [cellId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const downstream = graph.downstreamEdges.get(current);
    if (downstream) {
      for (const dep of downstream) {
        if (!reachable.has(dep)) {
          reachable.add(dep);
          queue.push(dep);
        }
      }
    }
  }

  if (reachable.size === 0) {
    return [];
  }

  // Build in-degree counts for the reachable subgraph.
  const inDegree = new Map<string, number>();
  for (const nodeId of reachable) {
    inDegree.set(nodeId, 0);
  }

  for (const nodeId of reachable) {
    const downstream = graph.downstreamEdges.get(nodeId);
    if (downstream) {
      for (const dep of downstream) {
        if (reachable.has(dep)) {
          inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
        }
      }
    }
  }

  // Also count edges from the trigger cell into the reachable set.
  const triggerDownstream = graph.downstreamEdges.get(cellId);
  if (triggerDownstream) {
    for (const dep of triggerDownstream) {
      if (reachable.has(dep)) {
        inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm: process nodes with in-degree 0.
  const sorted: string[] = [];
  const kahnQueue: string[] = [];

  // Start with reachable nodes whose only upstream within the subgraph
  // is the trigger cell (in-degree from reachable nodes is 0 after removing trigger edges).
  // We need to recompute: in-degree considering only edges within reachable set.
  const subgraphInDegree = new Map<string, number>();
  for (const nodeId of reachable) {
    subgraphInDegree.set(nodeId, 0);
  }
  for (const nodeId of reachable) {
    const upstream = graph.upstreamEdges.get(nodeId);
    if (upstream) {
      for (const dep of upstream) {
        if (reachable.has(dep)) {
          subgraphInDegree.set(nodeId, (subgraphInDegree.get(nodeId) ?? 0) + 1);
        }
      }
    }
  }

  for (const [nodeId, degree] of subgraphInDegree) {
    if (degree === 0) {
      kahnQueue.push(nodeId);
    }
  }

  while (kahnQueue.length > 0) {
    const current = kahnQueue.shift()!;
    sorted.push(current);

    const downstream = graph.downstreamEdges.get(current);
    if (downstream) {
      for (const dep of downstream) {
        if (reachable.has(dep)) {
          const newDegree = (subgraphInDegree.get(dep) ?? 1) - 1;
          subgraphInDegree.set(dep, newDegree);
          if (newDegree === 0) {
            kahnQueue.push(dep);
          }
        }
      }
    }
  }

  return sorted;
}

/**
 * Detect cycles in the dependency graph using Tarjan's SCC algorithm.
 *
 * @param graph - The dependency graph.
 * @returns Array of strongly connected components with more than one node.
 *          Each SCC is an array of cell IDs.
 */
export function detectCycles(graph: IDependencyGraph): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const sccs: string[][] = [];

  function strongConnect(v: string): void {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const downstream = graph.downstreamEdges.get(v);
    if (downstream) {
      for (const w of downstream) {
        if (!indices.has(w)) {
          strongConnect(w);
          lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
        } else if (onStack.has(w)) {
          lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
        }
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);

      if (scc.length > 1) {
        sccs.push(scc);
      }
    }
  }

  for (const cellId of graph.cells.keys()) {
    if (!indices.has(cellId)) {
      strongConnect(cellId);
    }
  }

  return sccs;
}

/**
 * Find variables defined in multiple cells.
 *
 * @param analyses - Array of cell analyses.
 * @returns Array of variable conflicts.
 */
export function findConflicts(analyses: ICellAnalysis[]): IVariableConflict[] {
  const varToCells = new Map<string, string[]>();

  for (const analysis of analyses) {
    for (const varName of analysis.defines) {
      const existing = varToCells.get(varName);
      if (existing) {
        existing.push(analysis.cellId);
      } else {
        varToCells.set(varName, [analysis.cellId]);
      }
    }
  }

  const conflicts: IVariableConflict[] = [];
  for (const [variable, cellIds] of varToCells) {
    if (cellIds.length > 1) {
      conflicts.push({ variable, cellIds });
    }
  }

  return conflicts;
}

/**
 * Simple string hash function for cache keys.
 */
export function hashSource(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}
