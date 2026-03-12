// Copyright (c) Orange Bricks
// Distributed under the terms of the MIT License.

import type { JupyterFrontEnd } from '@jupyterlab/application';

const TOUR_ADD_COMMAND = 'jupyterlab-tour:add';
const TOUR_LAUNCH_COMMAND = 'jupyterlab-tour:launch';
const TOUR_ID = 'jupyterlab-ripple:tour';

const TOUR_DEFINITION = {
  id: TOUR_ID,
  label: 'Ripple: Reactive Notebooks',
  hasHelpEntry: true,
  options: {
    disableScrolling: true
  },
  steps: [
    {
      target: '#jp-main-dock-panel',
      content:
        'Ripple adds reactive execution to JupyterLab. ' +
        'When you run a cell, all downstream cells that depend on its ' +
        'variables are automatically re-executed in topological order.',
      placement: 'center',
      title: 'Welcome to Ripple'
    },
    {
      target: '.jp-reactive-toggle-widget',
      content:
        'Click this toggle to enable or disable reactive mode. ' +
        'When the checkbox is checked and the label turns green, ' +
        'reactive execution is active for this notebook.',
      placement: 'bottom',
      title: 'Reactive Mode Toggle'
    },
    {
      target: '.jp-CodeCell',
      content:
        'After running cells, Ripple analyzes each code cell to find ' +
        'which variables it defines and references, then builds a ' +
        'dependency graph across the notebook. Cells that define ' +
        'variables used elsewhere get a blue left border (upstream).',
      placement: 'left',
      title: 'Upstream Cell (Blue Border)'
    },
    {
      target: '.jp-CodeCell + .jp-CodeCell',
      content:
        'Cells that reference variables from other cells are downstream ' +
        'dependents. They get a green left border and re-execute ' +
        'automatically when their upstream changes.',
      placement: 'left',
      title: 'Downstream Cell (Green Border)'
    },
    {
      target: '#jp-main-dock-panel',
      content:
        'Colored left borders show dependency status at a glance:\n\n' +
        '\u2022 Blue — upstream cell that defines variables used by others\n' +
        '\u2022 Green — downstream cell that depends on upstream variables\n' +
        '\u2022 Orange — stale cell whose upstream was edited but not re-run\n' +
        '\u2022 Red — conflict (variable defined in multiple cells) or cycle',
      placement: 'center',
      title: 'Dependency Indicators'
    },
    {
      target: '#jp-main-dock-panel',
      content:
        "That's it! Enable reactive mode and run your cells — Ripple " +
        "handles the rest. Hover over any cell's left border to see a " +
        'tooltip with its dependency details.',
      placement: 'center',
      title: "You're All Set"
    }
  ]
};

/**
 * Register the Ripple guided tour if jupyterlab-tour is installed.
 *
 * Uses the command-based API so no npm dependency on jupyterlab-tour is needed.
 * If the tour commands are not available, this is a silent no-op.
 */
export async function registerRippleTour(app: JupyterFrontEnd): Promise<void> {
  if (!app.commands.hasCommand(TOUR_ADD_COMMAND)) {
    return;
  }

  try {
    const handler = await app.commands.execute(TOUR_ADD_COMMAND, {
      tour: TOUR_DEFINITION
    });

    if (handler) {
      await app.commands.execute(TOUR_LAUNCH_COMMAND, {
        id: TOUR_ID,
        force: false
      });
    }
  } catch {
    console.warn('Ripple: Could not register guided tour.');
  }
}
