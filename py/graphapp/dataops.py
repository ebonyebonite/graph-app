"""データの加工 (式による変換・並べ替え・平均化・微分・積分・規格化・切り出し)。

x, y がともに数値の行だけを対象にする (グラフに描かれる点と同じ)。
結果は新しい列 (欠損は None) として返し、元のデータは変更しない。
"""
from __future__ import annotations

import math

import numpy as np

from .model import Dataset
from .safe_expr import compile_expr

# (表示名, キー, 新しいデータセット名に付ける語)
OPS = [
    ("式で変換 (ln y, 1/x など)", "expr", "変換"),
    ("X の順に並べ替え", "sort", "並べ替え"),
    ("同じ X の点を平均する", "mean", "平均"),
    ("微分 (dy/dx)", "diff", "微分"),
    ("積分 (台形則の累積)", "integ", "積分"),
    ("規格化", "norm", "規格化"),
    ("X の範囲で切り出す", "crop", "切り出し"),
    ("X と Y を入れ替える", "swap", "XY 入れ替え"),
]
# 式で変換: よく使う組み合わせ (表示名, 新しい X, 新しい Y)
EXPR_PRESETS = [
    ("ln y  (片対数)", "x", "log(y)"),
    ("log₁₀ y", "x", "log10(y)"),
    ("ln x と ln y  (両対数)", "log(x)", "log(y)"),
    ("1/x と ln y  (アレニウスプロット)", "1 / x", "log(y)"),
    ("1/x と 1/y  (ラインウィーバー・バーク)", "1 / x", "1 / y"),
    ("1/y", "x", "1 / y"),
    ("y を 1000 倍 (単位の換算)", "x", "y * 1000"),
]
NORM_MODES = [("最大値を 1 にする", "max"), ("最小 0・最大 1 にする", "minmax"), ("最初の点を 1 にする", "first"),
              ("最初の点を 0 にする (差をとる)", "offset")]
MEAN_ERRORS = [("標準偏差 (n−1)", "sd"), ("標準誤差 (標準偏差 / √n)", "se"), ("付けない", "none")]


def _columns(ds: Dataset):
    """有効な行の x, y と誤差 (欠損は NaN)。"""
    def arr(col):
        return np.array([np.nan if v is None else v for v in col], dtype=float)
    x, y, ye, xe = (arr(c) for c in (ds.x, ds.y, ds.yerr, ds.xerr))
    n = x.size
    ye, xe = (c if c.size == n else np.full(n, np.nan) for c in (ye, xe))
    mask = np.isfinite(x) & np.isfinite(y)
    return x[mask], y[mask], np.abs(ye[mask]), np.abs(xe[mask])


def _partial(f, x, y, which: int) -> np.ndarray:
    """f(x, y) の偏微分 (中心差分)。which=0 なら x、1 なら y について。"""
    v = (x, y)[which]
    scale = float(np.max(np.abs(v))) if v.size else 1.0
    h = 1e-6 * np.where(v != 0, np.abs(v), scale or 1.0)
    hi, lo = [x, y], [x, y]
    hi[which], lo[which] = v + h, v - h
    with np.errstate(all="ignore"):
        return (f(*hi) - f(*lo)) / (2.0 * h)


def _propagate(f, x, y, xe, ye) -> np.ndarray:
    """誤差の伝播 (1 次近似): u(f)² = (∂f/∂x·u(x))² + (∂f/∂y·u(y))²。元の誤差がない点は NaN。"""
    dfx, dfy = _partial(f, x, y, 0), _partial(f, x, y, 1)
    with np.errstate(all="ignore"):
        tx = np.where(np.isfinite(xe) & (dfx != 0), (dfx * xe) ** 2, 0.0)
        ty = np.where(np.isfinite(ye) & (dfy != 0), (dfy * ye) ** 2, 0.0)
        has = (np.isfinite(xe) & (dfx != 0)) | (np.isfinite(ye) & (dfy != 0))
        return np.where(has, np.sqrt(tx + ty), np.nan)


def _num(v) -> float | None:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def apply(ds: Dataset, op: str, opt: dict | None = None) -> dict:
    """加工した列を返す: {"x", "y", "yerr", "xerr", "suffix", "note"}。"""
    opt = opt or {}
    x, y, ye, xe = _columns(ds)
    if x.size == 0:
        raise ValueError("加工できる点 (X と Y がそろった行) がありません")
    note = ""
    nan = np.full(x.size, np.nan)

    if op == "expr":
        fx = compile_expr(opt.get("x_expr") or "x", ("x", "y"))
        fy = compile_expr(opt.get("y_expr") or "y", ("x", "y"))
        nx, ny = fx(x, y), fy(x, y)
        nxe, nye = _propagate(fx, x, y, xe, ye), _propagate(fy, x, y, xe, ye)
        bad = int(np.sum(~(np.isfinite(nx) & np.isfinite(ny))))
        if bad == x.size:
            raise ValueError("変換した値がすべて無効になりました (対数の中が 0 以下、0 での割り算など)")
        if bad:
            note = f"{bad} 点は値が求められないため、空欄になりました。"
        x, y, xe, ye = nx, ny, nxe, nye
    elif op == "sort":
        order = np.argsort(x, kind="stable")
        x, y, ye, xe = x[order], y[order], ye[order], xe[order]
    elif op == "swap":
        x, y, ye, xe = y, x, xe, ye
    elif op == "crop":
        lo, hi = _num(opt.get("min")), _num(opt.get("max"))
        mask = np.ones(x.size, dtype=bool)
        if lo is not None:
            mask &= x >= lo
        if hi is not None:
            mask &= x <= hi
        if not mask.any():
            raise ValueError("指定した範囲に点がありません")
        x, y, ye, xe = x[mask], y[mask], ye[mask], xe[mask]
    elif op == "norm":
        mode = opt.get("mode", "max")
        if mode == "minmax":
            lo, width = float(np.min(y)), float(np.ptp(y))
            if width == 0:
                raise ValueError("Y がすべて同じ値のため規格化できません")
            y, ye = (y - lo) / width, ye / width
        elif mode == "offset":
            y = y - y[0]
        else:
            ref = float(y[0]) if mode == "first" else float(np.max(np.abs(y)))
            if ref == 0:
                raise ValueError("基準の値が 0 のため規格化できません")
            y, ye = y / ref, ye / abs(ref)
    elif op in ("diff", "integ"):
        if x.size < 2:
            raise ValueError("2 点以上のデータが必要です")
        order = np.argsort(x, kind="stable")
        x, y = x[order], y[order]
        if op == "diff":
            if np.any(np.diff(x) == 0):
                raise ValueError("同じ X の点があるため微分できません (先に「同じ X の点を平均する」を行ってください)")
            y = np.gradient(y, x)
        else:
            y = np.concatenate([[0.0], np.cumsum(np.diff(x) * (y[1:] + y[:-1]) / 2.0)])
        ye = xe = nan
    elif op == "mean":
        mode = opt.get("err", "sd")
        ux, inverse = np.unique(x, return_inverse=True)
        if ux.size == x.size:
            note = "同じ X の点はありませんでした。"
        my, sd = np.empty(ux.size), np.full(ux.size, np.nan)
        for i in range(ux.size):
            g = y[inverse == i]
            my[i] = np.mean(g)
            if g.size > 1 and mode in ("sd", "se"):
                sd[i] = np.std(g, ddof=1) / (math.sqrt(g.size) if mode == "se" else 1.0)
        x, y, ye, xe = ux, my, sd, np.full(ux.size, np.nan)
    else:
        raise ValueError(f"不明な加工の種類です: {op}")

    def col(a):
        return [float(v) if math.isfinite(v) else None for v in a]
    suffix = next((s for _, key, s in OPS if key == op), "加工")
    return {"x": col(x), "y": col(y), "yerr": col(ye), "xerr": col(xe), "suffix": suffix, "note": note}
