/* 装置のひな形。部品・つながり・ホースを名前で書き、読み込むと自動で整列する。
 * parts: { 名前: [種類, 値, { x: 並べる順の目安 }] }
 * links / tubes: [["名前.接続口", "名前.接続口"], ...] */

import { newDoc, addPart, solve, moveParts } from "./scene.js";
import { tidy } from "./layout.js";

export const TEMPLATES = [
  {
    id: "vacuumDistillation",
    name: "減圧蒸留",
    parts: {
      jack: ["jack"],
      mantle: ["mantle"],
      flask: ["rbf", { volume: 100, level: 0.4 }],
      claisen: ["claisen"],
      cap: ["capillary"],
      head: ["stillHead"],
      thermo: ["thermometer"],
      cond: ["liebig"],
      vad: ["vacAdapter"],
      recv: ["pear", { volume: 50, level: 0.12, color: "#f2c14e" }],
      clamp: ["clamp", { arm: 60 }],
      stand: ["stand"],
      trap: ["coldTrap", {}, { x: 1 }],
      gauge: ["gauge", {}, { x: 2 }],
      pump: ["pump", {}, { x: 3 }],
      win: ["waterIn"],
      wout: ["waterOut"],
    },
    links: [
      ["jack.stage", "mantle.base"], ["mantle.stage", "flask.base"], ["flask.neck", "claisen.bottom"],
      ["claisen.top1", "cap.joint"], ["claisen.top2", "head.bottom"], ["head.top", "thermo.joint"],
      ["head.arm", "cond.in"], ["cond.out", "vad.in"], ["vad.out", "recv.neck"], ["flask.grip", "clamp.grip"],
    ],
    tubes: [["vad.hose", "trap.in"], ["trap.out", "gauge.in"], ["gauge.out", "pump.in"], ["win.hose", "cond.waterIn"], ["cond.waterOut", "wout.hose"]],
  },
  {
    id: "simpleDistillation",
    name: "常圧蒸留 (単蒸留)",
    parts: {
      jack: ["jack"],
      mantle: ["mantle"],
      flask: ["rbf", { volume: 200, level: 0.45, chips: true }],
      head: ["stillHead"],
      thermo: ["thermometer"],
      cond: ["liebig", { length: 300 }],
      vad: ["vacAdapter", { barb: false }],
      recv: ["erlenmeyer", { volume: 100, level: 0.15 }],
      clamp: ["clamp", { arm: 60 }],
      stand: ["stand"],
      win: ["waterIn"],
      wout: ["waterOut"],
    },
    links: [
      ["jack.stage", "mantle.base"], ["mantle.stage", "flask.base"], ["flask.neck", "head.bottom"], ["head.top", "thermo.joint"],
      ["head.arm", "cond.in"], ["cond.out", "vad.in"], ["vad.out", "recv.mouth"], ["flask.grip", "clamp.grip"],
    ],
    tubes: [["win.hose", "cond.waterIn"], ["cond.waterOut", "wout.hose"]],
  },
  {
    id: "reflux",
    name: "加熱還流",
    parts: {
      stirrer: ["stirrer"],
      bath: ["bath", { medium: "oil" }],
      flask: ["rbf", { volume: 100, level: 0.4, stirbar: true, color: "#e8833a" }],
      cond: ["dimroth"],
      dry: ["dryingTube"],
      clamp: ["clamp", { arm: 60 }],
      stand: ["stand"],
      win: ["waterIn"],
      wout: ["waterOut"],
    },
    links: [["stirrer.stage", "bath.base"], ["bath.stage", "flask.base"], ["flask.neck", "cond.out"], ["cond.in", "dry.joint"], ["flask.grip", "clamp.grip"]],
    tubes: [["win.hose", "cond.waterIn"], ["cond.waterOut", "wout.hose"]],
  },
  {
    id: "inertReaction",
    name: "不活性ガス下の反応 (三口)",
    parts: {
      stirrer: ["stirrer", { heat: false }],
      bath: ["bath", { medium: "ice" }],
      flask: ["rbf", { volume: 200, necks: 3, level: 0.3, stirbar: true }],
      cond: ["dimroth"],
      gas: ["gasAdapter"],
      balloon: ["gasSource"],
      funnel: ["dropFunnel"],
      thermo: ["thermometer", { joint: "24/40", length: 90 }],
      clamp: ["clamp", { arm: 60 }],
      stand: ["stand"],
      win: ["waterIn"],
      wout: ["waterOut"],
    },
    links: [
      ["stirrer.stage", "bath.base"], ["bath.stage", "flask.base"], ["flask.neck", "cond.out"], ["cond.in", "gas.bottom"],
      ["flask.neck2", "funnel.bottom"], ["flask.neck3", "thermo.joint"], ["flask.grip", "clamp.grip"],
    ],
    tubes: [["balloon.hose", "gas.hose"], ["win.hose", "cond.waterIn"], ["cond.waterOut", "wout.hose"]],
  },
  {
    id: "suctionFiltration",
    name: "吸引ろ過",
    parts: {
      flask: ["suctionFlask", { level: 0.15 }],
      buchner: ["buchner"],
      clamp: ["clamp", { arm: 50 }],
      stand: ["stand"],
      trap: ["suctionFlask", { volume: 250, level: 0 }, { x: 1 }],
      pump: ["pump", { kind: "aspirator" }, { x: 2 }],
    },
    links: [["flask.mouth", "buchner.stem"], ["flask.grip", "clamp.grip"]],
    tubes: [["flask.hose", "trap.hose"], ["trap.mouth", "pump.in"]],
  },
  {
    id: "titration",
    name: "滴定",
    parts: {
      stirrer: ["stirrer", { heat: false }],
      flask: ["erlenmeyer", { volume: 200, level: 0.2, stirbar: true, color: "#d9534f" }],
      burette: ["burette"],
      clamp: ["clamp", { arm: 60 }],
      stand: ["stand"],
    },
    links: [["stirrer.stage", "flask.base"], ["flask.mouth", "burette.stem"], ["burette.grip", "clamp.grip"]],
    tubes: [],
  },
  {
    id: "extraction",
    name: "分液 (抽出)",
    parts: {
      beaker: ["erlenmeyer", { volume: 200, level: 0.1 }],
      funnel: ["sepFunnel"],
      ring: ["clamp", { kind: "ring", arm: 60 }],
      stand: ["stand"],
    },
    links: [["beaker.mouth", "funnel.stem"], ["funnel.grip", "ring.grip"]],
    tubes: [],
  },
  {
    id: "burnerHeating",
    name: "ガスバーナーで加熱",
    parts: {
      tripod: ["tripod"],
      beaker: ["beaker", { volume: 300, level: 0.5 }],
      burner: ["burner"],
    },
    links: [["tripod.stage", "beaker.base"], ["tripod.floor", "burner.base"]],
    tubes: [],
  },
  {
    id: "soxhlet",
    name: "ソックスレー抽出",
    parts: {
      jack: ["jack"],
      mantle: ["mantle"],
      flask: ["rbf", { volume: 200, level: 0.4, chips: true }],
      sox: ["soxhlet"],
      cond: ["dimroth"],
      clamp: ["clamp", { arm: 60 }],
      stand: ["stand"],
      win: ["waterIn"],
      wout: ["waterOut"],
    },
    links: [["jack.stage", "mantle.base"], ["mantle.stage", "flask.base"], ["flask.neck", "sox.bottom"], ["sox.top", "cond.out"], ["sox.grip", "clamp.grip"]],
    tubes: [["win.hose", "cond.waterIn"], ["cond.waterOut", "wout.hose"]],
  },
  {
    id: "rotavap",
    name: "ロータリーエバポレーター",
    parts: {
      evap: ["rotavap"],
      flask: ["pear", { volume: 100, level: 0.3 }],
      recv: ["rbf", { volume: 200, level: 0.1 }],
      pump: ["pump", { kind: "diaphragm" }, { x: 1 }],
      win: ["waterIn"],
      wout: ["waterOut"],
    },
    links: [["evap.flask", "flask.neck"], ["evap.recv", "recv.neck"]],
    tubes: [["evap.vac", "pump.in"], ["win.hose", "evap.waterIn"], ["evap.waterOut", "wout.hose"]],
  },
  {
    id: "columnChromatography",
    name: "カラムクロマトグラフィー",
    parts: {
      col: ["column"],
      flask: ["erlenmeyer", { volume: 100, level: 0.1 }],
      clamp: ["clamp", { arm: 60 }],
      stand: ["stand"],
    },
    links: [["flask.mouth", "col.stem"], ["col.grip", "clamp.grip"]],
    tubes: [],
  },
  {
    id: "schlenk",
    name: "シュレンクライン",
    parts: {
      stirrer: ["stirrer", { heat: false }],
      flask: ["schlenkFlask", { volume: 100 }],
      sep: ["stopper", { kind: "septum" }],
      line: ["schlenkLine", { taps: 3 }],
      gas: ["gasCylinder", {}, { x: -1 }],
      bubbler: ["bubbler"],
      trap: ["coldTrap", {}, { x: 1 }],
      pump: ["pump", {}, { x: 2 }],
    },
    links: [["stirrer.stage", "flask.base"], ["flask.neck", "sep.joint"]],
    tubes: [["gas.hose", "line.gasIn"], ["line.gasOut", "bubbler.in"], ["line.vac", "trap.in"], ["trap.out", "pump.in"], ["line.tap1", "flask.hose"]],
    // 床に置かない物の位置: [基準の部品, 基準の上端中央からの x, y]
    place: { line: ["flask", 10, -110] },
  },
  {
    id: "fractionalVacuum",
    name: "分留 (分配器付き減圧蒸留)",
    parts: {
      jack: ["jack"],
      mantle: ["mantle"],
      flask: ["rbf", { volume: 100, level: 0.4, stirbar: true }],
      col: ["vigreux", { length: 150 }],
      head: ["stillHead"],
      thermo: ["thermometer"],
      cond: ["liebig"],
      cow: ["cowReceiver"],
      r1: ["pear", { volume: 25, level: 0.2 }],
      r2: ["pear", { volume: 25, level: 0 }],
      r3: ["pear", { volume: 25, level: 0 }],
      clamp: ["clamp", { arm: 60 }],
      stand: ["stand"],
      trap: ["coldTrap", {}, { x: 1 }],
      pump: ["pump", {}, { x: 2 }],
      win: ["waterIn"],
      wout: ["waterOut"],
    },
    links: [
      ["jack.stage", "mantle.base"], ["mantle.stage", "flask.base"], ["flask.neck", "col.out"], ["col.in", "head.bottom"],
      ["head.top", "thermo.joint"], ["head.arm", "cond.in"], ["cond.out", "cow.in"],
      ["cow.out1", "r1.neck"], ["cow.out2", "r2.neck"], ["cow.out3", "r3.neck"], ["flask.grip", "clamp.grip"],
    ],
    tubes: [["cow.hose", "trap.in"], ["trap.out", "pump.in"], ["win.hose", "cond.waterIn"], ["cond.waterOut", "wout.hose"]],
  },
];

/** ひな形から図を作る */
export function instantiate(tpl, settings = null) {
  const doc = newDoc();
  if (settings) doc.settings = { ...doc.settings, ...settings };
  const ids = {};
  for (const [key, [type, params = {}, hint = {}]] of Object.entries(tpl.parts)) {
    ids[key] = addPart(doc, type, params, (hint.x || 0) * 1000, 0).id;
  }
  const end = (s) => {
    const [k, port] = s.split(".");
    if (!ids[k]) throw new Error(`ひな形 ${tpl.id}: ${k} がありません`);
    return { id: ids[k], port };
  };
  doc.links = tpl.links.map(([a, b]) => ({ a: end(a), b: end(b) }));
  doc.tubes = tpl.tubes.map(([a, b]) => ({ id: `t${doc.seq++}`, a: end(a), b: end(b), arrow: "auto", label: { show: false, text: "" } }));
  tidy(doc, { full: true });
  if (tpl.place) {
    const sv = solve(doc);
    for (const [key, [ref, dx, dy]] of Object.entries(tpl.place)) {
      const b = sv.items.get(ids[ref]).box, it = sv.items.get(ids[key]);
      moveParts(doc, new Set([ids[key]]), (b.x0 + b.x1) / 2 + dx - it.box.x0, b.y0 + dy - it.box.y1);
    }
    tidy(doc, { full: true });
  }
  return doc;
}
