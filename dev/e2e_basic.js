/* 以前からある機能の通し試験 (数式・テキスト編集・取り込み・書き出し・保存と再読込)。
 *   python3 dev/serve.py 8765 &   →   node dev/e2e_basic.js
 */
const { chromium } = require(process.env.PLAYWRIGHT || "/opt/node-tools/node_modules/playwright");
const fs = require("fs");
const URL = process.env.APP_URL || "http://localhost:8765/index.html";
let failed = 0;
const check = (cond, what, extra = "") => { if (!cond) failed++; console.log(`${cond ? "ok  " : "FAIL"} ${what}`, cond ? "" : extra); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failed++; console.log("PAGEERR", e.message); });
  page.on("dialog", (d) => d.accept());
  await page.goto(URL);
  await page.waitForSelector("#splash.done", { timeout: 60000 });
  const settle = async () => { await page.waitForTimeout(450); await page.waitForFunction(() => !rendering && document.getElementById("preview-busy").hidden); };
  const names = () => page.$$eval(".ds-name", (e) => e.map((x) => x.textContent));

  // 数式から生成 (入力欄で Enter)
  await page.click("#btn-formula");
  await page.fill("#fx-expr", "x**2");
  await page.press("#fx-expr", "Enter");
  await settle();
  check((await names()).length === 1 && await page.evaluate(() => curDs().x.length) === 100, "数式から生成 (Enter で実行)", (await names()).join());

  // テキストで編集
  await page.click("#btn-add");
  await page.click("#btn-textedit");
  await page.fill("#txt-area", "x, y\n1, 2\n2, 4.1\n3, 5.9\n4, 8.2");
  await page.click("#txt-ok");
  await settle();
  check(await page.evaluate(() => curDs().y.join()) === "2,4.1,5.9,8.2", "テキストで編集");

  // CSV の取り込み (誤差列つき)
  await page.setInputFiles("#file-import", { name: "測定.csv", mimeType: "text/csv", buffer: Buffer.from("t,v,err\n0,1.0,0.1\n1,2.1,0.1\n2,2.9,0.2\n3,4.2,0.2\n") });
  await page.waitForSelector("#dlg-import[open]");
  await page.click("#imp-ok");
  await settle();
  const imp = await page.evaluate(() => { const d = curDs(); return [d.name, d.x.length, d.yerr.join()]; });
  check(imp[1] === 4 && imp[2] === "0.1,0.1,0.2,0.2", "CSV の取り込み", JSON.stringify(imp));

  // 書き出し (PNG / PDF / SVG)
  for (const fmt of ["png", "pdf", "svg"]) {
    await page.click("#btn-export");
    await page.selectOption("#ex-fmt", fmt);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#ex-download")]);
    const size = fs.statSync(await dl.path()).size;
    check(size > 2000, `書き出し ${fmt}`, String(size));
  }

  // プロジェクトの保存 → 別のタブで開き直す
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btn-save")]);
  const text = fs.readFileSync(await dl.path(), "utf8");
  const proj = JSON.parse(text);
  check(proj.format === "graphapp-project" && proj.datasets.length === 3 && "conf_level" in proj.settings, "プロジェクトを保存");
  await page.setInputFiles("#file-open", { name: "保存したもの.gproj", mimeType: "application/json", buffer: Buffer.from(text) });
  await settle();
  check(await page.$$eval(".doctab", (e) => e.length) === 2 && (await names()).length === 3, "プロジェクトを開く (新しいタブ)");

  // 以前の版のプロジェクト (新しい項目がない) も開ける
  const old = { format: "graphapp-project", version: 3, next_id: 2, settings: { xlabel: "古い" },
    datasets: [{ id: 1, name: "旧データ", x: [1, 2, 3], y: [1, 2, 2.9], fit: { kind: "linear" } }] };
  await page.setInputFiles("#file-open", { name: "old.gproj", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(old)) });
  await settle();
  const o = await page.evaluate(() => [curDs().fit.band, curDs().fit.degree, state.project.settings.conf_level, state.results[0].ok]);
  check(o.join() === "none,2,0.95,true", "以前の版のプロジェクトを開く", o.join());

  // 複製・並べ替え・削除・元に戻す
  await page.click("#btn-dup");
  await page.click("#btn-up");
  await page.click("#btn-del");
  await settle();
  check((await names()).join() === "旧データ", "複製・並べ替え・削除", (await names()).join());
  await page.click("#btn-undo");
  await settle();
  check((await names()).length === 2, "元に戻す");

  // データの加工: 結果を新しいグラフ (タブ) に作る / Enter で実行 / 変化なしの通知
  const tabsBefore = await page.$$eval(".doctab", (e) => e.length);
  await page.click('[data-etab="table"]');
  await page.click("#btn-ops");
  await page.selectOption("#ops-op", "expr");
  await page.selectOption("#ops-dest", "tab");
  await page.fill("#ops-yexpr", "y * 2");
  await page.press("#ops-yexpr", "Enter");
  await settle();
  check(await page.$$eval(".doctab", (e) => e.length) === tabsBefore + 1 && (await names()).length === 1
    && await page.evaluate(() => curDs().y.join()) === "2,4,5.8", "加工の結果を新しいグラフに作る (Enter で実行)", (await names()).join());
  await page.click("#btn-ops");
  await page.selectOption("#ops-op", "sort");
  await page.selectOption("#ops-dest", "replace");
  await page.click("#ops-ok");
  await page.waitForFunction(() => !document.getElementById("dlg-ops").open);
  check((await page.$eval("#toast", (e) => e.textContent)).includes("変わりません"), "変化がないときの通知", await page.$eval("#toast", (e) => e.textContent));

  await b.close();
  console.log(failed ? `${failed} 件の失敗` : "すべて成功");
  process.exit(failed ? 1 : 0);
})();
