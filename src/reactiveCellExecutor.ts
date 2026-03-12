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
    const state = this._stateManager.getStateByModel(options.notebook);
    const leaveRunCell = state?.enterRunCell();

    try {
      // Step 1: Run the cell using the default executor.
      const success = await defaultRunCell(options);
      if (!success) {
        return false;
      }

      // Step 2: Check if reactivity is enabled for this notebook.
      if (!state || !state.enabled) {
        return true;
      }

      // Skip propagation during batch execution (e.g. Run All Cells).
      if (state.isRunningBatch) {
        const cellId = options.cell.model.sharedModel.getId();
        state.markExecuted(cellId);
        state.clearStale(cellId);
        return true;
      }

      // Step 3: Re-analyze the executed cell.
      const cellId = options.cell.model.sharedModel.getId();
      state.cancelPendingAnalysis(cellId);
      state.markExecuted(cellId);
      const source = options.cell.model.sharedModel.getSource();
      if (source.trim() && options.cell.model.type === 'code') {
        await state.analyzeSingleCell(cellId, source);
      }

      // Clear stale status of the executed cell.
      state.clearStale(cellId);

      // Step 4: Get downstream cells in topological order.
      const allDownstreamIds = state.getDownstreamExecutionOrder(cellId);
      // Only re-execute cells that (a) have been run before AND (b) have
      // all their upstream dependencies satisfied.
      const downstreamIds = allDownstreamIds.filter(
        id => state.hasBeenExecuted(id) && state.allUpstreamExecuted(id)
      );
      if (downstreamIds.length === 0) {
        state.notifyChanged();
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

          state.clearStale(downstreamId);
          state.markExecuted(downstreamId);

          if (!downstreamSuccess) {
            console.warn(
              `Ripple: Stopping propagation due to error in cell ${downstreamId}`
            );
            break;
          }
        }
      }

      state.notifyChanged();
      return true;
    } finally {
      leaveRunCell?.();
    }
  }

  private _stateManager: ReactiveStateManager;
}
