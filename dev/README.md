# 開発用メモとツール

アプリ本体 (index.html / app.js / style.css / worker.js / py/) を変更するときに使うものです。
アプリの動作には関係しません。

## 構成

- 画面は `app.js`。プロジェクト (`.gproj` と同じ JSON) を持ち、変更はすべて `commit()` を通す (元に戻す・自動保存・再描画)
- 計算と描画は `py/` の Python。ブラウザでは `worker.js` が Pyodide で動かし、`py/webapi.py` が JSON で橋渡しする
- 選択肢や初期値 (近似の種類、テンプレート、信頼水準など) は `webapi.defaults_dict()` から画面に渡す。JS 側に同じ定数を書かない
- `.gproj` は PC 版と共通。項目を足すときは必ず既定値を付ける (古い版は知らない項目を無視する)

## 試し方

Pyodide の CDN に届かない環境でも試せるよう、同じ Python をネイティブで動かします。

```sh
pip install numpy matplotlib scipy openpyxl

python3 dev/test_core.py            # 計算部の検証 (scipy の結果と突き合わせる)

python3 dev/serve.py 8765 &         # 画面 + ネイティブ Python (worker.js を差し替える開発用サーバー)
node dev/e2e.js /tmp                # 新しい機能の通し試験 (Playwright。画像を /tmp に保存)
node dev/e2e_basic.js               # 以前からある機能の通し試験
```

- `py/` に `__pycache__` を残さない (公開されるフォルダ)。手で動かすときは `python3 -B`
- 実機 (Pyodide) での確認は、公開後のサイトか、CDN に届く環境で行う

## 公開するとき

1. ビルド番号 (`2.4.0-YYYYMMDDHHMM` の形) を `index.html` / `app.js` / `sw.js` / `py/manifest.json` で一斉に置き換える
   (古いキャッシュが残らないようにするため)
2. Python のファイルを足したら `py/manifest.json` と `sw.js` の `PRECACHE` の両方に入れる
3. 計算部を変えたら `py/graphapp/__init__.py` の `APP_VERSION` も上げる
4. RPC を足したら `worker.js` の `handlers` と `dev/serve.py` の `call()` の両方に登録する

## 統計まわりの決めごと

- 重みなしの近似: 共分散に残差の分散を掛け、信頼区間は t 分布 (自由度 = 点数 − パラメータ数)
- Y 誤差で重み付けした近似: 誤差を既知の標準偏差とみなす (scipy の `absolute_sigma=True` と同じ)。
  信頼区間は正規分布。予測区間は求めない
- 指数・累乗近似は対数変換せず、元のデータに対する非線形最小二乗 (初期値だけ対数変換から求める)
- 逆算 (y → x) の不確かさ: `√(u(y)² + u(近似値)²) / |傾き|`
