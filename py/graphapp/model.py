"""データモデル: プロジェクト = データセット群 + グラフ全体設定。

JSON へそのまま保存できるよう、値はすべて素の Python 型で保持する。
欠損セル (入力途中の行など) は None で表す。
"""
from __future__ import annotations

import copy
import math
from dataclasses import asdict, dataclass, field, fields
from typing import Any

import numpy as np

FIT_KINDS = [
    ("なし", "none"),
    ("線形近似 (y=ax+b)", "linear"),
    ("非線形 (カスタム)", "custom"),
    ("Savitzky-Golay", "savgol"),
]
FIT_KIND_LABELS = {key: label for label, key in FIT_KINDS}

STYLES = [("点 (マーカー)", "points"), ("線", "line"), ("線 + 点", "line_points")]

# 白黒印刷でも区別できるよう、データセットごとにマーカー形状を変える
MARKERS = [
    ("自動", "auto"), ("○ 丸", "o"), ("□ 四角", "s"), ("△ 三角", "^"), ("◇ ひし形", "D"),
    ("▽ 逆三角", "v"), ("⬠ 五角形", "p"), ("⬡ 六角形", "h"), ("◁ 左三角", "<"), ("▷ 右三角", ">"),
]
AUTO_MARKERS = ["o", "s", "^", "D", "v", "p", "h", "<", ">"]

DEFAULT_COLORS = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
]

FONT_STYLES = [
    ("セリフ (Times 系・論文向け)", "serif"),
    ("サンセリフ (DejaVu Sans)", "sans"),
    ("ゴシック (v1 互換)", "gothic"),
]

# (表示名, 幅 cm, 高さ cm, 文字サイズ pt)
FIGURE_PRESETS = [
    ("レポート (12 × 9 cm, 10 pt)", 12.0, 9.0, 10.0),
    ("論文 1段組 (8.5 × 6.5 cm, 8 pt)", 8.5, 6.5, 8.0),
    ("論文 2段組 (17 × 10 cm, 9 pt)", 17.0, 10.0, 9.0),
    ("スライド (20 × 15 cm, 16 pt)", 20.0, 15.0, 16.0),
    ("v1 互換 (8 × 6 in, 10 pt)", 20.32, 15.24, 10.0),
]

LEGEND_LOCS = [
    ("自動 (重ならない位置)", "best"), ("右上", "upper right"), ("左上", "upper left"),
    ("右下", "lower right"), ("左下", "lower left"), ("右中央", "center right"),
    ("左中央", "center left"), ("上中央", "upper center"), ("下中央", "lower center"),
    ("グラフの外 (右)", "outside right"),
]


def _from_dict(cls, data: dict | None):
    """dataclass を辞書から生成する。未知のキーは無視し、欠けたキーは既定値にする。"""
    if data is None:
        return cls()
    names = {f.name for f in fields(cls)}
    return cls(**{k: v for k, v in data.items() if k in names})


@dataclass
class FitSpec:
    kind: str = "none"
    equation: str = "a * np.exp(-b * x) + c"
    label: str = ""
    show_r2: bool = False
    show_formula: bool = False
    sig_figs: int = 3
    window_length: int = 5
    polyorder: int = 2
    weighted: bool = False  # Y 誤差で重み付け (誤差の逆数を重みにする)


@dataclass
class Dataset:
    id: int = 0
    name: str = "データ1"
    color: str = "#1f77b4"
    style: str = "points"
    visible: bool = True
    x: list = field(default_factory=list)
    y: list = field(default_factory=list)
    yerr: list = field(default_factory=list)
    xerr: list = field(default_factory=list)
    marker: str = "auto"
    filled: bool = True
    marker_size: float = 5.0
    line_width: float = 1.5
    fit: FitSpec = field(default_factory=FitSpec)
    # データの出どころ (数式生成時の条件やファイル名)。表示と再生成用。
    source: dict | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "Dataset":
        ds = _from_dict(cls, data)
        ds.fit = _from_dict(FitSpec, data.get("fit"))
        ds.set_columns(ds.x, ds.y, ds.yerr, ds.xerr)
        return ds

    def set_columns(self, x, y, yerr=None, xerr=None) -> None:
        cols = [[_num_or_none(v) for v in (c or [])] for c in (x, y, yerr, xerr)]
        n = max(len(c) for c in cols)
        for c in cols:
            c += [None] * (n - len(c))
        self.x, self.y, self.yerr, self.xerr = cols

    @property
    def has_yerr(self) -> bool:
        return any(v is not None for v in self.yerr)

    @property
    def has_xerr(self) -> bool:
        return any(v is not None for v in self.xerr)

    def valid_arrays(self):
        """x, y がともに有限な行だけを取り出す。誤差は欠損を 0 とし、列が空なら None。"""
        def arr(col):
            a = np.array([np.nan if v is None else v for v in col], dtype=float)
            return np.resize(a, len(self.x)) if len(a) != len(self.x) else a
        x, y = arr(self.x), arr(self.y)
        mask = np.isfinite(x) & np.isfinite(y)
        errs = []
        for col, has in ((self.yerr, self.has_yerr), (self.xerr, self.has_xerr)):
            if not has:
                errs.append(None)
                continue
            e = np.abs(arr(col))[mask]
            errs.append(np.where(np.isfinite(e), e, 0.0))
        return x[mask], y[mask], errs[0], errs[1]

    def valid_xy(self) -> tuple[np.ndarray, np.ndarray]:
        x, y, _, _ = self.valid_arrays()
        return x, y

    @property
    def n_points(self) -> int:
        return int(self.valid_xy()[0].size)


@dataclass
class AxisSpec:
    auto: bool = True
    min: float = 0.0
    max: float = 1.0
    log: bool = False


@dataclass
class GraphSettings:
    title: str = "実験結果"
    show_title: bool = False  # 論文では図題は本文のキャプションに書くのが通例
    xlabel: str = "Time / s"
    ylabel: str = "Value"
    sci_notation: bool = False
    x_sig_figs: int = 3
    y_sig_figs: int = 3
    grid: bool = False
    legend: bool = True
    data_legend: bool = True
    legend_loc: str = "best"
    legend_frame: bool = True
    font_style: str = "serif"
    font_size: float = 10.0
    width_cm: float = 12.0
    height_cm: float = 9.0
    x_axis: AxisSpec = field(default_factory=AxisSpec)
    y_axis: AxisSpec = field(default_factory=AxisSpec)

    @classmethod
    def from_dict(cls, data: dict | None) -> "GraphSettings":
        s = _from_dict(cls, data)
        data = data or {}
        s.x_axis = _from_dict(AxisSpec, data.get("x_axis"))
        s.y_axis = _from_dict(AxisSpec, data.get("y_axis"))
        return s


@dataclass
class Project:
    datasets: list[Dataset] = field(default_factory=list)
    settings: GraphSettings = field(default_factory=GraphSettings)
    next_id: int = 1

    FORMAT = "graphapp-project"
    VERSION = 3

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["format"] = self.FORMAT
        d["version"] = self.VERSION
        return d

    @classmethod
    def from_dict(cls, data: dict) -> "Project":
        if data.get("format", cls.FORMAT) != cls.FORMAT:
            raise ValueError("グラフ生成アプリのプロジェクトファイルではありません。")
        p = cls(
            datasets=[Dataset.from_dict(d) for d in data.get("datasets", [])],
            settings=GraphSettings.from_dict(data.get("settings")),
            next_id=int(data.get("next_id", 1)),
        )
        used = max((ds.id for ds in p.datasets), default=0)
        p.next_id = max(p.next_id, used + 1)
        return p

    # ---- データセット操作 -------------------------------------------------
    def get(self, ds_id: int) -> Dataset | None:
        return next((ds for ds in self.datasets if ds.id == ds_id), None)

    def index_of(self, ds_id: int) -> int:
        return next((i for i, ds in enumerate(self.datasets) if ds.id == ds_id), -1)

    def new_dataset(self, **kwargs) -> Dataset:
        ds = Dataset(id=self.next_id, **kwargs)
        if "name" not in kwargs:
            ds.name = f"データ{self.next_id}"
        if "color" not in kwargs:
            ds.color = DEFAULT_COLORS[(self.next_id - 1) % len(DEFAULT_COLORS)]
        self.next_id += 1
        return ds

    def add(self, ds: Dataset, index: int | None = None) -> Dataset:
        if index is None:
            self.datasets.append(ds)
        else:
            self.datasets.insert(index, ds)
        return ds

    def duplicate(self, ds_id: int) -> Dataset | None:
        src = self.get(ds_id)
        if src is None:
            return None
        dup = copy.deepcopy(src)
        dup.id = self.next_id
        self.next_id += 1
        dup.name = f"{src.name} のコピー"
        self.add(dup, self.index_of(ds_id) + 1)
        return dup

    def remove(self, ds_id: int) -> None:
        self.datasets = [ds for ds in self.datasets if ds.id != ds_id]

    def move(self, ds_id: int, new_index: int) -> None:
        i = self.index_of(ds_id)
        if i < 0:
            return
        ds = self.datasets.pop(i)
        new_index = max(0, min(new_index, len(self.datasets)))
        self.datasets.insert(new_index, ds)


def _num_or_none(v) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None
