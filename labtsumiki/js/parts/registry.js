/* 部品の定義を集める所。
 *
 * 部品の定義 (def) の項目:
 *   type        種類の名前 (保存データに入る。あとから変えない)
 *   name        { ja, en } 表示名
 *   cat         部品一覧での分類 (CATEGORIES のキー)
 *   params      調整できる値の一覧 [{ key, label, type: select|range|bool|color, ... , default }]
 *   build(p, ctx)  形 (Shape) を作る。ctx には周りの部品から決まる値が入る
 *                  ctx.fit   … 台・クランプが合わせる相手の幅 (mm)
 *                  ctx.probe … 温度計などを差し込む深さ (mm)
 *   label(p, lang) ラベルの文字 (省略すると name)
 *   grounded    机の上に置く物 (整列で床に揃える)
 *   labelDefault  ラベルを最初から出すか (既定 true)
 *   adapt(p, info) つないだ相手の向きに合わせて値を変える (例: 減圧アダプターの出口を鉛直に)
 *   autoPlace   ホースだけでつながる小物 (整列で相手の近くに置く)
 */

import { JOINT_SIZES, LIQUID_COLORS } from "../draw.js";

const DEFS = new Map();

export const CATEGORIES = [
  ["vessel", "フラスコ・容器"],
  ["adapter", "ヘッド・アダプター"],
  ["condenser", "冷却管・カラム"],
  ["funnel", "ロート・ビュレット"],
  ["purify", "抽出・精製"],
  ["insert", "温度計・栓"],
  ["heat", "加熱・撹拌・台"],
  ["vacuum", "減圧・配管"],
  ["support", "スタンド・クランプ"],
];

export function define(def) {
  if (DEFS.has(def.type)) throw new Error(`部品 ${def.type} が二重に定義されています`);
  def.params = def.params || [];
  DEFS.set(def.type, def);
  return def;
}

export function getDef(type) {
  const d = DEFS.get(type);
  if (!d) throw new Error(`未知の部品: ${type}`);
  return d;
}

export function hasDef(type) {
  return DEFS.has(type);
}

export function allDefs() {
  return [...DEFS.values()];
}

/** 足りない値を既定値で埋めた params を返す */
export function withDefaults(def, params = {}) {
  const p = {};
  for (const q of def.params) p[q.key] = params[q.key] ?? q.default;
  // 定義にない値 (自動調整の結果など) も残す
  for (const [k, v] of Object.entries(params)) if (!(k in p)) p[k] = v;
  return p;
}

export function partLabel(def, p, lang = "ja") {
  if (def.label) return def.label(p, lang);
  return def.name[lang] || def.name.ja;
}

/* ---- よく使う調整項目 ---- */

export function pJoint(key = "joint", label = "すり合わせ", def = "24/40") {
  return { key, label, type: "select", options: JOINT_SIZES.map((s) => [s, s]), default: def };
}

export function pSelect(key, label, options, def) {
  return { key, label, type: "select", options, default: def };
}

export function pRange(key, label, min, max, step, def, unit = "") {
  return { key, label, type: "range", min, max, step, default: def, unit };
}

export function pBool(key, label, def = false) {
  return { key, label, type: "bool", default: def };
}

export function pColor(key = "color", label = "液体の色", def = "#7fb8e6") {
  return { key, label, type: "color", options: LIQUID_COLORS, default: def };
}

export function pLevel(key = "level", label = "液量", def = 0.35) {
  return { key, label, type: "range", min: 0, max: 0.95, step: 0.05, default: def, unit: "%" };
}

export function volOptions(list) {
  return list.map((v) => [v, `${v} mL`]);
}
