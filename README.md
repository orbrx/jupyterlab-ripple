# jupyterlab-ripple

[![Github Actions Status](https://github.com/orbrx/jupyterlab-ripple/workflows/Build/badge.svg)](https://github.com/orbrx/jupyterlab-ripple/actions/workflows/build.yml)

**Ripple** brings reactive execution to JupyterLab notebooks.

When enabled, executing a cell automatically re-executes all downstream cells that depend on its variables — determined via Python AST analysis. No custom kernel required.

## How It Works

1. Click the **Ripple** button in the notebook toolbar to enable reactive mode
2. Edit and run a cell as usual
3. All cells that reference variables defined by that cell automatically re-execute in dependency order

Ripple uses kernel-side `ast.parse()` to statically analyze each cell's variable definitions and references, building a directed acyclic graph (DAG) of cell dependencies. When a cell executes, its transitive downstream dependents are re-run in topological order.

## Features

- **Automatic downstream execution** — change `x = 1` to `x = 2`, and every cell using `x` re-runs
- **Dependency visualization** — colored left borders show each cell's role in the dependency graph:
  - Blue: defines variables used by other cells (upstream)
  - Green: depends on variables from other cells (downstream)
  - Amber: stale — upstream changed but this cell hasn't re-run yet
  - Red: variable conflict (defined in multiple cells) or dependency cycle
- **Cycle detection** — circular dependencies are detected and flagged (not auto-executed)
- **Variable conflict warnings** — variables defined in multiple cells are highlighted
- **Per-notebook toggle** — enable/disable independently for each notebook
- **No custom kernel** — works with standard ipykernel via silent execution

## Architecture

| File                             | Purpose                                                                     |
| -------------------------------- | --------------------------------------------------------------------------- |
| `src/dag.ts`                     | Dependency graph, topological sort (Kahn's), cycle detection (Tarjan's SCC) |
| `src/analyzer.ts`                | Kernel-side Python AST analysis via silent `requestExecute`                 |
| `src/reactiveState.ts`           | Per-notebook state: analysis cache, graph, stale/conflict tracking          |
| `src/reactiveCellExecutor.ts`    | Custom `INotebookCellExecutor` wrapping default `runCell`                   |
| `src/ui/toggleButton.ts`         | Toolbar toggle and command registration                                     |
| `src/ui/dependencyIndicators.ts` | CSS class management for visual cell indicators                             |

The extension replaces JupyterLab's default `INotebookCellExecutor` plugin, intercepting cell execution to add reactive propagation.

## Limitations

- **Side effects not tracked** — `list.append(x)` or `obj.attr = val` won't trigger downstream re-runs
- **Magic commands** — `%` and `!` lines are stripped before AST analysis
- **Dynamic code** — `exec()`, `eval()`, and metaprogramming may confuse the analyzer

## Requirements

- JupyterLab >= 4.0.0

## Install

```bash
pip install jupyterlab_ripple
```

## Uninstall

```bash
pip uninstall jupyterlab_ripple
```

## Contributing

### Development install

Note: You will need NodeJS to build the extension package.

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

```bash
# Clone the repo to your local environment
# Change directory to the jupyterlab-ripple directory

# Set up a virtual environment and install package in development mode
python -m venv .venv
source .venv/bin/activate
pip install --editable "."

# Link your development version of the extension with JupyterLab
jupyter labextension develop . --overwrite

# Rebuild extension Typescript source after making changes
jlpm build
```

You can watch the source directory and run JupyterLab at the same time in different terminals to watch for changes in the extension's source and automatically rebuild the extension.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm watch
# Run JupyterLab in another terminal
jupyter lab
```

### Testing the extension

#### Frontend tests

This extension uses [Jest](https://jestjs.io/) for JavaScript code testing.

```sh
jlpm
jlpm test
```

#### Integration tests

This extension uses [Playwright](https://playwright.dev/docs/intro) for the integration tests (aka user level tests).
More precisely, the JupyterLab helper [Galata](https://github.com/jupyterlab/jupyterlab/tree/master/galata) is used to handle testing the extension in JupyterLab.

More information are provided within the [ui-tests](./ui-tests/README.md) README.

### Packaging the extension

See [RELEASE](RELEASE.md)

## License

MIT
