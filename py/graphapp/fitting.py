"""近似 (フィッティング) の計算と凡例の文言。

凡例の数式は論文表記 (mathtext) で組む:
    y = 6.93x − 6.59 (R² = 0.920)        … 有効数字の末尾の 0 も残す
    y = 30.0 exp(−1.20x) + 2.00

近似の種類:
    linear / proportional / poly / log … パラメータについて線形。最小二乗解を直接求める
    exp / power / custom               … 非線形最小二乗 (Levenberg–Marquardt 法)。対数変換はしない
    savgol                             … Savitzky-Golay 平滑化 (パラメータなし)

統計量 (パラメトリックな近似のみ):
    標準誤差・信頼区間 … パラメータの共分散行列から。重みなしなら残差の分散を掛け t 分布を、
                          Y 誤差で重み付けしたときは誤差を既知の標準偏差とみなし正規分布を使う
    信頼帯・予測帯     … 近似値の分散 = gᵀ C g (g: パラメータについての勾配, C: 共分散行列)
"""
from __future__ import annotations

import math
import warnings
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
from .model import Dataset
from .numerics import OptimizeWarning, curve_fit, savgol_filter  # scipy と同じアルゴリズムの numpy 実装
from .safe_expr import ExprError, compile_expr
from .stats import critical_value, valid_level
from .texfmt import equation_tex, linear_tex, num_tex, num_text

DEFAULT_FIT_NAMES = {"linear": "近似直線", "proportional": "近似直線", "savgol": "平滑化曲線"}

# 式の形が決まっている近似 (パラメータ名はアルファベット順に a, b, c, …)
PRESET_EXPR = {
    "linear": "a * x + b",
    "proportional": "a * x",
    "log": "a * log(x) + b",
    "exp": "a * exp(b * x)",
    "power": "a * x**b",
}
PRESET_TEXT = {"proportional": "y = ax", "log": "y = a ln(x) + b", "exp": "y = a exp(bx)", "power": "y = a x^b"}
PARAMETRIC = ("linear", "proportional", "poly", "exp", "power", "log", "custom")
MAX_POLY_DEGREE = 9
_PARAM_NAMES = "abcdefghij"
_SUPERSCRIPT = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")


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
    # ---- 統計量 (パラメトリックな近似のみ) ----
    n: int = 0                        # 近似に使った点数
    dof: int | None = None            # 自由度 (点数 − パラメータ数)
    level: float = 0.95               # 信頼水準
    ci: list[float | None] = field(default_factory=list)  # パラメータの信頼区間の半幅 (params と同じ並び)
    r2_adj: float | None = None       # 自由度調整済み R²
    resid_sd: float | None = None     # 残差の標準偏差 √(Σ残差² / 自由度)
    chi2_red: float | None = None     # 換算 χ² = χ² / 自由度 (重み付きのとき)
    x_data: np.ndarray = field(default_factory=lambda: np.array([]))  # 近似に使った点の x
    resid: np.ndarray = field(default_factory=lambda: np.array([]))   # 残差 (測定値 − 近似値)
    resid_err: np.ndarray | None = None                               # その点の Y 誤差 (あれば)
    _func: Callable | None = field(default=None, repr=False, compare=False)
    _popt: np.ndarray | None = field(default=None, repr=False, compare=False)
    _pcov: np.ndarray | None = field(default=None, repr=False, compare=False)
    _s2: float | None = field(default=None, repr=False, compare=False)    # 残差の分散 (重みなしのとき)
    _crit: float | None = field(default=None, repr=False, compare=False)  # 信頼区間の係数 (t または z)

    @property
    def parametric(self) -> bool:
        return self.ok and self._func is not None

    def evaluate(self, x) -> np.ndarray:
        """近似式の値。"""
        if self._func is None:
            raise ValueError("この近似では計算できません")
        with np.errstate(all="ignore"):
            return np.asarray(self._func(np.asarray(x, dtype=float), *self._popt), dtype=float)

    def se_mean(self, x) -> np.ndarray | None:
        """近似値の標準誤差。共分散が求められていなければ None。"""
        if self._func is None or self._pcov is None:
            return None
        jac = _param_jac(self._func, np.asarray(x, dtype=float), self._popt)
        with np.errstate(all="ignore"):
            return np.sqrt(np.maximum(np.einsum("ij,jk,ik->i", jac, self._pcov, jac), 0.0))

    def interval(self, x, kind: str = "confidence") -> np.ndarray | None:
        """信頼区間 (confidence) / 予測区間 (prediction) の半幅。求められなければ None。"""
        se = self.se_mean(x)
        if se is None or self._crit is None:
            return None
        if kind == "prediction":
            if self._s2 is None:
                return None
            se = np.sqrt(se ** 2 + self._s2)
        return self._crit * se


def _param_jac(func, x: np.ndarray, popt: np.ndarray) -> np.ndarray:
    """近似値のパラメータについての勾配 (中心差分)。形は (len(x), パラメータ数)。"""
    jac = np.empty((x.size, popt.size))
    with np.errstate(all="ignore"):
        for j in range(popt.size):
            h = 6e-6 * (abs(popt[j]) or 1.0)
            hi, lo = popt.copy(), popt.copy()
            hi[j] += h
            lo[j] -= h
            jac[:, j] = (func(x, *hi) - func(x, *lo)) / (2.0 * h)
    return jac


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


def poly_expr(degree: int) -> str:
    """多項式の式 (高次の項から a, b, c, …)。 2 次なら 'a * x**2 + b * x + c'。"""
    terms = []
    for i in range(degree + 1):
        k, name = degree - i, _PARAM_NAMES[i]
        terms.append(name if k == 0 else f"{name} * x" if k == 1 else f"{name} * x**{k}")
    return " + ".join(terms)


def poly_text(degree: int) -> str:
    terms = []
    for i in range(degree + 1):
        k, name = degree - i, _PARAM_NAMES[i]
        terms.append(name if k == 0 else f"{name}x" if k == 1 else f"{name}x{str(k).translate(_SUPERSCRIPT)}")
    return "y = " + " + ".join(terms)


def _sigma(spec, yerr, n) -> np.ndarray | None:
    """重み付けに使う誤差。重み付けしない・誤差がそろっていない場合は None。"""
    if not spec.weighted:
        return None
    if yerr is None or yerr.size != n or np.any(yerr <= 0):
        raise ValueError("重み付けには、すべての点に正の Y 誤差が必要です")
    return yerr


def _polyfit(x, y, deg: int, sigma):
    """多項式の最小二乗 (係数は高次から)。共分散は求められなければ None。"""
    if np.unique(x).size < deg + 1:
        raise ValueError(f"X の値が {deg + 1} 種類以上必要です")
    w = None if sigma is None else 1.0 / sigma
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # 条件数の警告は出さない
        try:
            p, cov = np.polyfit(x, y, deg, w=w, cov="unscaled" if w is not None else True)
        except ValueError:
            # 点数が少ないと共分散は求められない
            p, cov = np.polyfit(x, y, deg, w=w), None
    return p, cov


def _propfit(x, y, sigma):
    """原点を通る直線 y = ax。"""
    w2 = 1.0 if sigma is None else 1.0 / sigma ** 2
    sxx = float(np.sum(w2 * x * x))
    if sxx == 0.0:
        raise ValueError("X がすべて 0 のため、傾きを求められません")
    a = float(np.sum(w2 * x * y)) / sxx
    if sigma is not None:
        return np.array([a]), np.array([[1.0 / sxx]])
    if x.size > 1:
        return np.array([a]), np.array([[float(np.sum((y - a * x) ** 2)) / (x.size - 1) / sxx]])
    return np.array([a]), None


def _loglin_guess(u, y, default):
    """ln|y| を u の 1 次式で近似して (係数, 傾き) の初期値にする (y の符号がそろっているとき)。"""
    sign = 1.0 if np.all(y > 0) else -1.0 if np.all(y < 0) else 0.0
    if sign and np.unique(u).size > 1:
        try:
            slope, icpt = np.polyfit(u, np.log(sign * y), 1)
            return [sign * math.exp(icpt), float(slope)]
        except (OverflowError, ValueError):
            pass
    return default


def _p0_value(p0, name: str) -> float:
    try:
        v = float(p0.get(name)) if isinstance(p0, dict) else 1.0
    except (TypeError, ValueError):
        return 1.0
    return v if math.isfinite(v) else 1.0


def _in_range(spec, x: np.ndarray) -> np.ndarray | None:
    """近似に使う X の範囲 (x_min 〜 x_max) に入る点のマスク。制限がなければ None。"""
    lo, hi = _f(getattr(spec, "x_min", None)), _f(getattr(spec, "x_max", None))
    if lo is None and hi is None:
        return None
    if lo is not None and hi is not None and lo > hi:
        lo, hi = hi, lo  # 最小と最大が逆に入力されていても受け付ける
    mask = np.ones(x.size, dtype=bool)
    if lo is not None:
        mask &= x >= lo
    if hi is not None:
        mask &= x <= hi
    return mask


def compute_fit(ds: Dataset, level: float = 0.95) -> FitResult | None:
    spec = ds.fit
    if spec.kind == "none":
        return None
    res = FitResult(ds.id, ds.name, spec.kind, level=valid_level(level))
    x, y, yerr, _ = ds.valid_arrays()
    try:
        if spec.kind == "savgol":
            res.n = int(x.size)
            wl, po = savgol_params(spec.window_length, spec.polyorder)
            if len(y) < wl:
                res.message = (f"データ点数 ({len(y)}) が Savitzky-Golay のウィンドウ長 "
                               f"({wl}) より少ないため、平滑化を省略しました。")
                return res
            res.x_fit, res.y_fit = np.asarray(x, float), np.asarray(savgol_filter(y, wl, po), float)
            res.equation = f"Savitzky-Golay (ウィンドウ長 {wl}, 次数 {po})"
            res.params = [("ウィンドウ長", float(wl), None), ("多項式次数", float(po), None)]
            res.ci = [None, None]
        elif spec.kind in PARAMETRIC:
            mask = _in_range(spec, x)
            if mask is not None:
                x, y = x[mask], y[mask]
                yerr = None if yerr is None else yerr[mask]
            _fit_parametric(ds, res, x, y, yerr)
        else:
            res.message = f"不明な近似の種類です: {spec.kind}"
            return res
    except Exception as e:  # noqa: BLE001  フィット失敗はメッセージとして返す
        res.message = f"フィッティングエラー: {e}"
        return res

    res.ok = True
    res.label = build_label(ds, res)
    return res


def _fit_parametric(ds: Dataset, res: FitResult, x, y, yerr) -> None:
    spec, kind = ds.fit, ds.fit.kind
    sf = int(spec.sig_figs)
    n = res.n = int(x.size)
    degree = int(spec.degree) if kind == "poly" else 1
    if kind == "custom":
        source = spec.equation
    elif kind == "poly":
        if not 1 <= degree <= MAX_POLY_DEGREE:
            raise ValueError(f"多項式の次数は 1〜{MAX_POLY_DEGREE} にしてください")
        source = poly_expr(degree)
    else:
        source = PRESET_EXPR[kind]
    expr = compile_expr(source, ("x",), allow_params=True)
    names = expr.params
    if not names:
        raise ExprError("フィットするパラメータ (a, b, c など) が数式にありません")
    if n < len(names):
        raise ValueError(f"データ点数 ({n}) がパラメータ数 ({len(names)}) より少ないです")
    sigma = _sigma(spec, yerr, n)

    def func(xx, *p):
        return expr(xx, *p)

    if kind in ("linear", "poly"):
        popt, pcov = _polyfit(x, y, degree, sigma)
    elif kind == "log":
        if np.any(x <= 0):
            raise ValueError("対数近似には、X がすべて正である必要があります")
        popt, pcov = _polyfit(np.log(x), y, 1, sigma)
    elif kind == "proportional":
        popt, pcov = _propfit(x, y, sigma)
    else:
        if kind == "custom":
            p0 = [_p0_value(spec.p0, name) for name in names]
        elif kind == "exp":
            p0 = _loglin_guess(x, y, [float(np.mean(y)) or 1.0, 0.0])
        else:
            if np.any(x <= 0):
                raise ValueError("累乗近似には、X がすべて正である必要があります")
            p0 = _loglin_guess(np.log(x), y, [1.0, 1.0])
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", OptimizeWarning)
            popt, pcov = curve_fit(func, x, y, p0=np.array(p0, dtype=float), maxfev=10000,
                                   sigma=sigma, absolute_sigma=sigma is not None)
    popt = np.asarray(popt, dtype=float)
    if pcov is not None and not np.all(np.isfinite(pcov)):
        pcov = None

    y_model = func(x, *popt)
    resid = y - y_model
    dof = n - len(names)
    res.dof = dof
    res.weighted = sigma is not None
    res.r2 = r_squared(y, y_model)
    s2 = None
    if dof > 0:
        s2 = float(resid @ resid) / dof
        res.resid_sd = _f(math.sqrt(s2))
        res.r2_adj = _f(1.0 - (1.0 - res.r2) * (n - 1) / dof)
        if sigma is not None:
            res.chi2_red = _f(float(np.sum((resid / sigma) ** 2)) / dof)
    crit = None
    if pcov is not None:
        # Y 誤差で重み付けしたときは誤差を既知とみなす (共分散に残差の分散を掛けない) ので正規分布
        crit = critical_value(res.level) if sigma is not None else critical_value(res.level, dof) if dof > 0 else None
    with np.errstate(all="ignore"):
        errs = [None] * len(names) if pcov is None else [_f(e) for e in np.sqrt(np.diag(pcov))]
    res.params = [(name, float(v), e) for name, v, e in zip(names, popt, errs)]
    res.ci = [None if e is None or crit is None else _f(crit * e) for e in errs]
    res._func, res._popt, res._pcov, res._crit = func, popt, pcov, crit
    res._s2 = s2 if sigma is None else None
    res.x_data, res.resid, res.resid_err = x, resid, yerr
    res.x_fit = np.linspace(min(x), max(x), 200)
    res.y_fit = np.asarray(func(res.x_fit, *popt), dtype=float)
    band = getattr(spec, "band", "none")
    if band in ("confidence", "prediction"):
        if crit is None:
            res.message = "点数が足りないため、信頼区間・予測区間を描けません。"
        elif band == "prediction" and res._s2 is None:
            res.message = "Y 誤差で重み付けした近似では予測区間を求められないため、信頼区間を表示しています。"

    values = dict(zip(names, (float(v) for v in popt)))
    if kind == "linear":
        a, b = values["a"], values["b"]
        res.equation = f"y = {num_text(a, sf)}x {'-' if b < 0 else '+'} {num_text(abs(b), sf)}"
        res.equation_tex = linear_tex(a, b, sf)
        return
    form = f"y = {spec.equation}" if kind == "custom" else poly_text(degree) if kind == "poly" else PRESET_TEXT[kind]
    res.equation = f"{form}  (" + ", ".join(f"{k} = {num_text(v, sf)}" for k, v in values.items()) + ")"
    try:
        res.equation_tex = equation_tex(source, values, sf)
    except Exception:  # noqa: BLE001  数式に変換できない形なら名前=値 の列挙
        res.equation_tex = r",\ ".join(f"{k} = {num_tex(v, sf)}" for k, v in values.items())


def build_label(ds: Dataset, res: FitResult) -> str:
    """凡例の文言。

    凡例名あり           : 「凡例名」
    凡例名なし           : 「<データ名> の近似直線」など
    近似式を表示         : 凡例名ありなら「凡例名 (y = …)」、なしなら「y = …」のみ
    R² を表示            : 末尾に「(R² = …)」
    """
    spec = ds.fit
    name = spec.label or f"{ds.name} の{DEFAULT_FIT_NAMES.get(spec.kind, '近似曲線')}"
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


# ---- 近似式を使った計算 (予測・逆算) --------------------------------------------
def predict(res: FitResult, x0: float) -> dict:
    """x0 での近似値と、その標準誤差・信頼区間・予測区間 (半幅)。"""
    def first(a):
        return None if a is None else _f(a[0])
    return {"y": _f(res.evaluate([x0])[0]), "se": first(res.se_mean([x0])),
            "ci": first(res.interval([x0])), "pi": first(res.interval([x0], "prediction"))}


def solve_x(res: FitResult, y0: float, y_err: float | None = None, max_roots: int = 6) -> list[dict]:
    """近似式の値が y0 になる x を求める (検量線から未知試料の濃度を読むときなど)。

    x の不確かさは誤差の伝播で見積もる: u(x) = √(u(y0)² + u(近似値)²) / |傾き|
    u(y0) は y_err の指定があればその値、なければ残差の標準偏差 (重みなしの近似のとき)。
    直線は範囲を限らず解く。曲線はデータの範囲とその前後 (幅の 1 倍ずつ) を探す。
    """
    if not res.parametric or res.x_data.size == 0:
        raise ValueError("この近似では計算できません")
    lo, hi = float(np.min(res.x_data)), float(np.max(res.x_data))
    span = (hi - lo) or abs(lo) or 1.0
    roots: list[float] = []
    if res.kind in ("linear", "proportional"):
        a = float(res._popt[0])
        b = float(res._popt[1]) if res.kind == "linear" else 0.0
        if a == 0.0:
            raise ValueError("傾きが 0 のため求められません")
        roots.append((y0 - b) / a)
    else:
        xs = np.linspace(lo - span, hi + span, 3001)
        g = res.evaluate(xs) - y0
        for i in range(xs.size - 1):
            if len(roots) >= max_roots:
                break
            g0, g1 = g[i], g[i + 1]
            if not (np.isfinite(g0) and np.isfinite(g1)):
                continue
            if g0 == 0.0:
                roots.append(float(xs[i]))
            elif g0 * g1 < 0.0:
                a, b = float(xs[i]), float(xs[i + 1])
                for _ in range(80):
                    mid = 0.5 * (a + b)
                    gm = float(res.evaluate([mid])[0]) - y0
                    if gm == 0.0 or not math.isfinite(gm):
                        a = b = mid
                        break
                    if (gm < 0) == (g0 < 0):
                        a = mid
                    else:
                        b = mid
                roots.append(0.5 * (a + b))
        if len(roots) < max_roots and g[-1] == 0.0:
            roots.append(float(xs[-1]))

    u_y = abs(float(y_err)) if y_err is not None else math.sqrt(res._s2) if res._s2 is not None else 0.0
    out = []
    h = 1e-6 * span
    for r in roots:
        slope = float((res.evaluate([r + h])[0] - res.evaluate([r - h])[0]) / (2.0 * h))
        se_fit = res.se_mean([r])
        se = ci = None
        if se_fit is not None and math.isfinite(slope) and slope != 0.0:
            se = _f(math.sqrt(u_y ** 2 + float(se_fit[0]) ** 2) / abs(slope))
            ci = None if se is None or res._crit is None else _f(res._crit * se)
        out.append({"x": float(r), "se": se, "ci": ci, "extrapolated": not (lo <= r <= hi)})
    return out


# ---- 非線形 (カスタム) の初期値の見積もり ----------------------------------------
def _tail(y) -> int:
    return max(1, y.size // 10)


def _half_width(x, d) -> float:
    """|d| が最初の値の半分以下になるまでの x の幅 (見つからなければ全体の 1/3)。"""
    idx = np.nonzero(np.abs(d) <= abs(d[0]) / 2.0)[0]
    span = float(x[-1] - x[0])
    t = float(x[idx[0]] - x[0]) if idx.size and idx[0] > 0 else span / 3.0
    return t if t > 0 else (span / 3.0 or 1.0)


def _exp_clip(v: float) -> float:
    return math.exp(max(-50.0, min(50.0, v)))


def _peak(x, y):
    """ピーク (または谷) の高さ・位置・半値半幅・ベースライン。"""
    lo, hi, med = float(np.min(y)), float(np.max(y)), float(np.median(y))
    up = (hi - med) >= (med - lo)  # 上向きのピークか
    base = lo if up else hi
    i = int(np.argmax(y) if up else np.argmin(y))
    amp = float(y[i]) - base
    xs = x[np.abs(y - base) >= abs(amp) / 2.0]
    width = float(xs.max() - xs.min()) / 2.0 if xs.size > 1 else 0.0
    if width <= 0:
        width = float(x[-1] - x[0]) / 10.0 or 1.0
    return (amp or 1.0), float(x[i]), width, base


def _g_decay(x, y):
    y0 = float(np.mean(y[-_tail(y):]))
    k = math.log(2.0) / _half_width(x, y - y0)
    return {"A": (float(y[0]) - y0) * _exp_clip(k * float(x[0])) or float(np.ptp(y)) or 1.0, "k": k, "y0": y0}


def _g_saturation(x, y):
    top = float(np.mean(y[-_tail(y):]))
    k = math.log(2.0) / _half_width(x, y - top)
    amp = (top - float(y[0])) * _exp_clip(k * float(x[0])) or float(np.ptp(y)) or 1.0
    return {"A": amp, "k": k, "y0": top - amp}


def _g_gauss(x, y):
    amp, x0, hwhm, base = _peak(x, y)
    return {"A": amp, "x0": x0, "w": hwhm / math.sqrt(2.0 * math.log(2.0)), "y0": base}


def _g_lorentz(x, y):
    amp, x0, hwhm, base = _peak(x, y)
    return {"A": amp, "x0": x0, "w": hwhm, "y0": base}


def _g_sigmoid(x, y):
    t = _tail(y)
    y0 = float(np.mean(y[:t]))
    amp = (float(np.mean(y[-t:])) - y0) or 1.0
    frac = (y - y0) / amp

    def cross(level):
        idx = np.nonzero(frac >= level)[0]
        return float(x[idx[0]]) if idx.size else None
    x0, x10, x90 = cross(0.5), cross(0.1), cross(0.9)
    span = float(x[-1] - x[0]) or 1.0
    width = (x90 - x10) if x10 is not None and x90 is not None and x90 > x10 else span / 4.0
    return {"A": amp, "k": 4.4 / width, "x0": float(np.median(x)) if x0 is None else x0, "y0": y0}


def _g_michaelis(x, y):
    vmax = float(np.max(y)) * 1.2 or 1.0
    idx = np.nonzero(y >= vmax / 2.0)[0]
    km = float(x[idx[0]]) if idx.size else float(np.median(x))
    return {"Vmax": vmax, "Km": km if km > 0 else float(np.median(x)) or 1.0}


def _g_arrhenius(x, y):
    if np.any(x == 0):
        return {}
    a, slope = _loglin_guess(1.0 / x, y, [1.0, -1.0])
    return {"A": a, "B": -slope}


def _g_inverse(x, y):
    if np.any(x == 0):
        return {}
    a, b = np.polyfit(1.0 / x, y, 1)
    return {"a": a, "b": b}


def _g_sine(x, y):
    y0 = float(np.mean(y))
    d = y - y0
    amp = float(np.ptp(y)) / 2.0 or 1.0
    span = float(x[-1] - x[0]) or 1.0
    sign = np.sign(d[d != 0])
    crossings = int(np.sum(sign[1:] != sign[:-1]))
    w = math.pi * crossings / span if crossings else 2.0 * math.pi / span
    phases = np.arange(8) * (math.pi / 4.0)
    p = float(phases[int(np.argmin([np.sum((d - amp * np.sin(w * x + ph)) ** 2) for ph in phases]))])
    return {"A": amp, "w": w, "p": p, "y0": y0}


_GUESSERS = {
    "A*exp(-k*x)+y0": _g_decay,
    "A*(1-exp(-k*x))+y0": _g_saturation,
    "A*exp(-(x-x0)**2/(2*w**2))+y0": _g_gauss,
    "A*w**2/((x-x0)**2+w**2)+y0": _g_lorentz,
    "A/(1+exp(-k*(x-x0)))+y0": _g_sigmoid,
    "Vmax*x/(Km+x)": _g_michaelis,
    "A*exp(-B/x)": _g_arrhenius,
    "a/x+b": _g_inverse,
    "A*sin(w*x+p)+y0": _g_sine,
}


def guess_p0(equation: str, x, y) -> dict[str, float] | None:
    """テンプレートの式 (model.FIT_TEMPLATES) なら、データから初期値を見積もる。

    テンプレートでなければ None、見積もれなければ空の辞書。
    """
    guesser = _GUESSERS.get("".join((equation or "").split()))
    if guesser is None:
        return None
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    if x.size < 2:
        return {}
    order = np.argsort(x, kind="stable")
    try:
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore")
            guess = guesser(x[order], y[order])
    except Exception:  # noqa: BLE001  見積もれないときは既定値 (1) のまま
        return {}
    return {k: float(v) for k, v in guess.items() if math.isfinite(float(v))}


def _f(v) -> float | None:
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if np.isfinite(v) else None
