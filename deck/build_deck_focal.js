// "Focal" style deck: 16:9 (10 x 5.625 in), Verdana, sizes 7 / 8 / 9 / 15 pt, sources 6 pt.
// usage: (cd deck && npm install) then node deck/build_deck_focal.js [out.pptx]
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");
// Optional: writes the palette into the theme part. Without it the deck is identical, all colours are set explicitly.
const applyTheme = process.env.PPTX_SKILL ? require(process.env.PPTX_SKILL + "/scripts/apply_theme.js").applyTheme : async () => {};

const ROOT = path.resolve(__dirname, "..");
const D = JSON.parse(fs.readFileSync(path.join(__dirname, "deck_data.json")));
const FIG = (f) => path.join(ROOT, "figures", f);
const OUT = process.argv[2] || path.join(ROOT, "27_D4G Cornell 4_Final Submission.pptx");

// ---------- palette & type scale (one scale for the whole deck)
const NAVY = "1A2150", NAVY2 = "0B1660", BLUE = "2A39B0", GOLD = "F8AB00", BG = "F2F3F9", LAV = "DADDF0", GREY = "8A8FA8", CREAM = "FEF2D6", WHITE = "FFFFFF";
const CTX = "C4C7D6";                       // context bars (grey)
const F = "Verdana";
const PT = { text: 7, hi: 8, head: 9, big: 15, title: 15, src: 6 };
const THEME = { name: "Focal", headFontFace: F, bodyFontFace: F,
  colors: { dk1: NAVY, lt1: WHITE, dk2: NAVY2, lt2: BG, accent1: BLUE, accent2: GOLD, accent3: GREY, accent4: LAV, accent5: NAVY, accent6: CREAM, hlink: BLUE, folHlink: NAVY } };

// ---------- number helpers
const n0 = (x) => Math.round(x).toLocaleString("en-US");
const n1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const n2 = (x) => (Math.round(x * 100) / 100).toFixed(2);
const pct = (x, d = 0) => (100 * x).toFixed(d) + "%";
const usd = (x) => "$" + n0(x);
const inv = D.inventory, val = D.validation;
const tier = (k) => D.tiers.find((t) => t.tier.startsWith(k));
const T1 = tier("Tier 1"), T2 = tier("Tier 2"), T3 = tier("Tier 3"), T4 = tier("Tier 4");
const seg = (k) => D.segment_rows.find((r) => r.primary_segment === k);
const SYS = D.system_peak_kw_total, NA = D.active, NM = D.customers_in_run;
const PDC = seg("Peak demand contributor"), HE = seg("High electrification"), BASE = seg("Baseline residential");
const flip = D.hp_adoption_share_to_flip_peak;
const curve = (s) => D.peak_flip_curve.find((r) => Math.abs(r[0] - s) < 1e-6)[1];
const fb = D.flex_breakdown_kw;
const ev_ok0 = 1 - D.ev_needs_eval_share, ev_ok1 = ev_ok0 + D.ev_enabled_share;
const hp_ok0 = 1 - D.hp_needs_eval_share, hp_ok1 = hp_ok0 + D.hp_enabled_share;
const T1full = T1.n, T1mw = T1full * T1.coinc_red / 1000;
const dis = D.dispatch;
const peakL = Math.max(...dis.load), peakN = Math.max(...dis.net);
const heWin = (w) => { const he = +w.split("HE")[1]; const f = (h) => (h % 12 || 12) + (h < 12 || h === 24 ? " am" : " pm"); return f(he - 1).replace(/ (am|pm)$/, (he - 1 < 12) === (he < 12) ? "" : " $1") + " to " + f(he); };
const fmtDay = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

// sources (footer codes)
const SRC = {
  data: "Avangrid, hackathon AMI and weather data (Sep 2025 to Aug 2026), Nov 2026",
  chal: "Avangrid, Challenge Statement and Data Dictionary, Nov 2026",
  tou: "NYSEG, Time-of-Use Service Class 12 rates, accessed Nov 2026",
  pu: "Elkan and Noto, Learning classifiers from only positive and unlabeled data, KDD 2008",
  avg: "Avangrid Networks website, accessed Nov 2026",
  est: `Team estimate: hourly model on all ${n0(NM)} meters in the hackathon dataset, see Appendix A2`,
};

// ---------- icons (white glyph rendered to PNG, placed on a coloured circle)
async function icon(name) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(fa[name], { color: "#FFFFFF", size: 256 }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

(async () => {
  const ICON = {};
  for (const k of ["FaSolarPanel", "FaChargingStation", "FaBolt", "FaThermometerHalf", "FaSnowflake", "FaSun", "FaBatteryFull", "FaHome", "FaDollarSign",
    "FaPlug", "FaSearch", "FaUsers", "FaDatabase", "FaCloudSun", "FaTags", "FaFan", "FaChartLine", "FaMapMarkerAlt", "FaFire"]) ICON[k] = await icon(k);

  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";               // 10 x 5.625 in
  pres.theme = { headFontFace: F, bodyFontFace: F };
  pres.title = "AMI Customer Intelligence and BTM Battery Targeting";
  pres.author = "Team 27, D4G Cornell 4";

  // ---------- layouts
  pres.defineSlideMaster({ title: "TITLE", background: { color: NAVY } });
  pres.defineSlideMaster({ title: "CONTENT", background: { color: WHITE },
    slideNumber: { x: 9.2, y: 5.3, w: 0.4, h: 0.2, fontFace: F, fontSize: PT.src, color: GREY, align: "right" } });

  // ---------- components
  const TABS = ["Answer", "Detection", "Segments", "Batteries", "Plan"];
  function tabs(s, active) {
    let x = 0.4;
    s.addShape(pres.shapes.LINE, { x: 0.4, y: 0.36, w: 9.2, h: 0, line: { color: LAV, width: 0.75 }, objectName: "tab rule" });
    TABS.forEach((t) => {
      const w = 0.09 + t.length * 0.068;
      s.addText(t, { x, y: 0.12, w, h: 0.22, fontFace: F, fontSize: PT.text, bold: t === active, color: t === active ? NAVY : GREY, margin: 0, isTextBox: true, valign: "bottom" });
      if (t === active) s.addShape(pres.shapes.LINE, { x, y: 0.36, w: w - 0.09, h: 0, line: { color: NAVY, width: 1.5 }, objectName: "active tab" });
      x += w + 0.25;
    });
  }
  function title(s, t) {
    s.addText(t, { x: 0.4, y: 0.42, w: 9.2, h: 0.56, fontFace: F, fontSize: PT.title, bold: true, color: NAVY, margin: 0, isTextBox: true, valign: "top", fit: "none" });
  }
  function rec(s, boldPart, rest, label = "Recommendation") {
    s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 4.74, w: 9.2, h: 0.44, fill: { color: BG }, line: { color: BG }, objectName: "recommendation bar" });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 4.74, w: 1.2, h: 0.44, fill: { color: GOLD }, line: { color: GOLD }, objectName: "recommendation label" });
    s.addText(label, { x: 0.4, y: 4.74, w: 1.2, h: 0.44, fontFace: F, fontSize: PT.hi, bold: true, color: NAVY, align: "center", valign: "middle", margin: 0, isTextBox: true });
    s.addText([{ text: boldPart, options: { bold: true } }, { text: " " + rest }],
              { x: 1.7, y: 4.74, w: 7.82, h: 0.44, fontFace: F, fontSize: PT.hi, color: NAVY, valign: "middle", margin: 0, isTextBox: true });
  }
  function sources(s, keys) {
    s.addText("Sources: " + keys.map((k) => SRC[k] || k).join(". ") + ".",
              { x: 0.4, y: 5.24, w: 8.7, h: 0.3, fontFace: F, fontSize: PT.src, color: GREY, margin: 0, isTextBox: true, valign: "top" });
  }
  function content(active, t) {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: active });
    tabs(s, active); title(s, t); return s;
  }
  function head(s, x, y, w, t) {
    s.addText(t, { x, y, w, h: 0.22, fontFace: F, fontSize: PT.head, bold: true, color: NAVY, margin: 0, isTextBox: true, valign: "bottom" });
    s.addShape(pres.shapes.LINE, { x, y: y + 0.25, w, h: 0, line: { color: NAVY, width: 0.75 }, objectName: "section rule" });
  }
  function vdash(s, x, y1 = 1.12, y2 = 4.64) {
    s.addShape(pres.shapes.LINE, { x, y: y1, w: 0, h: y2 - y1, line: { color: GREY, width: 0.75, dashType: "dash" }, objectName: "column separator" });
  }
  function dot(s, x, y, w) {
    s.addShape(pres.shapes.LINE, { x, y, w, h: 0, line: { color: GREY, width: 0.5, dashType: "sysDot" }, objectName: "dotted separator" });
  }
  function circleIcon(s, x, y, d, ic, fill = BLUE) {
    s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill }, objectName: "icon circle" });
    s.addImage({ data: ICON[ic], x: x + d * 0.24, y: y + d * 0.24, w: d * 0.52, h: d * 0.52, altText: ic });
  }
  // stat callout: icon + big number + short description beside it, dotted rule below
  function stat(s, x, y, w, ic, big, desc, opt = {}) {
    const h = opt.h || 0.72, nw = opt.nw || 1.2;
    circleIcon(s, x, y + (h - 0.34) / 2 - 0.02, 0.34, ic, opt.fill || BLUE);
    s.addText(big, { x: x + 0.44, y, w: nw, h: h - 0.06, fontFace: F, fontSize: PT.big, bold: true, color: opt.color || BLUE, margin: 0, isTextBox: true, valign: "middle" });
    s.addText(desc, { x: x + 0.48 + nw, y, w: w - 0.48 - nw, h: h - 0.06, fontFace: F, fontSize: PT.text, color: NAVY, margin: 0, isTextBox: true, valign: "middle" });
    if (!opt.last) dot(s, x, y + h, w);
  }
  function para(s, x, y, w, h, runs, size = PT.text) {
    s.addText(runs, { x, y, w, h, fontFace: F, fontSize: size, color: NAVY, margin: 0, isTextBox: true, valign: "top", paraSpaceAfter: 3 });
  }
  function bl(s, x, y, w, h, items, size = PT.text, sp = 4) {
    s.addText(items.map((t, i) => ({ text: t, options: { bullet: { indent: 9 }, breakLine: i < items.length - 1, paraSpaceAfter: sp } })),
              { x, y, w, h, fontFace: F, fontSize: size, color: NAVY, margin: 0, isTextBox: true, valign: "top" });
  }
  const BODY_B = [{ type: "none" }, { type: "none" }, { type: "dash", pt: 0.5, color: GREY }, { type: "none" }];
  function table(s, rows, x, y, w, colW, hiRow = -1, rowH = 0.27, left = false) {
    const data = rows.map((r, i) => r.map((c, j) => {
      const cell = typeof c === "object" ? c : { text: String(c) };
      const al = (j === 0 || left) ? "left" : "center";
      if (i === 0) return { text: cell.text, options: { bold: true, color: WHITE, fill: { color: NAVY }, align: al, border: [{ type: "none" }, { type: "none" }, { type: "none" }, { type: "none" }] } };
      return { text: cell.text, options: { color: NAVY, bold: !!cell.bold || i === hiRow, align: al, border: BODY_B, ...(i === hiRow ? { fill: { color: LAV } } : {}) } };
    }));
    s.addTable(data, { x, y, w, colW, fontFace: F, fontSize: PT.text, valign: "middle", rowH, margin: [0.03, 0.05, 0.03, 0.05] });
  }
  // bar chart: grey context bars, one (or more) highlighted bar, values on bars, no value axis or grid
  function bars(s, x, y, w, h, header, labels, values, hi, opt = {}) {
    s.addText(header, { x, y, w, h: 0.36, fontFace: F, fontSize: PT.hi, bold: true, color: NAVY, margin: 0, isTextBox: true, valign: "top" });
    const colors = values.map((_, i) => (Array.isArray(hi) ? hi.includes(i) : i === hi) ? BLUE : CTX);
    s.addChart(pres.charts.BAR, [{ name: opt.name || "value", labels, values }], {
      x, y: y + 0.36, w, h: h - 0.36, barDir: opt.dir || "col", chartColors: colors, showLegend: false, showValue: true,
      dataLabelPosition: "outEnd", dataLabelFormatCode: opt.fmt || "0", dataLabelFontFace: F, dataLabelFontSize: PT.text, dataLabelColor: NAVY,
      valAxisHidden: true, valAxisLabelFontSize: PT.text, valAxisLabelFontFace: F, valGridLine: { style: "none" }, catGridLine: { style: "none" }, valAxisMinVal: 0, valAxisMaxVal: opt.max,
      catAxisLabelFontFace: F, catAxisLabelFontSize: PT.text, catAxisLabelColor: NAVY, catAxisLineColor: GREY, catAxisLineSize: 0.5,
      barGapWidthPct: opt.gap || 60, catAxisOrientation: opt.reverse ? "maxMin" : "minMax", layout: opt.layout,
    });
  }

  // ===================================================================== title
  pres.addSection({ title: "Title" });
  let s = pres.addSlide({ masterName: "TITLE", sectionTitle: "Title" });
  s.addText("2026 AVANGRID ENERGY INNOVATION HACKATHON", { x: 0.6, y: 1.25, w: 8.8, h: 0.3, fontFace: F, fontSize: PT.head, bold: true, color: GOLD, margin: 0, isTextBox: true, charSpacing: 1 });
  s.addText("From meter data to battery decisions", { x: 0.6, y: 1.6, w: 8.8, h: 0.5, fontFace: F, fontSize: PT.title, bold: true, color: WHITE, margin: 0, isTextBox: true });
  s.addText("A transparent AMI tool that inventories customer technologies, segments load and targets behind-the-meter batteries",
            { x: 0.6, y: 2.12, w: 7.6, h: 0.5, fontFace: F, fontSize: PT.hi, color: LAV, margin: 0, isTextBox: true, valign: "top" });
  s.addShape(pres.shapes.LINE, { x: 0.6, y: 3.45, w: 8.8, h: 0, line: { color: GREY, width: 0.5 }, objectName: "title rule" });
  s.addText("Team 27, D4G Cornell 4", { x: 0.6, y: 3.6, w: 4, h: 0.25, fontFace: F, fontSize: PT.head, bold: true, color: WHITE, margin: 0, isTextBox: true });
  s.addText("Cezary Pendras  ·  Lorraine Yang  ·  Aronya Sarker", { x: 0.6, y: 3.88, w: 6, h: 0.25, fontFace: F, fontSize: PT.hi, color: LAV, margin: 0, isTextBox: true });
  s.addText("Cornell University  ·  November 13, 2026", { x: 0.6, y: 4.12, w: 6, h: 0.25, fontFace: F, fontSize: PT.text, color: GREY, margin: 0, isTextBox: true });

  // ===================================================================== 1. answer first
  pres.addSection({ title: "Answer" });
  s = content("Answer", `Batteries in the top 5% of homes cut ${pct(D.tier1_share_of_system_peak, 1)} of the summer peak, and ${pct(flip)} heat-pump adoption will move the peak to winter`);
  const cw = 2.9, cx = [0.4, 3.55, 6.7];
  [["Who has what", [
     ["FaSolarPanel", pct(val.PV.rule_recall), `of registered solar homes found from load alone, plus ${n0(inv.pv_unregistered)} systems missing from the list`],
     ["FaChargingStation", n1(val.EV.lift_top10pct) + "x", `better EV hit rate than random (${pct(val.EV.recall_top10pct)} vs 10% of labeled EVs in our top 10%)`],
     ["FaThermometerHalf", pct(inv.eheat / NA, 0), `of homes heat mainly with electricity, another ${pct(inv.eheat_supplemental / NA, 0)} partly`]]],
   ["Who drives the peak", [
     ["FaSun", n2(D.system_peak_kw_per_cust) + " kW", `per home at the annual peak (${fmtDay(D.system_peak_when.split(" ")[0])}, ${heWin(D.system_peak_when)}, ${n0(D.system_peak_temp_f)}°F)`],
     ["FaUsers", pct(PDC.share_of_coincident_peak), `of peak load comes from ${pct(PDC.n / NA)} of homes, 2.4x their share of customers`],
     ["FaSnowflake", pct(flip), `heat-pump adoption makes winter the peak (winter is ${pct(1 - D.winter_peak_kw_per_cust / D.system_peak_kw_per_cust)} below summer today)`]]],
   ["Where a battery pays", [
     ["FaDollarSign", n1(D.value_ratio_tier1_vs_tier4) + "x", `value per battery in Tier 1 vs Tier 4 (${usd(T1.val)} vs ${usd(T4.val)} a year)`],
     ["FaBolt", pct(D.tier1_share_of_system_peak, 1), `of the system peak relieved by Tier 1 (${n0(D.tier1_total_coinc_relief_kw)} kW from ${n0(T1.n)} homes)`],
     ["FaPlug", pct(ev_ok1), `of homes can add a Level 2 charger within 3 kVA with a battery (${pct(ev_ok0)} without)`]]],
  ].forEach(([h, rows], i) => {
    head(s, cx[i], 1.12, cw, h);
    rows.forEach((r, j) => stat(s, cx[i], 1.5 + j * 1.04, cw, r[0], r[1], r[2], { h: 1.0, nw: 1.0, last: j === 2 }));
    if (i < 2) vdash(s, cx[i] + cw + 0.125);
  });
  rec(s, "Launch a Tier 1 battery pilot and a no-hardware flexibility program before summer 2027.",
      `Tier 1 earns ${n1(D.value_ratio_tier1_vs_tier4)}x more per battery, and thermostats, EV charging and pool pumps add ${pct(D.flex_share_of_system_peak)} of peak relief.`);
  sources(s, ["data", "chal", "est"]);

  // ===================================================================== 2. approach
  s = content("Answer", "One transparent pipeline turns 8,760 hourly reads per home into a ranked program list in minutes");
  head(s, 0.4, 1.12, 2.55, "Starting point");
  [["FaDatabase", n0(NM), "homes with hourly AMI reads for a full year (Sep 2025 to Aug 2026)"],
   ["FaCloudSun", "3", "hourly weather series: temperature, humidity, wind speed"],
   ["FaTags", n0(val.EV.labeled + val.HP.labeled + val.PV.labeled), `labels: ${n0(val.EV.labeled)} likely EV and ${n0(val.HP.labeled)} heat-pump homes (25% samples), ${n0(val.PV.labeled)} solar homes`]].forEach((r, j) =>
    stat(s, 0.4, 1.5 + j * 1.04, 2.55, r[0], r[1], r[2], { h: 1.0, nw: 0.85, last: j === 2 }));
  vdash(s, 3.1);
  head(s, 3.25, 1.12, 6.35, "Three steps, each traceable to a physical feature");
  const ph = [["1  Detect", ["~120 features per home: weather change-point model, flat high-power blocks, midday zeros", "Positive-unlabeled learning for EV and heat pump, physics rules for 8 other technologies", "Each flag carries a probability and the feature that triggered it"]],
              ["2  Segment", [`k-means on normalised seasonal day profiles gives ${D.n_archetypes} load archetypes`, "Business segments use each home's load at the 100 highest system hours", "Each segment maps to one utility program"]],
              ["3  Target", ["Hour-by-hour battery dispatch for every home and day, 1 vs 2 units", "Value at system peak, customer bill savings and the 3 kVA service test", "Battery Priority Index 0 to 100 and four action tiers"]]];
  ph.forEach(([t, items], i) => {
    const x = 3.25 + i * 2.13;
    s.addShape(i === 0 ? pres.shapes.PENTAGON : pres.shapes.CHEVRON, { x, y: 1.52, w: 2.05, h: 0.42, fill: { color: i === 2 ? BLUE : NAVY }, line: { color: WHITE }, objectName: "phase chevron" });
    s.addText(t, { x: x + 0.22, y: 1.52, w: 1.6, h: 0.42, fontFace: F, fontSize: PT.hi, bold: true, color: WHITE, margin: 0, isTextBox: true, valign: "middle" });
    bl(s, x + 0.05, 2.08, 1.95, 1.35, items);
  });
  const outs = [["Output", "13 technology flags per home, each with a probability [0 to 1]"], ["Output", `${D.segment_rows.length} business segments and ${D.n_archetypes} load archetypes, one program each`], ["Output", "Battery size, value [$/yr] and priority tier for every home"]];
  outs.forEach(([h, t], i) => {
    const x = 3.25 + i * 2.13;
    s.addShape(pres.shapes.RECTANGLE, { x, y: 3.55, w: 2.05, h: 1.05, fill: { color: BG }, line: { color: LAV }, objectName: "output box" });
    s.addText([{ text: h, options: { bold: true, color: BLUE, breakLine: true } }, { text: t }], { x: x + 0.1, y: 3.62, w: 1.85, h: 0.9, fontFace: F, fontSize: PT.text, color: NAVY, margin: 0, isTextBox: true, valign: "top", paraSpaceAfter: 3 });
  });
  rec(s, "Run the tool monthly on every meter.", `It scales linearly (about ${D.runtime_min} minutes for all ${n0(NM)} meters on one laptop), and every score traces back to a feature an engineer can check.`);
  sources(s, ["chal", "data", "pu"]);

  // ===================================================================== 3. fingerprints
  pres.addSection({ title: "Detection" });
  s = content("Detection", "Each technology leaves a measurable fingerprint in hourly data, so every flag rests on physics, not a black box");
  const fp = [["EV Level 2 charging", "focal_heat_ev.png", "Flat 5 to 12.5 kW blocks for 1 to 8 hours above the rolling minimum, repeated on warm days too", `A labeled EV home shows ${n0(D.ev_l2_events_median_labeled)} such blocks a year at the median, a typical home ${n0(D.ev_l2_events_median_all)}`],
              ["Solar PV", "focal_heat_pv.png", "Midday net load at zero (11 am to 3 pm) while the home draws power at night", "The share of such solar days in summer separates solar homes from vacant ones"],
              ["Electric heating", "focal_heat_heat.png", "Daily kWh = base + heating slope × degrees below Th + cooling slope × degrees above Tc", "Primary electric heat: at least 4,000 kWh a year and 25% of use driven by cold"]];
  fp.forEach(([h, img, rule, fact], i) => {
    const x = cx[i];
    head(s, x, 1.12, cw, h);
    s.addImage({ path: FIG(img), x, y: 1.46, w: cw, h: cw * 0.58, altText: h + " day by hour heatmap" });
    s.addText("Rule", { x, y: 3.25, w: cw, h: 0.2, fontFace: F, fontSize: PT.text, bold: true, color: BLUE, margin: 0, isTextBox: true });
    para(s, x, 3.45, cw, 0.5, rule);
    dot(s, x, 3.98, cw);
    para(s, x, 4.05, cw, 0.55, [{ text: fact, options: { bold: true } }]);
    if (i < 2) vdash(s, x + cw + 0.125);
  });
  rec(s, "Use the inventory with confidence because it is explainable.", "Every flag cites the feature that triggered it, so a field engineer can verify any customer in seconds from the heatmap.");
  sources(s, ["data", "est"]);

  // ===================================================================== 4. classification results
  s = content("Detection", `Learning from Avangrid's 25% label samples finds EVs ${n1(val.EV.lift_top10pct)}x better than random and flags ${n0(inv.pv_unregistered)} unregistered solar systems`);
  const invItems = [["Air conditioning", inv.ac], ["Supplemental electric heat", inv.eheat_supplemental], ["Primary electric heat", inv.eheat],
    ["EV charging", inv.ev], ["Electric water heater", inv.water_heater], ["Solar PV", inv.pv], ["Pool pump", inv.pool], ["Heat pump", inv.heat_pump]];
  bars(s, 0.4, 1.12, 3.4, 3.5, `EVs are already in ${pct(inv.ev / NA, 1)} of homes, AC in ${pct(inv.ac / NA)} [% of active homes]`,
       invItems.map((r) => r[0]), invItems.map((r) => Math.round(1000 * r[1] / NA) / 10), 3, { dir: "bar", fmt: '0.0"%"', reverse: true, gap: 45, max: 90 });
  vdash(s, 3.95);
  head(s, 4.1, 1.12, 2.75, "Validation on hidden labels");
  para(s, 4.1, 1.45, 2.75, 0.62, [{ text: "Unlabeled is not negative. ", options: { bold: true } },
       { text: "The model learns labeled vs unlabeled homes, then divides by the label rate and rescales to the known population (labels ÷ 25%)." }]);
  table(s, [["Technology", "Labels", "In top 10%", "Lift"],
            ["Solar PV", n0(val.PV.labeled), pct(val.PV.recall_top10pct), n1(val.PV.lift_top10pct) + "x"],
            ["EV", n0(val.EV.labeled), pct(val.EV.recall_top10pct), n1(val.EV.lift_top10pct) + "x"],
            ["Heat pump", n0(val.HP.labeled), pct(val.HP.recall_top10pct), n1(val.HP.lift_top10pct) + "x"]],
        4.1, 2.15, 2.75, [0.95, 0.55, 0.7, 0.55], 2);
  para(s, 4.1, 3.32, 2.75, 1.25, [{ text: "Labels are noisy, so lifts are lower bounds. ", options: { bold: true } },
       { text: "A third of labeled EVs show no home charging at all, and most labeled heat-pump homes heat only partly with electricity." }]);
  vdash(s, 7.0);
  head(s, 7.15, 1.12, 2.45, "Found beyond the lists");
  [["FaSolarPanel", n0(inv.pv_unregistered), "active homes with a clear solar signature not on Avangrid's solar list"],
   ["FaSun", n0(inv.pv_new_install), "solar systems installed during the year (no solar days in Sep to Oct)"],
   ["FaHome", n0(inv.seasonal_home), "part-year homes with 30+ vacant days, to drop from baselines"]].forEach((r, j) =>
    stat(s, 7.15, 1.5 + j * 1.04, 2.45, r[0], r[1], r[2], { h: 1.0, nw: 0.85, last: j === 2 }));
  rec(s, "Target programs from high-confidence flags first and route the unregistered solar list to interconnection.",
      `Heat pumps are the weakest call (${n1(val.HP.lift_top10pct)}x lift) and need gas-account and rebate data to improve.`);
  sources(s, ["data", "chal", "pu", "est"]);

  // ===================================================================== 5. segments
  pres.addSection({ title: "Segments" });
  s = content("Segments", `Peak contributors and electrified homes are ${pct((PDC.n + HE.n) / NA)} of customers but supply ${pct(PDC.share_of_coincident_peak + HE.share_of_coincident_peak)} of peak load`);
  const sOrder = [["Peak demand contributor", PDC], ["High electrification", HE], ["Flexible load", seg("Flexible load")], ["Likely tech adopter", seg("Likely tech adopter")],
                  ["Emerging electrification", seg("Emerging electrification candidate")], ["Baseline residential", BASE], ["Solar prosumer", seg("Solar prosumer")], ["Seasonal home", seg("Seasonal / part-year occupancy")]];
  bars(s, 0.4, 1.12, 4.55, 3.5, `A peak contributor draws ${n1(PDC.coinc / BASE.coinc)}x a baseline home at the system peak [kW per home]`,
       sOrder.map((r) => r[0]), sOrder.map((r) => Math.round(r[1].coinc * 10) / 10), 0, { fmt: "0.0", gap: 45, dir: "bar", reverse: true, max: 6 });
  vdash(s, 5.1);
  head(s, 5.25, 1.12, 4.35, "Each segment gets one program");
  const prog = [["Peak demand contributor", PDC, "Battery offer plus summer DR"], ["High electrification", HE, "Battery, TOU and managed charging"],
                ["Flexible load", seg("Flexible load"), "Thermostat, EV and pool DR"], ["Likely tech adopter", seg("Likely tech adopter"), "EV and storage marketing"],
                ["Emerging electrification", seg("Emerging electrification candidate"), "Heat-pump rebate with load check"],
                ["Baseline residential", BASE, "Efficiency and behavior programs"]];
  table(s, [["Segment", "Homes", "Peak load", "Program"], ...prog.map(([k, r, p]) => [k, n0(r.n), pct(r.share_of_coincident_peak), p])],
        5.25, 1.47, 4.35, [1.45, 0.5, 0.65, 1.75], 1, 0.36);
  para(s, 5.25, 4.08, 4.35, 0.5, [{ text: "Peak load = share of total load at the 100 highest system hours. ", options: { bold: true } },
       { text: "Six load archetypes from k-means are in Appendix A5." }]);
  rec(s, "Start battery and DR outreach with peak contributors and high-electrification homes.", `They are ${pct((PDC.n + HE.n) / NA)} of customers but ${pct(PDC.share_of_coincident_peak + HE.share_of_coincident_peak)} of the load the grid is sized for.`);
  sources(s, ["data", "est"]);

  // ===================================================================== 6. peak flip
  s = content("Segments", `The peak is a summer evening today, but ${pct(flip)} heat-pump adoption moves it to winter`);
  const fl = [["Summer peak\ntoday", D.system_peak_kw_per_cust], ["Winter,\n0% HP", curve(0)], ["Winter,\n4% HP", curve(0.04)], ["Winter,\n8% HP", curve(0.08)],
              ["Winter,\n12% HP", curve(0.12)], ["Winter,\n16% HP", curve(0.16)], ["Winter,\n20% HP", curve(0.2)]];
  bars(s, 0.4, 1.12, 5.6, 3.5, `Winter overtakes today's summer peak at ${pct(flip)} adoption [peak kW per home]`,
       fl.map((r) => r[0]), fl.map((r) => Math.round(r[1] * 100) / 100), 4, { fmt: "0.00", gap: 50, max: 3.4 });
  vdash(s, 6.15);
  head(s, 6.3, 1.12, 3.3, "What sets the peak");
  [["FaSun", n2(D.system_peak_kw_per_cust) + " kW", `summer peak per home, and ${D.top100_summer} of the 100 highest hours fall in Jun to Aug`],
   ["FaSnowflake", n2(D.winter_peak_kw_per_cust) + " kW", `winter peak per home at ${n0(D.winter_peak_temp_f)}°F, ${pct(1 - D.winter_peak_kw_per_cust / D.system_peak_kw_per_cust)} below summer`],
   ["FaFire", "6 kW", "added by each ducted heat pump on the coldest hour (team assumption)"]].forEach((r, j) =>
    stat(s, 6.3, 1.5 + j * 1.04, 3.3, r[0], r[1], r[2], { h: 1.0, nw: 1.1, last: j === 2 }));
  rec(s, "Size batteries and heat-pump controls for winter mornings and evenings, not only summer.", `Re-score the ${pct(flip)} flip point every quarter as heat-pump rebates are paid.`);
  sources(s, ["data", "est"]);

  // ===================================================================== 7. battery method
  pres.addSection({ title: "Batteries" });
  s = content("Batteries", "Every home gets an hourly battery simulation, a recommended size and a priority score");
  head(s, 0.4, 1.12, 4.6, "How each home is scored");
  const blocks = [["Customer peak shaving", "Each day, find the lowest cap θ such that energy above θ ≤ 18.1 kWh and peak minus θ ≤ 7.68 kW. Recharge in the lowest-load hours."],
                  ["Utility peak window", "Discharge 3 to 8 pm, highest load first, no export. Value = kW at the 100 highest system hours × $100 per kW-year + TOU savings."],
                  ["Priority Index and size", "30% kW cut at system peak, 25% customer peak cut, 15% kWh shifted, 15% electrification, 10% peak days, 5% solar. One unit if a second adds under 1 kW."]];
  blocks.forEach(([h, t], j) => {
    const y = 1.5 + j * 1.04;
    circleIcon(s, 0.4, y + 0.08, 0.34, ["FaHome", "FaBolt", "FaChartLine"][j]);
    s.addText(h, { x: 0.86, y, w: 4.1, h: 0.22, fontFace: F, fontSize: PT.hi, bold: true, color: BLUE, margin: 0, isTextBox: true });
    para(s, 0.86, y + 0.24, 4.1, 0.72, t);
    if (j < 2) dot(s, 0.4, y + 1.0, 4.6);
  });
  vdash(s, 5.15);
  const hrs = Array.from({ length: 24 }, (_, i) => String(i + 1));
  s.addText(`One battery cuts this home's peak from ${n1(peakL)} to ${n1(peakN)} kW [kW per hour, ${fmtDay(dis.date)}]`,
            { x: 5.3, y: 1.12, w: 4.3, h: 0.36, fontFace: F, fontSize: PT.hi, bold: true, color: NAVY, margin: 0, isTextBox: true, valign: "top" });
  s.addChart([
    { type: pres.charts.BAR, data: [{ name: "Load without battery", labels: hrs, values: dis.load }], options: { chartColors: [CTX], barGapWidthPct: 30 } },
    { type: pres.charts.LINE, data: [{ name: "Grid draw with battery", labels: hrs, values: dis.net }], options: { chartColors: [BLUE], lineSize: 2, lineDataSymbol: "none" } },
  ], { x: 5.3, y: 1.48, w: 4.3, h: 3.14, valAxisHidden: true, valAxisLabelFontSize: PT.text, valAxisLabelFontFace: F, valGridLine: { style: "none" }, catGridLine: { style: "none" }, valAxisMinVal: 0,
       catAxisLabelFontFace: F, catAxisLabelFontSize: PT.text, catAxisLabelColor: NAVY, catAxisLineColor: GREY, catAxisLabelFrequency: 3,
       showLegend: true, legendPos: "t", legendFontFace: F, legendFontSize: PT.text, legendColor: NAVY, catAxisTitle: "Hour ending", showCatAxisTitle: true,
       catAxisTitleFontFace: F, catAxisTitleFontSize: PT.text, catAxisTitleColor: GREY });
  rec(s, "Size batteries per home, not per program.", `Across all meters ${n0(D.recommendation_counts["2 units (20.16 kWh)"])} homes need 2 units, ${n0(D.recommendation_counts["1 unit (10.08 kWh)"])} are served by one and ${n0(D.recommendation_counts["demand flex only"])} only need demand flexibility.`);
  sources(s, ["chal", "tou", "est"]);

  // ===================================================================== 8. battery results
  s = content("Batteries", `Targeting matters: a Tier 1 battery is worth ${n1(D.value_ratio_tier1_vs_tier4)}x a Tier 4 battery (${usd(T1.val)} vs ${usd(T4.val)} a year)`);
  bars(s, 0.4, 1.12, 3.3, 3.5, "Tier 1 earns the most per battery [$ per battery per year]",
       ["Tier 1\ndeploy", "Tier 2\noffer", "Tier 3\nflex program", "Tier 4\nmonitor"], [T1, T2, T3, T4].map((t) => Math.round(t.val)), 0, { fmt: '"$"0', gap: 55 });
  vdash(s, 3.85);
  head(s, 4.0, 1.12, 5.6, "Tiers at a glance");
  table(s, [["Tier", "Homes", "Peak [kW]", "Peak cut [kW]", "At system peak [kW]", "Value [$/yr]"],
            ...[["Tier 1, deploy", T1], ["Tier 2, offer", T2], ["Tier 3, flex program", T3], ["Tier 4, monitor", T4]].map(([k, t]) => [k, n0(t.n), n1(t.peak), n1(t.red), n1(t.coinc_red), usd(t.val)])],
        4.0, 1.47, 5.6, [1.45, 0.65, 0.75, 0.9, 1.05, 0.8], 1, 0.3);
  const yy = 3.1;
  [["FaBolt", n0(D.tier1_total_coinc_relief_kw) + " kW", `Tier 1 relief at the system peak, ${pct(D.tier1_share_of_system_peak, 1)} of it`],
   ["FaBatteryFull", n0(D.tier12_total_coinc_relief_kw) + " kW", `Tier 1 and 2 relief, ${pct(D.tier12_total_coinc_relief_kw / SYS, 1)} of peak from ${pct((T1.n + T2.n) / NA)} of homes`],
   ["FaDollarSign", usd(T1.cap) + " + " + usd(T1.tou), "Tier 1 value split: capacity relief plus customer TOU savings"]].forEach((r, j) => {
    const x = 4.0 + j * 1.9;
    circleIcon(s, x, yy, 0.34, r[0]);
    s.addText(r[1], { x, y: yy + 0.4, w: 1.8, h: 0.34, fontFace: F, fontSize: PT.big, bold: true, color: BLUE, margin: 0, isTextBox: true, valign: "middle" });
    para(s, x, yy + 0.78, 1.75, 0.7, r[2]);
    if (j < 2) s.addShape(pres.shapes.LINE, { x: x + 1.82, y: yy, w: 0, h: 1.45, line: { color: GREY, width: 0.5, dashType: "sysDot" }, objectName: "dotted separator" });
  });
  rec(s, "Deploy to Tier 1 first and offer to Tier 2.", `Together they deliver ${n0(D.tier12_total_coinc_relief_kw)} kW (${pct(D.tier12_total_coinc_relief_kw / SYS, 1)} of the peak) from ${pct((T1.n + T2.n) / NA)} of homes, before counting backup value.`);
  sources(s, ["chal", "tou", "est"]);

  // ===================================================================== 9. enablement & flexibility
  s = content("Batteries", `With a battery, ${pct(ev_ok1)} of homes can add a Level 2 charger without a service upgrade, versus ${pct(ev_ok0)} today`);
  bars(s, 0.4, 1.12, 5.0, 3.5, "Batteries keep new electric loads inside the 3 kVA limit [% of homes within the limit]",
       ["EV charger,\nno battery", "EV charger,\nwith battery", "Heat pump,\nno battery", "Heat pump,\nwith battery"],
       [ev_ok0, ev_ok1, hp_ok0, hp_ok1].map((v) => Math.round(v * 100)), [1, 3], { fmt: '0"%"', gap: 70, max: 115 });
  vdash(s, 5.55);
  head(s, 5.7, 1.12, 3.9, "Flexibility without new hardware [kW at peak]");
  [["FaFan", n0(fb.flex_ac_kw) + " kW", `smart thermostats (30% of AC load), ${pct(fb.flex_ac_kw / SYS)} of the peak`],
   ["FaChargingStation", n0(fb.flex_ev_kw) + " kW", "managed EV charging moved out of 3 to 8 pm"],
   ["FaPlug", n0(fb.flex_pool_kw + fb.flex_wh_kw) + " kW", "pool-pump timers and water-heater control"]].forEach((r, j) =>
    stat(s, 5.7, 1.5 + j * 1.04, 3.9, r[0], r[1], r[2], { h: 1.0, nw: 1.55, last: j === 2 }));
  rec(s, "Make a battery or managed charging the default answer to EV and heat-pump service requests.", `It avoids most service upgrades, while thermostats alone deliver ${pct(fb.flex_ac_kw / SYS)} of the peak with no new hardware.`);
  sources(s, ["chal", "est"]);

  // ===================================================================== 10. plan
  pres.addSection({ title: "Plan" });
  s = content("Plan", "A three-phase rollout reaches all NYSEG and RG&E meters by Q4 2027, with a go/no-go gate after the summer 2027 pilot");
  const phases = [["Q1 2027  Validate", ["Share the Tier 1 list with field teams", "Site visits on a Tier 1 sample", "Join gas-account and rebate data"]],
                  ["Q2 to Q3 2027  Pilot", ["Tier 1 batteries and DR program", "Run through the summer 2027 peak", "Measure kW at peak vs simulation"]],
                  ["Q4 2027  Scale", ["Monthly scoring of ~1.3M meters", "Winter test of heat-pump homes", "Add transformer IDs to rank sites"]]];
  phases.forEach(([t, items], i) => {
    const x = 0.4 + i * 1.98;
    s.addShape(i === 0 ? pres.shapes.PENTAGON : pres.shapes.CHEVRON, { x, y: 1.15, w: 1.95, h: 0.4, fill: { color: i === 2 ? BLUE : NAVY }, line: { color: WHITE }, objectName: "phase chevron" });
    s.addText(t, { x: x + (i === 0 ? 0.12 : 0.3), y: 1.15, w: 1.5, h: 0.4, fontFace: F, fontSize: PT.text, bold: true, color: WHITE, margin: 0, isTextBox: true, valign: "middle" });
    bl(s, x + 0.05, 1.65, 1.85, 0.85, items);
  });
  // milestones
  s.addShape(pres.shapes.LINE, { x: 0.5, y: 2.78, w: 5.7, h: 0, line: { color: GREY, width: 0.75 }, objectName: "timeline" });
  [[1.3, "Q1 2027: pilot list approved", NAVY], [3.3, "Q3 2027: summer peak measured", NAVY], [5.3, "Q4 2027: go/no-go decision", GOLD]].forEach(([x, t, c]) => {
    s.addShape(pres.shapes.DIAMOND, { x: x - 0.11, y: 2.67, w: 0.22, h: 0.22, fill: { color: c }, line: { color: c }, objectName: "milestone" });
    s.addText(t, { x: x - 0.8, y: 2.93, w: 1.6, h: 0.3, fontFace: F, fontSize: PT.text, color: NAVY, bold: c === GOLD, align: "center", margin: 0, isTextBox: true });
  });
  // go / no-go
  s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 3.4, w: 5.9, h: 1.22, fill: { color: CREAM }, line: { color: CREAM }, objectName: "go no-go box" });
  s.addText([{ text: "Go/no-go, Q4 2027", options: { bold: true, breakLine: true } },
             { text: "Go: ", options: { bold: true } }, { text: `measured relief at the system peak reaches at least 80% of the simulated ${n1(T1.coinc_red)} kW per Tier 1 home. Scale batteries to Tier 1 and 2 across NYSEG and RG&E.`, options: { breakLine: true } },
             { text: "If not: ", options: { bold: true } }, { text: `shift the budget to the no-hardware flexibility program (${pct(D.flex_share_of_system_peak)} of peak), re-tune dispatch and repeat the pilot in summer 2028.` }],
            { x: 0.55, y: 3.45, w: 5.6, h: 1.12, fontFace: F, fontSize: PT.text, color: NAVY, margin: 0, isTextBox: true, valign: "middle", paraSpaceAfter: 5 });
  vdash(s, 6.45);
  head(s, 6.6, 1.12, 3.0, "Tier 1 value in this dataset [team estimate]");
  const casc = [[n0(NM), "meters"], ["× " + pct(T1.n / D.customers_in_run, 1) + " (Tier 1 share)", null], [n0(T1full), "Tier 1 homes"], [`× ${n1(T1.coinc_red)} kW`, null], [n1(T1mw) + " MW", "at system peak"], ["× $100/kW-yr", null], ["$" + n2(T1mw * 0.1) + "M", "per year"]];
  let cy = 1.48;
  casc.forEach(([big, lab]) => {
    if (lab) {
      const last = lab === "per year";
      s.addShape(pres.shapes.RECTANGLE, { x: 6.6, y: cy, w: 3.0, h: 0.38, fill: { color: last ? BLUE : BG }, line: { color: last ? BLUE : LAV }, objectName: "cascade box" });
      s.addText([{ text: big + "  ", options: { bold: true, fontSize: PT.head } }, { text: lab }], { x: 6.7, y: cy, w: 2.8, h: 0.38, fontFace: F, fontSize: PT.text, color: last ? WHITE : NAVY, margin: 0, isTextBox: true, valign: "middle" });
      cy += 0.38;
    } else {
      s.addText(big, { x: 6.6, y: cy, w: 3.0, h: 0.2, fontFace: F, fontSize: PT.text, bold: true, color: GREY, align: "center", margin: 0, isTextBox: true, valign: "middle" });
      cy += 0.2;
    }
  });
  para(s, 6.6, cy + 0.06, 3.0, 0.5, `Plus ${usd(T1.tou * T1full / 1e3)}k a year in customer TOU savings. Excludes backup value and avoided service upgrades.`);
  rec(s, "Approve a Q1 2027 validation sprint.", "It needs no hardware, confirms the Tier 1 list in the field and decides whether the summer 2027 pilot goes ahead.", "Our ask");
  sources(s, ["data", "avg", "est"]);

  // ===================================================================== thank you
  s = pres.addSlide({ masterName: "TITLE", sectionTitle: "Plan" });
  s.addText("Thank you", { x: 0.6, y: 2.0, w: 8.8, h: 0.5, fontFace: F, fontSize: PT.title, bold: true, color: WHITE, margin: 0, isTextBox: true });
  s.addText("Team 27, D4G Cornell 4  ·  Cezary Pendras  ·  Lorraine Yang  ·  Aronya Sarker", { x: 0.6, y: 2.55, w: 8.8, h: 0.3, fontFace: F, fontSize: PT.hi, color: LAV, margin: 0, isTextBox: true });
  s.addText("Code, README and requirements: GitHub repository submitted with this deck", { x: 0.6, y: 2.88, w: 8.8, h: 0.3, fontFace: F, fontSize: PT.text, color: GREY, margin: 0, isTextBox: true });

  // ===================================================================== appendix
  pres.addSection({ title: "Appendix" });
  const app = (t) => { const sl = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Appendix" });
    sl.addText("Appendix", { x: 0.4, y: 0.12, w: 2, h: 0.22, fontFace: F, fontSize: PT.text, bold: true, color: NAVY, margin: 0, isTextBox: true, valign: "bottom" });
    sl.addShape(pres.shapes.LINE, { x: 0.4, y: 0.36, w: 9.2, h: 0, line: { color: LAV, width: 0.75 }, objectName: "tab rule" });
    title(sl, t); return sl; };

  // A1 sources + AI line
  s = app("A1. Sources: every number comes from Avangrid's data or a cited public source, our own calculations are marked")
  table(s, [["Code", "Publisher and document", "Date", "Used for"],
            ["Data", "Avangrid, hackathon AMI dataset (hourly kWh) and weather workbook", "Sep 2025 to Aug 2026", "All load, peak and battery results"],
            ["Challenge", "Avangrid, Challenge Statement, Data Dictionary, Scoring Rubric", "Nov 2026", "Label sampling (25%), battery spec, 3 kVA rule"],
            ["NYSEG", "NYSEG, Time-of-Use Service Class 12 rates (12-month average supply prices)", "accessed Nov 2026", "Peak $0.16 and off-peak $0.09 per kWh"],
            ["Avangrid", "Avangrid Networks website, NYSEG and RG&E customer counts", "accessed Nov 2026", "About 1.3M electric meters for scaling"],
            ["PU", "Elkan and Noto, Learning classifiers from only positive and unlabeled data, KDD", "2008", "EV and heat-pump probability method"],
            ["Team", "Team estimate from the open-source pipeline (run_all.py)", "Nov 2026", "Every derived number, see A2"]],
        0.4, 1.12, 9.2, [0.9, 4.0, 1.4, 2.9], -1, 0.38, true);
  dot(s, 0.4, 4.0, 9.2);
  para(s, 0.4, 4.1, 9.2, 0.35, [{ text: "To replace before final scoring: ", options: { bold: true } },
       { text: `verify NYSEG prices and replace the $100/kW-year placeholder with Avangrid's avoided cost.` }]);
  para(s, 0.4, 4.55, 9.2, 0.3, [{ text: "AI use: ", options: { bold: true } }, { text: "Claude (Anthropic) assisted with code, analysis and slide drafting. The team reviewed the method and every number can be reproduced from the repository." }]);

  // A2 calculations
  s = app("A2. Calculations: how each derived number on the slides is built");
  table(s, [["Number", "Formula", "Inputs"],
            [pct(val.PV.rule_recall), "Registered solar homes flagged by the solar-day rule ÷ registered solar homes", `${n0(Math.round(val.PV.rule_recall * val.PV.labeled))} of ${n0(val.PV.labeled)} in the dataset`],
            [n1(val.EV.lift_top10pct) + "x", "Share of hidden labeled EVs in our top 10% ÷ 10% (out-of-fold)", `${pct(val.EV.recall_top10pct)} ÷ 10%`],
            [n2(D.system_peak_kw_per_cust) + " kW", "Highest hourly sum of active homes ÷ active homes", `${n0(SYS)} kW ÷ ${n0(NA)} homes`],
            [pct(flip), "Smallest share of homes with a 0.12 kW/°F heat pump (max 6 kW) that lifts winter above summer", "Hourly temperature, 2% steps"],
            [pct(PDC.share_of_coincident_peak), "Load of peak contributors at the 100 highest system hours ÷ all load at those hours", `${n0(PDC.n)} homes, top 10% by that load`],
            [n1(D.value_ratio_tier1_vs_tier4) + "x", "Mean annual value per battery, Tier 1 ÷ Tier 4", `${usd(T1.val)} ÷ ${usd(T4.val)}`],
            ["Value [$/yr]", "kW cut at the 100 highest hours × $100 + discharged kWh × ($0.16 − $0.09 ÷ 0.894) in peak months", "Battery 18.1 kWh usable, 7.68 kW"],
            [pct(D.tier1_share_of_system_peak, 1), "Tier 1 kW cut at system peak ÷ system peak", `${n0(D.tier1_total_coinc_relief_kw)} ÷ ${n0(SYS)} kW`],
            [pct(ev_ok1), "Homes whose annual peak rises ≤ 3 kVA after adding 7.2 kW from 6 to 9 pm, with battery", `${n0(NA)} active homes`],
            [n0(D.flex_total_kw) + " kW", "30% of AC kW + EV kW seen at peak + pool kW in 3 to 8 pm + 0.4 kW per water heater", `${pct(D.flex_share_of_system_peak)} of ${n0(SYS)} kW`],
            [n1(T1mw) + " MW", "Tier 1 homes × kW cut per Tier 1 home at system peak", `${n0(T1.n)} × ${n1(T1.coinc_red)} kW`]],
        0.4, 1.12, 9.2, [1.05, 5.5, 2.65], -1, 0.32, true);

  // A3 method & assumptions
  s = app("A3. Methods and assumptions behind the classification and battery model");
  head(s, 0.4, 1.12, 4.45, "Classification");
  bl(s, 0.4, 1.5, 4.45, 3.1, [
    "Data: hourly kWh cube (home × day × hour), gaps filled from the same hour on adjacent days, meters under 600 kWh a year flagged inactive",
    "Weather model: daily kWh = base + heating slope × max(0, Th − T) + cooling slope × max(0, T − Tc), balance points searched per home",
    "PU learning: P(tech) = P(labeled) ÷ c, with c = mean P(labeled) on held-out labeled homes, then log-odds shifted so the total equals labels ÷ 25%",
    "Final EV and heat-pump score: 60% model and 40% physics evidence (EV) or 30% model and 70% heating physics (heat pump)",
    "AC: hot-hour uplift above 0.5 kW, central if 1.8 kW or more. Pool: summer-only 6-hour block of 1 kW or more, independent of temperature",
    "Segments: k-means on 72 normalised hourly values (winter, summer, shoulder days), k chosen by silhouette, floor of 6",
  ], PT.text, 12);
  vdash(s, 5.0);
  head(s, 5.15, 1.12, 4.45, "Battery and flexibility");
  bl(s, 5.15, 1.5, 4.45, 3.1, [
    "Battery: 2 × Enphase IQ 10C, 20.16 kWh, 7.68 kW, 89.4% round trip, 10% backup reserve (18.1 kWh usable), one cycle a day",
    "Perfect daily foresight in dispatch, so results are an upper bound on what a real controller achieves",
    "Hourly data understates instant peaks. Meters above 38.4 kW (beyond a 200 A service) and seasonal homes are excluded from tiers",
    "Synthetic new loads: Level 2 EV 7.2 kW from 6 to 9 pm daily, ducted heat pump 0.12 kW per °F below 55°F, max 6 kW",
    "$100 per kW-year capacity value is a placeholder for Avangrid's avoided cost, TOU savings use NYSEG peak months only",
    "Tiers: Tier 1 = top 5% of eligible homes by Priority Index, Tier 2 = next 10%, Tier 3 = at least 0.5 kW of flexible load, Tier 4 = the rest",
  ], PT.text, 12);

  // A4 limitations
  s = app("A4. Limitations: what we could not confirm and what would make the tool more accurate");
  table(s, [["Limitation", "Effect on results", "Fix"],
            ["Customer IDs run to 35,725 but only " + n0(NM) + " have reads", "Counts cover every meter delivered", "Confirm with Avangrid that no meters are missing"],
            ["Labels are likely, not verified", "Validation lifts are lower bounds", "Field-verify a Tier 1 sample"],
            ["Heat pump vs resistance heat", `Weakest call, ${n1(val.HP.lift_top10pct)}x lift`, "15-minute data, gas-account flag, rebates"],
            ["Hot tub and water heater rules", "Heuristic, low confidence", "Sub-hourly cycling features"],
            ["No location data", "Ranks homes, not transformers", "Join transformer and feeder IDs"],
            ["PV with battery", `Only ${n0(inv.pv_battery)} weak signatures found`, "Rule ready, confirm with interconnection records"],
            ["Capacity value and prices", "Value per battery scales with them", "Use Avangrid avoided cost, verify NYSEG rates"]],
        0.4, 1.12, 9.2, [2.6, 3.4, 3.2], -1, 0.46, true);

  // A5 tool output + archetypes
  s = app(`A5. Tool output: the ranked list a program manager receives, and the ${D.n_archetypes} load archetypes`);
  const top = D.top_customers.slice(0, 5);
  table(s, [["Customer", "kWh/yr", "Technologies", "Peak [kW]", "Cut [kW]", "Value [$/yr]", "Size", "Index"],
            ...top.map((r) => [String(r.cust), n0(r.kwh), r.tech, n1(r.peak), n1(r.red), usd(r.value), r.rec.replace(" (20.16 kWh)", "").replace(" (10.08 kWh)", ""), n0(r.bpi)])],
        0.4, 1.12, 9.2, [0.85, 0.85, 2.9, 0.8, 0.75, 0.95, 1.4, 0.7], -1, 0.24);
  s.addImage({ path: FIG("focal_archetypes.png"), x: (10 - 2.62 * 8.6 / 3.7) / 2, y: 2.55, w: 2.62 * 8.6 / 3.7, h: 2.62, altText: "Six load archetypes" });

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  require("child_process").execFileSync("python3", [path.join(__dirname, "postprocess.py"), OUT], { stdio: "inherit" });
  console.log("wrote", OUT);
})();
