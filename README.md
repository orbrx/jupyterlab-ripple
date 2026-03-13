<h1 align="center">
  <img src="https://github.com/user-attachments/assets/99abd1a7-7e99-4d20-b72c-892e0d7804d8" alt="Orange Bricks logo" height="64" valign="middle">
  <span>Ripple</span>
</h1>
<p align="center">
  Reactive notebook execution in Jupyter
</p>

<p align="center">
  <a href="https://github.com/orbrx/jupyterlab-ripple/actions/workflows/build.yml"><img src="https://github.com/orbrx/jupyterlab-ripple/workflows/Build/badge.svg" alt="Github Actions Status"></a>
  <a href="https://notebook.link/github.com/orbrx/jupyterlab-ripple/?path=demo.ipynb"><img src="https://img.shields.io/badge/notebook-link-e2d610?logo=jupyter&logoColor=white" alt="Try on notebook.link"></a>
  <a href="https://labextensions.dev/extensions/jupyterlab-ripple"><img src="https://labextensions.dev/api/badge/jupyterlab-ripple?metric=downloads&leftColor=%23555&rightColor=%23F37620&style=flat" alt="jupyterlab-ripple"></a>
</p>

Run a cell, and Ripple automatically re-runs every cell that depends on it.
No more hunting for stale outputs or manually replaying half the notebook.
Install it, and reactivity is on from the start.

<p align="center">
  <img src="https://github.com/user-attachments/assets/b911755d-8efe-4fff-841b-a5aeec179d86" alt="Ripple demo: change a variable and watch downstream cells update automatically" width="800">
</p>

## Highlights

- **Always in sync** — change a variable, downstream cells re-run automatically
- **Visual dependency map** — colored borders show upstream (blue), downstream (green), stale (amber), and conflict/cycle (red) cells at a glance
- **Zero migration** — `pip install`, and it just works. Standard `ipykernel`, your existing `.ipynb` files, no custom kernel or new notebook format. Reactive by default.
- **Cycle-safe** — circular dependencies are detected and flagged, never silently looped
- **Per-notebook control** — toggle reactive mode independently for each notebook

## Why Ripple

Notebooks give you the freedom to run cells in any order, but that flexibility
comes with a cost: forget to re-run a downstream cell and your outputs go stale.
The longer the notebook, the easier it is to lose track. Ripple takes care of
that for you.

Imagine three cells:

```python
# Cell 1
x = 1
```

```python
# Cell 2
y = x * 2
```

```python
# Cell 3
print(f"Result: {y}")
```

Change `x = 1` to `x = 10` and run Cell 1. Ripple re-executes Cell 2 and
Cell 3 in dependency order — no manual re-running, no stale outputs.

## Install

Requires JupyterLab >= 4.0.0.

```bash
pip install jupyterlab_ripple
```

Or [try it online](https://notebook.link/github.com/orbrx/jupyterlab-ripple/?path=demo.ipynb) without installing anything.

## Getting Started

After installing, Ripple is active by default. Just work as you normally would:

1. Edit and run a cell
2. Watch every downstream cell update automatically

To disable reactivity for a notebook, click the **Ripple** button in the toolbar.

## Configuration

Ripple exposes three settings in **Settings → Ripple** (or `schema/plugin.json`):

| Setting            | Default  | Description                                                      |
| ------------------ | -------- | ---------------------------------------------------------------- |
| `enabled`          | `true`   | Whether reactive mode is on by default for new notebooks         |
| `debounceInterval` | `500` ms | Time to wait after the last keystroke before re-analyzing a cell |
| `stopOnError`      | `true`   | Whether to stop executing downstream cells when a cell errors    |

## Limitations

- **Side effects not tracked** — `list.append(x)` or `obj.attr = val` won't trigger downstream re-runs
- **Magic commands** — `%` and `!` lines are stripped before AST analysis
- **Dynamic code** — `exec()`, `eval()`, and metaprogramming may confuse the analyzer

<details>
<summary><strong>How it works under the hood</strong></summary>

<br>

Ripple sends each cell's source to the kernel for static analysis using Python's
`ast.parse()`, extracting variable definitions and references. From these it
builds a dependency graph across all cells in the notebook. When you execute a
cell, Ripple walks the graph to find every transitive downstream dependent and
re-runs them in topological order — all through JupyterLab's standard execution
machinery, no custom kernel needed.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full architecture, algorithms,
and data-flow details.

</details>

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for
development setup, architecture overview, code style, testing, and linting
instructions.

## Uninstall

```bash
pip uninstall jupyterlab_ripple
```

## License

MIT
