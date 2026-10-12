"""数値・数式を論文表記 (matplotlib の mathtext) に変換する。

    sci_tex(1234, 3)        -> "1.23\\times10^{3}"          (1.23×10³)
    num_tex(0.92, 3)        -> "0.920"                      (有効数字の末尾の 0 を残す)
    num_tex(3.2e-5, 3)      -> "3.20\\times10^{-5}"
    equation_tex("a * np.exp(-b * x) + c", {"a": 30, "b": 1.2, "c": 2}, 3)
                            -> "y = 30.0\\exp(-1.20x) + 2.00"
"""
from __future__ import annotations

import ast
import math

from .safe_expr import CONSTANTS, MODULE_NAMES, NP_CONSTANTS

# 固定小数点で書く範囲 (これを外れたら ×10^n 表記)
FIXED_MIN, FIXED_MAX = 1e-3, 1e4


def sci_tex(value: float, sig: int) -> str:
    """常に a.bc×10^n の形 (目盛り用)。"""
    if value == 0:
        return "0"
    mant, exp = f"{value:.{max(sig, 1) - 1}e}".split("e")
    return rf"{mant}\times10^{{{int(exp)}}}"


def num_tex(value: float, sig: int) -> str:
    """有効数字 sig 桁。大きすぎ・小さすぎる値は ×10^n 表記。"""
    if value is None or not math.isfinite(value):
        return r"\mathrm{nan}" if value is None or math.isnan(value) else r"\infty"
    if value == 0:
        return "0"
    a = abs(value)
    if a < FIXED_MIN or a >= FIXED_MAX:
        return sci_tex(value, sig)
    exp = math.floor(math.log10(a))
    decimals = sig - 1 - exp
    if decimals > 0:
        s = f"{value:.{decimals}f}"
    else:
        s = f"{round(value, decimals):.0f}"
    return s


def num_text(value: float, sig: int) -> str:
    """mathtext を使わない場所 (結果パネルなど) 向けの同じ規則のプレーン表記。"""
    s = num_tex(value, sig)
    if "\\times10^" in s:
        mant, exp = s.split("\\times10^")
        return f"{mant}×10^{exp.strip('{}')}"
    return s


# ---- 数式 → mathtext -----------------------------------------------------------
_FUNC_TEX = {
    "sin": r"\sin", "cos": r"\cos", "tan": r"\tan",
    "arcsin": r"\arcsin", "arccos": r"\arccos", "arctan": r"\arctan",
    "sinh": r"\sinh", "cosh": r"\cosh", "tanh": r"\tanh",
    "exp": r"\exp", "log": r"\ln", "log10": r"\log_{10}", "log2": r"\log_{2}",
}
# 優先順位 (大きいほど強く結合)
P_ADD, P_MUL, P_UNARY, P_POW, P_ATOM = 1, 2, 3, 4, 5


class _Tex:
    def __init__(self, text: str, prec: int, leading_number: bool = False, negative: bool = False):
        self.text, self.prec = text, prec
        self.leading_number = leading_number  # 先頭が数字 (掛け算で × が必要か判定)
        self.negative = negative              # 先頭が負号


def _paren(t: _Tex) -> str:
    return rf"\left({t.text}\right)"


class _Converter:
    def __init__(self, values: dict[str, float], sig: int):
        self.values, self.sig = values, sig

    def number(self, v: float, from_param: bool) -> _Tex:
        if from_param:
            s = num_tex(v, self.sig)
        elif float(v).is_integer() and abs(v) < 1e6:
            s = str(int(v))
        else:
            g = f"{v:.6g}"  # 数式中に書かれた定数は書かれたとおりの桁で
            s = sci_tex(v, len(g.split("e")[0].replace("-", "").replace(".", ""))) if "e" in g else g
        neg = s.startswith("-")
        # 負の数・×10^n を含む数は「積」と同じ強さで結合する (-2.00x はそのまま、x(-2.00) は括弧)
        prec = P_MUL if (neg or "times" in s) else P_ATOM
        return _Tex(s, prec, leading_number=not neg, negative=neg)

    def conv(self, node) -> _Tex:
        if isinstance(node, ast.Expression):
            return self.conv(node.body)
        if isinstance(node, ast.Constant):
            return self.number(float(node.value), False)
        if isinstance(node, ast.Name):
            if node.id in self.values:
                return self.number(self.values[node.id], True)
            if node.id in CONSTANTS:
                return _Tex(r"\pi", P_ATOM)
            return _Tex(node.id, P_ATOM)
        if isinstance(node, ast.Attribute):
            if node.attr == "pi":
                return _Tex(r"\pi", P_ATOM)
            if node.attr == "e":
                return _Tex(r"\mathrm{e}", P_ATOM)
            return _Tex(r"\infty", P_ATOM)
        if isinstance(node, ast.UnaryOp):
            inner = self.conv(node.operand)
            if isinstance(node.op, ast.UAdd):
                return inner
            if inner.negative:  # -(-a) -> a
                return _Tex(inner.text[1:], inner.prec, inner.leading_number)
            body = _paren(inner) if inner.prec <= P_ADD else inner.text
            return _Tex("-" + body, P_UNARY, negative=True)
        if isinstance(node, ast.BinOp):
            return self.binop(node)
        if isinstance(node, ast.Call):
            return self.call(node)
        raise ValueError("unsupported")

    def binop(self, node: ast.BinOp) -> _Tex:
        op = node.op
        left, right = self.conv(node.left), self.conv(node.right)
        if isinstance(op, (ast.Add, ast.Sub)):
            sign = "+" if isinstance(op, ast.Add) else "-"
            rtext = right.text
            if right.negative:  # a + (-b) -> a - b,  a - (-b) -> a + b
                sign = "-" if sign == "+" else "+"
                rtext = rtext[1:]
            elif sign == "-" and right.prec <= P_ADD:
                rtext = _paren(right)
            return _Tex(f"{left.text} {sign} {rtext}", P_ADD, left.leading_number, left.negative)
        if isinstance(op, ast.Mult):
            ltext = _paren(left) if left.prec < P_MUL else left.text
            if right.prec < P_MUL or right.negative:
                rtext, joiner = _paren(right), ""
            elif right.leading_number or "times" in right.text:
                rtext, joiner = right.text, r"\times "  # 数字が続くときは ×
            else:
                # 2.00x のように並べて書く。3.00×10^{-5} の後ろは細いすき間を入れる
                # (数式モードの空白は表示されないが、\pi x のようにコマンドと文字がつながるのを防ぐ)
                rtext, joiner = right.text, (r"\," if "times" in left.text else " ")
            return _Tex(f"{ltext}{joiner}{rtext}", P_MUL, left.leading_number, left.negative)
        if isinstance(op, ast.Div):
            return _Tex(rf"\frac{{{left.text}}}{{{right.text}}}", P_ATOM, left.leading_number)
        if isinstance(op, ast.Pow):
            base = _paren(left) if (left.prec < P_ATOM or left.negative) else left.text
            return _Tex(f"{base}^{{{right.text}}}", P_POW, left.leading_number and left.prec == P_ATOM)
        if isinstance(op, ast.Mod):
            return _Tex(rf"{left.text}\ \mathrm{{mod}}\ {right.text}", P_MUL, left.leading_number)
        if isinstance(op, ast.FloorDiv):
            return _Tex(rf"\lfloor {left.text}/{right.text} \rfloor", P_ATOM)
        raise ValueError("unsupported")

    def call(self, node: ast.Call) -> _Tex:
        f = node.func
        name = f.id if isinstance(f, ast.Name) else f.attr
        args = [self.conv(a) for a in node.args]
        if name in ("sqrt",) and len(args) == 1:
            return _Tex(rf"\sqrt{{{args[0].text}}}", P_ATOM)
        if name in ("abs", "absolute") and len(args) == 1:
            return _Tex(rf"\left|{args[0].text}\right|", P_ATOM)
        if name == "power" and len(args) == 2:
            base = _paren(args[0]) if args[0].prec < P_ATOM else args[0].text
            return _Tex(f"{base}^{{{args[1].text}}}", P_POW)
        if name == "square" and len(args) == 1:
            base = _paren(args[0]) if args[0].prec < P_ATOM else args[0].text
            return _Tex(f"{base}^{{2}}", P_POW)
        head = _FUNC_TEX.get(name, rf"\mathrm{{{name}}}")
        inner = ", ".join(a.text for a in args)
        return _Tex(rf"{head}\left({inner}\right)", P_ATOM)


def equation_tex(expr: str, values: dict[str, float], sig: int, lhs: str = "y") -> str:
    """数式文字列にパラメータ値を代入して mathtext にする。変換できなければ例外。"""
    tree = ast.parse(expr.strip(), mode="eval")
    body = _Converter(values, sig).conv(tree).text
    return f"{lhs} = {body}" if lhs else body


def linear_tex(a: float, b: float, sig: int) -> str:
    """y = ax + b (b が負なら y = ax − |b|)。"""
    at = num_tex(a, sig)
    xs = r"\,x" if "times" in at else "x"
    if b == 0:
        return f"y = {at}{xs}"
    sign = "-" if b < 0 else "+"
    return f"y = {at}{xs} {sign} {num_tex(abs(b), sig)}"


def has_cjk(s: str) -> bool:
    return any(ord(c) >= 0x2E80 for c in s)


__all__ = ["sci_tex", "num_tex", "num_text", "equation_tex", "linear_tex", "has_cjk",
           "MODULE_NAMES", "NP_CONSTANTS"]
