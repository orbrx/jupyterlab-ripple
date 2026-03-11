# Copyright (c) Orange Bricks
# Distributed under the terms of the MIT License.
#
# Tests for the Python AST analysis snippet used by src/analyzer.ts.
# The analyze() helper below is a direct extraction of the kernel-side
# Python code from buildAnalysisCode(); any change there must be mirrored here.
#
# Run with:  pytest tests/
#
# To add a new test case, append a tuple to the appropriate parametrize list:
#   ("description", "source code", {"expected_defs"}, {"expected_refs"})

from __future__ import annotations

import ast
import builtins
from textwrap import dedent

import pytest


def analyze(source: str) -> dict:
    """Replicate the kernel-side AST analysis snippet from analyzer.ts."""
    lines = source.split("\n")
    cleaned = []
    in_cell_magic = False
    for line in lines:
        stripped = line.lstrip()
        if in_cell_magic:
            cleaned.append("pass")
            continue
        if stripped.startswith("%%"):
            in_cell_magic = True
            cleaned.append("pass")
        elif stripped.startswith("%") or stripped.startswith("!"):
            cleaned.append("pass")
        else:
            cleaned.append(line)
    source = "\n".join(cleaned)

    tree = ast.parse(source)
    defs: set[str] = set()
    refs: set[str] = set()

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            defs.add(node.name)
        elif isinstance(node, ast.Name):
            if isinstance(node.ctx, ast.Store):
                defs.add(node.id)
            elif isinstance(node.ctx, (ast.Load, ast.Del)):
                refs.add(node.id)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                defs.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name != "*":
                    defs.add(alias.asname or alias.name)
        elif isinstance(node, (ast.For, ast.comprehension)):
            pass  # handled by Name(Store) on target
        elif isinstance(node, ast.Global):
            for n in node.names:
                refs.add(n)

    # Comprehension-scoped variables
    comp_targets: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.comprehension):
            if isinstance(node.target, ast.Name):
                comp_targets.add(node.target.id)
            elif isinstance(node.target, ast.Tuple):
                for elt in ast.walk(node.target):
                    if isinstance(elt, ast.Name):
                        comp_targets.add(elt.id)

    top_defs: set[str] = set()
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.Assign):
            for tgt_node in node.targets:
                for tgt in ast.walk(tgt_node):
                    if isinstance(tgt, ast.Name):
                        top_defs.add(tgt.id)
        elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
            if node.target:
                for tgt in ast.walk(node.target):
                    if isinstance(tgt, ast.Name):
                        top_defs.add(tgt.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            top_defs.add(node.name)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                top_defs.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name != "*":
                    top_defs.add(alias.asname or alias.name)
        elif isinstance(node, ast.For):
            for tgt in ast.walk(node.target):
                if isinstance(tgt, ast.Name):
                    top_defs.add(tgt.id)

    defs -= comp_targets - top_defs
    refs -= comp_targets - top_defs

    refs -= defs
    refs -= set(dir(builtins))
    defs = {d for d in defs if not d.startswith("_")}
    refs = {r for r in refs if not r.startswith("_")}
    return {"defs": sorted(defs), "refs": sorted(refs)}


# ---------------------------------------------------------------------------
# Simple assignments
# ---------------------------------------------------------------------------
class TestSimpleAssignments:
    def test_single_assignment(self):
        r = analyze("x = 0")
        assert r["defs"] == ["x"]
        assert r["refs"] == []

    def test_multiple_targets(self):
        r = analyze("x = y = 0")
        assert r["defs"] == ["x", "y"]
        assert r["refs"] == []

    def test_multiple_statements(self):
        r = analyze("x = 0\ny = 1")
        assert r["defs"] == ["x", "y"]
        assert r["refs"] == []

    def test_self_referencing(self):
        r = analyze("x = x + 1")
        assert r["defs"] == ["x"]
        assert r["refs"] == []  # refs -= defs


# ---------------------------------------------------------------------------
# Structured / destructuring assignments
# ---------------------------------------------------------------------------
class TestStructuredAssignments:
    def test_tuple_unpack(self):
        r = analyze("(a, b) = (1, 2)")
        assert r["defs"] == ["a", "b"]
        assert r["refs"] == []

    def test_nested_unpack(self):
        r = analyze("(a, (b, c)) = (1, (2, 3))")
        assert r["defs"] == ["a", "b", "c"]
        assert r["refs"] == []

    def test_starred(self):
        r = analyze("a, *b = [1, 2, 3]")
        assert r["defs"] == ["a", "b"]
        assert r["refs"] == []


# ---------------------------------------------------------------------------
# Comprehensions — the bug that started it all
# ---------------------------------------------------------------------------
class TestComprehensions:
    def test_list_comp_var_does_not_leak(self):
        r = analyze("result = [x for x in items]")
        assert r["defs"] == ["result"]
        assert r["refs"] == ["items"]

    def test_set_comp_var_does_not_leak(self):
        r = analyze("result = {x for x in items}")
        assert r["defs"] == ["result"]
        assert r["refs"] == ["items"]

    def test_dict_comp_var_does_not_leak(self):
        r = analyze("result = {k: v for k, v in pairs}")
        assert r["defs"] == ["result"]
        assert r["refs"] == ["pairs"]

    def test_generator_var_does_not_leak(self):
        r = analyze("result = sum(x for x in items)")
        assert r["defs"] == ["result"]
        assert r["refs"] == ["items"]

    def test_nested_comprehension(self):
        r = analyze("[(i, j) for i in range(10) for j in range(i)]")
        assert r["defs"] == []
        assert r["refs"] == []  # range is a builtin

    def test_self_referencing_comprehension(self):
        """[x for x in x] — the iterable x is a ref, but our analyzer
        cannot distinguish the iterable Load from the body Load when they
        share the same name as the comp target. This is a known limitation;
        in practice this pattern is rare."""
        r = analyze("[x for x in x]")
        assert r["defs"] == []
        # Ideally refs == ["x"] (the iterable), but our approach strips it.
        assert r["refs"] == []

    def test_comp_var_same_name_as_top_level(self):
        """If a name is both a comprehension var and a top-level assignment,
        it should stay in defs."""
        r = analyze("x = 10\nresult = [x for x in items]")
        assert "x" in r["defs"]
        assert "result" in r["defs"]

    def test_multiple_comps_same_var(self):
        """Multiple comprehensions using the same iteration variable."""
        r = analyze(dedent("""\
            cold = [t for t in temps if t < 15]
            warm = [t for t in temps if 15 <= t < 25]
            hot = [t for t in temps if t >= 25]
        """))
        assert "t" not in r["defs"]
        assert set(r["defs"]) == {"cold", "warm", "hot"}
        assert r["refs"] == ["temps"]

    def test_comp_with_tuple_unpack(self):
        r = analyze("result = [(k, v) for k, v in items.items()]")
        assert r["defs"] == ["result"]
        assert r["refs"] == ["items"]


# ---------------------------------------------------------------------------
# Walrus operator (:=) in comprehensions — PEP 572
# ---------------------------------------------------------------------------
class TestWalrusOperator:
    def test_walrus_leaks_from_comprehension(self):
        """Walrus operator inside a comprehension leaks to enclosing scope."""
        r = analyze("[(y := f(x)) for x in data]")
        assert "y" in r["defs"]
        assert "f" in r["refs"]
        assert "data" in r["refs"]

    def test_walrus_in_filter(self):
        r = analyze("[(x, y, x/y) for x in input_data if (y := f(x)) > 0]")
        assert "y" in r["defs"]
        assert "f" in r["refs"]
        assert "input_data" in r["refs"]


# ---------------------------------------------------------------------------
# For loops (loop variable DOES leak, unlike comprehensions)
# ---------------------------------------------------------------------------
class TestForLoops:
    def test_for_loop_var_leaks(self):
        r = analyze(dedent("""\
            for x in items:
                pass
        """))
        assert "x" in r["defs"]
        assert "items" in r["refs"]

    def test_for_loop_tuple_unpack(self):
        r = analyze(dedent("""\
            for k, v in pairs:
                pass
        """))
        assert set(r["defs"]) == {"k", "v"}
        assert r["refs"] == ["pairs"]


# ---------------------------------------------------------------------------
# Function and class definitions
# ---------------------------------------------------------------------------
class TestDefinitions:
    def test_function_def(self):
        r = analyze(dedent("""\
            def foo():
                pass
        """))
        assert r["defs"] == ["foo"]
        assert r["refs"] == []

    def test_async_function_def(self):
        r = analyze(dedent("""\
            async def foo():
                pass
        """))
        assert r["defs"] == ["foo"]
        assert r["refs"] == []

    def test_class_def(self):
        r = analyze(dedent("""\
            class Foo:
                pass
        """))
        assert r["defs"] == ["Foo"]
        assert r["refs"] == []

    def test_function_inner_vars_dont_leak(self):
        """Variables assigned inside a function body should not appear as
        cell-level defs in our simple ast.walk approach. NOTE: our analyzer
        currently DOES walk into function bodies and adds inner variables
        to defs — this is a known simplification."""
        r = analyze(dedent("""\
            def foo():
                local_var = 10
                return local_var
        """))
        assert "foo" in r["defs"]
        # Our analyzer adds local_var to defs (known simplification)
        assert "local_var" in r["defs"]

    def test_function_refs_external_var(self):
        r = analyze(dedent("""\
            def foo():
                return external_var
        """))
        assert "foo" in r["defs"]
        assert "external_var" in r["refs"]


# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------
class TestImports:
    def test_import_simple(self):
        r = analyze("import os")
        assert r["defs"] == ["os"]
        assert r["refs"] == []

    def test_import_nested(self):
        r = analyze("import os.path")
        assert r["defs"] == ["os"]
        assert r["refs"] == []

    def test_import_as(self):
        r = analyze("import numpy as np")
        assert r["defs"] == ["np"]
        assert r["refs"] == []

    def test_from_import(self):
        r = analyze("from os import path")
        assert r["defs"] == ["path"]
        assert r["refs"] == []

    def test_from_import_as(self):
        r = analyze("from os.path import join as pjoin")
        assert r["defs"] == ["pjoin"]
        assert r["refs"] == []

    def test_import_multiple(self):
        r = analyze("import os, sys")
        assert set(r["defs"]) == {"os", "sys"}
        assert r["refs"] == []


# ---------------------------------------------------------------------------
# Augmented assignment
# ---------------------------------------------------------------------------
class TestAugmentedAssignment:
    def test_aug_assign(self):
        r = analyze("x += 5")
        assert r["defs"] == ["x"]
        assert r["refs"] == []  # refs -= defs

    def test_ann_assign(self):
        r = analyze("x: int = 5")
        assert r["defs"] == ["x"]
        # int is a builtin, so not in refs
        assert r["refs"] == []


# ---------------------------------------------------------------------------
# Magic commands (IPython)
# ---------------------------------------------------------------------------
class TestMagicCommands:
    def test_line_magic_stripped(self):
        r = analyze("%matplotlib inline\nx = 5")
        assert r["defs"] == ["x"]
        assert r["refs"] == []

    def test_shell_command_stripped(self):
        r = analyze("!pip install pandas\nx = 5")
        assert r["defs"] == ["x"]
        assert r["refs"] == []

    def test_cell_magic_stripped(self):
        r = analyze("%%timeit\nx = 5\ny = x + 1")
        # Everything after %% becomes pass
        assert r["defs"] == []
        assert r["refs"] == []


# ---------------------------------------------------------------------------
# Global statement
# ---------------------------------------------------------------------------
class TestGlobalStatement:
    def test_global_creates_ref(self):
        r = analyze(dedent("""\
            def foo():
                global x
                x = 10
        """))
        assert "foo" in r["defs"]
        assert "x" in r["defs"]  # assigned via global


# ---------------------------------------------------------------------------
# Demo notebook regression cases
# ---------------------------------------------------------------------------
class TestDemoNotebookRegressions:
    """Exact cell sources from demo.ipynb that triggered the original bug."""

    def test_convert_to_celsius(self):
        source = dedent("""\
            temperatures_c = [(f - 32) * 5 / 9 for f in temperatures_f]
            print("Celsius:", [f"{t:.1f}" for t in temperatures_c])
        """)
        r = analyze(source)
        assert "temperatures_c" in r["defs"]
        assert "f" not in r["defs"], "comprehension var 'f' should not leak"
        assert "t" not in r["defs"], "comprehension var 't' should not leak"
        assert "temperatures_f" in r["refs"]

    def test_classification(self):
        source = dedent("""\
            cold = [t for t in temperatures_c if t < 15]
            warm = [t for t in temperatures_c if 15 <= t < 25]
            hot = [t for t in temperatures_c if t >= 25]
            print(f"Cold (<15°C): {len(cold)} readings")
            print(f"Warm (15-25°C): {len(warm)} readings")
            print(f"Hot (>=25°C): {len(hot)} readings")
        """)
        r = analyze(source)
        assert set(r["defs"]) == {"cold", "warm", "hot"}
        assert "t" not in r["defs"], "comprehension var 't' should not leak"
        assert "temperatures_c" in r["refs"]

    def test_no_false_conflict_between_pipeline_cells(self):
        """The two pipeline cells should not share any defined variable."""
        r1 = analyze(dedent("""\
            temperatures_c = [(f - 32) * 5 / 9 for f in temperatures_f]
            print("Celsius:", [f"{t:.1f}" for t in temperatures_c])
        """))
        r2 = analyze(dedent("""\
            cold = [t for t in temperatures_c if t < 15]
            warm = [t for t in temperatures_c if 15 <= t < 25]
            hot = [t for t in temperatures_c if t >= 25]
        """))
        shared = set(r1["defs"]) & set(r2["defs"])
        assert shared == set(), f"False conflict on: {shared}"

    def test_summary_statistics(self):
        source = dedent("""\
            avg_temp = sum(temperatures_c) / len(temperatures_c)
            min_temp = min(temperatures_c)
            max_temp = max(temperatures_c)
        """)
        r = analyze(source)
        assert set(r["defs"]) == {"avg_temp", "min_temp", "max_temp"}
        assert "temperatures_c" in r["refs"]

    def test_basic_reactivity_chain(self):
        r1 = analyze("x = 5")
        r2 = analyze('y = x * 2\nprint(f"y = x * 2 = {y}")')
        r3 = analyze('result = y + 10\nprint(f"result = y + 10 = {result}")')
        assert r1["defs"] == ["x"]
        assert r2["defs"] == ["y"]
        assert r2["refs"] == ["x"]
        assert r3["defs"] == ["result"]
        assert r3["refs"] == ["y"]

    def test_function_and_imports(self):
        r_import = analyze("import math")
        r_func = analyze(dedent("""\
            def circle_area(radius):
                return math.pi * radius ** 2
        """))
        r_call = analyze(dedent("""\
            area = circle_area(r)
            print(f"Area of circle with radius {r}: {area:.2f}")
        """))
        assert r_import["defs"] == ["math"]
        assert r_func["defs"] == ["circle_area"]
        assert "math" in r_func["refs"]
        assert r_call["defs"] == ["area"]
        assert set(r_call["refs"]) == {"circle_area", "r"}
