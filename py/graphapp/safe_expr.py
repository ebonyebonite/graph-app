"""数式の安全な評価。

v1 では入力文字列を eval / exec にそのまま渡していたため、任意のコードが実行できた。
ここでは数式を AST に分解し、四則演算・べき乗・許可した数学関数・数値・変数だけを
受け付けてから評価する。

    np.sin(x) * 2 + 5        -> OK (np. 付きでも)
    sin(x) * 2 + 5           -> OK (np. なしでも)
    a * np.exp(-b * x) + c   -> パラメータ a, b, c を自動検出
"""
from __future__ import annotations

import ast
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Callable

import numpy as np

_FUNC_NAMES = [
    "sin", "cos", "tan", "arcsin", "arccos", "arctan", "arctan2",
    "sinh", "cosh", "tanh", "arcsinh", "arccosh", "arctanh",
    "exp", "expm1", "log", "log10", "log2", "log1p", "sqrt", "cbrt",
    "abs", "absolute", "sign", "power", "square", "floor", "ceil", "round",
    "maximum", "minimum", "heaviside", "radians", "degrees", "hypot", "where",
]
FUNCTIONS: dict[str, Callable] = {name: getattr(np, name) for name in _FUNC_NAMES}
CONSTANTS = {"pi": np.pi}
# np.pi, np.e, np.inf は属性としてのみ許可 (e はフィット用パラメータ名として使えるようにする)
NP_CONSTANTS = {"pi": np.pi, "e": np.e, "inf": np.inf}
MODULE_NAMES = ("np", "numpy")

_SAFE_NP = SimpleNamespace(**FUNCTIONS, **NP_CONSTANTS)

_BIN_OPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.FloorDiv)
_UNARY_OPS = (ast.UAdd, ast.USub)
_CMP_OPS = (ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.Eq, ast.NotEq)


class ExprError(ValueError):
    pass


@dataclass
class CompiledExpr:
    source: str
    variables: tuple[str, ...]
    params: tuple[str, ...]
    _code: object

    def __call__(self, *args) -> np.ndarray:
        names = self.variables + self.params
        if len(args) != len(names):
            raise TypeError(f"引数の数が違います (必要: {len(names)})")
        ns = {"__builtins__": {}, "np": _SAFE_NP, "numpy": _SAFE_NP, **FUNCTIONS, **CONSTANTS}
        ns.update(zip(names, args))
        with np.errstate(all="ignore"):
            result = eval(self._code, ns)  # noqa: S307  検証済みの AST のみ
        result = np.asarray(result, dtype=float)
        if self.variables:
            first = np.asarray(args[0], dtype=float)
            result = np.broadcast_to(result, first.shape).astype(float)
        return result


class _IntToFloat(ast.NodeTransformer):
    def visit_Constant(self, node: ast.Constant):
        if isinstance(node.value, int) and not isinstance(node.value, bool):
            return ast.copy_location(ast.Constant(float(node.value)), node)
        return node


def _attr_name(node: ast.Attribute) -> str:
    if isinstance(node.value, ast.Name) and node.value.id in MODULE_NAMES:
        if node.attr in FUNCTIONS or node.attr in NP_CONSTANTS:
            return node.attr
    raise ExprError(f"使用できない関数・定数です: {ast.unparse(node)}")


def _validate(node: ast.AST, free_names: list[str]) -> None:
    if isinstance(node, ast.Expression):
        _validate(node.body, free_names)
    elif isinstance(node, ast.BinOp):
        if not isinstance(node.op, _BIN_OPS):
            raise ExprError(f"使用できない演算子です: {type(node.op).__name__}")
        _validate(node.left, free_names)
        _validate(node.right, free_names)
    elif isinstance(node, ast.UnaryOp):
        if not isinstance(node.op, _UNARY_OPS):
            raise ExprError("使用できない単項演算子です")
        _validate(node.operand, free_names)
    elif isinstance(node, ast.Compare):
        if not all(isinstance(op, _CMP_OPS) for op in node.ops):
            raise ExprError("使用できない比較演算子です")
        _validate(node.left, free_names)
        for c in node.comparators:
            _validate(c, free_names)
    elif isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise ExprError(f"数値以外の定数は使えません: {node.value!r}")
    elif isinstance(node, ast.Name):
        if node.id.startswith("_"):
            raise ExprError(f"使用できない名前です: {node.id}")
        if node.id in MODULE_NAMES:
            raise ExprError(f"'{node.id}' は 'np.sin(x)' のように関数と一緒に使ってください")
        if node.id in FUNCTIONS:
            raise ExprError(f"'{node.id}' は関数です。'{node.id}(x)' のように使ってください")
        if node.id not in CONSTANTS and node.id not in free_names:
            free_names.append(node.id)
    elif isinstance(node, ast.Attribute):
        _attr_name(node)
    elif isinstance(node, ast.Call):
        if node.keywords:
            raise ExprError("キーワード引数は使えません")
        func = node.func
        if isinstance(func, ast.Name):
            if func.id not in FUNCTIONS:
                raise ExprError(f"使用できない関数です: {func.id}")
        elif isinstance(func, ast.Attribute):
            if _attr_name(func) not in FUNCTIONS:
                raise ExprError(f"関数ではありません: {ast.unparse(func)}")
        else:
            raise ExprError("関数呼び出しの形式が正しくありません")
        for a in node.args:
            if isinstance(a, ast.Starred):
                raise ExprError("* 展開は使えません")
            _validate(a, free_names)
    else:
        raise ExprError(f"数式に使えない構文です: {type(node).__name__}")


def compile_expr(source: str, variables: tuple[str, ...] = ("x",),
                 allow_params: bool = False) -> CompiledExpr:
    """数式を検証してコンパイルする。

    variables: 独立変数 (通常は x)。
    allow_params: True のとき、それ以外の未定義の名前をフィットパラメータとして扱う
                  (アルファベット順。v1 の a, b, c, d, e と同じ並び)。
    """
    text = (source or "").strip()
    if not text:
        raise ExprError("数式が空です")
    if len(text) > 500:
        raise ExprError("数式が長すぎます")
    try:
        tree = ast.parse(text, mode="eval")
    except SyntaxError as e:
        raise ExprError(f"数式の書き方が正しくありません ({e.msg})") from None
    free: list[str] = []
    _validate(tree, free)
    params = [n for n in free if n not in variables]
    if params and not allow_params:
        raise ExprError(f"未定義の名前があります: {', '.join(params)}")
    # 整数定数を float にしておく (9**9**9 のような巨大整数計算で固まるのを防ぐ)
    tree = ast.fix_missing_locations(_IntToFloat().visit(tree))
    code = compile(tree, "<expr>", "eval")
    return CompiledExpr(text, tuple(variables), tuple(sorted(params)), code)
