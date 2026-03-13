// Copyright (c) Orange Bricks
// Distributed under the terms of the MIT License.

import { Signal } from '@lumino/signaling';
import type { Kernel } from '@jupyterlab/services';
import { ReactiveNotebookState } from '../reactiveState';
import { buildGraph, hashSource } from '../dag';
import type { ICellAnalysis } from '../dag';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

class MockSignal<T, U> extends Signal<T, U> {
  constructor(sender: T) {
    super(sender);
  }
  fire(args: U): void {
    this.emit(args);
  }
}

interface IMockSessionContext {
  statusChanged: MockSignal<any, Kernel.Status>;
  kernelChanged: MockSignal<any, any>;
  session: { kernel: { status: string } | null } | null;
  ready: Promise<void>;
}

function makeFakeCell(id: string, source = '', type = 'code') {
  return {
    model: {
      type,
      sharedModel: {
        getId: () => id,
        getSource: () => source
      },
      contentChanged: new Signal<any, void>({} as any)
    }
  };
}

function makeMockPanel(
  cells: ReturnType<typeof makeFakeCell>[],
  sessionContext?: IMockSessionContext
) {
  const sc: IMockSessionContext = sessionContext ?? {
    statusChanged: new MockSignal<any, Kernel.Status>({} as any),
    kernelChanged: new MockSignal<any, any>({} as any),
    session: { kernel: { status: 'idle' } },
    ready: Promise.resolve()
  };

  const panel: any = {
    context: {
      ready: Promise.resolve(),
      sessionContext: sc,
      model: {}
    },
    content: {
      widgets: cells,
      model: {
        cells: { changed: new Signal<any, void>({} as any) }
      }
    },
    disposed: new Signal<any, void>({} as any)
  };

  return { panel, sessionContext: sc };
}

function makeState(
  cells: ReturnType<typeof makeFakeCell>[],
  enabledByDefault = true
) {
  const { panel, sessionContext } = makeMockPanel(cells);
  const state = new ReactiveNotebookState(panel, enabledByDefault);
  return { state, panel, sessionContext };
}

// ---------------------------------------------------------------------------
// Helper to inject a pre-built graph into the state for tests that need one.
// ---------------------------------------------------------------------------
function injectGraph(
  state: ReactiveNotebookState,
  analyses: ICellAnalysis[],
  cellOrder: string[]
): void {
  const graph = buildGraph(analyses, cellOrder);
  (state as any)._graph = graph;
}

function cellAnalysis(
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
// Execution tracking
// ---------------------------------------------------------------------------
describe('ReactiveNotebookState – execution tracking', () => {
  it('markExecuted adds cell to executed set; hasBeenExecuted returns true', () => {
    const { state } = makeState([]);
    expect(state.hasBeenExecuted('cell-1')).toBe(false);

    state.markExecuted('cell-1');
    expect(state.hasBeenExecuted('cell-1')).toBe(true);
  });

  it('clearStale removes cell from stale set', () => {
    const { state } = makeState([]);
    // Manually add to stale set via the internal set.
    (state as any)._staleCells.add('cell-1');
    expect(state.staleCells.has('cell-1')).toBe(true);

    state.clearStale('cell-1');
    expect(state.staleCells.has('cell-1')).toBe(false);
  });

  it('notifyChanged emits stateChanged signal', () => {
    const { state } = makeState([]);
    const spy = jest.fn();
    state.stateChanged.connect(spy);

    state.notifyChanged();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('cancelPendingAnalysis clears a pending debounce timer', () => {
    const { state } = makeState([]);

    // Plant a fake timer.
    const timerId = setTimeout(() => {}, 10000);
    (state as any)._debounceTimers.set('cell-1', timerId);

    state.cancelPendingAnalysis('cell-1');

    expect((state as any)._debounceTimers.has('cell-1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Kernel restart behavior
// ---------------------------------------------------------------------------
describe('ReactiveNotebookState – kernel restart', () => {
  it('statusChanged("restarting") clears executedCells and staleCells', () => {
    const { state, sessionContext } = makeState([]);
    state.markExecuted('cell-1');
    state.markExecuted('cell-2');
    (state as any)._staleCells.add('cell-1');

    sessionContext.statusChanged.fire('restarting');

    expect(state.hasBeenExecuted('cell-1')).toBe(false);
    expect(state.hasBeenExecuted('cell-2')).toBe(false);
    expect(state.staleCells.size).toBe(0);
  });

  it('statusChanged("restarting") preserves the analysis cache', () => {
    const { state, sessionContext } = makeState([]);
    const fakeAnalysis = cellAnalysis('cell-1', ['x'], []);
    (state as any)._analysisCache.set('cell-1', fakeAnalysis);

    sessionContext.statusChanged.fire('restarting');

    expect((state as any)._analysisCache.has('cell-1')).toBe(true);
  });

  it('statusChanged("restarting") preserves the graph', () => {
    const { state, sessionContext } = makeState([]);
    const analyses = [
      cellAnalysis('A', ['x'], []),
      cellAnalysis('B', ['y'], ['x'])
    ];
    injectGraph(state, analyses, ['A', 'B']);
    expect(state.graph).not.toBeNull();

    sessionContext.statusChanged.fire('restarting');

    expect(state.graph).not.toBeNull();
  });

  it('statusChanged("restarting") emits stateChanged', () => {
    const { state, sessionContext } = makeState([]);
    const spy = jest.fn();
    state.stateChanged.connect(spy);

    sessionContext.statusChanged.fire('restarting');

    expect(spy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Kernel shutdown (kernelChanged) behavior
// ---------------------------------------------------------------------------
describe('ReactiveNotebookState – kernel shutdown', () => {
  it('kernelChanged clears executedCells', () => {
    const { state, sessionContext } = makeState([]);
    state.markExecuted('cell-1');

    sessionContext.kernelChanged.fire({});

    expect(state.hasBeenExecuted('cell-1')).toBe(false);
  });

  it('kernelChanged preserves graph and analysis cache', () => {
    const { state, sessionContext } = makeState([]);
    const analyses = [
      cellAnalysis('A', ['x'], []),
      cellAnalysis('B', ['y'], ['x'])
    ];
    injectGraph(state, analyses, ['A', 'B']);
    (state as any)._analysisCache.set('A', analyses[0]);

    sessionContext.kernelChanged.fire({});

    expect(state.graph).not.toBeNull();
    expect((state as any)._analysisCache.has('A')).toBe(true);
  });

  it('hasKernel returns false when kernel is null', () => {
    const { state, sessionContext } = makeState([]);
    sessionContext.session = { kernel: null };

    expect(state.hasKernel).toBe(false);
  });

  it('hasKernel returns true when kernel is available', () => {
    const { state, sessionContext } = makeState([]);
    sessionContext.session = { kernel: { status: 'idle' } };

    expect(state.hasKernel).toBe(true);
  });

  it('hasKernel returns false when session is null', () => {
    const { state, sessionContext } = makeState([]);
    sessionContext.session = null;

    expect(state.hasKernel).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Batch completion notification
// ---------------------------------------------------------------------------
describe('ReactiveNotebookState – batch tracking', () => {
  it('enterRunCell disposer emits stateChanged when batch ends (counter 2 → 0)', () => {
    const { state } = makeState([]);
    const spy = jest.fn();
    state.stateChanged.connect(spy);

    const exit1 = state.enterRunCell();
    const exit2 = state.enterRunCell();

    expect(state.isRunningBatch).toBe(true);
    spy.mockClear();

    exit1();
    expect(spy).not.toHaveBeenCalled();

    exit2();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('enterRunCell disposer does NOT emit stateChanged for single-cell execution', () => {
    const { state } = makeState([]);
    const spy = jest.fn();
    state.stateChanged.connect(spy);

    const exit = state.enterRunCell();
    expect(state.isRunningBatch).toBe(false);
    spy.mockClear();

    exit();
    expect(spy).not.toHaveBeenCalled();
  });

  it('isRunningBatch resets to false after batch completes', () => {
    const { state } = makeState([]);

    const exit1 = state.enterRunCell();
    const exit2 = state.enterRunCell();
    expect(state.isRunningBatch).toBe(true);

    exit1();
    exit2();
    expect(state.isRunningBatch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stale + execution interaction
// ---------------------------------------------------------------------------
describe('ReactiveNotebookState – markDownstreamStale', () => {
  it('only marks cells that are in executedCells', () => {
    const { state } = makeState([]);
    const analyses = [
      cellAnalysis('A', ['x'], []),
      cellAnalysis('B', ['y'], ['x']),
      cellAnalysis('C', ['z'], ['x'])
    ];
    injectGraph(state, analyses, ['A', 'B', 'C']);

    state.markExecuted('B');
    // C has never been executed.

    state.markDownstreamStale('A');

    expect(state.staleCells.has('B')).toBe(true);
    expect(state.staleCells.has('C')).toBe(false);
  });

  it('skips cells not in executedCells', () => {
    const { state } = makeState([]);
    const analyses = [
      cellAnalysis('A', ['x'], []),
      cellAnalysis('B', ['y'], ['x'])
    ];
    injectGraph(state, analyses, ['A', 'B']);
    // B never executed — should not be marked stale.

    state.markDownstreamStale('A');

    expect(state.staleCells.has('B')).toBe(false);
  });

  it('marks all executed downstream cells in a chain', () => {
    const { state } = makeState([]);
    const analyses = [
      cellAnalysis('A', ['x'], []),
      cellAnalysis('B', ['y'], ['x']),
      cellAnalysis('C', ['z'], ['y'])
    ];
    injectGraph(state, analyses, ['A', 'B', 'C']);

    state.markExecuted('B');
    state.markExecuted('C');

    state.markDownstreamStale('A');

    expect(state.staleCells.has('B')).toBe(true);
    expect(state.staleCells.has('C')).toBe(true);
  });

  it('does nothing when graph is null', () => {
    const { state } = makeState([]);
    // Graph is null by default before any build.
    state.markExecuted('A');

    state.markDownstreamStale('A');

    expect(state.staleCells.size).toBe(0);
  });

  it('emits stateChanged after marking stale', () => {
    const { state } = makeState([]);
    const analyses = [
      cellAnalysis('A', ['x'], []),
      cellAnalysis('B', ['y'], ['x'])
    ];
    injectGraph(state, analyses, ['A', 'B']);
    state.markExecuted('B');

    const spy = jest.fn();
    state.stateChanged.connect(spy);

    state.markDownstreamStale('A');

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------
describe('ReactiveNotebookState – getDownstreamExecutionOrder', () => {
  it('returns empty array when graph is null', () => {
    const { state } = makeState([]);
    expect(state.getDownstreamExecutionOrder('A')).toEqual([]);
  });

  it('returns downstream cells in topological order', () => {
    const { state } = makeState([]);
    const analyses = [
      cellAnalysis('A', ['x'], []),
      cellAnalysis('B', ['y'], ['x']),
      cellAnalysis('C', ['z'], ['y'])
    ];
    injectGraph(state, analyses, ['A', 'B', 'C']);

    expect(state.getDownstreamExecutionOrder('A')).toEqual(['B', 'C']);
  });

  it('filters out cycle cells from downstream order', () => {
    const { state } = makeState([]);
    const analyses = [
      cellAnalysis('A', ['x'], []),
      cellAnalysis('B', ['y'], ['x', 'z']),
      cellAnalysis('C', ['z'], ['y'])
    ];
    injectGraph(state, analyses, ['A', 'B', 'C']);
    // B and C form a cycle. Mark them in the internal cycle set.
    (state as any)._cycleCells.add('B');
    (state as any)._cycleCells.add('C');

    const downstream = state.getDownstreamExecutionOrder('A');
    expect(downstream).not.toContain('B');
    expect(downstream).not.toContain('C');
  });
});

describe('ReactiveNotebookState – removeCell', () => {
  it('removes cell from analysis cache and stale set', () => {
    const { state } = makeState([]);
    (state as any)._analysisCache.set(
      'cell-1',
      cellAnalysis('cell-1', ['x'], [])
    );
    (state as any)._staleCells.add('cell-1');

    state.removeCell('cell-1');

    expect((state as any)._analysisCache.has('cell-1')).toBe(false);
    expect(state.staleCells.has('cell-1')).toBe(false);
  });
});

describe('ReactiveNotebookState – dispose', () => {
  it('clears debounce timers and executed cells', () => {
    const { state } = makeState([]);
    const timerId = setTimeout(() => {}, 10000);
    (state as any)._debounceTimers.set('cell-1', timerId);
    state.markExecuted('cell-1');

    state.dispose();

    expect((state as any)._debounceTimers.size).toBe(0);
    expect(state.hasBeenExecuted('cell-1')).toBe(false);
  });
});
