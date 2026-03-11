// Copyright (c) Orange Bricks
// Distributed under the terms of the MIT License.

import type {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { INotebookCellExecutor, INotebookTracker } from '@jupyterlab/notebook';
import type { NotebookPanel } from '@jupyterlab/notebook';
import { ITranslator } from '@jupyterlab/translation';
import { ReactiveCellExecutor } from './reactiveCellExecutor';
import { ReactiveStateManager } from './reactiveState';
import {
  updateDependencyIndicators,
  clearDependencyIndicators
} from './ui/dependencyIndicators';
import { registerToggleCommand, addToolbarButton } from './ui/toggleButton';

/**
 * Shared state manager singleton.
 */
const stateManager = new ReactiveStateManager();

/**
 * Plugin A: Provides the reactive cell executor.
 *
 * This replaces the default @jupyterlab/notebook-extension:cell-executor plugin.
 */
const executorPlugin: JupyterFrontEndPlugin<INotebookCellExecutor> = {
  id: 'jupyterlab-ripple:executor',
  description:
    'Provides a reactive notebook cell executor that automatically ' +
    're-executes downstream dependent cells.',
  autoStart: true,
  provides: INotebookCellExecutor,
  activate: (): INotebookCellExecutor => {
    console.warn('Ripple: Activated reactive cell executor.');
    const executor = new ReactiveCellExecutor(stateManager);
    return Object.freeze({
      runCell: executor.runCell.bind(executor)
    });
  }
};

/**
 * Plugin B: Sets up the UI (toolbar buttons, dependency indicators).
 *
 * Wires the ReactiveStateManager to actual notebook panels via INotebookTracker.
 */
const uiPlugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-ripple:ui',
  description:
    'Provides the Ripple reactive notebook UI: toggle button and dependency indicators.',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ITranslator],
  activate: (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    translator: ITranslator | null
  ): void => {
    // Register the toggle command.
    registerToggleCommand(app, tracker, stateManager, translator ?? undefined);

    // Set up each notebook panel as it is created.
    tracker.widgetAdded.connect(
      (_sender: INotebookTracker, panel: NotebookPanel) => {
        setupNotebookPanel(app, panel);
      }
    );

    // Also set up any already-open notebooks.
    tracker.forEach((panel: NotebookPanel) => {
      setupNotebookPanel(app, panel);
    });

    console.warn('Ripple: UI plugin activated.');
  }
};

/**
 * Set up reactive features for a single notebook panel.
 */
function setupNotebookPanel(app: JupyterFrontEnd, panel: NotebookPanel): void {
  // Create the reactive state for this notebook first (needed by toolbar widget).
  const state = stateManager.getOrCreateState(panel);

  // Add the toolbar toggle widget, wired to this panel's state.
  addToolbarButton(panel, app, state);

  // Update indicators whenever the reactive state changes.
  state.stateChanged.connect(() => {
    updateDependencyIndicators(panel, state);
  });

  // Clean up when the panel is disposed.
  panel.disposed.connect(() => {
    clearDependencyIndicators(panel);
  });
}

/**
 * Export all plugins.
 */
const plugins: JupyterFrontEndPlugin<unknown>[] = [executorPlugin, uiPlugin];
export default plugins;
