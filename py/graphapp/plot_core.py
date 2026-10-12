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

from matplotlib import font_manager, ticker  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402
from matplotlib.text import Text  # noqa: E402

from .fitting import FitResult, compute_fit  # noqa: E402
from .model import AUTO_MARKERS, GraphSettings, Project  # noqa: E402
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


def build_figure(project: Project) -> tuple[Figure, list[FitResult]]:
    setup_fonts()
    s = project.settings
    rc = style_rc(s)
    results: list[FitResult] = []
    with matplotlib.rc_context(rc):
        fig = Figure(figsize=(max(s.width_cm, 2) * CM, max(s.height_cm, 2) * CM))
        fig._graphapp_rc = rc
        ax = fig.subplots()

        auto_i = 0
        for ds in project.datasets:
            if not ds.visible:
                continue
            marker = ds.marker
            if marker == "auto":
                marker = AUTO_MARKERS[auto_i % len(AUTO_MARKERS)]
                auto_i += 1
            x, y, yerr, xerr = ds.valid_arrays()
            label = ds.name if s.data_legend else None
            show_marker = ds.style in ("points", "line_points")
            show_line = ds.style in ("line", "line_points")
            if yerr is not None or xerr is not None:
                ax.errorbar(x, y, yerr=yerr, xerr=xerr, fmt="none", ecolor=ds.color,
                            elinewidth=0.8, capthick=0.8, zorder=1.5)
            ax.plot(x, y, color=ds.color, label=label, zorder=2,
                    linestyle="-" if show_line else "none", linewidth=ds.line_width,
                    marker=marker if show_marker else None, markersize=ds.marker_size,
                    markerfacecolor=ds.color if ds.filled else "white",
                    markeredgecolor=ds.color, markeredgewidth=0.8)

            res = compute_fit(ds)
            if res is None:
                continue
            results.append(res)
            if res.ok:
                ax.plot(res.x_fit, res.y_fit, color=ds.color, linestyle="--",
                        linewidth=max(ds.line_width * 0.8, 0.5), label=res.label, zorder=2.5)

        ax.set_xlabel(s.xlabel)
        ax.set_ylabel(s.ylabel)

        if s.x_axis.log:
            ax.set_xscale("log")
        if s.y_axis.log:
            ax.set_yscale("log")
        if not s.x_axis.auto and s.x_axis.min != s.x_axis.max:
            ax.set_xlim(s.x_axis.min, s.x_axis.max)
        if not s.y_axis.auto and s.y_axis.min != s.y_axis.max:
            ax.set_ylim(s.y_axis.min, s.y_axis.max)

        if s.grid:
            # 半透明は EPS で使えないため、不透明な薄い灰色にする
            ax.grid(True, linestyle=":", linewidth=0.5, color="0.6")

        ax.tick_params(direction="in", top=True, right=True, labeltop=False, labelright=False)
        ax.minorticks_on()
        ax.tick_params(which="minor", direction="in", top=True, right=True)

        if s.sci_notation:
            xs, ys = int(s.x_sig_figs), int(s.y_sig_figs)
            ax.xaxis.set_major_formatter(ticker.FuncFormatter(lambda v, p: f"${sci_tex(v, xs)}$"))
            ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda v, p: f"${sci_tex(v, ys)}$"))

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
            fig.tight_layout(pad=0.3, rect=[0, bottom, 1, 1])
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
