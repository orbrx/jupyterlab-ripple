# Contributing to Ripple

Thanks for your interest in contributing to Ripple! This guide covers
development setup, architecture, code conventions, and testing.

## Development Setup

You will need **Node.js** (for building the extension) and **Python** with
**JupyterLab >= 4.0.0**.

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

```bash
# Clone the repo
git clone https://github.com/orbrx/jupyterlab-ripple.git
cd jupyterlab-ripple

# Create a virtual environment and install in development mode
python -m venv .venv
source .venv/bin/activate
pip install --editable "."

# Link the development version with JupyterLab
jupyter labextension develop . --overwrite

# Build the extension
jlpm build
```

## Build Commands

```bash
jlpm install        # Install dependencies
jlpm build:lib      # Compile TypeScript only
jlpm build          # Full build (lib + labextension)
jlpm watch          # Watch mode for development
```

For active development, run `jlpm watch` in one terminal and JupyterLab in
another — the extension rebuilds automatically when source files change:

```bash
# Terminal 1
jlpm watch

# Terminal 2
jupyter lab
```

## Architecture

Ripple replaces JupyterLab's default `INotebookCellExecutor` plugin with a
reactive version that intercepts cell execution and automatically re-runs
downstream dependent cells.

### Core Modules

| File                             | Responsibility                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `src/index.ts`                   | Plugin registration (two plugins: executor + UI)                                      |
| `src/dag.ts`                     | Dependency graph, topological sort (Kahn's algorithm), cycle detection (Tarjan's SCC) |
| `src/analyzer.ts`                | Kernel-side Python AST analysis via silent `requestExecute`                           |
| `src/reactiveState.ts`           | Per-notebook state: analysis cache, graph, stale/conflict tracking                    |
| `src/reactiveCellExecutor.ts`    | Custom `INotebookCellExecutor` wrapping default `runCell`                             |
| `src/ui/toggleButton.ts`         | Toolbar toggle button and command registration                                        |
| `src/ui/dependencyIndicators.ts` | CSS class management for visual cell indicators                                       |

### Key Algorithms

- **Topological sort** — Kahn's algorithm in `getDownstreamCells()` determines
  execution order for downstream dependents
- **Cycle detection** — Tarjan's strongly connected components in
  `detectCycles()` identifies circular dependencies
- **AST analysis** — Python `ast.parse()` sent as a silent kernel execution
  extracts variable definitions and references per cell

### Data Flow

1. User executes a cell
2. `ReactiveCellExecutor.runCell()` delegates to the default `runCell`
3. If reactive mode is on, re-analyzes the cell via `analyzeCell()` (kernel-side
   AST)
4. Rebuilds the dependency graph via `buildGraph()`
5. Gets downstream cells in topological order via `getDownstreamCells()`
6. Executes each downstream cell sequentially via default `runCell`

## Code Style

- Single quotes, no trailing commas, arrow parens avoided (Prettier config in
  `package.json`)
- Interfaces prefixed with `I` (e.g., `ICellAnalysis`, `IDependencyGraph`)
- Private members prefixed with `_` (Lumino convention)
- Use `console.warn()` for operational messages, `console.error()` for errors —
  no `console.log()`
- Import types with `import type` where possible

## Testing

### Unit Tests

This extension uses [Jest](https://jestjs.io/) for JavaScript code testing:

```bash
jlpm test
```

### Integration Tests

Integration tests use [Playwright](https://playwright.dev/docs/intro) with
the JupyterLab helper
[Galata](https://github.com/jupyterlab/jupyterlab/tree/master/galata).

See [ui-tests/README.md](./ui-tests/README.md) for details.

## Linting

```bash
jlpm lint         # Auto-fix ESLint, Prettier, and Stylelint issues
jlpm lint:check   # Verify everything is clean (runs in CI)
```

Run `jlpm lint` before committing — Prettier formatting drift will fail CI.

## Packaging and Releases

See [RELEASE.md](RELEASE.md).
