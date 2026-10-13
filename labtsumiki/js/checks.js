/* 装置としておかしな所の確認 (図の描き間違いを防ぐ) */

import { components } from "./scene.js";
import { tubeGeometry, tubeFlow } from "./compose.js";

const HEATERS = new Set(["mantle", "burner"]);
const CONDENSERS = new Set(["liebig", "allihn", "dimroth"]);

function nameOf(it) {
  return it.def.name.ja;
}

/** 確認結果の一覧 [{ level: warn|info, text, ids }] */
export function runChecks(doc, solved) {
  const out = [];
  const items = solved.items;

  // 1) 冷却管の水
  for (const it of items.values()) {
    if (!CONDENSERS.has(it.def.type)) continue;
    const ends = ["waterIn", "waterOut"].map((port) => doc.tubes.find((t) => (t.a.id === it.part.id && t.a.port === port) || (t.b.id === it.part.id && t.b.port === port)));
    if (ends.some((t) => !t)) {
      out.push({ level: "warn", text: `${nameOf(it)}に冷却水のホースがつながっていません。`, ids: [it.part.id] });
      continue;
    }
    // 入口の口へ水が流れ込んでいるか (相手が蛇口か、矢印の向きで判断)
    const reversed = ends.some((t, k) => {
      const g = tubeGeometry(solved, t);
      if (!g) return false;
      const mine = t.a.id === it.part.id ? g.pa : g.pb, other = mine === g.pa ? g.pb : g.pa;
      if (other.flow === (k === 0 ? "in" : "out")) return true;
      const { dir } = tubeFlow(g, t);
      if (!dir) return false;
      const intoMine = mine === g.pb ? dir > 0 : dir < 0;
      return k === 0 ? !intoMine : intoMine;
    });
    if (reversed) {
      out.push({ level: "warn", text: `${nameOf(it)}の冷却水の向きが逆です。${it.def.type === "dimroth" ? "決められた口" : "下の口"}から入れてください。`, ids: [it.part.id] });
    }
  }

  // 2) 密閉したまま加熱していないか
  const tubeEnds = new Set(doc.tubes.flatMap((t) => [`${t.a.id}:${t.a.port}`, `${t.b.id}:${t.b.port}`]));
  for (const comp of components(doc)) {
    const its = comp.map((id) => items.get(id));
    const heated = its.some((it) => HEATERS.has(it.def.type) || (it.def.type === "bath" && it.part.params.medium === "oil") || (it.def.type === "stirrer" && it.part.params.heat && comp.length > 1));
    const glass = its.filter((it) => it.ports.some((q) => q.kind === "joint"));
    if (!heated || !glass.length) continue;
    const open = its.some((it) => it.ports.some((q) => {
      if (q.kind === "mouth") return true;                                    // すり合わせの無い口は密閉されない
      if (q.link) return false;
      if (q.kind === "joint" && q.gender === "F") return true;               // 空いた口
      if (q.kind === "hose" && q.medium !== "water") return true;            // 空いた吸引口など
      return false;
    }) || ["dryingTube", "capillary"].includes(it.def.type)
      || it.ports.some((q) => q.kind === "hose" && q.medium !== "water" && tubeEnds.has(`${it.part.id}:${q.id}`)));
    if (!open) out.push({ level: "warn", text: "密閉した装置を加熱しています。圧力が上がって危険です (乾燥管・ガス導入などで外とつなぐ)。", ids: comp });
  }

  // 3) 空いたままのオスのすり合わせ (つなぎ忘れ)
  for (const it of items.values()) {
    if (it.ports.some((q) => q.kind === "joint" && q.gender === "M" && !q.link)) {
      if (it.def.cat === "insert") continue;
      out.push({ level: "info", text: `${nameOf(it)}の差し込み口 (オス) がどこにもつながっていません。`, ids: [it.part.id] });
    }
  }
  return out;
}
