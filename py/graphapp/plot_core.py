"""グラフ描画 (GUI 非依存)。論文・レポートにそのまま載せられる体裁で描く。

  - 図の大きさは実寸 (cm) と文字サイズ (pt) で指定。紙面に貼ったときに文字が意図した大きさになる
  - 数値の指数表記は 1.23×10³ (上付き)。e+03 のような計算機表記は使わない
  - 数式・単位は mathtext で組版 (変数は斜体、関数名は立体)
  - データ点はデータセットごとに形の違うマーカー (白黒印刷でも区別できる)、誤差棒あり
  - 目盛りは内向き・四辺・補助目盛り、凡例は角の丸くない細い黒枠
  - フォントは同梱 (Times 系 STIX / DejaVu Sans / IPAexゴシック)。OS に依存しない
"""
from __future__ import annotations

import io
import os
import sys
import warnings
from contextlib import contextmanager

import matplotlib

matplotlib.use("Agg")

import numpy as np  # noqa: E402
from matplotlib import colors as mcolors  # noqa: E402
from matplotlib import font_manager, ticker  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402
from matplotlib.text import Text  # noqa: E402

from .fitting import FitResult, compute_fit  # noqa: E402
from .model import AUTO_MARKERS, GraphSettings, Project  # noqa: E402
from .stats import valid_level  # noqa: E402
from .texfmt import has_cjk, sci_tex  # noqa: E402

CM = 1 / 2.54
FONT_FILE = "ipaexg.ttf"
CJK_FONT = "IPAexGothic"

# 文字種ごとのフォント。日本語は IPAexゴシックにフォールバックする
FONT_RC = {
    "serif": {"font.family": ["STIXGeneral", CJK_FONT], "mathtext.fontset": "stix"},
    "sans": {"font.family": ["DejaVu Sans", CJK_FONT], "mathtext.fontset": "dejavusans"},
    "gothic": {"font.family": [CJK_FONT], "mathtext.fontset": "dejavusans"},
}

_fonts_ready = False


def resource_path(*parts: str) -> str:
    """同梱リソースの絶対パス (PyInstaller で固めた後も動く)。"""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base, *parts)


def setup_fonts() -> None:
    """同梱フォントを登録する。OS にどのフォントが入っているかに依存しない。"""
    global _fonts_ready
    if _fonts_ready:
        return
    path = resource_path("assets", "fonts", FONT_FILE)
    if os.path.exists(path):
        font_manager.fontManager.addfont(path)
    _fonts_ready = True


def style_rc(s: GraphSettings) -> dict:
    fs = float(s.font_size)
    rc = dict(FONT_RC.get(s.font_style, FONT_RC["serif"]))
    rc.update({
        "font.size": fs,
        "axes.labelsize": fs,
        "xtick.labelsize": fs * 0.9,
        "ytick.labelsize": fs * 0.9,
        "legend.fontsize": fs * 0.85,
        "axes.linewidth": 0.8,
        "xtick.major.width": 0.8, "ytick.major.width": 0.8,
        "xtick.minor.width": 0.6, "ytick.minor.width": 0.6,
        "xtick.major.size": 4.0, "ytick.major.size": 4.0,
        "xtick.minor.size": 2.0, "ytick.minor.size": 2.0,
        # 自動の目盛りでも 1e6 ではなく ×10⁶ と表示する
        "axes.formatter.use_mathtext": True,
        "axes.unicode_minus": True,
        "legend.fancybox": False,
        "legend.edgecolor": "black",
        "legend.framealpha": 1.0,
        "legend.borderaxespad": 0.6,
        "patch.linewidth": 0.6,
        "errorbar.capsize": 2.5,
        "pdf.fonttype": 42,   # PDF/EPS にフォントを TrueType のまま埋め込む (文字の検索・編集が可能)
        "ps.fonttype": 42,
        "svg.fonttype": "path",
        "savefig.facecolor": "white",
    })
    return rc


@contextmanager
def _rc(fig: Figure):
    with matplotlib.rc_context(getattr(fig, "_graphapp_rc", {})):
        yield


def _fix_mixed_text(fig: Figure) -> None:
    """日本語と数式 ($…$) が混ざったテキストは、地の文を日本語フォントで描く。

    matplotlib は数式を含む文字列の地の文にフォールバックを効かせられないため。
    """
    for t in fig.findobj(Text):
        s = t.get_text()
        if "$" in s and has_cjk(s):
            t.set_fontfamily([CJK_FONT])


def _band_color(color: str) -> tuple[float, float, float]:
    """信頼帯の色: データの色を白で薄めた不透明色 (半透明は EPS で使えない)。"""
    return tuple(c + (1.0 - c) * 0.85 for c in mcolors.to_rgb(color))


def _draw_band(ax, ds, res: FitResult, xs):
    """近似線のまわりの信頼帯 / 予測帯。描けなければ None。"""
    kind = getattr(ds.fit, "band", "none")
    if kind not in ("confidence", "prediction") or not res.parametric:
        return None
    half = res.interval(xs, kind)
    if half is None and kind == "prediction":
        half = res.interval(xs, "confidence")  # 重み付きの近似では予測区間を求められない
    if half is None:
        return None
    y = res.evaluate(xs)
    ok = np.isfinite(y) & np.isfinite(half)
    if not ok.any():
        return None
    return ax.fill_between(xs, y - half, y + half, where=ok, color=_band_color(ds.color), linewidth=0, zorder=1)


def _tick_step(axis, spec, lim) -> None:
    """目盛りの間隔の指定 (対数軸と、目盛りが多くなりすぎる指定は無視する)。"""
    step = float(getattr(spec, "step", 0) or 0)
    if step > 0 and not spec.log and abs(lim[1] - lim[0]) / step <= 50:
        axis.set_major_locator(ticker.MultipleLocator(step))


def build_figure(project: Project) -> tuple[Figure, list[FitResult]]:
    setup_fonts()
    s = project.settings
    rc = style_rc(s)
    level = valid_level(getattr(s, "conf_level", 0.95))
    visible = [ds for ds in project.datasets if ds.visible]
    fits = [compute_fit(ds, level) for ds in visible]
    results: list[FitResult] = [r for r in fits if r is not None]
    show_resid = bool(getattr(s, "residuals", False)) and any(r.parametric and r.resid.size for r in results)
    with matplotlib.rc_context(rc):
        fig = Figure(figsize=(max(s.width_cm, 2) * CM, max(s.height_cm, 2) * CM))
        fig._graphapp_rc = rc
        if show_resid:
            # 下段に残差 (測定値 − 近似値)。横軸は上段と共通
            ax, ax_r = fig.subplots(2, 1, sharex=True, gridspec_kw={"height_ratios": [3, 1]})
        else:
            ax, ax_r = fig.subplots(), None
        axes = [ax] if ax_r is None else [ax, ax_r]

        auto_i = 0
        extended = []  # 軸の範囲が決まってから端まで延ばす近似線
        for ds, res in zip(visible, fits):
            marker = ds.marker
            if marker == "auto":
                marker = AUTO_MARKERS[auto_i % len(AUTO_MARKERS)]
                auto_i += 1
            x, y, yerr, xerr = ds.valid_arrays()
            label = ds.name if s.data_legend else None
            show_marker = ds.style in ("points", "line_points")
            show_line = ds.style in ("line", "line_points")
            face = ds.color if ds.filled else "white"
            if yerr is not None or xerr is not None:
                ax.errorbar(x, y, yerr=yerr, xerr=xerr, fmt="none", ecolor=ds.color,
                            elinewidth=0.8, capthick=0.8, zorder=1.5)
            ax.plot(x, y, color=ds.color, label=label, zorder=2,
                    linestyle="-" if show_line else "none", linewidth=ds.line_width,
                    marker=marker if show_marker else None, markersize=ds.marker_size,
                    markerfacecolor=face, markeredgecolor=ds.color, markeredgewidth=0.8)

            if res is None or not res.ok:
                continue
            (line,) = ax.plot(res.x_fit, res.y_fit, color=ds.color, linestyle="--",
                              linewidth=max(ds.line_width * 0.8, 0.5), label=res.label, zorder=2.5)
            band = _draw_band(ax, ds, res, res.x_fit)
            if res.parametric and getattr(ds.fit, "extend", False):
                extended.append((ds, res, line, band))
            if ax_r is not None and res.parametric and res.resid.size:
                if res.resid_err is not None:
                    ax_r.errorbar(res.x_data, res.resid, yerr=res.resid_err, fmt="none", ecolor=ds.color,
                                  elinewidth=0.8, capthick=0.8, zorder=1.5)
                ax_r.plot(res.x_data, res.resid, linestyle="none", zorder=2,
                          marker=marker if show_marker else "o", markersize=ds.marker_size * 0.8,
                          markerfacecolor=face, markeredgecolor=ds.color, markeredgewidth=0.8)

        axes[-1].set_xlabel(s.xlabel)
        ax.set_ylabel(s.ylabel)

        if s.x_axis.log:
            ax.set_xscale("log")
        if s.y_axis.log:
            ax.set_yscale("log")
        if not s.x_axis.auto and s.x_axis.min != s.x_axis.max:
            ax.set_xlim(s.x_axis.min, s.x_axis.max)
        if not s.y_axis.auto and s.y_axis.min != s.y_axis.max:
            ax.set_ylim(s.y_axis.min, s.y_axis.max)

        xlim, ylim = ax.get_xlim(), ax.get_ylim()
        if extended:
            # 延長した線で表示範囲が変わらないよう、範囲を固定してから描き直す
            lo, hi = sorted(xlim)
            xs = np.geomspace(lo, hi, 400) if s.x_axis.log and lo > 0 else np.linspace(lo, hi, 400)
            for ds, res, line, band in extended:
                line.set_data(xs, res.evaluate(xs))
                if band is not None:
                    band.remove()
                    _draw_band(ax, ds, res, xs)
            ax.set_xlim(xlim)
            ax.set_ylim(ylim)
        _tick_step(ax.xaxis, s.x_axis, xlim)
        _tick_step(ax.yaxis, s.y_axis, ylim)

        if ax_r is not None:
            ax_r.axhline(0.0, color="black", linewidth=0.8, zorder=1)
            ax_r.set_ylabel(getattr(s, "residual_label", "残差"))
            m = max(abs(v) for v in ax_r.get_ylim()) * 1.1
            ax_r.set_ylim(-m, m)  # 0 を中心に上下対称
            ax_r.yaxis.set_major_locator(ticker.MaxNLocator(nbins=3, symmetric=True))

        for a in axes:
            if s.grid:
                # 半透明は EPS で使えないため、不透明な薄い灰色にする
                a.grid(True, linestyle=":", linewidth=0.5, color="0.6")
            a.tick_params(direction="in", top=True, right=True, labeltop=False, labelright=False)
            a.minorticks_on()
            a.tick_params(which="minor", direction="in", top=True, right=True)

        if s.sci_notation:
            xs_, ys_ = int(s.x_sig_figs), int(s.y_sig_figs)
            ax.xaxis.set_major_formatter(ticker.FuncFormatter(lambda v, p: f"${sci_tex(v, xs_)}$"))
            for a in axes:
                a.yaxis.set_major_formatter(ticker.FuncFormatter(lambda v, p: f"${sci_tex(v, ys_)}$"))

        if s.legend:
            handles, _ = ax.get_legend_handles_labels()
            if handles:
                if s.legend_loc == "outside right":
                    leg = ax.legend(loc="upper left", bbox_to_anchor=(1.02, 1.0), borderaxespad=0.0)
                else:
                    leg = ax.legend(loc=s.legend_loc)
                leg.set_frame_on(s.legend_frame)

        bottom = 0.0
        if s.show_title and s.title.strip():
            # 図題は図の下 (論文の図キャプションと同じ位置)
            fig.text(0.5, 0.012, s.title, ha="center", va="bottom", fontsize=s.font_size * 1.1)
            bottom = (s.font_size * 1.1 * 1.6 / 72) / fig.get_figheight()

        _fix_mixed_text(fig)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fig.tight_layout(pad=0.3, h_pad=0.5, rect=[0, bottom, 1, 1])
            if ax_r is not None:
                fig.align_ylabels(axes)
    return fig, results


def render_bytes(fig: Figure, fmt: str = "png", dpi: float = 300, tight: bool = False) -> bytes:
    """図をバイト列に書き出す。tight=False なら指定した図のサイズ (cm) どおりになる。"""
    buf = io.BytesIO()
    kwargs = {"bbox_inches": "tight", "pad_inches": 0.02} if tight else {}
    if fmt in ("tif", "tiff"):
        fmt = "tiff"
        kwargs["pil_kwargs"] = {"compression": "tiff_lzw"}
    with _rc(fig), warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fig.savefig(buf, format=fmt, dpi=dpi, facecolor="white", **kwargs)
    return buf.getvalue()


def save_figure(fig: Figure, path: str, dpi: float = 300, tight: bool = False) -> None:
    fmt = os.path.splitext(path)[1].lstrip(".").lower() or "png"
    data = render_bytes(fig, fmt, dpi, tight)
    with open(path, "wb") as f:
        f.write(data)
