# 作業の引き継ぎメモ (開発中のみ。完成したら dev/ と一緒に消す)

依頼: 「もっと洗練し、統計的な機能やその他便利機能を追加」。ブランチ `claude/trusting-ramanujan-n17kvm`
(`gh-pages` から作り直した。PR #1 はマージ済みなので、PR を作るなら新規)。

## 試し方 (この環境は Pyodide の CDN に届かない)
- `pip install matplotlib scipy` → `python3 dev/test_core.py` … 計算部を scipy と突き合わせる
- `python3 dev/serve.py 8765` … 画面 + ネイティブ Python の RPC (worker.js をスタブに差し替え)。
  Playwright は `/opt/node-tools/node_modules/playwright`、`serviceWorkers: 'block'` で開く
- `py/` に `__pycache__` を残さない (公開されるフォルダ)

## 設計の要点
- `.gproj` は PC 版と共通。追加した項目はすべて既定値つき (古い版は無視する)。`Project.VERSION` は 3 のまま
- 画面の初期値・選択肢は `webapi.defaults_dict()` から来る (JS 側に定数を重複させない)
- 新しい RPC は「JSON 文字列 1 つを受け取る」形にそろえた (`worker.js` と `dev/serve.py` の両方に登録)
- 重み付き近似は Y 誤差を既知とみなす → 信頼区間は正規分布、予測区間は出さない

## 進み具合
- [x] 計算部: `stats.py` (t 分布・基本統計量・t 検定)、`fitting.py` (比例・多項式・指数・累乗・対数、
      初期値 p0、X の範囲、標準誤差・信頼区間・補正 R²・残差の標準偏差・換算 χ²、予測と逆算、
      テンプレートの初期値推定)、`dataops.py` (データ加工)、`plot_core.py` (信頼帯・残差プロット・
      近似線の延長・目盛り間隔)、`webapi.py` (predict / guess_p0 / transform / ttest、render に stats と axes)
- [ ] 画面 (app.js / index.html / style.css): 近似の新しい設定、結果タブの作り直し、統計、予測・逆算、t 検定
- [ ] データ加工ダイアログ、表への直接貼り付け、別のグラフへコピー、CSV 保存
- [ ] タブの並べ替え・閉じたタブの復元、プレビューの座標読み取り、Ctrl+S
- [ ] 使い方の更新、ビルド番号の更新 (`sw.js` の PRECACHE に stats.py / dataops.py を足す)、
      `APP_VERSION` を 2.4.0 に、最後に HANDOFF.md と dev/ を消す
