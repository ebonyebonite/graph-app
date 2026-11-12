/* 画面の通し試験 (dev/serve.py を起動してから実行する)。
 *   python3 dev/serve.py 8765 &
 *   node dev/e2e.js [スクリーンショットの保存先]
 */
const { chromium } = require(process.env.PLAYWRIGHT || "/opt/node-tools/node_modules/playwright");
const out = process.argv[2] || "/tmp";
const URL = process.env.APP_URL || "http://localhost:8765/index.html";
let failed = 0;
const check = (cond, what, extra = "") => { if (!cond) failed++; console.log(`${cond ? "ok  " : "FAIL"} ${what}`, cond ? "" : extra); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failed++; console.log("PAGEERR", e.message); });
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.goto(URL);
  await page.waitForSelector("#splash.done", { timeout: 60000 });
  const settle = async () => { await page.waitForTimeout(450); await page.waitForFunction(() => !rendering && document.getElementById("preview-busy").hidden); };
  const text = (sel) => page.$eval(sel, (e) => e.textContent);
  const paste = (sel, t) => page.$eval(sel, (el, t) => {
    el.focus();
    const dt = new DataTransfer(); dt.setData("text", t);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, t);

  // 1) 表に直接貼り付け → 線形近似
  await page.click("#btn-add");
  const rows = Array.from({ length: 10 }, (_, i) => `${i}\t${(0.52 * i + 0.1 + 0.2 * Math.sin(i * 7)).toFixed(3)}\t0.2`).join("\n");
  await paste("#data-table tbody input", rows);
  await settle();
  check(await page.$$eval("#data-table tbody tr", (r) => r.length) === 11, "表に 10 行貼り付け");
  await page.click('[data-etab="props"]');
  await page.selectOption("#p-fit", "linear");
  await settle();
  check((await text("#fit-cards")).includes("信頼区間"), "線形近似の結果に信頼区間", await text("#fit-cards"));
  check((await text(".fit-stats")).includes("補正 R²"), "近似の統計量");
  check(await page.$$eval("#stat-table tbody tr", (r) => r.length) === 2, "基本統計量 (X, Y)");

  // 2) 信頼帯・延長・残差・重み付け
  await page.selectOption("#p-band", "prediction");
  await page.check("#p-extend");
  await page.check("#s-resid");
  await page.fill('fieldset[data-axis="x_axis"] [data-k="step"]', "3");
  await settle();
  check((await text("#msg-list")) === "", "メッセージなし", await text("#msg-list"));
  await page.check("#p-weighted");
  await settle();
  check((await text("#fit-cards")).includes("χ²/自由度") && (await text("#msg-list")).includes("予測区間"), "重み付き: χ² と予測区間の注意");
  await page.uncheck("#p-weighted");

  // 3) 近似式で計算 (予測・逆算)
  await page.click('.rtabs [data-rtab="results"]');
  await page.fill("#calc-x", "4.5");
  await page.fill("#calc-y", "3");
  await settle();
  check(/y = [\d.]+ ± [\d.]+/.test(await text("#calc-y-out")), "x → y", await text("#calc-y-out"));
  check(/x = [\d.]+ ± [\d.]+/.test(await text("#calc-x-out")), "y → x", await text("#calc-x-out"));
  await page.screenshot({ path: `${out}/e2e-linear.png` });

  // 4) テンプレート (ガウス) と初期値
  await page.click("#btn-add");
  const peak = Array.from({ length: 41 }, (_, i) => { const x = 500 + i; return `${x}\t${(0.3 + 2 * Math.exp(-((x - 522) ** 2) / 50) + 0.02 * Math.cos(i * 5)).toFixed(4)}`; }).join("\n");
  await paste("#data-table tbody input", peak);
  await page.click('[data-etab="props"]');
  await page.selectOption("#p-fit", "custom");
  await page.selectOption("#p-template", { index: 3 });
  await settle();
  const p0 = await page.$$eval("#p-p0 input", (els) => els.map((e) => `${e.dataset.p}=${e.value}`));
  check(p0.length === 4 && p0.some((t) => t.startsWith("x0=52")), "ガウスの初期値を推定", p0.join(" "));
  const g = await page.evaluate(() => state.results.find((r) => r.kind === "custom"));
  check(g && g.ok && g.r2 > 0.99, "ガウス近似が収束", JSON.stringify(g && [g.ok, g.r2, g.message]));
  await page.selectOption("#p-fit", "poly");
  await page.fill("#p-degree", "4");
  await settle();
  check((await text("#ds-list")).includes("4 次多項式"), "多項式 (4 次)", await text("#ds-list"));

  // 5) t 検定・データ加工・CSV
  check(/p = /.test(await text("#tt-out")), "t 検定", await text("#tt-out"));
  await page.click('[data-etab="table"]');
  await page.click("#btn-ops");
  await page.selectOption("#ops-preset", { index: 1 });
  await page.click("#ops-ok");
  await settle();
  check((await text("#ds-list")).includes("(変換)"), "データ加工 (ln y) で新しいデータセット", await text("#ds-list"));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btn-csv")]);
  check(!!dl, "CSV 保存");   // テスト用ブラウザは日本語のファイル名を "download" と報告する

  // 6) 別のグラフへコピー・タブの並べ替え・閉じて復元
  await page.click("#btn-copyto");
  await page.click("#copyto-list .menu-item");
  await settle();
  const tabs = () => page.$$eval(".doctab", (els) => els.map((e) => (e.classList.contains("active") ? "*" : "") + e.querySelector(".doctab-name").textContent));
  check((await tabs()).length === 2 && await page.$$eval(".ds-item", (e) => e.length) === 1, "別のグラフへコピー", (await tabs()).join());
  await page.evaluate(() => moveDoc(1, 0));
  check((await tabs())[0].startsWith("*"), "タブの並べ替え", (await tabs()).join());
  await page.click(".doctab.active .doctab-close");
  await settle();
  check((await tabs()).length === 1, "タブを閉じる");
  await page.click("#btn-menu");
  await page.click("#menu-reopen");
  await settle();
  check((await tabs()).length === 2, "閉じたグラフを復元");
  await page.click(".doctab:not(.active) .doctab-name");
  await settle();
  await page.click("#btn-undo");
  await settle();

  // 7) 座標の読み取り
  const box = await page.$eval("#preview-img", (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 3]; });
  await page.mouse.move(box[0], box[1]);
  check(/x = .+y = /.test(await text("#preview-coord")), "プレビューの座標", await text("#preview-coord"));
  await page.screenshot({ path: `${out}/e2e-wide.png` });

  // 8) スマホ幅: 結果タブ
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('.tabbar [data-tab="results"]');
  await settle();
  await page.screenshot({ path: `${out}/e2e-mobile-results.png`, fullPage: true });
  await page.click('.tabbar [data-tab="data"]');
  await page.click('[data-etab="props"]');
  await page.screenshot({ path: `${out}/e2e-mobile-props.png`, fullPage: true });

  await b.close();
  console.log(failed ? `${failed} 件の失敗` : "すべて成功");
  process.exit(failed ? 1 : 0);
})();
