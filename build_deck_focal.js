// "Focal" style deck: 16:9 (10 x 5.625 in), Verdana.
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
const PT = { tab: 9, text: 9, hi: 10, head: 11, big: 20, title: 17, src: 7, app: 8.5 };
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
const DR = D.drivers, EC = D.drivers.economics, SG = D.drivers.summer_groups, WG = D.drivers.winter_groups, SKW = D.drivers.summer_kw_added, WKW = D.drivers.winter_kw_added;
const k1 = (x) => x >= 9950 ? "$" + Math.round(x / 1000) + "k" : "$" + (Math.round(x / 100) / 10).toFixed(1) + "k";
const ev_ok0 = 1 - D.ev_needs_eval_share, ev_ok1 = ev_ok0 + D.ev_enabled_share;
const hp_ok0 = 1 - D.hp_needs_eval_share, hp_ok1 = hp_ok0 + D.hp_enabled_share;
const T1full = T1.n, T1mw = T1full * T1.coinc_red / 1000;
const dis = D.dispatch;
const peakL = Math.max(...dis.load), peakN = Math.max(...dis.net);
const heWin = (w) => { const he = +w.split("HE")[1]; const f = (h) => (h % 12 || 12) + (h < 12 || h === 24 ? " am" : " pm"); return f(he - 1).replace(/ (am|pm)$/, (he - 1 < 12) === (he < 12) ? "" : " $1") + " to " + f(he); };
const fmtDay = (s) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });


// sources (short footer form, full references in Appendix A1)
const SRC = {
  data: "Avangrid AMI and weather data, Sep 2025 to Aug 2026",
  chal: "Avangrid Challenge Statement, Nov 2026",
  tou: "NYSEG SC12 TOU rates, Nov 2026",
  pu: "Elkan and Noto, KDD 2008",
  mcos: "NYSEG and RG&E 2025 Marginal Cost of Service Study",
  nyiso: "Modo Energy, NYISO capacity prices, May 2026",
  ess: "NYSEG Energy Storage Solutions, Nov 2026",
  cost: "EnergySage, Enphase IQ 10C review, Nov 2026",
  avg: "Avangrid Networks, Nov 2026",
  est: `Team estimates on all ${n0(NM)} meters, see Appendix A2`,
};
const GITHUB = "https://github.com/Cezary14237/avangrid-team27";
const LOGO_W = FIG("cornell_logo_white.png"), LOGO_G = FIG("cornell_logo_grey.png");
const TEAM = [["Cezary Pendras", "photo_cezary.png", "CEMS MIM &\nData Analytics - Big Data", "Data & physics"],
              ["Lorraine Yang", "photo_lorraine.png", "Statistics", "Energy, sustainability, data"],
              ["Aronya Sarker", "photo_aronya.png", "Statistics and Biometry", "Data Science & Fintech"]];

// ---------- icons (white glyph rendered to PNG, placed on a coloured circle)
async function icon(name) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(fa[name], { color: "#FFFFFF", size: 256 }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

// ---------- page grid
const CY = 1.28;      // content top
const CB = 4.5;       // content bottom
const RY = 4.62;      // recommendation bar

(async () => {
  const ICON = {};
  for (const k of ["FaSolarPanel", "FaChargingStation", "FaBolt", "FaThermometerHalf", "FaSnowflake", "FaSun", "FaBatteryFull", "FaHome", "FaDollarSign",
    "FaPlug", "FaSearch", "FaUsers", "FaDatabase", "FaCloudSun", "FaTags", "FaFan", "FaChartLine", "FaMapMarkerAlt", "FaFire"]) ICON[k] = await icon(k);

  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";               // 10 x 5.625 in
  pres.theme = { headFontFace: F, bodyFontFace: F };
  pres.title = "AMI Customer Intelligence and BTM Battery Targeting";
  pres.author = "Team 27, D4G Cornell 4";

  pres.defineSlideMaster({ title: "TITLE", background: { color: NAVY } });
  pres.defineSlideMaster({ title: "CONTENT", background: { color: WHITE },
    slideNumber: { x: 9.2, y: 5.3, w: 0.4, h: 0.2, fontFace: F, fontSize: PT.src, color: GREY, align: "right" } });

  // ---------- components
  const TABS = ["Answer", "Detection", "Segments", "Batteries", "Plan"];
  function tabs(s, active) {
    let x = 0.4;
    s.addShape(pres.shapes.LINE, { x: 0.4, y: 0.38, w: 9.2, h: 0, line: { color: LAV, width: 0.75 }, objectName: "tab rule" });
    TABS.forEach((t) => {
      const w = 0.12 + t.length * 0.08;
      s.addText(t, { x, y: 0.1, w, h: 0.26, fontFace: F, fontSize: PT.tab, bold: t === active, color: t === active ? NAVY : GREY, margin: 0, isTextBox: true, valign: "bottom" });
      if (t === active) s.addShape(pres.shapes.LINE, { x, y: 0.38, w: w - 0.1, h: 0, line: { color: NAVY, width: 2 }, objectName: "active tab" });
      x += w + 0.3;
    });
  }
  function title(s, t) {
    s.addText(t, { x: 0.4, y: 0.46, w: 9.2, h: 0.74, fontFace: F, fontSize: PT.title, bold: true, color: NAVY, margin: 0, isTextBox: true, valign: "top", fit: "none" });
  }
  function rec(s, boldPart, rest, label = "Recommendation") {
    s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: RY, w: 9.2, h: 0.56, fill: { color: BG }, line: { color: BG }, objectName: "recommendation bar" });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: RY, w: 1.6, h: 0.56, fill: { color: GOLD }, line: { color: GOLD }, objectName: "recommendation label" });
    s.addText(label, { x: 0.4, y: RY, w: 1.6, h: 0.56, fontFace: F, fontSize: PT.hi, bold: true, color: NAVY, align: "center", valign: "middle", margin: 0, isTextBox: true });
    s.addText([{ text: boldPart, options: { bold: true } }, { text: " " + rest }],
              { x: 2.12, y: RY, w: 7.4, h: 0.56, fontFace: F, fontSize: PT.hi, color: NAVY, valign: "middle", margin: 0, isTextBox: true });
  }
  function footLogo(s) {
    if (fs.existsSync(LOGO_G)) s.addImage({ path: LOGO_G, x: 0.4, y: 5.24, w: 0.26 * 1200 / 269, h: 0.26, altText: "Cornell University" });
  }
  function sources(s, keys) {
    s.addText("Sources: " + keys.map((k) => SRC[k] || k).join(". ") + ".",
              { x: 1.72, y: 5.25, w: 7.38, h: 0.28, fontFace: F, fontSize: PT.src, color: GREY, margin: 0, isTextBox: true, valign: "top" });
  }
  function content(active, t) {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: active });
    tabs(s, active); title(s, t); footLogo(s); return s;
  }
  function head(s, x, y, w, t) {
    s.addText(t, { x, y, w, h: 0.28, fontFace: F, fontSize: PT.head, bold: true, color: NAVY, margin: 0, isTextBox: true, valign: "bottom" });
    s.addShape(pres.shapes.LINE, { x, y: y + 0.32, w, h: 0, line: { color: NAVY, width: 1 }, objectName: "section rule" });
  }
  function vdash(s, x, y1 = CY, y2 = CB) {
    s.addShape(pres.shapes.LINE, { x, y: y1, w: 0, h: y2 - y1, line: { color: GREY, width: 0.75, dashType: "dash" }, objectName: "column separator" });
  }
  function dot(s, x, y, w) {
    s.addShape(pres.shapes.LINE, { x, y, w, h: 0, line: { color: GREY, width: 0.5, dashType: "sysDot" }, objectName: "dotted separator" });
  }
  function circleIcon(s, x, y, d, ic, fill = BLUE) {
    s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill }, objectName: "icon circle" });
    s.addImage({ data: ICON[ic], x: x + d * 0.24, y: y + d * 0.24, w: d * 0.52, h: d * 0.52, altText: ic });
  }
  // stat callout, stacked: icon + big number on one line, description under it
  function stat(s, x, y, w, ic, big, desc, opt = {}) {
    const h = opt.h || 1.0, d = 0.4;
    circleIcon(s, x, y, d, ic, opt.fill || BLUE);
    s.addText(big, { x: x + d + 0.14, y: y - 0.02, w: w - d - 0.14, h: d + 0.04, fontFace: F, fontSize: opt.size || PT.big, bold: true, color: BLUE, margin: 0, isTextBox: true, valign: "middle" });
    s.addText(desc, { x, y: y + d + 0.06, w, h: h - d - 0.08, fontFace: F, fontSize: PT.text, color: NAVY, margin: 0, isTextBox: true, valign: "top" });
    if (!opt.last) dot(s, x, y + h, w);
  }
  // three stacked stats filling a column from y0 to CB
  function statCol(s, x, w, y0, rows) {
    const h = (CB - y0) / rows.length;
    rows.forEach((r, j) => stat(s, x, y0 + j * h + (j ? 0.07 : 0), w, r[0], r[1], r[2], { h: h - (j ? 0.07 : 0) - 0.02, last: j === rows.length - 1 }));
  }
  function para(s, x, y, w, h, runs, size = PT.text, valign = "top") {
    s.addText(runs, { x, y, w, h, fontFace: F, fontSize: size, color: NAVY, margin: 0, isTextBox: true, valign, paraSpaceAfter: 4 });
  }
  function bl(s, x, y, w, h, items, size = PT.text, sp = 6) {
    s.addText(items.map((t, i) => ({ text: t, options: { bullet: { indent: 11 }, breakLine: i < items.length - 1, paraSpaceAfter: sp } })),
              { x, y, w, h, fontFace: F, fontSize: size, color: NAVY, margin: 0, isTextBox: true, valign: "top" });
  }
  const BODY_B = [{ type: "none" }, { type: "none" }, { type: "dash", pt: 0.5, color: GREY }, { type: "none" }];
  function table(s, rows, x, y, w, colW, hiRow = -1, rowH = 0.3, left = false, size = PT.text) {
    const data = rows.map((r, i) => r.map((c, j) => {
      const al = (j === 0 || left) ? "left" : "center";
      if (i === 0) return { text: String(c), options: { bold: true, color: WHITE, fill: { color: NAVY }, align: al, border: [{ type: "none" }, { type: "none" }, { type: "none" }, { type: "none" }] } };
      return { text: String(c), options: { color: NAVY, bold: i === hiRow, align: al, border: BODY_B, ...(i === hiRow ? { fill: { color: LAV } } : {}) } };
    }));
    s.addTable(data, { x, y, w, colW, fontFace: F, fontSize: size, valign: "middle", rowH, margin: [0.04, 0.06, 0.04, 0.06] });
  }
  function chartHead(s, x, y, w, t, h = 0.44) {
    s.addText(t, { x, y, w, h, fontFace: F, fontSize: PT.hi, bold: true, color: NAVY, margin: 0, isTextBox: true, valign: "top" });
  }
  const AX = { valAxisHidden: true, valAxisLabelFontSize: PT.text, valAxisLabelFontFace: F, valGridLine: { style: "none" }, catGridLine: { style: "none" },
               catAxisLabelFontFace: F, catAxisLabelFontSize: PT.text, catAxisLabelColor: NAVY, catAxisLineColor: GREY, catAxisLineSize: 0.5,
               dataLabelFontFace: F, dataLabelFontSize: PT.text, dataLabelColor: NAVY };
  // bar chart: grey context bars, highlighted bar(s) in blue, values on bars, no value axis or grid
  function bars(s, x, y, w, h, header, labels, values, hi, opt = {}) {
    const hh = opt.hh || 0.44;
    chartHead(s, x, y, w, header, hh);
    const colors = values.map((_, i) => (Array.isArray(hi) ? hi.includes(i) : i === hi) ? BLUE : CTX);
    s.addChart(pres.charts.BAR, [{ name: "value", labels, values }], {
      ...AX, x, y: y + hh, w, h: h - hh, barDir: opt.dir || "col", chartColors: colors, showLegend: false, showValue: true,
      dataLabelPosition: "outEnd", dataLabelFormatCode: opt.fmt || "0", valAxisMinVal: 0, valAxisMaxVal: opt.max,
      barGapWidthPct: opt.gap || 50, catAxisOrientation: opt.reverse ? "maxMin" : "minMax",
    });
  }

  // ===================================================================== title
  pres.addSection({ title: "Title" });
  let s = pres.addSlide({ masterName: "TITLE", sectionTitle: "Title" });
  const lw = 0.42 * 1200 / 258;
  if (fs.existsSync(LOGO_W)) s.addImage({ path: LOGO_W, x: 9.4 - lw, y: 0.42, w: lw, h: 0.42, altText: "Cornell University" });
  s.addText("2026 AVANGRID ENERGY INNOVATION HACKATHON", { x: 0.6, y: 0.5, w: 6.4, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: GOLD, margin: 0, isTextBox: true, charSpacing: 1 });
  s.addText("From meter data to battery decisions", { x: 0.6, y: 0.92, w: 8.8, h: 0.56, fontFace: F, fontSize: 28, bold: true, color: WHITE, margin: 0, isTextBox: true });
  s.addText([{ text: "A transparent AMI tool that inventories customer technologies, segments load and targets", options: { breakLine: true } }, { text: "behind-the-meter batteries" }],
            { x: 0.6, y: 1.56, w: 8.4, h: 0.5, fontFace: F, fontSize: 12, color: LAV, margin: 0, isTextBox: true, valign: "top" });
  const CARD = "273274";
  TEAM.forEach(([name, photo, major, interest], i) => {
    const x = 0.6 + i * 2.35, y = 2.3, w = 2.15, h = 5.625 - 2.3, d = 1.5, px = x + (w - d) / 2, py = y + 0.28;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: CARD }, line: { color: CARD }, objectName: "team card" });
    if (photo && fs.existsSync(FIG(photo))) s.addImage({ path: FIG(photo), x: px, y: py, w: d, h: d, rounding: true, altText: name });
    else {
      s.addShape(pres.shapes.OVAL, { x: px, y: py, w: d, h: d, fill: { color: BLUE }, line: { color: BLUE }, objectName: "initials" });
      s.addText(name.split(" ").map((p) => p[0]).join(""), { x: px, y: py, w: d, h: d, fontFace: F, fontSize: 28, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0, isTextBox: true });
    }
    s.addShape(pres.shapes.OVAL, { x: px - 0.05, y: py - 0.05, w: d + 0.1, h: d + 0.1, fill: { type: "none" }, line: { color: GOLD, width: 2.5 }, objectName: "photo ring" });
    s.addText(name, { x, y: y + 1.98, w, h: 0.32, fontFace: F, fontSize: 14, bold: true, color: WHITE, align: "center", margin: 0, isTextBox: true });
    s.addText(major, { x: x + 0.1, y: y + 2.32, w: w - 0.2, h: 0.42, fontFace: F, fontSize: 10, italic: true, color: GOLD, align: "center", valign: "middle", margin: 0, isTextBox: true });
    s.addText([{ text: "Interest: ", options: { color: LAV } }, { text: interest, options: { color: WHITE, bold: true } }],
              { x: x + 0.1, y: y + 2.78, w: w - 0.2, h: 0.42, fontFace: F, fontSize: 9.5, align: "center", valign: "top", margin: 0, isTextBox: true });
  });
  s.addText("Team 27", { x: 7.8, y: 2.3, w: 1.7, h: 0.42, fontFace: F, fontSize: 20, bold: true, color: WHITE, margin: 0, isTextBox: true });
  s.addText("D4G Cornell 4", { x: 7.8, y: 2.74, w: 1.7, h: 0.3, fontFace: F, fontSize: 12, color: LAV, margin: 0, isTextBox: true });
  s.addShape(pres.shapes.LINE, { x: 7.8, y: 3.2, w: 1.6, h: 0, line: { color: GOLD, width: 1.5 }, objectName: "accent rule" });
  s.addText([{ text: "Code and README", options: { color: LAV, breakLine: true } },
             { text: "github.com/", options: { color: GOLD, bold: true, breakLine: true, hyperlink: { url: GITHUB, tooltip: "GitHub repository" } } },
             { text: "Cezary14237/", options: { color: GOLD, bold: true, breakLine: true, hyperlink: { url: GITHUB, tooltip: "GitHub repository" } } },
             { text: "avangrid-team27", options: { color: GOLD, bold: true, hyperlink: { url: GITHUB, tooltip: "GitHub repository" } } }],
            { x: 7.8, y: 3.34, w: 1.75, h: 1.0, fontFace: F, fontSize: 9, margin: 0, isTextBox: true, valign: "top", paraSpaceAfter: 3 });

  // ===================================================================== 1. answer first
  pres.addSection({ title: "Answer" });
  s = content("Answer", "Demand response is the cheapest peak relief, and batteries pay only in the top 5% of homes that avoid a service upgrade");
  const cw = 2.9, cx = [0.4, 3.55, 6.7];
  [["Who has what", [
     ["FaSolarPanel", pct(val.PV.rule_recall), `of registered solar homes found from load alone, plus ${n0(inv.pv_unregistered)} not on the list`],
     ["FaChargingStation", n1(val.EV.lift_top10pct) + "x", `better EV hit rate than random (${pct(val.EV.recall_top10pct)} vs 10% of labeled EVs)`],
     ["FaThermometerHalf", pct(inv.eheat / NA, 0), `of homes heat mainly with electricity, another ${pct(inv.eheat_supplemental / NA, 0)} partly`]]],
   ["Who drives the peak", [
     ["FaSun", pct(SG.central_ac.share_peak), `of the summer peak comes from central-AC homes, only ${pct(SG.central_ac.share_homes)} of customers`],
     ["FaFire", pct(WG.eheat_primary.share_peak), `of the winter peak comes from electric-heat homes, ${pct(WG.eheat_primary.share_homes)} of customers`],
     ["FaSnowflake", pct(flip), `heat-pump adoption makes winter the peak, now ${pct(1 - D.winter_peak_kw_per_cust / D.system_peak_kw_per_cust)} below summer`]]],
   ["Where a battery pays", [
     ["FaDollarSign", n1(D.value_ratio_tier1_vs_tier4) + "x", `value per battery in Tier 1 vs Tier 4 (${usd(T1.val)} vs ${usd(T4.val)} a year)`],
     ["FaBatteryFull", pct(EC.lifetime_value_system / EC.cost), `of a ${k1(EC.cost)} battery repaid by 15 years of peak value alone`],
     ["FaPlug", pct(ev_ok1), `of homes can add a Level 2 charger within 3 kVA with a battery, ${pct(ev_ok0)} without`]]],
  ].forEach(([h, rows], i) => {
    head(s, cx[i], CY, cw, h);
    statCol(s, cx[i], cw, CY + 0.48, rows);
    if (i < 2) vdash(s, cx[i] + cw + 0.125);
  });
  rec(s, "Launch demand response for most homes and a battery pilot for Tier 1 homes facing a service upgrade.",
      `No-hardware programs cover ${pct(D.flex_share_of_system_peak)} of the peak, and a Tier 1 battery earns ${n1(D.value_ratio_tier1_vs_tier4)}x a Tier 4 one.`);
  sources(s, ["data", "chal", "mcos", "cost", "est"]);

  // ===================================================================== 2. approach
  s = content("Answer", "One transparent pipeline turns 8,760 hourly reads per home into a ranked program list in minutes");
  head(s, 0.4, CY, 2.75, "Starting point");
  statCol(s, 0.4, 2.75, CY + 0.48, [
    ["FaDatabase", n0(NM), "homes with a full year of hourly reads"],
    ["FaCloudSun", "3", "weather series: temperature, humidity, wind"],
    ["FaTags", n0(val.EV.labeled + val.HP.labeled + val.PV.labeled), `labels: ${n0(val.EV.labeled)} EV, ${n0(val.HP.labeled)} heat pump, ${n0(val.PV.labeled)} solar`]]);
  vdash(s, 3.3);
  head(s, 3.45, CY, 6.15, "Three steps, each traceable to a physical feature");
  const ph = [["1  Detect", ["~120 physics features", "PU learning: EV, heat pump", "Rules: 8 more technologies"], "13 technology flags per home, each with a probability"],
              ["2  Segment", [`k-means: ${D.n_archetypes} load archetypes`, "Load at 100 peak hours", "One program per segment"], `${D.segment_rows.length} business segments mapped to programs`],
              ["3  Target", ["Hourly battery dispatch", "Value and 3 kVA test", "Priority Index 0 to 100"], "Battery size, value and tier for every home"]];
  ph.forEach(([t, items, out], i) => {
    const x = 3.45 + i * 2.06, w = 2.0;
    s.addShape(i === 0 ? pres.shapes.PENTAGON : pres.shapes.CHEVRON, { x, y: CY + 0.5, w, h: 0.5, fill: { color: i === 2 ? BLUE : NAVY }, line: { color: WHITE }, objectName: "phase chevron" });
    s.addText(t, { x: x + (i ? 0.3 : 0.14), y: CY + 0.5, w: w - 0.4, h: 0.5, fontFace: F, fontSize: PT.hi, bold: true, color: WHITE, margin: 0, isTextBox: true, valign: "middle" });
    bl(s, x + 0.02, CY + 1.12, w - 0.06, 1.2, items);
    s.addShape(pres.shapes.RECTANGLE, { x, y: 3.35, w, h: CB - 3.35, fill: { color: BG }, line: { color: LAV }, objectName: "output box" });
    s.addText([{ text: "Output", options: { bold: true, color: BLUE, breakLine: true } }, { text: out }],
              { x: x + 0.12, y: 3.45, w: w - 0.24, h: CB - 3.55, fontFace: F, fontSize: PT.text, color: NAVY, margin: 0, isTextBox: true, valign: "top", paraSpaceAfter: 4 });
  });
  rec(s, "Run the tool monthly on every meter.", `It runs in about ${D.runtime_min} minutes for all ${n0(NM)} meters on one laptop, and every score traces back to a feature an engineer can check.`);
  sources(s, ["chal", "data", "pu"]);

  // ===================================================================== 3. fingerprints
  pres.addSection({ title: "Detection" });
  s = content("Detection", "Each technology leaves a measurable fingerprint in hourly data, so every flag rests on physics, not a black box");
  const fp = [["EV Level 2 charging", "focal_heat_ev.png", "Flat 5 to 12.5 kW blocks lasting 1 to 8 hours, also on mild days", `Labeled EV home: ${n0(D.ev_l2_events_median_labeled)} blocks a year (median), typical home ${n0(D.ev_l2_events_median_all)}`],
              ["Solar PV", "focal_heat_pv.png", "Midday net load at zero while the home draws power at night", "Summer solar days separate solar homes from vacant ones"],
              ["Electric heating", "focal_heat_heat.png", "Daily kWh rises below a balance temperature fitted per home", "Primary: 4,000+ kWh a year and 25%+ of use driven by cold"]];
  fp.forEach(([h, img, rule, fact], i) => {
    const x = cx[i];
    head(s, x, CY, cw, h);
    s.addImage({ path: FIG(img), x, y: CY + 0.44, w: cw, h: cw * 0.58, altText: h + " day by hour heatmap" });
    const y2 = CY + 0.5 + cw * 0.58;
    para(s, x, y2, cw, 0.5, [{ text: "Rule: ", options: { bold: true, color: BLUE } }, { text: rule }]);
    dot(s, x, y2 + 0.56, cw);
    para(s, x, y2 + 0.62, cw, CB - y2 - 0.62, [{ text: fact, options: { bold: true } }]);
    if (i < 2) vdash(s, x + cw + 0.125);
  });
  rec(s, "Use the inventory with confidence because it is explainable.", "Every flag cites the feature that triggered it, so a field engineer can check any customer in seconds.");
  sources(s, ["data", "est"]);

  // ===================================================================== 4. classification results
  s = content("Detection", `Learning from Avangrid's 25% label samples finds EVs ${n1(val.EV.lift_top10pct)}x better than random and flags ${n0(inv.pv_unregistered)} unregistered solar systems`);
  const invItems = [["Air conditioning", inv.ac], ["Supplemental heat", inv.eheat_supplemental], ["Primary electric heat", inv.eheat],
    ["EV charging", inv.ev], ["Water heater", inv.water_heater], ["Solar PV", inv.pv], ["Pool pump", inv.pool], ["Heat pump", inv.heat_pump]];
  bars(s, 0.4, CY, 3.35, CB - CY, `EVs are in ${pct(inv.ev / NA, 1)} of homes, AC in ${pct(inv.ac / NA)} [% of homes]`,
       invItems.map((r) => r[0]), invItems.map((r) => Math.round(1000 * r[1] / NA) / 10), 3, { dir: "bar", fmt: '0.0"%"', reverse: true, gap: 40, max: 95 });
  vdash(s, 3.9);
  head(s, 4.05, CY, 2.85, "Validation on hidden labels");
  para(s, 4.05, CY + 0.44, 2.85, 0.62, [{ text: "Unlabeled is not negative. ", options: { bold: true } }, { text: "The model rescales to the known population (labels ÷ 25%)." }]);
  table(s, [["Technology", "Labels", "Top 10%", "Lift"],
            ["Solar PV", n0(val.PV.labeled), pct(val.PV.recall_top10pct), n1(val.PV.lift_top10pct) + "x"],
            ["EV", n0(val.EV.labeled), pct(val.EV.recall_top10pct), n1(val.EV.lift_top10pct) + "x"],
            ["Heat pump", n0(val.HP.labeled), pct(val.HP.recall_top10pct), n1(val.HP.lift_top10pct) + "x"]],
        4.05, CY + 1.12, 2.85, [1.0, 0.6, 0.7, 0.55], 2, 0.34);
  para(s, 4.05, CY + 2.56, 2.85, CB - CY - 2.56, [{ text: "Lifts are lower bounds: ", options: { bold: true } }, { text: "27% of labeled EVs show no Level 2 charging at home." }]);
  vdash(s, 7.05);
  head(s, 7.2, CY, 2.4, "Found beyond the lists");
  statCol(s, 7.2, 2.4, CY + 0.48, [
    ["FaSolarPanel", n0(inv.pv_unregistered), "solar homes missing from Avangrid's list"],
    ["FaSun", n0(inv.pv_new_install), "solar systems installed during the year"],
    ["FaHome", n0(inv.seasonal_home), "part-year homes to drop from baselines"]]);
  rec(s, "Target programs from high-confidence flags and route unregistered solar to interconnection.",
      `Heat pumps are the weakest call (${n1(val.HP.lift_top10pct)}x) and need gas-account and rebate data.`);
  sources(s, ["data", "chal", "pu", "est"]);

  // ===================================================================== 5. segments
  pres.addSection({ title: "Segments" });
  s = content("Segments", `Peak contributors and electrified homes are ${pct((PDC.n + HE.n) / NA)} of customers but supply ${pct(PDC.share_of_coincident_peak + HE.share_of_coincident_peak)} of peak load`);
  const sOrder = [["Peak contributor", PDC], ["High electrification", HE], ["Flexible load", seg("Flexible load")], ["Likely adopter", seg("Likely tech adopter")],
                  ["Emerging electrification", seg("Emerging electrification candidate")], ["Baseline", BASE], ["Solar prosumer", seg("Solar prosumer")], ["Seasonal home", seg("Seasonal / part-year occupancy")]];
  bars(s, 0.4, CY, 4.1, CB - CY, `A peak contributor draws ${n1(PDC.coinc / BASE.coinc)}x a baseline home at the system peak [kW per home]`,
       sOrder.map((r) => r[0]), sOrder.map((r) => Math.round(r[1].coinc * 10) / 10), 0, { fmt: "0.0", gap: 40, dir: "bar", reverse: true, max: 5.6 });
  vdash(s, 4.65);
  head(s, 4.8, CY, 4.8, "Each segment gets one program");
  const prog = [["Peak contributor", PDC, "Battery + DR"], ["High electrification", HE, "Battery, managed EV"],
                ["Flexible load", seg("Flexible load"), "DR: thermostat, EV, pool"], ["Likely adopter", seg("Likely tech adopter"), "EV and storage marketing"],
                ["Emerging electrification", seg("Emerging electrification candidate"), "Heat-pump rebate"],
                ["Solar prosumer", seg("Solar prosumer"), "Solar + battery, backup"],
                ["Baseline", BASE, "Monitor, efficiency"]];
  table(s, [["Segment", "Homes", "Peak load", "Program"], ...prog.map(([k, r, p]) => [k, n0(r.n), pct(r.share_of_coincident_peak), p])],
        4.8, CY + 0.44, 4.8, [1.78, 0.6, 0.6, 1.82], 1, 0.29);
  para(s, 4.8, CB - 0.42, 4.8, 0.42, [{ text: `Technologies come in bundles: solar homes are ${n1(DR.lift_solar_ev)}x as likely to own an EV.`, options: { bold: true } }], PT.text, "bottom");
  rec(s, "Start battery and DR outreach with peak contributors and high-electrification homes.", `They are ${pct((PDC.n + HE.n) / NA)} of customers but ${pct(PDC.share_of_coincident_peak + HE.share_of_coincident_peak)} of the load the grid is sized for.`);
  sources(s, ["data", "est"]);

  // ===================================================================== 6. two peaks
  s = content("Segments", `Air conditioning sets the summer peak, electric heat the winter peak, and ${pct(flip)} heat-pump adoption makes winter larger`);
  const tk = [["Central AC", "central_ac"], ["Room AC", "room_ac"], ["Primary\nelectric heat", "eheat_primary"], ["Supplemental\nelectric heat", "eheat_supplemental"], ["EV", "ev"]];
  chartHead(s, 0.4, CY, 5.6, `Central AC adds ${n1(SKW.central_ac)} kW at the summer peak, electric heat ${n1(WKW.eheat_primary)} kW in winter [kW added per home]`);
  s.addChart(pres.charts.BAR, [
    { name: "Summer peak", labels: tk.map((r) => r[0]), values: tk.map((r) => Math.round(SKW[r[1]] * 10) / 10) },
    { name: "Winter peak", labels: tk.map((r) => r[0]), values: tk.map((r) => Math.round(WKW[r[1]] * 10) / 10) }],
    { ...AX, x: 0.4, y: CY + 0.44, w: 5.6, h: CB - CY - 0.44, barDir: "col", chartColors: [CTX, BLUE], showLegend: true, legendPos: "t", legendFontFace: F, legendFontSize: PT.text, legendColor: NAVY,
      showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.0", valAxisMinVal: 0, valAxisMaxVal: 4.2, barGapWidthPct: 50 });
  vdash(s, 6.15);
  head(s, 6.3, CY, 3.3, "Who sets each peak");
  statCol(s, 6.3, 3.3, CY + 0.48, [
    ["FaSun", pct(SG.central_ac.share_peak), `of the summer peak comes from central-AC homes, ${pct(SG.central_ac.share_homes)} of customers`],
    ["FaSnowflake", pct(WG.eheat_primary.share_peak), `of the winter peak comes from homes heated mainly by electricity, ${pct(WG.eheat_primary.share_homes)} of customers`],
    ["FaFire", pct(flip), "heat-pump adoption lifts winter above today's summer peak"]]);
  rec(s, "Run summer DR for central-AC homes and winter setback for electric-heat homes.", "A second, independent team pipeline found a similar split (40% and 31%).");
  sources(s, ["data", "est"]);

  // ===================================================================== 7. battery method
  pres.addSection({ title: "Batteries" });
  s = content("Batteries", "Every home gets an hourly battery simulation, a recommended size and a priority score");
  head(s, 0.4, CY, 4.55, "How each home is scored");
  const blocks = [["Customer peak shaving", "Each day, the lowest cap the battery can hold (18.1 kWh, 7.68 kW). Recharge in the quietest hours."],
                  ["Utility peak window", "Discharge 3 to 8 pm. Value = kW at the 100 highest hours × $74 per kW-year + TOU savings."],
                  ["Priority Index and size", "Weights kW at system peak, peak cut, kWh shifted, electrification. One unit if a second adds under 1 kW."]];
  const bh = (CB - CY - 0.48) / 3;
  blocks.forEach(([h, t], j) => {
    const y = CY + 0.5 + j * bh;
    circleIcon(s, 0.4, y + 0.02, 0.46, ["FaHome", "FaBolt", "FaChartLine"][j]);
    s.addText(h, { x: 1.0, y, w: 3.95, h: 0.28, fontFace: F, fontSize: PT.hi, bold: true, color: BLUE, margin: 0, isTextBox: true });
    para(s, 1.0, y + 0.3, 3.95, bh - 0.36, t);
    if (j < 2) dot(s, 0.4, y + bh - 0.04, 4.55);
  });
  vdash(s, 5.1);
  const hrs = Array.from({ length: 24 }, (_, i) => String(i + 1));
  chartHead(s, 5.25, CY, 4.35, `One battery cuts this home's peak from ${n1(peakL)} to ${n1(peakN)} kW [kW, ${fmtDay(dis.date)}]`);
  s.addChart([
    { type: pres.charts.BAR, data: [{ name: "Load without battery", labels: hrs, values: dis.load }], options: { chartColors: [CTX], barGapWidthPct: 30 } },
    { type: pres.charts.LINE, data: [{ name: "Grid draw with battery", labels: hrs, values: dis.net }], options: { chartColors: [BLUE], lineSize: 2.5, lineDataSymbol: "none" } },
  ], { ...AX, x: 5.25, y: CY + 0.44, w: 4.35, h: CB - CY - 0.44, valAxisMinVal: 0, catAxisLabelFrequency: 3,
       showLegend: true, legendPos: "t", legendFontFace: F, legendFontSize: PT.text, legendColor: NAVY, catAxisTitle: "Hour ending", showCatAxisTitle: true,
       catAxisTitleFontFace: F, catAxisTitleFontSize: PT.text, catAxisTitleColor: GREY });
  rec(s, "Size batteries per home, not per program.", `${n0(D.recommendation_counts["2 units (20.16 kWh)"])} homes need 2 units, ${n0(D.recommendation_counts["1 unit (10.08 kWh)"])} are served by one and ${n0(D.recommendation_counts["demand flex only"])} need only demand flexibility.`);
  sources(s, ["chal", "tou", "mcos", "est"]);

  // ===================================================================== 8. battery results
  s = content("Batteries", `A Tier 1 battery is worth ${n1(D.value_ratio_tier1_vs_tier4)}x a Tier 4 battery, but peak value alone repays only ${pct(EC.lifetime_value_system / EC.cost)} of its cost`);
  bars(s, 0.4, CY, 3.2, CB - CY, "Tier 1 earns the most per battery [$ per year]",
       ["Tier 1\nbattery + DR", "Tier 2\nbattery offer", "Tier 3\nDR", "Tier 4\nmonitor"], [T1, T2, T3, T4].map((t) => Math.round(t.val)), 0, { fmt: '"$"0', gap: 45, max: 350 });
  vdash(s, 3.75);
  head(s, 3.9, CY, 5.7, "Tiers at a glance");
  table(s, [["Tier", "Homes", "Peak cut [kW]", "At system peak [kW]", "Value [$/yr]"],
            ...[["1  Battery + DR", T1], ["2  Battery offer", T2], ["3  Demand response", T3], ["4  Monitor", T4]].map(([k, t]) => [k, n0(t.n), n1(t.red), n1(t.coinc_red), usd(t.val)])],
        3.9, CY + 0.44, 5.7, [1.8, 0.8, 1.0, 1.2, 0.9], 1, 0.29);
  const yy = CY + 2.2, sw = 1.84;
  [["FaBolt", n0(D.tier1_total_coinc_relief_kw) + " kW", `Tier 1 relief, ${pct(D.tier1_share_of_system_peak, 1)} of the system peak`],
   ["FaBatteryFull", n0(D.tier12_total_coinc_relief_kw) + " kW", `Tiers 1 and 2, ${pct(D.tier12_total_coinc_relief_kw / SYS, 1)} of peak from ${pct((T1.n + T2.n) / NA)} of homes`],
   ["FaDollarSign", k1(EC.lifetime_value_system), `15-year peak value vs ${k1(EC.cost)} installed (${k1(EC.lifetime_value_constrained)} on a constrained feeder)`]].forEach((r, j) => {
    const x = 3.9 + j * (sw + 0.09);
    stat(s, x, yy, sw, r[0], r[1], r[2], { h: CB - yy, last: true, size: 16 });
    if (j < 2) s.addShape(pres.shapes.LINE, { x: x + sw + 0.045, y: yy, w: 0, h: CB - yy, line: { color: GREY, width: 0.5, dashType: "sysDot" }, objectName: "dotted separator" });
  });
  rec(s, "Fund batteries where they also avoid a service or feeder upgrade.", `Offer the rest of Tiers 1 and 2 a customer-funded battery with ESS payments of about ${usd(EC.ess_per_year)} a year.`);
  sources(s, ["tou", "mcos", "nyiso", "ess", "cost", "est"]);

  // ===================================================================== 9. enablement & flexibility
  s = content("Batteries", `With a battery, ${pct(ev_ok1)} of homes can add a Level 2 charger without a service upgrade, versus ${pct(ev_ok0)} today`);
  bars(s, 0.4, CY, 5.0, CB - CY, "Batteries keep new loads inside the 3 kVA limit [% of homes within the limit]",
       ["EV charger,\nno battery", "EV charger,\nwith battery", "Heat pump,\nno battery", "Heat pump,\nwith battery"],
       [ev_ok0, ev_ok1, hp_ok0, hp_ok1].map((v) => Math.round(v * 100)), [1, 3], { fmt: '0"%"', gap: 60, max: 112 });
  vdash(s, 5.55);
  head(s, 5.7, CY, 3.9, "Flexibility without new hardware");
  statCol(s, 5.7, 3.9, CY + 0.48, [
    ["FaFan", n0(fb.flex_ac_kw) + " kW", `smart thermostats (30% of AC load), ${pct(fb.flex_ac_kw / SYS)} of the peak`],
    ["FaChargingStation", n0(fb.flex_ev_kw) + " kW", "managed EV charging moved out of 3 to 8 pm"],
    ["FaPlug", n0(fb.flex_pool_kw + fb.flex_wh_kw) + " kW", "pool-pump timers and water-heater control"]]);
  rec(s, "Make a battery or managed charging the default answer to EV and heat-pump service requests.", `Thermostats alone deliver ${pct(fb.flex_ac_kw / SYS)} of the peak with no new hardware.`);
  sources(s, ["chal", "est"]);

  // ===================================================================== 10. plan
  pres.addSection({ title: "Plan" });
  s = content("Plan", "A three-phase rollout reaches all NYSEG and RG&E meters by Q4 2027, with a go/no-go gate after the summer 2027 pilot");
  const phases = [["Q1 2027  Validate", ["Tier 1 list to field teams", "Site visits on a sample", "Join gas and rebate data"]],
                  ["Q2 to Q3 2027  Pilot", ["Batteries where upgrade is due", "Thermostat and EV DR", "Measure kW vs simulation"]],
                  ["Q4 2027  Scale", ["Monthly scoring, ~1.3M meters", "Winter heat-pump test", "Add transformer IDs"]]];
  phases.forEach(([t, items], i) => {
    const x = 0.4 + i * 2.02, w = 2.0;
    s.addShape(i === 0 ? pres.shapes.PENTAGON : pres.shapes.CHEVRON, { x, y: CY, w, h: 0.46, fill: { color: i === 2 ? BLUE : NAVY }, line: { color: WHITE }, objectName: "phase chevron" });
    s.addText(t, { x: x + (i === 0 ? 0.12 : 0.3), y: CY, w: w - 0.4, h: 0.46, fontFace: F, fontSize: PT.text, bold: true, color: WHITE, margin: 0, isTextBox: true, valign: "middle" });
    bl(s, x + 0.04, CY + 0.56, w - 0.08, 0.9, items);
  });
  const ly = CY + 1.62;
  s.addShape(pres.shapes.LINE, { x: 0.5, y: ly, w: 5.85, h: 0, line: { color: GREY, width: 1 }, objectName: "timeline" });
  [[1.4, "Q1 2027: pilot list approved", NAVY], [3.42, "Q3 2027: summer peak measured", NAVY], [5.44, "Q4 2027: go/no-go", GOLD]].forEach(([x, t, c]) => {
    s.addShape(pres.shapes.DIAMOND, { x: x - 0.14, y: ly - 0.14, w: 0.28, h: 0.28, fill: { color: c }, line: { color: c }, objectName: "milestone" });
    s.addText(t, { x: x - 0.95, y: ly + 0.2, w: 1.9, h: 0.3, fontFace: F, fontSize: PT.text, color: NAVY, bold: c === GOLD, align: "center", margin: 0, isTextBox: true });
  });
  const gy = ly + 0.62;
  s.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: gy, w: 6.0, h: CB - gy, fill: { color: CREAM }, line: { color: CREAM }, objectName: "go no-go box" });
  s.addText([{ text: "Go: ", options: { bold: true } }, { text: `measured relief reaches 80% of the simulated ${n1(T1.coinc_red)} kW per Tier 1 home. Scale batteries to Tier 1 and 2 homes due an upgrade.`, options: { breakLine: true } },
             { text: "If not: ", options: { bold: true } }, { text: `move the budget to demand response (${pct(D.flex_share_of_system_peak)} of peak) and repeat the pilot in summer 2028.` }],
            { x: 0.55, y: gy, w: 5.7, h: CB - gy, fontFace: F, fontSize: PT.text, color: NAVY, margin: 0, isTextBox: true, valign: "middle", paraSpaceAfter: 6 });
  vdash(s, 6.55);
  head(s, 6.7, CY, 2.9, "Tier 1 value [team estimate]");
  const casc = [[n0(NM), "meters"], ["× " + pct(T1.n / NM, 1) + " Tier 1 share", null], [n0(T1full), "Tier 1 homes"], [`× ${n1(T1.coinc_red)} kW each`, null], [n1(T1mw) + " MW", "at system peak"], ["× $74 per kW-year", null], ["$" + n2(T1mw * 0.074) + "M", "per year"]];
  let cy = CY + 0.46;
  const boxH = 0.42, gapH = 0.22;
  casc.forEach(([big, lab]) => {
    if (lab) {
      const last = lab === "per year";
      s.addShape(pres.shapes.RECTANGLE, { x: 6.7, y: cy, w: 2.9, h: boxH, fill: { color: last ? BLUE : BG }, line: { color: last ? BLUE : LAV }, objectName: "cascade box" });
      s.addText([{ text: big + "  ", options: { bold: true, fontSize: PT.head } }, { text: lab }], { x: 6.82, y: cy, w: 2.7, h: boxH, fontFace: F, fontSize: PT.text, color: last ? WHITE : NAVY, margin: 0, isTextBox: true, valign: "middle" });
      cy += boxH;
    } else {
      s.addText(big, { x: 6.7, y: cy, w: 2.9, h: gapH, fontFace: F, fontSize: PT.text, bold: true, color: GREY, align: "center", margin: 0, isTextBox: true, valign: "middle" });
      cy += gapH;
    }
  });
  para(s, 6.7, cy + 0.06, 2.9, CB - cy - 0.06, `$${n2(T1mw * 0.119)}M on constrained feeders. Capacity value only.`, PT.text, "bottom");
  rec(s, "Approve a Q1 2027 validation sprint.", "It needs no hardware, confirms the Tier 1 list in the field and decides whether the summer 2027 pilot goes ahead.", "Our ask");
  sources(s, ["data", "mcos", "nyiso", "est"]);

  // ===================================================================== 11. risks
  s = content("Plan", "Four risks are manageable if batteries scale only after the Q4 2027 gate on relief, enrolment, upgrade cost and data");
  const RC = [0.4, 0.72, 3.2, 4.15, 5.05, 7.45, 8.45];   // column x
  const hdr = ["#", "Risk", "Likelihood", "Impact", "Mitigation", "Owner", "Gate KPI, Q4 2027"];
  const hw = [0.3, 2.45, 0.9, 0.85, 2.35, 1.0, 1.15];
  hdr.forEach((t, i) => s.addText(t, { x: RC[i], y: CY, w: hw[i], h: 0.3, fontFace: F, fontSize: 8.5, bold: true, color: NAVY, margin: 0, isTextBox: true, valign: "bottom", align: (i === 2 || i === 3) ? "center" : "left" }));
  s.addShape(pres.shapes.LINE, { x: 0.4, y: CY + 0.34, w: 9.2, h: 0, line: { color: NAVY, width: 1.25 }, objectName: "header rule" });
  const risks = [
    ["Batteries deliver less relief than simulated", "Dispatch assumes perfect daily foresight", 2, 3, ["Pilot before scaling", "Re-tune dispatch on metered data"], "Grid planning", "80%+", `of the simulated ${n1(T1.coinc_red)} kW per home`],
    ["Customers do not enrol in demand response", "Relief depends on participation", 2, 2, ["Bill credits and ESS payments", "Start with AC and flexible segments"], "Customer programs", "20%+", "of contacted homes enrolled"],
    ["Avoided upgrades are too cheap to fund batteries", `Peak value repays ${pct(EC.lifetime_value_system / EC.cost)} of the cost`, 2, 3, ["Get upgrade costs in Q1", "Fund only where the gap is covered"], "Finance, engineering", k1(EC.gap_constrained) + "+", "avoided upgrade cost per battery"],
    ["Technology flags are wrong for some homes", "Labels are likely, not verified", 2, 2, ["Field-check a Tier 1 sample", "Add gas and rebate data"], "Analytics", "90%+", "of sampled Tier 1 flags confirmed"],
  ];
  const rrh = (CB - CY - 0.4) / 4;
  risks.forEach(([r, sub, lk, im, mit, own, kpi, kdesc], i) => {
    const y = CY + 0.4 + i * rrh;
    s.addText(String(i + 1), { x: RC[0], y, w: hw[0], h: rrh, fontFace: F, fontSize: PT.head, bold: true, color: NAVY, margin: 0, isTextBox: true, valign: "middle" });
    s.addText([{ text: r, options: { bold: true, breakLine: true } }, { text: sub, options: { fontSize: 8, color: GREY } }],
              { x: RC[1], y, w: hw[1], h: rrh, fontFace: F, fontSize: PT.text, color: NAVY, margin: 0, isTextBox: true, valign: "middle", paraSpaceAfter: 2 });
    [[2, lk], [3, im]].forEach(([c, n]) => {
      for (let k = 0; k < 3; k++) {
        const dx = RC[c] + hw[c] / 2 - 0.33 + k * 0.23;
        s.addShape(pres.shapes.OVAL, { x: dx, y: y + rrh / 2 - 0.08, w: 0.17, h: 0.17, fill: { color: k < n ? NAVY : WHITE }, line: { color: NAVY, width: 1 }, objectName: "rating dot" });
      }
    });
    bl(s, RC[4], y + 0.1, hw[4], rrh - 0.14, mit, 8.5, 3);
    s.addText(own, { x: RC[5], y, w: hw[5], h: rrh, fontFace: F, fontSize: 8.5, color: NAVY, margin: 0, isTextBox: true, valign: "middle" });
    s.addShape(pres.shapes.LINE, { x: RC[6] - 0.08, y: y + 0.06, w: 0, h: rrh - 0.12, line: { color: LAV, width: 1 }, objectName: "kpi rule" });
    s.addText([{ text: kpi, options: { bold: true, fontSize: 13, color: BLUE, breakLine: true } }, { text: kdesc, options: { fontSize: 8, color: NAVY } }],
              { x: RC[6], y, w: hw[6], h: rrh, fontFace: F, margin: 0, isTextBox: true, valign: "middle" });
    dot(s, 0.4, y + rrh - 0.01, 9.2);
  });
  rec(s, "Scale batteries only when all four gate KPIs are met in Q4 2027.", "If one is missed, demand response keeps running and the battery pilot repeats in summer 2028.");
  sources(s, ["est", "Ratings and gate thresholds are team proposals"]);

  // ===================================================================== appendix
  pres.addSection({ title: "Appendix" });
  const app = (t) => { const sl = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Appendix" });
    sl.addText("Appendix", { x: 0.4, y: 0.1, w: 2, h: 0.26, fontFace: F, fontSize: PT.tab, bold: true, color: NAVY, margin: 0, isTextBox: true, valign: "bottom" });
    sl.addShape(pres.shapes.LINE, { x: 0.4, y: 0.38, w: 9.2, h: 0, line: { color: LAV, width: 0.75 }, objectName: "tab rule" });
    title(sl, t); footLogo(sl); return sl; };
  const AP = PT.app;

  // A1 sources
  s = app("A1. Sources: every number comes from Avangrid's data or a cited public source, our own calculations are marked");
  table(s, [["Code", "Publisher and document", "Date", "Used for"],
            ["Data", "Avangrid, hackathon AMI data and weather workbook", "Sep 2025 to Aug 2026", "All load, peak and battery results"],
            ["Challenge", "Avangrid, Challenge Statement and Data Dictionary", "Nov 2026", "25% label samples, battery spec, 3 kVA rule"],
            ["NYSEG", "NYSEG, Time-of-Use Service Class 12 rates", "Nov 2026", "Peak $0.16, off-peak $0.09 per kWh"],
            ["MCOS", "NYSEG and RG&E, 2025 Marginal Cost of Service Study", "2025", "Distribution $26.02/kW-yr, $70.61 constrained"],
            ["NYISO", "Modo Energy, NYISO capacity reference price", "May 2026", "Rest of state $8 per kW-month"],
            ["ESS", "NYSEG, Energy Storage Solutions program", "Nov 2026", "$50 per kW of event performance"],
            ["Cost", "EnergySage, Enphase IQ Battery 10C review", "Nov 2026", "About $13,000 installed per unit"],
            ["Avangrid", "Avangrid Networks, NYSEG and RG&E customers", "Nov 2026", "About 1.3M electric meters"],
            ["PU", "Elkan and Noto, KDD 2008 (positive-unlabeled learning)", "2008", "EV and heat-pump probabilities"],
            ["Team", "Team estimates from the open-source pipeline", "Nov 2026", "Every derived number, see A2"]],
        0.4, CY, 9.2, [0.95, 3.55, 1.55, 3.15], -1, 0.29, true, PT.text);
  para(s, 0.4, 4.9, 9.2, 0.3, [{ text: "Still to confirm: ", options: { bold: true } },
       { text: "NYSEG TOU prices, a second installed-cost quote and Avangrid's cost of a typical service upgrade." }], PT.text);

  // A2 calculations
  s = app("A2. Calculations: how each derived number on the slides is built");
  table(s, [["Number", "Formula", "Inputs"],
            [pct(val.PV.rule_recall), "Registered solar homes flagged by the solar-day rule ÷ registered solar homes", `${n0(Math.round(val.PV.rule_recall * val.PV.labeled))} of ${n0(val.PV.labeled)}`],
            [n1(val.EV.lift_top10pct) + "x", "Share of hidden labeled EVs in our top 10% ÷ 10% (out-of-fold)", `${pct(val.EV.recall_top10pct)} ÷ 10%`],
            [n2(D.system_peak_kw_per_cust) + " kW", "Highest hourly sum of active homes ÷ active homes", `${n0(SYS)} kW ÷ ${n0(NA)}`],
            [pct(flip), "Smallest share of homes with a 0.12 kW/°F heat pump (max 6 kW) lifting winter above summer", "Hourly temperature, 2% steps"],
            [pct(SG.central_ac.share_peak), "Load of central-AC homes at the 20 highest Jun to Aug hours ÷ all load then", `${n0(SG.central_ac.homes)} homes`],
            [n1(SKW.central_ac) + " kW", "OLS of each home's load at the 20 peak hours on technology flags", "Summer and winter fitted separately"],
            [n1(D.value_ratio_tier1_vs_tier4) + "x", "Mean annual value per battery, Tier 1 ÷ Tier 4", `${usd(T1.val)} ÷ ${usd(T4.val)}`],
            ["Value [$/yr]", "kW cut at the 100 highest hours × $74 + discharged kWh × ($0.16 − $0.09 ÷ 0.894)", "$74 = $26.02 + $8 × 6 months"],
            [k1(EC.lifetime_value_system), "15 × (Tier 1 kW cut × $74 + TOU savings), vs 2 × $13,000 installed", `15 × (${n2(EC.kw_at_system_peak)} × $74 + ${usd(EC.tou_per_year)})`],
            [usd(EC.ess_per_year), "ESS: 80% of 20.16 kWh over a 4-hour event = average kW, × $50 per kW", "16.1 kWh ÷ 4 h = 4.0 kW"],
            [pct(D.tier1_share_of_system_peak, 1), "Tier 1 kW cut at system peak ÷ system peak", `${n0(D.tier1_total_coinc_relief_kw)} ÷ ${n0(SYS)} kW`],
            [pct(ev_ok1), "Homes whose annual peak rises ≤ 3 kVA after adding 7.2 kW from 6 to 9 pm, with battery", `${n0(NA)} active homes`],
            [n0(D.flex_total_kw) + " kW", "30% of AC kW + EV kW at peak + pool kW 3 to 8 pm + 0.4 kW per water heater", `${pct(D.flex_share_of_system_peak)} of ${n0(SYS)} kW`],
            [n1(T1mw) + " MW", "Tier 1 homes × kW cut per Tier 1 home at system peak", `${n0(T1.n)} × ${n1(T1.coinc_red)} kW`]],
        0.4, CY, 9.2, [1.0, 5.6, 2.6], -1, 0.255, true, AP);

  // A3 method & assumptions
  s = app("A3. Methods and assumptions behind the classification and battery model");
  head(s, 0.4, CY, 4.45, "Classification");
  bl(s, 0.4, CY + 0.48, 4.45, CB + 0.6 - CY - 0.48, [
    "Hourly kWh cube (home × day × hour), gaps filled from the same hour on adjacent days, under 600 kWh a year = inactive",
    "Weather model: daily kWh = base + heating slope × max(0, Th − T) + cooling slope × max(0, T − Tc), fitted per home",
    "PU learning: P(tech) = P(labeled) ÷ c, then log-odds shifted so the total equals labels ÷ 25%",
    "EV score: 60% model, 40% charging evidence. Heat pump: 30% model, 70% heating physics",
    "AC: hot-hour uplift above 0.5 kW, central if 1.8 kW or more. Pool: summer-only 6-hour block of 1 kW or more",
    "Segments: k-means on 72 normalised hourly values, k by silhouette, floor of 6",
  ], PT.text, 11);
  vdash(s, 5.0, CY, CB + 0.6);
  head(s, 5.15, CY, 4.45, "Battery and flexibility");
  bl(s, 5.15, CY + 0.48, 4.45, CB + 0.6 - CY - 0.48, [
    "2 × Enphase IQ 10C: 20.16 kWh, 7.68 kW, 89.4% round trip, 10% reserve (18.1 kWh usable), one cycle a day",
    "Perfect daily foresight in dispatch, so results are an upper bound",
    "Homes above 38.4 kW (beyond a 200 A service) and part-year homes are excluded from tiers",
    "New loads: Level 2 EV 7.2 kW from 6 to 9 pm, heat pump 0.12 kW per °F below 55°F, max 6 kW",
    "Capacity value $74 per kW-year ($119 on constrained feeders), TOU savings in NYSEG peak months only",
    "Tier 1 = top 5% by Priority Index, Tier 2 = next 10%, Tier 3 = 0.5 kW+ of flexible load, Tier 4 = the rest",
  ], PT.text, 11);

  // A4 limitations
  s = app("A4. Limitations: what we could not confirm and what would make the tool more accurate");
  table(s, [["Limitation", "Effect on results", "Fix"],
            ["Customer IDs run to 35,725 but " + n0(NM) + " have reads", "Counts cover every meter delivered", "Confirm no meters are missing"],
            ["Labels are likely, not verified", "Validation lifts are lower bounds", "Field-verify a Tier 1 sample"],
            ["Heat pump vs resistance heat", `Weakest call, ${n1(val.HP.lift_top10pct)}x lift`, "15-minute data, gas flag, rebates"],
            ["Hot tub and water heater rules", "Heuristic, low confidence", "Sub-hourly cycling features"],
            ["No location data", "Ranks homes, not transformers", "Join transformer and feeder IDs"],
            ["PV with battery", `Only ${n0(inv.pv_battery)} weak signatures found`, "Confirm with interconnection records"],
            ["Battery and upgrade cost", "Decide whether a battery pays", "Second quote, Avangrid upgrade cost"]],
        0.4, CY, 9.2, [3.0, 3.1, 3.1], -1, 0.46, true, PT.text);

  // A5 tool output + archetypes
  s = app(`A5. Tool output: the ranked list a program manager receives, and the ${D.n_archetypes} load archetypes`);
  const top = D.top_customers.slice(0, 5);
  table(s, [["Customer", "kWh/yr", "Technologies", "Peak [kW]", "Cut [kW]", "Value [$/yr]", "Size", "Index"],
            ...top.map((r) => [String(r.cust), n0(r.kwh), r.tech, n1(r.peak), n1(r.red), usd(r.value), r.rec.replace(" (20.16 kWh)", "").replace(" (10.08 kWh)", ""), n0(r.bpi)])],
        0.4, CY, 9.2, [0.85, 0.85, 2.9, 0.8, 0.75, 0.95, 1.4, 0.7], -1, 0.24, false, AP);
  const ah = 5.2 - 2.98;
  s.addImage({ path: FIG("focal_archetypes.png"), x: (10 - ah * 8.6 / 3.7) / 2, y: 2.98, w: ah * 8.6 / 3.7, h: ah, altText: "Load archetypes" });

  // A6 cross-check with the second team pipeline
  s = app("A6. Cross-check: a second, independently built team pipeline reproduces the headline results");
  table(s, [["Metric", "Pipeline A (this deck)", "Pipeline B (independent)", "Reading"],
            ["Summer peak [kW per home]", `${n2(D.system_peak_kw_per_cust)}, ${fmtDay(D.system_peak_when.split(" ")[0])}, ${heWin(D.system_peak_when)}`, "2.32, same hour", "Match"],
            ["Winter peak [kW per home]", `${n2(D.winter_peak_kw_per_cust)}, ${fmtDay(D.winter_peak_when.split(" ")[0])}`, "1.68, Jan 25 and Feb 8", "Match"],
            ["Homes with AC", pct(inv.ac / NA), "69%", "Match"],
            ["Central AC: homes vs summer peak", `${pct(SG.central_ac.share_homes)} vs ${pct(SG.central_ac.share_peak)}`, "24% vs 40%", "Match"],
            ["Electric heat: homes vs winter peak", `${pct(WG.eheat_primary.share_homes)} vs ${pct(WG.eheat_primary.share_peak)}`, "13% vs 31%", "Match, looser threshold in B"],
            ["kW added: AC summer, heat winter", `${n1(SKW.central_ac)} and ${n1(WKW.eheat_primary)}`, "2.9 and 2.8", "Same ranking"],
            ["EV homes", `${n0(inv.ev)} (${n0(inv.ev_L2)} Level 2)`, "744 (598 Level 2)", "Total matches"],
            ["Unregistered solar homes", n0(inv.pv_unregistered), "231", "Report 119 to 231"],
            ["Solar homes owning an EV", `${n1(DR.lift_solar_ev)}x average`, "6.8x average", "Match"],
            ["Targeted vs average battery", "1.8x (Tier 1 vs eligible)", "2.3x (top 3% vs random)", "About 2x either way"]],
        0.4, CY, 9.2, [2.75, 2.4, 2.2, 1.85], -1, 0.32, true, PT.text);

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  require("child_process").execFileSync("python3", [path.join(__dirname, "postprocess.py"), OUT], { stdio: "inherit" });
  console.log("wrote", OUT);
})();
