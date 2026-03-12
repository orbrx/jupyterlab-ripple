// Copyright (c) Orange Bricks
// Distributed under the terms of the MIT License.

import type { JupyterFrontEnd } from '@jupyterlab/application';
import type { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import type { ITranslator } from '@jupyterlab/translation';
import { nullTranslator } from '@jupyterlab/translation';
import { Widget } from '@lumino/widgets';
import type { ReactiveNotebookState, ReactiveStateManager } from '../reactiveState';

/**
 * Command ID for toggling reactivity.
 */
export const TOGGLE_COMMAND = 'ripple:toggle';

/**
 * Register the toggle command and add a toolbar button to notebooks.
 */
export function registerToggleCommand(
  app: JupyterFrontEnd,
  tracker: INotebookTracker,
  stateManager: ReactiveStateManager,
  translator?: ITranslator
): void {
  const trans = (translator ?? nullTranslator).load('jupyterlab');

  app.commands.addCommand(TOGGLE_COMMAND, {
    label: trans.__('Toggle Reactive Mode'),
    caption: trans.__(
      'Enable/disable automatic re-execution of dependent cells'
    ),
    isToggled: () => {
      const panel = tracker.currentWidget;
      if (!panel) {
        return false;
      }
      const state = stateManager.getOrCreateState(panel);
      return state.enabled;
    },
    isEnabled: () => {
      return tracker.currentWidget !== null;
    },
    execute: async () => {
      const panel = tracker.currentWidget;
      if (!panel) {
        return;
      }
      const state = stateManager.getOrCreateState(panel);
      await state.toggle();
    }
  });
}

/**
 * Add the reactive toggle widget to a notebook panel's toolbar, to the right
 * of the spacer (i.e. next to the kernel name indicator).
 */
export function addToolbarButton(
  panel: NotebookPanel,
  app: JupyterFrontEnd,
  state: ReactiveNotebookState
): void {
  const widget = new ReactiveToggleWidget(app, state);
  // Insert before kernelName so it sits just to the left of the kernel name.
  panel.toolbar.insertBefore('kernelName', 'reactiveToggle', widget);
}

/**
 * A compact button with a visual checkbox indicator that reflects and toggles
 * reactive mode. Using a single <button> avoids the native <input> double-click
 * issue where clicking the checkbox directly could desync visual state.
 */
class ReactiveToggleWidget extends Widget {
  constructor(app: JupyterFrontEnd, state: ReactiveNotebookState) {
    super();
    this._app = app;
    this._state = state;
    this.addClass('jp-reactive-toggle-widget');

    this._button = document.createElement('button');
    this._button.className = 'jp-reactive-toggle-btn';
    this._button.title = 'Toggle reactive auto-execution of dependent cells';
    this._button.type = 'button';

    // Visual-only checkbox: pointer-events none so the button handles all clicks.
    this._checkbox = document.createElement('input');
    this._checkbox.type = 'checkbox';
    this._checkbox.className = 'jp-reactive-checkbox';
    this._checkbox.tabIndex = -1;
    this._checkbox.checked = state.enabled;

    const text = document.createElement('span');
    text.className = 'jp-reactive-text';
    text.textContent = 'Reactive';
    this._text = text;

    this._button.appendChild(this._checkbox);
    this._button.appendChild(this._text);
    this.node.appendChild(this._button);

    this._button.addEventListener('click', () => {
      void this._app.commands.execute(TOGGLE_COMMAND);
    });

    state.stateChanged.connect(this._onStateChanged, this);
  }

  dispose(): void {
    this._state.stateChanged.disconnect(this._onStateChanged, this);
    super.dispose();
  }

  private _onStateChanged(): void {
    this._checkbox.checked = this._state.enabled;
    this._text.textContent =
      this._state.enabled && !this._state.hasKernel
        ? 'Reactive (no kernel)'
        : 'Reactive';
  }

  private _app: JupyterFrontEnd;
  private _state: ReactiveNotebookState;
  private _button: HTMLButtonElement;
  private _checkbox: HTMLInputElement;
  private _text: HTMLSpanElement;
}
