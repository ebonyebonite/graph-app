"""統計の補助計算 (t 分布・正規分布・基本統計量・t 検定)。

scipy を同梱しないため、numpy と標準ライブラリだけで書く。
値は scipy.stats (t.cdf / t.ppf / norm.ppf / ttest_ind / ttest_rel / pearsonr) と一致する。
"""
from __future__ import annotations

import math

import numpy as np

_TINY = 1e-300


def _betacf(a: float, b: float, x: float) -> float:
    """不完全ベータ関数の連分数展開 (修正 Lentz 法)。"""
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > _TINY else _TINY)
    h = d
    for m in range(1, 20000):
        m2 = 2 * m
        for aa in (m * (b - m) * x / ((qam + m2) * (a + m2)),
                   -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))):
            d = 1.0 + aa * d
            d = 1.0 / (d if abs(d) > _TINY else _TINY)
            c = 1.0 + aa / c
            if abs(c) < _TINY:
                c = _TINY
            delta = d * c
            h *= delta
        if abs(delta - 1.0) < 1e-16:
            break
    return h


def betainc(a: float, b: float, x: float) -> float:
    """正則化不完全ベータ関数 I_x(a, b)。"""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    front = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
                     + a * math.log(x) + b * math.log1p(-x))
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b


# ---- t 分布・正規分布 ----------------------------------------------------------
def t_sf(t: float, df: float) -> float:
    """t 分布の上側確率 P(T > t)。"""
    p = 0.5 * betainc(df / 2.0, 0.5, df / (df + t * t))
    return p if t >= 0 else 1.0 - p


def t_cdf(t: float, df: float) -> float:
    return 1.0 - t_sf(t, df)


def t_pvalue(t: float, df: float) -> float:
    """両側 p 値 P(|T| > |t|)。"""
    if not math.isfinite(t):
        return 0.0 if t == t else float("nan")
    return betainc(df / 2.0, 0.5, df / (df + t * t))


def _bisect_upper(sf, q: float) -> float:
    """sf(v) = q となる v ≥ 0 (sf は単調減少、0 < q < 0.5)。"""
    lo, hi = 0.0, 1.0
    while sf(hi) > q and hi < 1e300:
        lo, hi = hi, hi * 2.0
    for _ in range(300):
        mid = 0.5 * (lo + hi)
        if sf(mid) > q:
            lo = mid
        else:
            hi = mid
        if hi - lo <= 1e-15 * hi:
            break
    return 0.5 * (lo + hi)


def t_ppf(p: float, df: float) -> float:
    """t 分布の下側確率 p に対応する値 (分位点)。"""
    if not (0.0 < p < 1.0) or df <= 0:
        return float("nan")
    if p == 0.5:
        return 0.0
    if p < 0.5:
        return -t_ppf(1.0 - p, df)
    return _bisect_upper(lambda v: t_sf(v, df), 1.0 - p)


def norm_cdf(z: float) -> float:
    return 0.5 * math.erfc(-z / math.sqrt(2.0))


def norm_ppf(p: float) -> float:
    if not (0.0 < p < 1.0):
        return float("nan")
    if p == 0.5:
        return 0.0
    if p < 0.5:
        return -norm_ppf(1.0 - p)
    return _bisect_upper(lambda v: 0.5 * math.erfc(v / math.sqrt(2.0)), 1.0 - p)


def critical_value(level: float, dof: float | None = None) -> float:
    """両側の信頼水準 level に対応する係数 (dof が None なら正規分布、そうでなければ t 分布)。"""
    p = 0.5 * (1.0 + level)
    return norm_ppf(p) if dof is None else t_ppf(p, dof)


def valid_level(level) -> float:
    try:
        level = float(level)
    except (TypeError, ValueError):
        return 0.95
    return level if 0.5 <= level <= 0.9999 else 0.95


# ---- 基本統計量 ----------------------------------------------------------------
def _finite(values) -> np.ndarray:
    v = np.array([np.nan if u is None else u for u in values], dtype=float)
    return v[np.isfinite(v)]


def describe(values) -> dict:
    """点数・平均・標準偏差 (不偏, n−1)・標準誤差・中央値・最小・最大。"""
    v = _finite(values)
    n = int(v.size)
    out = {"n": n, "mean": None, "sd": None, "se": None, "median": None, "min": None, "max": None}
    if n == 0:
        return out
    out.update(mean=float(np.mean(v)), median=float(np.median(v)), min=float(np.min(v)), max=float(np.max(v)))
    if n > 1:
        sd = float(np.std(v, ddof=1))
        out.update(sd=sd, se=sd / math.sqrt(n))
    return out


def pearson(x, y) -> tuple[float | None, float | None]:
    """相関係数 r と、無相関の検定の両側 p 値。求められなければ None。"""
    x, y = np.asarray(x, float), np.asarray(y, float)
    n = x.size
    if n < 3:
        return None, None
    dx, dy = x - x.mean(), y - y.mean()
    den = math.sqrt(float(dx @ dx) * float(dy @ dy))
    if den == 0.0:
        return None, None
    r = max(-1.0, min(1.0, float(dx @ dy) / den))
    if abs(r) == 1.0:
        return r, 0.0
    return r, t_pvalue(r * math.sqrt((n - 2) / (1.0 - r * r)), n - 2)


def trapezoid(x, y) -> float | None:
    """台形則による面積 ∫y dx (データの並び順のまま)。"""
    x, y = np.asarray(x, float), np.asarray(y, float)
    if x.size < 2:
        return None
    return float(np.sum((x[1:] - x[:-1]) * (y[1:] + y[:-1]) / 2.0))


# ---- t 検定 --------------------------------------------------------------------
def ttest(a, b, paired: bool = False, level: float = 0.95) -> dict:
    """2 組のデータの平均の差の検定。

    paired=False: Welch の t 検定 (等分散を仮定しない)
    paired=True : 対応のある t 検定 (同じ順番の値どうしの差を調べる)
    """
    level = valid_level(level)
    if paired:
        # 同じ行どうしを対にする。どちらかが欠けている行は使わない (欠損を詰めると対がずれる)
        a, b = (np.array([np.nan if u is None else u for u in v], dtype=float) for v in (a, b))
        if a.size != b.size:
            raise ValueError(f"対応のある検定には同じ行数が必要です ({a.size} 行と {b.size} 行)")
        both = np.isfinite(a) & np.isfinite(b)
        a, b = a[both], b[both]
        if a.size < 2:
            raise ValueError("両方に値のある行が 2 つ以上必要です")
        d = a - b
        diff, df = float(np.mean(d)), float(d.size - 1)
        se = float(np.std(d, ddof=1)) / math.sqrt(d.size)
    else:
        a, b = _finite(a), _finite(b)
        if a.size < 2 or b.size < 2:
            raise ValueError("それぞれ 2 点以上のデータが必要です")
        va, vb = float(np.var(a, ddof=1)) / a.size, float(np.var(b, ddof=1)) / b.size
        diff, se = float(np.mean(a) - np.mean(b)), math.sqrt(va + vb)
        df = (va + vb) ** 2 / (va ** 2 / (a.size - 1) + vb ** 2 / (b.size - 1)) if se > 0 else 0.0
    if se == 0.0:
        raise ValueError("ばらつきが 0 のため検定できません")
    t = diff / se
    return {"t": t, "df": df, "p": t_pvalue(t, df), "diff": diff, "se": se,
            "ci": critical_value(level, df) * se, "level": level, "paired": bool(paired),
            "n_a": int(a.size), "n_b": int(b.size), "mean_a": float(np.mean(a)), "mean_b": float(np.mean(b))}
