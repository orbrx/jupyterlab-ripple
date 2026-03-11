// Copyright (c) Orange Bricks
// Distributed under the terms of the MIT License.

import type { INotebookCellExecutor } from '@jupyterlab/notebook';
import { runCell as defaultRunCell } from '@jupyterlab/notebook';
import type { ReactiveStateManager } from './reactiveState';

/**
 * A reactive cell executor that wraps the default executor.
 *
 * After executing a cell, if reactivity is enabled for its notebook,
 * it automatically re-executes all downstream dependent cells in
 * topological order.
 */
export class ReactiveCellExecutor implements INotebookCellExecutor {
  constructor(stateManager: ReactiveStateManager) {
    this._stateManager = stateManager;
  }

  /**
   * Execute a cell, then propagate to downstream dependents if reactive mode is on.
   */
  async runCell(
    options: INotebookCellExecutor.IRunCellOptions
  ): Promise<boolean> {
    // Step 1: Run the cell using the default executor.
    const success = await defaultRunCell(options);
    if (!success) {
      return false;
    }

    // Step 2: Check if reactivity is enabled for this notebook.
    const state = this._stateManager.getStateByModel(options.notebook);
    if (!state || !state.enabled) {
      return true;
    }

    // Step 3: Re-analyze the executed cell.
    const cellId = options.cell.model.sharedModel.getId();
    state.markExecuted(cellId);
    const source = options.cell.model.sharedModel.getSource();
    if (source.trim() && options.cell.model.type === 'code') {
      await state.analyzeSingleCell(cellId, source);
    }

    // Clear stale status of the executed cell.
    state.clearStale(cellId);

    // Step 4: Get downstream cells in topological order.
    const allDownstreamIds = state.getDownstreamExecutionOrder(cellId);
    // Only re-execute cells that have been run at least once before (marimo semantics).
    const downstreamIds = allDownstreamIds.filter(id =>
      state.hasBeenExecuted(id)
    );
    if (downstreamIds.length === 0) {
      return true;
    }

    // Step 5: Execute each downstream cell sequentially.
    const panel = state.panel;
    for (const downstreamId of downstreamIds) {
      const downstreamCell = this._stateManager.findCellWidget(
        panel,
        downstreamId
      );
      if (downstreamCell && downstreamCell.model.type === 'code') {
        // Build options for the downstream cell execution.
        const downstreamOptions: INotebookCellExecutor.IRunCellOptions = {
          cell: downstreamCell,
          notebook: options.notebook,
          notebookConfig: options.notebookConfig,
          onCellExecuted: options.onCellExecuted,
          onCellExecutionScheduled: options.onCellExecutionScheduled,
          sessionContext: options.sessionContext,
          sessionDialogs: options.sessionDialogs,
          translator: options.translator
        };

        const downstreamSuccess = await defaultRunCell(downstreamOptions);

        // Clear stale status after successful execution.
        state.clearStale(downstreamId);
        state.markExecuted(downstreamId);

        if (!downstreamSuccess) {
          // Stop propagation on error.
          console.warn(
            `Ripple: Stopping propagation due to error in cell ${downstreamId}`
          );
          break;
        }
      }
    }

    return true;
  }

  private _stateManager: ReactiveStateManager;
}
