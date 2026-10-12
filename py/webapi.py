"""Web 版 (Pyodide) と graphapp コアの橋渡し。

ブラウザの Web Worker 内で動き、JavaScript からは JSON 文字列で呼ばれる。
グラフ描画・近似・数式・ファイル解析は PC 版と同じ graphapp のコードをそのまま使う。
"""
from __future__ import annotations

import base64
import json
from dataclasses import asdict

import numpy as np

from graphapp import APP_VERSION, io_utils
from graphapp.fitting import savgol_params
from graphapp.model import (AUTO_MARKERS, DEFAULT_COLORS, FIGURE_PRESETS, FIT_KINDS, FONT_STYLES,
                            LEGEND_LOCS, MARKERS, STYLES, Dataset, GraphSettings, Project)
from graphapp.plot_core import build_figure, render_bytes, setup_fonts
from graphapp.safe_expr import ExprError, compile_expr
from graphapp.texfmt import equation_tex, num_tex

_table_state: dict = {}


def _ok(**kw) -> str:
    return json.dumps({"ok": True, **kw}, ensure_ascii=False)


def _err(msg: str) -> str:
    return json.dumps({"ok": False, "error": str(msg)}, ensure_ascii=False)


def _f(v):
    return None if v is None or not np.isfinite(v) else float(v)


def init() -> str:
    setup_fonts()
    # 初回の描画を速くするため、空の図を 1 回描いておく (フォントの読み込み)
    p = Project()
    ds = p.add(p.new_dataset())
    ds.set_columns([0, 1], [0, 1])
    fig, _ = build_figure(p)
    render_bytes(fig, "png", 30)
    return _ok(version=APP_VERSION, defaults=defaults_dict())


def defaults_dict() -> dict:
    return {
        "dataset": asdict(Dataset()),
        "settings": asdict(GraphSettings()),
        "project": Project().to_dict(),
        "colors": DEFAULT_COLORS,
        "markers": MARKERS,
        "auto_markers": AUTO_MARKERS,
        "styles": STYLES,
        "fit_kinds": FIT_KINDS,
        "font_styles": FONT_STYLES,
        "presets": FIGURE_PRESETS,
        "legend_locs": LEGEND_LOCS,
    }


def normalize(project_json: str) -> str:
    """読み込んだプロジェクト (古い版を含む) を現在の形式にそろえる。"""
    try:
        p = Project.from_dict(json.loads(project_json))
    except Exception as e:  # noqa: BLE001
        return _err(f"プロジェクトを読み込めませんでした: {e}")
    return _ok(project=p.to_dict())


def render(project_json: str, fmt: str = "png", dpi: float = 100, tight: bool = False) -> str:
    try:
        p = Project.from_dict(json.loads(project_json))
        visible = [ds for ds in p.datasets if ds.visible]
        if not visible:
            msg = [] if not p.datasets else ["表示するデータがありません (すべて非表示です)。"]
            return _ok(empty=True, messages=msg, results=[])
        fig, results = build_figure(p)
        data = render_bytes(fig, fmt, float(dpi), bool(tight))
        ax = fig.axes[0]
        res = []
        for r in results:
            res.append({
                "dataset_id": r.dataset_id, "name": r.dataset_name, "kind": r.kind, "ok": r.ok,
                "equation": r.equation, "message": r.message, "r2": _f(r.r2), "weighted": r.weighted,
                "params": [{"name": n, "value": _f(v), "err": _f(e)} for n, v, e in r.params],
            })
        msgs = [f"[{r.dataset_name}] {r.message}" for r in results if r.message]
        msgs += [f"[{ds.name}] プロットできる点がありません。" for ds in visible if ds.n_points == 0]
        return _ok(empty=False, image=base64.b64encode(data).decode("ascii"), fmt=fmt,
                   xlim=list(map(float, ax.get_xlim())), ylim=list(map(float, ax.get_ylim())),
                   results=res, messages=msgs)
    except Exception as e:  # noqa: BLE001
        return _err(f"描画できませんでした: {e}")


def validate_fit(expr: str) -> str:
    try:
        ce = compile_expr(expr, ("x",), allow_params=True)
        if not ce.params:
            raise ExprError("パラメータ (a, b, c など) がありません")
        return _ok(params=list(ce.params))
    except ExprError as e:
        return _err(str(e))


def validate_gen(expr: str) -> str:
    try:
        compile_expr(expr, ("x",))
        return _ok()
    except ExprError as e:
        return _err(str(e))


def savgol_info(window_length: int, polyorder: int) -> str:
    wl, po = savgol_params(window_length, polyorder)
    return _ok(window_length=wl, polyorder=po)


def generate(args_json: str) -> str:
    """数式からデータ点を作る (PC 版の「数式から生成」と同じ)。"""
    a = json.loads(args_json)
    try:
        if a["mode"] == "y_fx":
            ce = compile_expr(a["expr"], ("x",))
            x = np.linspace(float(a["min"]), float(a["max"]), int(a["n"]))
            y = ce(x)
            src = {"type": "formula", "mode": "y_fx", "expr": ce.source,
                   "min": float(a["min"]), "max": float(a["max"]), "n": int(a["n"])}
            try:
                name = f"${equation_tex(ce.source, {}, 6)}$"
            except Exception:  # noqa: BLE001
                name = f"y = {ce.source}"
        else:
            n = int(a["n"])
            y = np.linspace(float(a["min"]), float(a["max"]), n)
            xc = float(a["x_const"])
            x = np.full(n, xc)
            src = {"type": "formula", "mode": "x_const", "x_const": xc,
                   "min": float(a["min"]), "max": float(a["max"]), "n": n}
            t = num_tex(xc, 6)
            name = f"$x = {t if 'times' in t else (t.rstrip('0').rstrip('.') or '0')}$"
    except (ExprError, ValueError, ArithmeticError, KeyError) as e:
        return _err(f"数式を評価できませんでした: {e}")
    if not np.isfinite(y).any():
        return _err("有効な値 (有限の数) が 1 つも得られませんでした。")
    return _ok(name=name, x=[float(v) for v in x],
               y=[float(v) if np.isfinite(v) else None for v in y], source=src)


def parse_table(filename: str, b64: str, sheet: str = "", header_mode: int = 0) -> str:
    """取り込むファイルを読み、列名・プレビューを返す (列の選択は JS 側)。"""
    import os
    import tempfile
    try:
        if b64:
            ext = os.path.splitext(filename)[1].lower()
            path = os.path.join(tempfile.gettempdir(), "import" + ext)
            with open(path, "wb") as f:
                f.write(base64.b64decode(b64))
            _table_state.clear()
            _table_state.update(path=path, filename=filename)
            if ext in io_utils.EXCEL_EXTS:
                _table_state["sheets"] = io_utils.excel_sheets(path)
        path = _table_state["path"]
        sheets = _table_state.get("sheets", [])
        raw = io_utils.read_raw_table(path, sheet or (sheets[0] if sheets else None))
        detected = io_utils.detect_header(raw) if not raw.empty else False
        has_header = detected if header_mode == 0 else (header_mode == 1)
        names, body = io_utils.split_header(raw, has_header)
        _table_state.update(names=names, body=body)
        preview = [body.row(r) for r in range(min(30, body.shape[0]))]
        yerr_guess = next((i for i, n in enumerate(names)
                           if any(k in n.lower() for k in ("誤差", "err", "σ", "sigma", "std", "標準偏差"))), -1)
        return _ok(names=names, preview=preview, rows=body.shape[0], detected=detected,
                   sheets=sheets, yerr_guess=yerr_guess)
    except Exception as e:  # noqa: BLE001
        return _err(f"ファイルを読み込めませんでした: {e}")


def import_columns(args_json: str) -> str:
    """選んだ列からデータセットの中身を作る (PC 版の取り込みダイアログと同じ規則)。"""
    import os
    a = json.loads(args_json)
    names, body = _table_state["names"], _table_state["body"]
    xcol, ycols = int(a["xcol"]), [int(c) for c in a["ycols"]]
    ecol, xecol = int(a.get("yerr", -1)), int(a.get("xerr", -1))
    x = io_utils.column_values(body, xcol)
    n = len(x)
    yerr = io_utils.column_values(body, ecol) if ecol >= 0 else [None] * n
    xerr = io_utils.column_values(body, xecol) if xecol >= 0 else [None] * n
    stem = os.path.splitext(_table_state["filename"])[0]
    out = []
    use = [c for c in ycols if c not in (ecol, xecol)]
    for c in use:
        y = io_utils.column_values(body, c)
        generic = names[c].startswith("列")
        name = stem if (len(use) == 1 and generic) else (names[c] if not generic else f"{stem} {names[c]}")
        rows = [r for r in zip(x, y, yerr, xerr) if r[0] is not None or r[1] is not None]
        out.append({"name": name, "x": [r[0] for r in rows], "y": [r[1] for r in rows],
                    "yerr": [r[2] for r in rows], "xerr": [r[3] for r in rows],
                    "source": {"type": "file", "file": _table_state["filename"],
                               "x_column": names[xcol], "y_column": names[c]}})
    return _ok(datasets=out)


def parse_paste(text: str) -> str:
    """貼り付けテキスト (Excel のコピーなど) を数値の行列にする。"""
    return _ok(rows=io_utils.parse_rows_text(text))
