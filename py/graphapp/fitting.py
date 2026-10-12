"""近似 (フィッティング) の計算と凡例の文言。

凡例の数式は論文表記 (mathtext) で組む:
    y = 6.93x − 6.59 (R² = 0.920)        … 有効数字の末尾の 0 も残す
    y = 30.0 exp(−1.20x) + 2.00
"""
from __future__ import annotations

import warnings
from dataclasses import dataclass, field

import numpy as np
from .model import Dataset
from .numerics import OptimizeWarning, curve_fit, savgol_filter  # scipy と同じアルゴリズムの numpy 実装
from .safe_expr import ExprError, compile_expr
from .texfmt import equation_tex, linear_tex, num_tex, num_text

DEFAULT_FIT_NAMES = {"linear": "近似直線", "custom": "近似曲線", "savgol": "平滑化曲線"}


@dataclass
class FitResult:
    dataset_id: int
    dataset_name: str
    kind: str
    ok: bool = False
    x_fit: np.ndarray = field(default_factory=lambda: np.array([]))
    y_fit: np.ndarray = field(default_factory=lambda: np.array([]))
    label: str = ""
    equation: str = ""       # プレーンテキスト (結果パネル用)
    equation_tex: str = ""   # mathtext ($ なし)
    # (名前, 値, 標準誤差 or None)
    params: list[tuple[str, float, float | None]] = field(default_factory=list)
    r2: float | None = None
    weighted: bool = False
    message: str = ""


def savgol_params(window_length: int, polyorder: int) -> tuple[int, int]:
    """ウィンドウ長を補正する (偶数なら +1、次数以下なら次数+1 の奇数)。"""
    wl, po = int(window_length), int(polyorder)
    if wl % 2 == 0:
        wl += 1
    if wl <= po:
        wl = po + 1
        if wl % 2 == 0:
            wl += 1
    return wl, po


def r_squared(y: np.ndarray, y_model: np.ndarray) -> float:
    ss_total = np.sum((y - np.mean(y)) ** 2)
    ss_residual = np.sum((y - y_model) ** 2)
    return float(1 - ss_residual / ss_total) if ss_total > 0 else 1.0


def _sigma(spec, yerr, n) -> np.ndarray | None:
    """重み付けに使う誤差。重み付けしない・誤差がそろっていない場合は None。"""
    if not spec.weighted:
        return None
    if yerr is None or yerr.size != n or np.any(yerr <= 0):
        raise ValueError("重み付けには、すべての点に正の Y 誤差が必要です")
    return yerr


def compute_fit(ds: Dataset) -> FitResult | None:
    spec = ds.fit
    if spec.kind == "none":
        return None
    res = FitResult(ds.id, ds.name, spec.kind)
    x, y, yerr, _ = ds.valid_arrays()
    sf = int(spec.sig_figs)

    if x.size > 0:
        x_fit = x if spec.kind == "savgol" else np.linspace(min(x), max(x), 200)
    else:
        x_fit = np.array([])
    y_model = None  # 元の x 上でのモデル値 (R^2 用)
    try:
        if spec.kind == "linear":
            sigma = _sigma(spec, yerr, x.size)
            w = None if sigma is None else 1.0 / sigma
            try:
                p, cov = np.polyfit(x, y, 1, w=w, cov="unscaled" if w is not None else True)
                errs = np.sqrt(np.diag(cov))
            except ValueError:
                # 点数が少ないと共分散は求められない
                p = np.polyfit(x, y, 1, w=w)
                errs = [None, None]
            y_model = np.polyval(p, x)
            y_fit = np.polyval(p, x_fit)
            res.weighted = sigma is not None
            res.equation = f"y = {num_text(p[0], sf)}x {'-' if p[1] < 0 else '+'} {num_text(abs(p[1]), sf)}"
            res.equation_tex = linear_tex(float(p[0]), float(p[1]), sf)
            res.params = [("a", float(p[0]), _f(errs[0])), ("b", float(p[1]), _f(errs[1]))]

        elif spec.kind == "custom":
            expr = compile_expr(spec.equation, ("x",), allow_params=True)
            names = expr.params
            if not names:
                raise ExprError("フィットするパラメータ (a, b, c など) が数式にありません")
            if x.size < len(names):
                raise ValueError(f"データ点数 ({x.size}) がパラメータ数 ({len(names)}) より少ないです")
            sigma = _sigma(spec, yerr, x.size)

            def func(xx, *p):
                return expr(xx, *p)

            with warnings.catch_warnings():
                warnings.simplefilter("ignore", OptimizeWarning)
                popt, pcov = curve_fit(func, x, y, p0=np.ones(len(names)), maxfev=10000,
                                       sigma=sigma, absolute_sigma=sigma is not None)
            errs = np.sqrt(np.diag(pcov)) if pcov is not None else [None] * len(names)
            y_model = func(x, *popt)
            y_fit = func(x_fit, *popt)
            values = dict(zip(names, (float(v) for v in popt)))
            res.weighted = sigma is not None
            res.equation = f"y = {spec.equation}  (" + ", ".join(
                f"{n} = {num_text(v, sf)}" for n, v in values.items()) + ")"
            try:
                res.equation_tex = equation_tex(spec.equation, values, sf)
            except Exception:  # noqa: BLE001  数式に変換できない形なら名前=値 の列挙
                res.equation_tex = r",\ ".join(f"{n} = {num_tex(v, sf)}" for n, v in values.items())
            res.params = [(n, float(v), _f(e)) for n, v, e in zip(names, popt, errs)]

        elif spec.kind == "savgol":
            wl, po = savgol_params(spec.window_length, spec.polyorder)
            if len(y) < wl:
                res.message = (f"データ点数 ({len(y)}) が Savitzky-Golay のウィンドウ長 "
                               f"({wl}) より少ないため、平滑化を省略しました。")
                return res
            y_fit = savgol_filter(y, wl, po)
            res.equation = f"Savitzky-Golay (ウィンドウ長 {wl}, 次数 {po})"
            res.params = [("ウィンドウ長", float(wl), None), ("多項式次数", float(po), None)]
        else:
            res.message = f"不明な近似の種類です: {spec.kind}"
            return res
    except Exception as e:  # noqa: BLE001  フィット失敗はメッセージとして返す
        res.message = f"フィッティングエラー: {e}"
        return res

    res.ok = True
    res.x_fit, res.y_fit = np.asarray(x_fit, float), np.asarray(y_fit, float)
    if y_model is not None:
        res.r2 = r_squared(y, y_model)
    res.label = build_label(ds, res)
    return res


def build_label(ds: Dataset, res: FitResult) -> str:
    """凡例の文言。

    凡例名あり           : 「凡例名」
    凡例名なし           : 「<データ名> の近似直線」など
    近似式を表示         : 凡例名ありなら「凡例名 (y = …)」、なしなら「y = …」のみ
    R² を表示            : 末尾に「(R² = …)」
    """
    spec = ds.fit
    name = spec.label or f"{ds.name} の{DEFAULT_FIT_NAMES.get(spec.kind, '近似')}"
    if spec.kind == "savgol":
        return name

    eq = res.equation_tex
    if spec.show_formula and eq:
        label = f"{spec.label} (${eq}$)" if spec.label else f"${eq}$"
    else:
        label = name
    if spec.show_r2 and res.r2 is not None:
        label += f" ($R^2 = {num_tex(res.r2, int(spec.sig_figs))}$)"
    return label


def _f(v) -> float | None:
    if v is None:
        return None
    v = float(v)
    return v if np.isfinite(v) else None
