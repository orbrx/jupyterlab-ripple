// Copyright (c) Orange Bricks
// Distributed under the terms of the MIT License.

import type { Kernel, KernelMessage } from '@jupyterlab/services';

/**
 * Result of analyzing a cell's source code for variable definitions and references.
 */
export interface IAnalysisResult {
  defs: string[];
  refs: string[];
}

/**
 * Python code snippet that performs AST analysis on a cell's source.
 * Sent as a silent execution request to the kernel.
 *
 * The snippet:
 * 1. Decodes the cell source from base64 (safe embedding of arbitrary code)
 * 2. Strips IPython magic commands (%, !, %%) and replaces with `pass`
 * 3. Parses the cleaned source with ast.parse()
 * 4. Walks the AST to collect definitions (assignments, function/class defs, imports)
 *    and references (variable loads)
 * 5. Removes self-defined variables and builtins from references
 * 6. Prints a JSON result: {"defs": [...], "refs": [...]}
 */
function buildAnalysisCode(cellSource: string): string {
  // Use base64 encoding to safely embed arbitrary cell source in Python.
  const encoded = btoa(unescape(encodeURIComponent(cellSource)));

  return `
import ast as _ast, json as _json, base64 as _b64
try:
    _source = _b64.b64decode("${encoded}").decode("utf-8")
    # Strip magic commands: lines starting with %, !, or %%
    _lines = _source.split('\\n')
    _cleaned = []
    _in_cell_magic = False
    for _line in _lines:
        _stripped = _line.lstrip()
        if _in_cell_magic:
            _cleaned.append('pass')
            continue
        if _stripped.startswith('%%'):
            _in_cell_magic = True
            _cleaned.append('pass')
        elif _stripped.startswith('%') or _stripped.startswith('!'):
            _cleaned.append('pass')
        else:
            _cleaned.append(_line)
    _source = '\\n'.join(_cleaned)
    _tree = _ast.parse(_source)
    _defs = set()
    _refs = set()
    for _node in _ast.walk(_tree):
        if isinstance(_node, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
            _defs.add(_node.name)
        elif isinstance(_node, _ast.Name):
            if isinstance(_node.ctx, _ast.Store):
                _defs.add(_node.id)
            elif isinstance(_node.ctx, (_ast.Load, _ast.Del)):
                _refs.add(_node.id)
        elif isinstance(_node, _ast.Import):
            for _alias in _node.names:
                _defs.add(_alias.asname or _alias.name.split('.')[0])
        elif isinstance(_node, _ast.ImportFrom):
            for _alias in _node.names:
                if _alias.name != '*':
                    _defs.add(_alias.asname or _alias.name)
        elif isinstance(_node, (_ast.For, _ast.comprehension)):
            pass  # handled by Name(Store) on target
        elif isinstance(_node, _ast.Global):
            for _n in _node.names:
                _refs.add(_n)
    # In Python 3, comprehension iteration variables are scoped locally
    # and do not leak into the cell namespace. Remove them from _defs
    # unless they are also assigned at the top level.
    _comp_targets = set()
    for _node in _ast.walk(_tree):
        if isinstance(_node, _ast.comprehension):
            if isinstance(_node.target, _ast.Name):
                _comp_targets.add(_node.target.id)
            elif isinstance(_node.target, _ast.Tuple):
                for _elt in _ast.walk(_node.target):
                    if isinstance(_elt, _ast.Name):
                        _comp_targets.add(_elt.id)
    _top_defs = set()
    for _node in _ast.iter_child_nodes(_tree):
        if isinstance(_node, _ast.Assign):
            for _tgt_node in _node.targets:
                for _tgt in _ast.walk(_tgt_node):
                    if isinstance(_tgt, _ast.Name):
                        _top_defs.add(_tgt.id)
        elif isinstance(_node, (_ast.AnnAssign, _ast.AugAssign)):
            if _node.target:
                for _tgt in _ast.walk(_node.target):
                    if isinstance(_tgt, _ast.Name):
                        _top_defs.add(_tgt.id)
        elif isinstance(_node, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
            _top_defs.add(_node.name)
        elif isinstance(_node, _ast.Import):
            for _alias in _node.names:
                _top_defs.add(_alias.asname or _alias.name.split('.')[0])
        elif isinstance(_node, _ast.ImportFrom):
            for _alias in _node.names:
                if _alias.name != '*':
                    _top_defs.add(_alias.asname or _alias.name)
        elif isinstance(_node, _ast.For):
            for _tgt in _ast.walk(_node.target):
                if isinstance(_tgt, _ast.Name):
                    _top_defs.add(_tgt.id)
    _defs -= (_comp_targets - _top_defs)
    # Remove self-defined refs and builtins
    import builtins as _builtins
    _refs -= _defs
    _refs -= set(dir(_builtins))
    # Remove underscore-prefixed (cell-local) variables
    _defs = {_d for _d in _defs if not _d.startswith('_')}
    _refs = {_r for _r in _refs if not _r.startswith('_')}
    print(_json.dumps({"defs": sorted(_defs), "refs": sorted(_refs)}))
except Exception as _e:
    print(_json.dumps({"defs": [], "refs": [], "error": str(_e)}))
`.trim();
}

/**
 * Analyze a cell's source code by sending a silent execution request to the kernel.
 *
 * @param source - The cell's source code.
 * @param kernel - The kernel connection to use.
 * @returns The analysis result with defined and referenced variables.
 */
export async function analyzeCell(
  source: string,
  kernel: Kernel.IKernelConnection
): Promise<IAnalysisResult> {
  const code = buildAnalysisCode(source);

  return new Promise<IAnalysisResult>((resolve, reject) => {
    const future = kernel.requestExecute({
      code,
      silent: true,
      store_history: false
    });

    let result: IAnalysisResult = { defs: [], refs: [] };

    future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
      if (msg.header.msg_type === 'stream') {
        const content = msg.content as KernelMessage.IStreamMsg['content'];
        if (content.name === 'stdout') {
          try {
            const parsed = JSON.parse(content.text);
            result = {
              defs: parsed.defs ?? [],
              refs: parsed.refs ?? []
            };
          } catch {
            console.warn('Ripple: Failed to parse AST analysis result');
          }
        }
      }
    };

    future.done
      .then(() => {
        resolve(result);
      })
      .catch((err: unknown) => {
        console.warn('Ripple: AST analysis failed', err);
        resolve({ defs: [], refs: [] });
      });
  });
}
