# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Technology Stack

- **Language**: TypeScript (strict mode)
- **Framework**: JupyterLab 4.x extension (frontend-only, no server component)
- **Widget toolkit**: Lumino 2.x (signals, widgets, disposables)
- **Editor**: CodeMirror 6 (via JupyterLab)
- **Build**: TypeScript compiler + Jupyter labextension builder
- **Package manager**: jlpm (JupyterLab's pinned yarn)
- **Testing**: Jest (unit), Playwright/Galata (integration)
- **Linting**: ESLint, Prettier, Stylelint

## Environment Setup

This project uses a conda environment. Before running any commands:

```bash
conda activate jupyterlab-ripple
```

## Build Commands

```bash
jlpm install          # Install dependencies
jlpm build:lib        # Compile TypeScript only
jlpm build            # Full build (lib + labextension)
jlpm test             # Run Jest unit tests
jlpm lint:check       # Check ESLint + Prettier + Stylelint
jlpm lint             # Auto-fix lint issues
jlpm watch            # Watch mode for development
```

For development install:

```bash
pip install -e "."
jupyter labextension develop . --overwrite
```

## Architecture

The extension replaces JupyterLab's default `INotebookCellExecutor` with a reactive version that automatically re-executes downstream dependent cells.

### Core modules

| File                             | Responsibility                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `src/index.ts`                   | Plugin registration (two plugins: executor + UI)                               |
| `src/dag.ts`                     | Dependency graph data structures, topological sort, cycle detection            |
| `src/analyzer.ts`                | Kernel-side Python AST analysis via silent `requestExecute`                    |
| `src/reactiveState.ts`           | Per-notebook state management (analysis cache, graph, stale/conflict tracking) |
| `src/reactiveCellExecutor.ts`    | Custom cell executor wrapping `runCell` with reactive propagation              |
| `src/ui/toggleButton.ts`         | Toolbar toggle button and command registration                                 |
| `src/ui/dependencyIndicators.ts` | CSS class management for cell dependency visualization                         |

### Key algorithms

- **Topological sort**: Kahn's algorithm in `getDownstreamCells()` — determines execution order for downstream dependents
- **Cycle detection**: Tarjan's strongly connected components in `detectCycles()` — identifies circular dependencies
- **AST analysis**: Python `ast.parse()` sent as silent kernel execution — extracts variable defs/refs per cell

### Data flow

1. User executes a cell
2. `ReactiveCellExecutor.runCell()` delegates to default `runCell`
3. If reactive mode is on, re-analyzes the cell via `analyzeCell()` (kernel-side AST)
4. Rebuilds the dependency graph via `buildGraph()`
5. Gets downstream cells in topological order via `getDownstreamCells()`
6. Executes each downstream cell sequentially via default `runCell`

## Code Style

- Single quotes, no trailing commas, arrow parens avoided (Prettier config in package.json)
- Interfaces prefixed with `I` (e.g., `ICellAnalysis`, `IDependencyGraph`)
- Private members prefixed with `_` (Lumino convention)
- Use `console.warn()` for operational messages, `console.error()` for errors
- No `console.log()` — the extension uses `console.warn()` for all status messages
- Import types with `import type` where possible

## Settings Schema

Extension settings are defined in `schema/plugin.json`:

- `enabled`: whether reactive mode is on by default
- `debounceInterval`: ms to wait before re-analyzing after keystrokes
- `stopOnError`: whether to halt downstream propagation on cell error
