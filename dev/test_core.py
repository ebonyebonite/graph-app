"""計算部 (py/graphapp) の検証。scipy の結果と突き合わせる。

    pip install numpy scipy matplotlib
    python3 dev/test_core.py
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np
from scipy import optimize, stats as S

sys.dont_write_bytecode = True  # py/ に __pycache__ を作らない (公開されるフォルダのため)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "py"))
from matplotlib import font_manager  # noqa: E402

font_manager.fontManager.addfont(os.path.join(ROOT, "assets", "fonts", "ipaexg.ttf"))
import webapi  # noqa: E402
from graphapp import dataops, fitting, stats as G  # noqa: E402
from graphapp.model import FIT_TEMPLATES, Dataset, Project  # noqa: E402

rng = np.random.default_rng(42)
checks = 0


def close(a, b, rel=1e-6, what=""):
    global checks
    checks += 1
    a, b = np.asarray(a, float), np.asarray(b, float)
    assert np.allclose(a, b, rtol=rel, atol=1e-12 + rel * np.max(np.abs(b))), f"{what}: {a} != {b}"


def make(x, y, yerr=None, **fit) -> Dataset:
    ds = Dataset(id=1, name="d")
    ds.set_columns(list(x), list(y), None if yerr is None else list(yerr))
    for k, v in fit.items():
        setattr(ds.fit, k, v)
    return ds


def errs(res):
    return [e for _, _, e in res.params]


def vals(res):
    return [v for _, v, _ in res.params]


# ---- 分布 ----------------------------------------------------------------------
for df in (1, 2, 4.5, 10, 30, 120, 1e4):
    for t in (0, 0.5, 1, 2, 5, 20, -1.5):
        close(G.t_cdf(t, df), S.t.cdf(t, df), 1e-10, "t_cdf")
        close(G.t_pvalue(t, df), 2 * S.t.sf(abs(t), df), 1e-9, "t_pvalue")
    for p in (0.6, 0.9, 0.975, 0.995, 0.025):
        close(G.t_ppf(p, df), S.t.ppf(p, df), 1e-9, "t_ppf")
for p in (0.6, 0.8415, 0.975, 0.995, 0.1):
    close(G.norm_ppf(p), S.norm.ppf(p), 1e-12, "norm_ppf")

# ---- 線形・多項式・比例・対数 -----------------------------------------------------
x = np.linspace(1, 10, 12)
y = 2.5 * x - 1.0 + rng.normal(0, 0.4, x.size)
res = fitting.compute_fit(make(x, y, kind="linear"))
lr = S.linregress(x, y)
close(vals(res), [lr.slope, lr.intercept], 1e-9, "linear params")
close(errs(res), [lr.stderr, lr.intercept_stderr], 1e-9, "linear errs")
close(res.r2, lr.rvalue ** 2, 1e-9, "r2")
tcrit = S.t.ppf(0.975, x.size - 2)
close(res.ci, [tcrit * lr.stderr, tcrit * lr.intercept_stderr], 1e-8, "linear ci")
s = math.sqrt(np.sum((y - lr.slope * x - lr.intercept) ** 2) / (x.size - 2))
close(res.resid_sd, s, 1e-9, "resid sd")
x0 = np.array([0.0, 3.3, 12.0])
sxx = np.sum((x - x.mean()) ** 2)
se_mean = s * np.sqrt(1 / x.size + (x0 - x.mean()) ** 2 / sxx)
close(res.se_mean(x0), se_mean, 1e-6, "se_mean")
close(res.interval(x0, "prediction"), tcrit * np.sqrt(s ** 2 + se_mean ** 2), 1e-6, "prediction band")
# 逆算 (検量線): 教科書の式  s_x = s/|a| √(1 + 1/n + (y0 − ȳ)² / (a² Sxx))
y0 = 11.0
sol = fitting.solve_x(res, y0)[0]
sx = s / abs(lr.slope) * math.sqrt(1 + 1 / x.size + (y0 - y.mean()) ** 2 / (lr.slope ** 2 * sxx))
close(sol["x"], (y0 - lr.intercept) / lr.slope, 1e-9, "solve x")
close(sol["se"], sx, 1e-6, "solve se")

sig = rng.uniform(0.2, 0.8, x.size)
res = fitting.compute_fit(make(x, y, sig, kind="linear", weighted=True))
po, pc = optimize.curve_fit(lambda x, a, b: a * x + b, x, y, sigma=sig, absolute_sigma=True)
close(vals(res), po, 1e-7, "weighted linear")
close(errs(res), np.sqrt(np.diag(pc)), 1e-6, "weighted errs")
close(res.ci, S.norm.ppf(0.975) * np.sqrt(np.diag(pc)), 1e-6, "weighted ci (z)")
close(res.chi2_red, np.sum(((y - po[0] * x - po[1]) / sig) ** 2) / (x.size - 2), 1e-7, "chi2_red")

y2 = 0.3 * x ** 3 - 2 * x ** 2 + x + 4 + rng.normal(0, 1.0, x.size)
res = fitting.compute_fit(make(x, y2, kind="poly", degree=3))
pp, pcov = np.polyfit(x, y2, 3, cov=True)
close(vals(res), pp, 1e-8, "poly")
close(errs(res), np.sqrt(np.diag(pcov)), 1e-8, "poly errs")
assert [n for n, _, _ in res.params] == ["a", "b", "c", "d"]

res = fitting.compute_fit(make(x, y, kind="proportional"))
po, pc = optimize.curve_fit(lambda x, a: a * x, x, y)
close(vals(res), po, 1e-8, "proportional")
close(errs(res), np.sqrt(np.diag(pc)), 1e-6, "proportional err")
res = fitting.compute_fit(make(x, y, sig, kind="proportional", weighted=True))
po, pc = optimize.curve_fit(lambda x, a: a * x, x, y, sigma=sig, absolute_sigma=True)
close(vals(res) + errs(res), [po[0], math.sqrt(pc[0, 0])], 1e-7, "proportional weighted")

yl = 3.0 * np.log(x) + 2 + rng.normal(0, 0.1, x.size)
res = fitting.compute_fit(make(x, yl, kind="log"))
po, pc = optimize.curve_fit(lambda x, a, b: a * np.log(x) + b, x, yl)
close(vals(res), po, 1e-7, "log")
close(errs(res), np.sqrt(np.diag(pc)), 1e-5, "log errs")

# ---- 非線形 ----------------------------------------------------------------------
ye = 5.0 * np.exp(-0.4 * x) + rng.normal(0, 0.02, x.size)
res = fitting.compute_fit(make(x, ye, kind="exp"))
po, pc = optimize.curve_fit(lambda x, a, b: a * np.exp(b * x), x, ye, p0=[1, -0.1])
close(vals(res), po, 1e-5, "exp")
close(errs(res), np.sqrt(np.diag(pc)), 1e-3, "exp errs")
yp = 2.0 * x ** 1.7 * (1 + rng.normal(0, 0.01, x.size))
res = fitting.compute_fit(make(x, yp, kind="power"))
po, pc = optimize.curve_fit(lambda x, a, b: a * x ** b, x, yp, p0=[1, 1])
close(vals(res), po, 1e-5, "power")
res = fitting.compute_fit(make(x, ye, kind="custom", equation="a * exp(-b * x) + c", p0={"a": 4, "b": 0.3, "c": 0}))
po, pc = optimize.curve_fit(lambda x, a, b, c: a * np.exp(-b * x) + c, x, ye, p0=[4, 0.3, 0])
close(vals(res), po, 1e-4, "custom")
assert res.ok and all(c is not None for c in res.ci), res
# 曲線の逆算
sol = fitting.solve_x(res, 1.0)
assert len(sol) == 1 and abs(res.evaluate([sol[0]["x"]])[0] - 1.0) < 1e-9 and sol[0]["se"] > 0, sol
# 範囲指定
res = fitting.compute_fit(make(x, y, kind="linear", x_min=3, x_max=8))
m = (x >= 3) & (x <= 8)
close(vals(res), np.polyfit(x[m], y[m], 1), 1e-9, "range")
assert res.n == int(m.sum())

# ---- テンプレートと初期値の見積もり ------------------------------------------------
xt = np.linspace(0.5, 20, 60)
truth = {
    "A * exp(-k * x) + y0": dict(A=8, k=0.35, y0=1.5),
    "A * (1 - exp(-k * x)) + y0": dict(A=6, k=0.25, y0=0.5),
    "A * exp(-(x - x0)**2 / (2 * w**2)) + y0": dict(A=4, x0=11, w=1.6, y0=0.3),
    "A * w**2 / ((x - x0)**2 + w**2) + y0": dict(A=-3, x0=7, w=1.2, y0=5),
    "A / (1 + exp(-k * (x - x0))) + y0": dict(A=5, k=0.9, x0=9, y0=1),
    "Vmax * x / (Km + x)": dict(Vmax=12, Km=3.5),
    "A * exp(-B / x)": dict(A=20, B=6),
    "a / x + b": dict(a=4, b=1),
    "A * sin(w * x + p) + y0": dict(A=2, w=0.9, p=0.6, y0=3),
}
assert set(truth) == {e for _, e in FIT_TEMPLATES}
for eq, p in truth.items():
    f = fitting.compile_expr(eq, ("x",), allow_params=True)
    yt = f(xt, *[p[n] for n in f.params])
    yt = yt + rng.normal(0, 0.01 * np.ptp(yt), xt.size)
    g = fitting.guess_p0(eq, xt, yt)
    assert g and set(g) == set(p), (eq, g)
    res = fitting.compute_fit(make(xt, yt, kind="custom", equation=eq, p0=g))
    assert res.ok and res.r2 > 0.99, (eq, g, res.message, res.r2)
    checks += 1
assert fitting.guess_p0("a * x + b", xt, xt) is None

# ---- t 検定・基本統計量 ------------------------------------------------------------
a, b = rng.normal(5, 1, 12), rng.normal(5.8, 2, 9)
r, sp = G.ttest(a, b), S.ttest_ind(a, b, equal_var=False)
close([r["t"], r["p"], r["df"]], [sp.statistic, sp.pvalue, sp.df], 1e-9, "welch")
r, sp = G.ttest(a[:9], b, paired=True), S.ttest_rel(a[:9], b)
close([r["t"], r["p"]], [sp.statistic, sp.pvalue], 1e-9, "paired")
pr, sp = G.pearson(a[:9], b), S.pearsonr(a[:9], b)
close(pr, [sp.statistic, sp.pvalue], 1e-9, "pearson")
d = G.describe([1, 2, None, 4, float("nan")])
assert d["n"] == 3 and abs(d["sd"] - np.std([1, 2, 4], ddof=1)) < 1e-12

# ---- データの加工 ------------------------------------------------------------------
ds = make([1, 2, 3, 4], [10, 20, 40, 80], [1, 2, 4, 8])
out = dataops.apply(ds, "expr", {"x_expr": "1 / x", "y_expr": "log(y)"})
close(out["x"], [1, 0.5, 1 / 3, 0.25], 1e-12, "expr x")
close(out["yerr"], [0.1] * 4, 1e-6, "ln y の誤差 = u(y)/y")
out = dataops.apply(make([3, 1, 2, 1], [9, 1, 4, 3]), "mean", {"err": "sd"})
assert out["x"] == [1, 2, 3] and out["y"] == [2, 4, 9] and out["yerr"][1] is None
close(out["yerr"][0], np.std([1, 3], ddof=1), 1e-12, "mean sd")
out = dataops.apply(make([0, 1, 2, 3], [0, 1, 4, 9]), "integ")
close(out["y"], [0, 0.5, 3, 9.5], 1e-12, "integ")
out = dataops.apply(make([0, 1, 2, 3], [0, 1, 4, 9]), "diff")
close(out["y"], np.gradient([0, 1, 4, 9.0], [0, 1, 2, 3.0]), 1e-12, "diff")
assert dataops.apply(make([0, 1, 2, 3], [0, 1, 4, 9]), "crop", {"min": 1, "max": 2})["x"] == [1, 2]
assert dataops.apply(make([0, 1, 2], [2, 4, 8]), "norm", {"mode": "max"})["y"] == [0.25, 0.5, 1]

# ---- 描画 (帯・残差・延長・目盛り) と Web API ---------------------------------------
proj = Project()
for i, (kind, extra) in enumerate([("linear", dict(band="confidence", extend=True)),
                                   ("custom", dict(equation="a * exp(-b * x) + c", band="prediction")),
                                   ("savgol", {})]):
    d = proj.add(proj.new_dataset())
    d.set_columns(list(x), list([y, ye * 3, y2 / 10][i]), list(sig) if i == 0 else None)
    d.fit.kind = kind
    d.color = ["#1f77b4", "#d62728", "#000000"][i]
    for k, v in extra.items():
        setattr(d.fit, k, v)
proj.settings.residuals = True
proj.settings.x_axis.step = 2
pj = json.dumps(proj.to_dict())
for fmt in ("png", "pdf", "svg", "eps"):
    r = json.loads(webapi.render(pj, fmt, 100))
    assert r["ok"] and not r["empty"] and len(r["image"]) > 1000, (fmt, r.get("error"))
    checks += 1
assert len(r["stats"]) == 3 and r["axes"]["box"][0] < r["axes"]["box"][2]
assert r["results"][0]["params"][0]["ci"] is not None and r["results"][0]["dof"] == x.size - 2
dd = proj.to_dict()["datasets"]
r = json.loads(webapi.predict(json.dumps({"dataset": dd[0], "x": 5, "y": 11, "level": 0.95})))
assert r["ok"] and r["predict"]["ci"] > 0 and r["solve"][0]["se"] > 0, r
r = json.loads(webapi.transform(json.dumps({"dataset": dd[0], "op": "expr", "opt": {"y_expr": "log(y)"}})))
assert r["ok"] or "無効" in r["error"], r
r = json.loads(webapi.ttest(json.dumps({"a": list(a), "b": list(b)})))
assert r["ok"] and 0 < r["p"] < 1
r = json.loads(webapi.guess_p0(json.dumps({"dataset": dd[1], "equation": "A * exp(-k * x) + y0"})))
assert r["ok"] and set(r["p0"]) == {"A", "k", "y0"}
old = {"format": "graphapp-project", "version": 3, "datasets": [{"id": 1, "x": [1, 2, 3], "y": [2, 4, 7],
       "fit": {"kind": "linear"}}], "settings": {}}
r = json.loads(webapi.render(json.dumps(old), "png", 60))
assert r["ok"] and r["results"][0]["ok"], r
json.loads(webapi.init())

print(f"OK ({checks} checks)")
