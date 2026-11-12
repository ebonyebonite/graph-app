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
- [x] 画面 (app.js / index.html / style.css): 近似の新しい設定 (次数・テンプレート・初期値・X の範囲・
      区間の帯・延長)、結果タブ (カード表示・統計量・近似式で計算・基本統計量・t 検定・CSV)、
      グラフ設定 (信頼水準・残差・目盛り間隔)
- [x] データ加工ダイアログ、表への直接貼り付け、別のグラフへコピー、CSV 保存
- [x] タブの並べ替え (ドラッグ)・閉じたタブの復元、プレビューの座標読み取り、Ctrl+S
- [x] 使い方の更新、ビルド番号 2.4.0-202611121200、`APP_VERSION` 2.4.0、`sw.js` の PRECACHE
- [ ] 見直し (コードレビュー、スマホ幅・ダーク表示の確認、細かい使い勝手)
- [ ] 最後に HANDOFF.md と dev/ を消す (公開サイトに開発用ファイルを残さない)。PR は依頼があれば作る

## 試験
- `python3 dev/test_core.py` (184 項目) と `node dev/e2e.js <画像の保存先>` (19 項目) が通ること
