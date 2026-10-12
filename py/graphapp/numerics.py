"""numpy だけで書いた非線形最小二乗法と Savitzky-Golay フィルタ。

scipy (exe で約 30 MB) を同梱しないための置き換え。結果が scipy と一致するよう、
アルゴリズムは scipy の実装と同じものを使う。

  curve_fit     : scipy.optimize.curve_fit (method='lm') と同じ。中身は MINPACK の lmdif
                  (Levenberg–Marquardt 法 + 信頼領域, 前進差分ヤコビアン) を手順どおりに移植。
                  共分散も scipy と同じく、最後に計算したヤコビアン J から (JᵀJ)⁻¹ × 残差分散。
  savgol_filter : scipy.signal.savgol_filter (mode='interp', deriv=0) と同じ。
"""
from __future__ import annotations

import numpy as np

_EPSMCH = np.finfo(float).eps
_DWARF = np.finfo(float).tiny
_TOL = 1.49012e-08  # scipy.optimize.leastsq の ftol / xtol の既定値


class OptimizeWarning(UserWarning):
    pass


def _norm(v) -> float:
    return float(np.sqrt(np.dot(v, v)))


def _fdjac(fun, x, fvec, eps):
    """前進差分ヤコビアン (MINPACK fdjac2)。"""
    jac = np.empty((fvec.size, x.size))
    for j in range(x.size):
        h = eps * abs(x[j])
        if h == 0.0:
            h = eps
        xh = x.copy()
        xh[j] = x[j] + h
        jac[:, j] = (fun(xh) - fvec) / h
    return jac


def _inv_quad(r_mat, v) -> float:
    """vᵀ (RᵀR)⁻¹ v = ||R⁻ᵀ v||²。"""
    y = np.linalg.solve(r_mat.T, v)
    return float(np.dot(y, y))


def _lmpar(jac, fvec, diag, delta, par):
    """MINPACK lmpar: ||D x|| ≈ delta となる LM パラメータ par と、
    min ||J x − f||² + par ||D x||² の解 x を求める (ステップは −x)。"""
    m, n = jac.shape
    r_mat = np.linalg.qr(jac, mode="r")[:n]
    full_rank = bool(np.all(np.diag(r_mat) != 0.0))  # MINPACK と同じく対角が厳密に 0 かで判定
    x = np.linalg.lstsq(jac, fvec, rcond=None)[0]  # ガウス・ニュートン方向
    dx = diag * x
    dxnorm = _norm(dx)
    fp = dxnorm - delta
    if fp <= 0.1 * delta:
        return 0.0, x

    # 下限 parl
    parl = 0.0
    if full_rank:
        q = _inv_quad(r_mat, diag * dx / dxnorm)
        parl = (fp / delta) / q
    # 上限 paru
    gnorm = _norm((jac.T @ fvec) / diag)
    paru = gnorm / delta
    if paru == 0.0:
        paru = _DWARF / min(delta, 0.1)

    par = min(max(par, parl), paru)
    if par == 0.0:
        par = gnorm / dxnorm

    it = 0
    while True:
        it += 1
        if par == 0.0:
            par = max(_DWARF, 0.001 * paru)
        aug = np.vstack([jac, np.sqrt(par) * np.diag(diag)])
        rhs = np.concatenate([fvec, np.zeros(n)])
        x = np.linalg.lstsq(aug, rhs, rcond=None)[0]
        dx = diag * x
        dxnorm = _norm(dx)
        temp = fp
        fp = dxnorm - delta
        if abs(fp) <= 0.1 * delta or (parl == 0.0 and fp <= temp < 0.0) or it == 10:
            break
        s_mat = np.linalg.qr(aug, mode="r")[:n]
        parc = (fp / delta) / _inv_quad(s_mat, diag * dx / dxnorm)
        if fp > 0.0:
            parl = max(parl, par)
        if fp < 0.0:
            paru = min(paru, par)
        par = max(parl, par + parc)
    return par, x


_MESSAGES = {
    5: "Number of calls to function has reached maxfev = {maxfev}.",
    6: f"ftol={_TOL:f} is too small, no further reduction in the sum of squares is possible.",
    7: f"xtol={_TOL:f} is too small, no further improvement in the approximate solution is possible.",
    8: "gtol=0.000000 is too small, func(x) is orthogonal to the columns of the Jacobian to machine precision.",
}


def leastsq(fun, x0, maxfev=0, ftol=_TOL, xtol=_TOL, gtol=0.0, factor=100.0):
    """MINPACK lmdif (scipy.optimize.leastsq, Dfun なし) の移植。

    戻り値: (x, 最後に計算したヤコビアン, 最終残差, info)
    """
    x = np.array(x0, dtype=float)
    n = x.size
    if maxfev == 0:
        maxfev = 200 * (n + 1)
    eps = np.sqrt(max(0.0, _EPSMCH))

    fvec = np.asarray(fun(x), dtype=float)
    m = fvec.size
    if n > m:
        raise TypeError(f"Improper input: func (m={m}) returned less than n={n}")
    nfev = 1
    fnorm = _norm(fvec)
    par = 0.0
    it = 1
    info = 0
    diag = None
    delta = xnorm = 0.0
    jac = None

    while True:
        jac = _fdjac(fun, x, fvec, eps)
        nfev += n
        acnorm = np.sqrt(np.sum(jac * jac, axis=0))
        if it == 1:
            diag = np.where(acnorm == 0.0, 1.0, acnorm)
            xnorm = _norm(diag * x)
            delta = factor * xnorm
            if delta == 0.0:
                delta = factor

        gnorm = 0.0
        if fnorm != 0.0:
            g = jac.T @ (fvec / fnorm)
            ok = acnorm != 0.0
            if ok.any():
                gnorm = float(np.max(np.abs(g[ok] / acnorm[ok])))
        if gnorm <= gtol:
            info = 4
            break
        diag = np.maximum(diag, acnorm)

        while True:
            par, step = _lmpar(jac, fvec, diag, delta, par)
            wa1 = -step
            wa2 = x + wa1
            pnorm = _norm(diag * wa1)
            if it == 1:
                delta = min(delta, pnorm)
            fnew = np.asarray(fun(wa2), dtype=float)
            nfev += 1
            fnorm1 = _norm(fnew)

            actred = -1.0
            if 0.1 * fnorm1 < fnorm:
                actred = 1.0 - (fnorm1 / fnorm) ** 2
            temp1 = _norm(jac @ wa1) / fnorm
            temp2 = np.sqrt(par) * pnorm / fnorm
            prered = temp1 ** 2 + temp2 ** 2 / 0.5
            dirder = -(temp1 ** 2 + temp2 ** 2)
            ratio = actred / prered if prered != 0.0 else 0.0

            if ratio <= 0.25:
                if actred >= 0.0:
                    temp = 0.5
                else:
                    temp = 0.5 * dirder / (dirder + 0.5 * actred)
                if 0.1 * fnorm1 >= fnorm or temp < 0.1 or not np.isfinite(fnorm1):
                    temp = 0.1
                delta = temp * min(delta, pnorm / 0.1)
                par = par / temp
            elif par == 0.0 or ratio >= 0.75:
                delta = pnorm / 0.5
                par = 0.5 * par

            if ratio >= 1e-4:  # ステップを採用
                x = wa2
                fvec = fnew
                xnorm = _norm(diag * x)
                fnorm = fnorm1
                it += 1

            if abs(actred) <= ftol and prered <= ftol and 0.5 * ratio <= 1.0:
                info = 1
            if delta <= xtol * xnorm:
                info = 3 if info == 1 else 2
            if info != 0:
                return x, jac, fvec, info
            if nfev >= maxfev:
                return x, jac, fvec, 5
            if abs(actred) <= _EPSMCH and prered <= _EPSMCH and 0.5 * ratio <= 1.0:
                return x, jac, fvec, 6
            if delta <= _EPSMCH * xnorm:
                return x, jac, fvec, 7
            if gnorm <= _EPSMCH:
                return x, jac, fvec, 8
            if ratio >= 1e-4:
                break
    return x, jac, fvec, info


def curve_fit(f, xdata, ydata, p0, sigma=None, absolute_sigma=False, maxfev=0):
    """scipy.optimize.curve_fit (method='lm') 相当。戻り値 (popt, pcov)。"""
    xdata = np.asarray(xdata, dtype=float)
    ydata = np.asarray(ydata, dtype=float)
    p0 = np.atleast_1d(np.asarray(p0, dtype=float))
    if not (np.all(np.isfinite(xdata)) and np.all(np.isfinite(ydata))):
        raise ValueError("array must not contain infs or NaNs")
    if ydata.size < p0.size:
        raise TypeError(f"Improper input: func (m={ydata.size}) returned less than n={p0.size}")

    if sigma is None:
        def fun(p):
            return f(xdata, *p) - ydata
    else:
        w = 1.0 / np.asarray(sigma, dtype=float)

        def fun(p):
            return w * (f(xdata, *p) - ydata)

    popt, jac, fvec, info = leastsq(fun, p0, maxfev=maxfev)
    if info not in (1, 2, 3, 4):
        raise RuntimeError("Optimal parameters not found: " + _MESSAGES[info].format(maxfev=maxfev))

    cost = float(np.dot(fvec, fvec))
    pcov = None
    try:
        r_mat = np.linalg.qr(jac, mode="r")[: p0.size]
        if np.all(np.diag(r_mat) != 0.0):
            inv_r = np.linalg.inv(r_mat)
            pcov = inv_r @ inv_r.T
    except np.linalg.LinAlgError:
        pcov = None

    warn_cov = False
    if pcov is None or np.isnan(pcov).any():
        pcov = np.full((p0.size, p0.size), np.inf)
        warn_cov = True
    elif not absolute_sigma:
        if ydata.size > p0.size:
            pcov = pcov * (cost / (ydata.size - p0.size))
        else:
            pcov = np.full((p0.size, p0.size), np.inf)
            warn_cov = True
    if warn_cov:
        import warnings
        warnings.warn("Covariance of the parameters could not be estimated", OptimizeWarning, stacklevel=2)
    return popt, pcov


def savgol_coeffs(window_length: int, polyorder: int) -> np.ndarray:
    """中心点の値を与える Savitzky-Golay 係数 (scipy.signal.savgol_coeffs, use='dot')。"""
    half = window_length // 2
    pos = np.arange(-half, window_length - half, dtype=float)
    a = np.vander(pos, polyorder + 1, increasing=True)  # (window, order+1)
    y = np.zeros(polyorder + 1)
    y[0] = 1.0
    coeffs, *_ = np.linalg.lstsq(a.T, y, rcond=None)
    return coeffs


def savgol_filter(x, window_length: int, polyorder: int) -> np.ndarray:
    """scipy.signal.savgol_filter(x, window_length, polyorder) (mode='interp') 相当。"""
    x = np.asarray(x, dtype=float)
    if polyorder >= window_length:
        raise ValueError("polyorder must be less than window_length.")
    if window_length > x.size:
        raise ValueError("If mode is 'interp', window_length must be less than or equal to the size of x.")
    if window_length % 2 == 0:
        raise ValueError("window_length must be odd.")  # アプリでは常に奇数に補正してから呼ぶ
    n = x.size
    half = window_length // 2
    coeffs = savgol_coeffs(window_length, polyorder)
    y = np.empty_like(x)
    # 内部: 窓をずらしながら係数との内積
    windows = np.lib.stride_tricks.sliding_window_view(x, window_length)
    y[half: n - half] = windows @ coeffs
    # 両端 (各 half 点): 端の window_length 点に多項式をあてはめて評価する
    t = np.arange(window_length, dtype=float)
    left = np.polyfit(t, x[:window_length], polyorder)
    y[:half] = np.polyval(left, t[:half])
    right = np.polyfit(t, x[n - window_length:], polyorder)
    y[n - half:] = np.polyval(right, t[window_length - half:])
    return y
