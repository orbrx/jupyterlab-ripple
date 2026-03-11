// Copyright (c) Orange Bricks
// Distributed under the terms of the MIT License.

import type { Cell } from '@jupyterlab/cells';
import type { NotebookPanel } from '@jupyterlab/notebook';
import type { ReactiveNotebookState } from '../reactiveState';

/**
 * CSS class names for dependency indicators.
 */
const UPSTREAM_CLASS = 'jp-reactive-upstream';
const DOWNSTREAM_CLASS = 'jp-reactive-downstream';
const STALE_CLASS = 'jp-reactive-stale';
const CONFLICT_CLASS = 'jp-reactive-conflict';
const CYCLE_CLASS = 'jp-reactive-cycle';
const REACTIVE_ENABLED_CLASS = 'jp-reactive-enabled';

/**
 * All reactive CSS classes for easy removal.
 */
const ALL_CLASSES = [
  UPSTREAM_CLASS,
  DOWNSTREAM_CLASS,
  STALE_CLASS,
  CONFLICT_CLASS,
  CYCLE_CLASS
];

/**
 * Update dependency indicators on all cells in a notebook.
 *
 * This reads the current graph from the reactive state and applies
 * appropriate CSS classes to each cell widget.
 */
export function updateDependencyIndicators(
  panel: NotebookPanel,
  state: ReactiveNotebookState
): void {
  const notebook = panel.content;
  const graph = state.graph;

  // Toggle the notebook-level class.
  if (state.enabled) {
    notebook.node.classList.add(REACTIVE_ENABLED_CLASS);
  } else {
    notebook.node.classList.remove(REACTIVE_ENABLED_CLASS);
  }

  for (const cell of notebook.widgets) {
    // Clear all reactive classes first.
    for (const cls of ALL_CLASSES) {
      cell.node.classList.remove(cls);
    }
    // Remove tooltip.
    cell.node.removeAttribute('title');

    if (!state.enabled || !graph || cell.model.type !== 'code') {
      continue;
    }

    const cellId = cell.model.sharedModel.getId();
    const analysis = graph.cells.get(cellId);
    if (!analysis) {
      continue;
    }

    // Check if this cell has downstream dependents (upstream provider).
    const downstream = graph.downstreamEdges.get(cellId);
    if (downstream && downstream.size > 0) {
      cell.node.classList.add(UPSTREAM_CLASS);
    }

    // Check if this cell depends on other cells (downstream consumer).
    const upstream = graph.upstreamEdges.get(cellId);
    if (upstream && upstream.size > 0) {
      cell.node.classList.add(DOWNSTREAM_CLASS);
    }

    // Check if this cell is stale.
    if (state.staleCells.has(cellId)) {
      cell.node.classList.add(STALE_CLASS);
    }

    // Check if this cell has variable conflicts.
    if (state.conflictCells.has(cellId)) {
      cell.node.classList.add(CONFLICT_CLASS);
    }

    // Check if this cell is in a dependency cycle.
    if (state.cycleCells.has(cellId)) {
      cell.node.classList.add(CYCLE_CLASS);
    }

    // Build tooltip.
    const tooltip = buildTooltip(cell, analysis, graph, state);
    if (tooltip) {
      cell.node.title = tooltip;
    }
  }
}

/**
 * Clear all dependency indicators from a notebook.
 */
export function clearDependencyIndicators(panel: NotebookPanel): void {
  const notebook = panel.content;
  notebook.node.classList.remove(REACTIVE_ENABLED_CLASS);

  for (const cell of notebook.widgets) {
    for (const cls of ALL_CLASSES) {
      cell.node.classList.remove(cls);
    }
    cell.node.removeAttribute('title');
  }
}

/**
 * Build a tooltip string for a cell.
 */
function buildTooltip(
  _cell: Cell,
  analysis: { defines: Set<string>; references: Set<string> },
  graph: {
    downstreamEdges: Map<string, Set<string>>;
    upstreamEdges: Map<string, Set<string>>;
  },
  state: ReactiveNotebookState
): string {
  const parts: string[] = [];
  const cellId = _cell.model.sharedModel.getId();

  if (analysis.defines.size > 0) {
    parts.push(`Defines: ${[...analysis.defines].join(', ')}`);
  }
  if (analysis.references.size > 0) {
    parts.push(`References: ${[...analysis.references].join(', ')}`);
  }

  const downstream = graph.downstreamEdges.get(cellId);
  if (downstream && downstream.size > 0) {
    parts.push(`${downstream.size} dependent cell(s)`);
  }

  const upstream = graph.upstreamEdges.get(cellId);
  if (upstream && upstream.size > 0) {
    parts.push(`Depends on ${upstream.size} cell(s)`);
  }

  if (state.staleCells.has(cellId)) {
    parts.push('\u26A0 Stale: upstream changed, needs re-execution');
  }

  if (state.conflictCells.has(cellId)) {
    const conflictVars = state.conflicts
      .filter(c => c.cellIds.includes(cellId))
      .map(c => c.variable);
    parts.push(
      `\u26A0 Conflict: "${conflictVars.join('", "')}" defined in multiple cells`
    );
  }

  if (state.cycleCells.has(cellId)) {
    parts.push('\u26A0 Cycle: this cell is part of a dependency cycle');
  }

  return parts.join('\n');
}
