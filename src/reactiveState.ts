// Copyright (c) Orange Bricks
// Distributed under the terms of the MIT License.

import type { Cell } from '@jupyterlab/cells';
import type { INotebookModel } from '@jupyterlab/notebook';
import type { NotebookPanel } from '@jupyterlab/notebook';
import type { Kernel } from '@jupyterlab/services';
import { Signal } from '@lumino/signaling';
import type { ISignal } from '@lumino/signaling';
import { analyzeCell } from './analyzer';
import {
  buildGraph,
  detectCycles,
  findConflicts,
  getDownstreamCells,
  hashSource
} from './dag';
import type { ICellAnalysis, IDependencyGraph, IVariableConflict } from './dag';

/**
 * Per-notebook reactive state.
 */
export class ReactiveNotebookState {
  constructor(panel: NotebookPanel, enabledByDefault = true) {
    this._panel = panel;
    this._analysisCache = new Map();
    this._graph = null;
    this._enabled = enabledByDefault;
    this._staleCells = new Set();
    this._executedCells = new Set();
    this._cycleCells = new Set();
    this._conflictCells = new Set();
    this._debounceTimers = new Map();
    this._activeRunCells = 0;

    this._connectCellListeners();
    this._connectKernelListeners();

    if (this._enabled) {
      void this._scheduleInitialBuild();
    }
  }

  /**
   * Schedule the initial graph build for when the kernel first becomes idle.
   * This avoids racing with Run All or other user-initiated executions that
   * happen immediately after opening the notebook.
   *
   * If a cell execution starts before the kernel goes idle (e.g. the user
   * clicks Run All while the kernel is still starting), the build is skipped
   * -- the normal per-cell analysis in runCell will populate the graph
   * incrementally instead.
   */
  private async _scheduleInitialBuild(): Promise<void> {
    try {
      const ctx = this._panel.context;
      await ctx.ready;
      await ctx.sessionContext.ready;

      if (!this._enabled || this._activeRunCells > 0) {
        return;
      }

      await this._waitForKernelIdle();

      if (!this._enabled || this._activeRunCells > 0 || this._wasBatch) {
        return;
      }

      await this.rebuildAll();
      this._stateChanged.emit(void 0);
    } catch {
      // Kernel unavailable or panel disposed -- silently skip.
    }
  }

  /**
   * Return a promise that resolves once the kernel status reaches 'idle'.
   */
  private _waitForKernelIdle(): Promise<void> {
    const sessionContext = this._panel.context.sessionContext;
    const kernel = sessionContext.session?.kernel;
    if (kernel?.status === 'idle') {
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      const onStatus = (_sender: unknown, status: Kernel.Status): void => {
        if (status === 'idle') {
          sessionContext.statusChanged.disconnect(onStatus);
          resolve();
        }
      };
      sessionContext.statusChanged.connect(onStatus);
    });
  }

  /**
   * Whether reactivity is enabled for this notebook.
   */
  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * Signal emitted when the reactive state changes (enabled/disabled, graph rebuilt).
   */
  get stateChanged(): ISignal<this, void> {
    return this._stateChanged;
  }

  /**
   * The current dependency graph, or null if not yet built.
   */
  get graph(): IDependencyGraph | null {
    return this._graph;
  }

  /**
   * Set of cell IDs that are stale (need re-execution).
   */
  get staleCells(): ReadonlySet<string> {
    return this._staleCells;
  }

  /**
   * Set of cell IDs involved in dependency cycles.
   */
  get cycleCells(): ReadonlySet<string> {
    return this._cycleCells;
  }

  /**
   * Set of cell IDs with variable definition conflicts.
   */
  get conflictCells(): ReadonlySet<string> {
    return this._conflictCells;
  }

  /**
   * Current variable conflicts.
   */
  get conflicts(): IVariableConflict[] {
    return this._conflicts;
  }

  /**
   * The notebook panel this state is associated with.
   */
  get panel(): NotebookPanel {
    return this._panel;
  }

  /**
   * Whether a live kernel connection is available for AST analysis.
   */
  get hasKernel(): boolean {
    return this._getKernel() !== null;
  }

  /**
   * Whether the current group of runCell calls is a batch (e.g. Run All).
   * Once two or more calls overlap, every call in the group is considered
   * part of the batch -- including the last one to finish.
   */
  get isRunningBatch(): boolean {
    return this._wasBatch;
  }

  /**
   * Increment the active runCell counter. Returns a disposer function.
   */
  enterRunCell(): () => void {
    this._activeRunCells++;
    if (this._activeRunCells > 1) {
      this._wasBatch = true;
    }
    return () => {
      this._activeRunCells--;
      if (this._activeRunCells === 0) {
        const wasBatch = this._wasBatch;
        this._wasBatch = false;
        if (wasBatch) {
          this._stateChanged.emit(void 0);
        }
      }
    };
  }

  /**
   * Toggle reactivity on/off.
   */
  async toggle(): Promise<void> {
    this._enabled = !this._enabled;
    if (this._enabled) {
      await this.rebuildAll();
    } else {
      this._graph = null;
      this._staleCells.clear();
      this._executedCells.clear();
      this._cycleCells.clear();
      this._conflictCells.clear();
      this._conflicts = [];
    }
    this._stateChanged.emit(void 0);
  }

  /**
   * Analyze a single cell and update the graph.
   */
  async analyzeSingleCell(cellId: string, source: string): Promise<void> {
    const kernel = this._getKernel();
    if (!kernel) {
      return;
    }

    const srcHash = hashSource(source);

    // Check cache.
    const cached = this._analysisCache.get(cellId);
    if (cached && cached.sourceHash === srcHash) {
      return;
    }

    const result = await analyzeCell(source, kernel);
    const analysis: ICellAnalysis = {
      cellId,
      defines: new Set(result.defs),
      references: new Set(result.refs),
      sourceHash: srcHash
    };

    this._analysisCache.set(cellId, analysis);
    this._rebuildGraphFromCache();
  }

  /**
   * Re-analyze all cells and rebuild the graph.
   */
  async rebuildAll(): Promise<void> {
    const kernel = this._getKernel();
    if (!kernel) {
      return;
    }

    const notebook = this._panel.content;
    const cells = notebook.widgets;
    this._analysisCache.clear();

    const promises: Promise<void>[] = [];
    for (const cell of cells) {
      if (cell.model.type === 'code') {
        const cellId = cell.model.sharedModel.getId();
        const source = cell.model.sharedModel.getSource();
        if (source.trim()) {
          promises.push(this.analyzeSingleCell(cellId, source));
        }
      }
    }

    await Promise.all(promises);
    this._rebuildGraphFromCache();
    this._stateChanged.emit(void 0);
  }

  /**
   * Get the topologically-sorted downstream cells that need re-execution.
   */
  getDownstreamExecutionOrder(cellId: string): string[] {
    if (!this._graph) {
      return [];
    }

    const downstream = getDownstreamCells(cellId, this._graph);
    // Filter out cells that are in a cycle.
    return downstream.filter(id => !this._cycleCells.has(id));
  }

  /**
   * Remove a cell from the analysis cache and rebuild the graph.
   */
  removeCell(cellId: string): void {
    this._analysisCache.delete(cellId);
    this._staleCells.delete(cellId);
    if (this._enabled) {
      this._rebuildGraphFromCache();
      this._stateChanged.emit(void 0);
    }
  }

  /**
   * Mark downstream cells of the given cell as stale.
   * Only cells that have been executed at least once are marked --
   * a cell that has never run cannot be "out of date".
   */
  markDownstreamStale(cellId: string): void {
    if (!this._graph) {
      return;
    }
    const downstream = getDownstreamCells(cellId, this._graph);
    for (const id of downstream) {
      if (this._executedCells.has(id)) {
        this._staleCells.add(id);
      }
    }
    this._stateChanged.emit(void 0);
  }

  /**
   * Clear the stale status of a cell.
   */
  clearStale(cellId: string): void {
    this._staleCells.delete(cellId);
  }

  /**
   * Cancel any pending debounced analysis for a cell.
   * Call before executing a cell to prevent a stale-marking race where
   * an in-flight debounce timer re-marks downstream cells after
   * propagation has already cleared them.
   */
  cancelPendingAnalysis(cellId: string): void {
    const timer = this._debounceTimers.get(cellId);
    if (timer) {
      clearTimeout(timer);
      this._debounceTimers.delete(cellId);
    }
  }

  /**
   * Emit the stateChanged signal so the UI repaints indicators.
   * Call after batch modifications to stale/executed sets.
   */
  notifyChanged(): void {
    this._stateChanged.emit(void 0);
  }

  /**
   * Record that a cell has been executed at least once in this session.
   */
  markExecuted(cellId: string): void {
    this._executedCells.add(cellId);
  }

  /**
   * Whether a cell has been executed at least once in this session.
   */
  hasBeenExecuted(cellId: string): boolean {
    return this._executedCells.has(cellId);
  }

  /**
   * Whether all upstream dependencies of a cell have been executed.
   */
  allUpstreamExecuted(cellId: string): boolean {
    if (!this._graph) {
      return false;
    }
    const upstream = this._graph.upstreamEdges.get(cellId);
    if (!upstream || upstream.size === 0) {
      return true;
    }
    for (const depId of upstream) {
      if (!this._executedCells.has(depId)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Dispose of this state.
   */
  dispose(): void {
    for (const timer of this._debounceTimers.values()) {
      clearTimeout(timer);
    }
    this._debounceTimers.clear();
    this._executedCells.clear();
    this._disconnectKernelListeners();
    Signal.clearData(this);
  }

  /**
   * Connect to kernel status changes to detect restarts.
   */
  private _connectKernelListeners(): void {
    const sessionContext = this._panel.context.sessionContext;
    sessionContext.statusChanged.connect(this._onKernelStatus, this);
    sessionContext.kernelChanged.connect(this._onKernelChanged, this);
  }

  /**
   * Disconnect kernel listeners.
   */
  private _disconnectKernelListeners(): void {
    const sessionContext = this._panel.context.sessionContext;
    sessionContext.statusChanged.disconnect(this._onKernelStatus, this);
    sessionContext.kernelChanged.disconnect(this._onKernelChanged, this);
  }

  /**
   * Reset execution tracking when the kernel restarts.
   * The dependency graph (derived from source code) is preserved;
   * only runtime state is cleared. A lazy rebuild is scheduled so
   * the analysis cache is refreshed once the new kernel is idle.
   */
  private _onKernelStatus(_sender: unknown, status: Kernel.Status): void {
    if (status === 'restarting' || status === 'autorestarting') {
      this._executedCells.clear();
      this._staleCells.clear();
      this._stateChanged.emit(void 0);
      if (this._enabled) {
        void this._scheduleInitialBuild();
      }
    }
  }

  /**
   * Reset execution tracking when the kernel changes (shutdown / switch).
   * The graph and analysis cache are kept so that dependency indicators
   * remain visible in a dimmed state. A lazy rebuild is scheduled to
   * refresh the analysis once a new kernel becomes available.
   */
  private _onKernelChanged(): void {
    this._executedCells.clear();
    this._staleCells.clear();
    this._stateChanged.emit(void 0);
    if (this._enabled) {
      void this._scheduleInitialBuild();
    }
  }

  /**
   * Connect content change listeners for all cells.
   */
  private _connectCellListeners(): void {
    const notebook = this._panel.content;
    for (const cell of notebook.widgets) {
      this._connectCellContentListener(cell);
    }

    // Listen for new cells being added.
    if (notebook.model) {
      notebook.model.cells.changed.connect(this._onCellsChanged, this);
    }
  }

  /**
   * Connect a content change listener for a single cell.
   */
  private _connectCellContentListener(cell: Cell): void {
    cell.model.contentChanged.connect(this._onCellContentChanged, this);
  }

  /**
   * Handle cell content changes with debouncing.
   */
  private _onCellContentChanged(cellModel: Cell['model']): void {
    if (!this._enabled) {
      return;
    }

    const cellId = cellModel.sharedModel.getId();

    // Debounce analysis: wait 500ms after last keystroke.
    const existing = this._debounceTimers.get(cellId);
    if (existing) {
      clearTimeout(existing);
    }

    this._debounceTimers.set(
      cellId,
      window.setTimeout(() => {
        this._debounceTimers.delete(cellId);
        const source = cellModel.sharedModel.getSource();
        if (source.trim() && cellModel.type === 'code') {
          const cached = this._analysisCache.get(cellId);
          if (cached && cached.sourceHash === hashSource(source)) {
            return;
          }
          void this.analyzeSingleCell(cellId, source).then(() => {
            this.markDownstreamStale(cellId);
          });
        }
      }, 500)
    );
  }

  /**
   * Handle cells being added or removed.
   */
  private _onCellsChanged(): void {
    if (!this._enabled) {
      return;
    }

    // Re-connect listeners for all cells.
    const notebook = this._panel.content;
    for (const cell of notebook.widgets) {
      // Disconnect first to avoid duplicates, then reconnect.
      cell.model.contentChanged.disconnect(this._onCellContentChanged, this);
      this._connectCellContentListener(cell);
    }

    // Rebuild the graph since cell list changed.
    void this.rebuildAll();
  }

  /**
   * Rebuild the graph from the analysis cache.
   */
  private _rebuildGraphFromCache(): void {
    const analyses = Array.from(this._analysisCache.values());
    const cellOrder = this._getCellOrder();
    this._graph = buildGraph(analyses, cellOrder);

    // Detect cycles.
    const cycles = detectCycles(this._graph);
    this._cycleCells.clear();
    for (const cycle of cycles) {
      for (const cellId of cycle) {
        this._cycleCells.add(cellId);
      }
    }

    // Detect conflicts.
    this._conflicts = findConflicts(analyses);
    this._conflictCells.clear();
    for (const conflict of this._conflicts) {
      for (const cellId of conflict.cellIds) {
        this._conflictCells.add(cellId);
      }
    }
  }

  /**
   * Get the cell order from the notebook.
   */
  private _getCellOrder(): string[] {
    const notebook = this._panel.content;
    const order: string[] = [];
    for (const cell of notebook.widgets) {
      if (cell.model.type === 'code') {
        order.push(cell.model.sharedModel.getId());
      }
    }
    return order;
  }

  /**
   * Get the kernel connection, if available.
   */
  private _getKernel(): Kernel.IKernelConnection | null {
    return this._panel.context.sessionContext.session?.kernel ?? null;
  }

  private _panel: NotebookPanel;
  private _enabled: boolean;
  private _activeRunCells: number;
  private _wasBatch = false;
  private _graph: IDependencyGraph | null;
  private _analysisCache: Map<string, ICellAnalysis>;
  private _staleCells: Set<string>;
  private _executedCells: Set<string>;
  private _cycleCells: Set<string>;
  private _conflictCells: Set<string>;
  private _conflicts: IVariableConflict[] = [];
  private _debounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  private _stateChanged = new Signal<this, void>(this);
}

/**
 * Manages reactive state across all open notebooks.
 */
export class ReactiveStateManager {
  /**
   * Set a callback that returns the current default for the enabled setting.
   */
  setEnabledDefault(getter: () => boolean): void {
    this._enabledDefault = getter;
  }

  /**
   * Get or create the reactive state for a notebook panel.
   */
  getOrCreateState(panel: NotebookPanel): ReactiveNotebookState {
    let state = this._states.get(panel);
    if (!state) {
      state = new ReactiveNotebookState(panel, this._enabledDefault());
      this._states.set(panel, state);

      // Clean up when the panel is disposed.
      panel.disposed.connect(() => {
        const s = this._states.get(panel);
        if (s) {
          s.dispose();
          this._states.delete(panel);
        }
      });
    }
    return state;
  }

  /**
   * Get the reactive state for a notebook model, if it exists.
   */
  getStateByModel(model: INotebookModel): ReactiveNotebookState | null {
    for (const [panel, state] of this._states) {
      if (panel.context.model === model) {
        return state;
      }
    }
    return null;
  }

  /**
   * Find a Cell widget by its ID in a notebook panel.
   */
  findCellWidget(panel: NotebookPanel, cellId: string): Cell | null {
    for (const cell of panel.content.widgets) {
      if (cell.model.sharedModel.getId() === cellId) {
        return cell;
      }
    }
    return null;
  }

  private _states = new Map<NotebookPanel, ReactiveNotebookState>();
  private _enabledDefault: () => boolean = () => true;
}
