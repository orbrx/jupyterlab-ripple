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
      target: '.jp-Notebook .jp-Cell:first-child',
      content:
        'After running cells, Ripple analyzes variable definitions and ' +
        'references to build a dependency graph. ' +
        'A blue left border marks upstream cells that define variables ' +
        'used by other cells.',
      placement: 'left',
      title: 'Upstream Cells (Blue Border)'
    },
    {
      target: '.jp-Notebook .jp-Cell:nth-child(2)',
      content:
        'A green left border marks downstream cells — they depend on ' +
        'variables from upstream cells. When you re-run an upstream cell, ' +
        'all its downstream dependents re-execute automatically.',
      placement: 'left',
      title: 'Downstream Cells (Green Border)'
    },
    {
      target: '.jp-Notebook',
      content:
        'If you edit an upstream cell without running it, its downstream ' +
        'dependents show an orange border to indicate they are stale. ' +
        'A red border warns about conflicts (a variable defined in ' +
        'multiple cells) or dependency cycles.',
      placement: 'right',
      title: 'Stale Cells & Conflicts'
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
