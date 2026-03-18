const BLUE = "#2563eb";
const RED = "#dc2626";
const GRID = "#e5e7eb";
const AXIS = "#6b7280";
const TEXT = "#111827";
const GREEN = "#059669";
const ORANGE = "#ea580c";

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function colorWithAlpha(color, alpha) {
  const a = clamp01(alpha);
  if (/^#([0-9a-f]{6})$/i.test(color)) {
    const m = color.slice(1);
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (/^#([0-9a-f]{3})$/i.test(color)) {
    const m = color.slice(1);
    const r = parseInt(m[0] + m[0], 16);
    const g = parseInt(m[1] + m[1], 16);
    const b = parseInt(m[2] + m[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return color;
}


const FONT_SCALE = 2.0;
const BASE_FONT = 12 * FONT_SCALE;
const ANIM_FONT = 12 * FONT_SCALE;

const controls = {};
const disableCollisionsCheckbox = document.getElementById('disableCollisions');
if (disableCollisionsCheckbox) {
  disableCollisionsCheckbox.addEventListener("change", handleCollisionToggle);
}
[
  "L","l1left","lmid","l2right","m","k1left","kmid","k2right","Ain","Aout","phiIn","phiOut"
].forEach(id => controls[id] = document.getElementById(id));

const dynamicRangeIds = ["L","l1left","lmid","l2right","k1left","kmid","k2right","Ain","Aout"];
const baseSliderRanges = {};
dynamicRangeIds.forEach(id => {
  const el = controls[id];
  baseSliderRanges[id] = {
    min: parseFloat(el.min),
    max: parseFloat(el.max),
    step: parseFloat(el.step) || 0.01
  };
});

let lastSafeSnapshot = null;
let activeSafetyDragId = null;

function beginSafetyDrag(id) {
  if (!dynamicRangeIds.includes(id)) return;
  activeSafetyDragId = id;
  applyCollisionSafetyConstraints(id);
}

function endSafetyDrag(id) {
  if (activeSafetyDragId !== id) return;
  activeSafetyDragId = null;
  applyCollisionSafetyConstraints();
}

function captureDynamicSnapshot() {
  const snap = {};
  dynamicRangeIds.forEach(id => {
    snap[id] = controls[id].value;
  });
  return snap;
}

function restoreDynamicSnapshot(snap) {
  if (!snap) return;
  dynamicRangeIds.forEach(id => {
    if (snap[id] != null) controls[id].value = snap[id];
  });
}

const valueEls = {};
[
  "L","l1left","lmid","l2right","m","k1left","kmid","k2right","Ain","Aout","phiIn","phiOut"
].forEach(id => valueEls[id] = document.getElementById(id + "Val"));

const statusText = document.getElementById("statusText");
const toggleBtn = document.getElementById("toggleBtn");
const resetBtn = document.getElementById("resetBtn");

const springPresetEqual = document.getElementById("springPresetEqual");
const springPresetK1EqK2 = document.getElementById("springPresetK1EqK2");
const springPresetK1EqK = document.getElementById("springPresetK1EqK");
const springPresetK2EqK = document.getElementById("springPresetK2EqK");
const springPresetCustom = document.getElementById("springPresetCustom");
const modePresetIn = document.getElementById("modePresetIn");
const modePresetOut = document.getElementById("modePresetOut");
const modePresetHalfHalf = document.getElementById("modePresetHalfHalf");
const modePresetCustom = document.getElementById("modePresetCustom");
const cmPanelTitle = document.getElementById("cmPanelTitle");

const animationCanvas = document.getElementById("animationCanvas");
const timeCanvas = document.getElementById("timeCanvas");
const freqCanvas = document.getElementById("freqCanvas");
const ratioCanvas = document.getElementById("ratioCanvas");
const cmCanvas = document.getElementById("cmCanvas");
const phaseCanvas = document.getElementById("phaseCanvas");

const actx = animationCanvas.getContext("2d");
const tctx = timeCanvas.getContext("2d");
const fctx = freqCanvas.getContext("2d");
const rctx = ratioCanvas.getContext("2d");
const cmctx = cmCanvas.getContext("2d");
const phctx = phaseCanvas ? phaseCanvas.getContext("2d") : null;

let running = false;
let simTime = 0;
let lastTimestamp = null;
let history = [];
const historyWindow = 8.0;
const playbackSpeed = 1.0;

function num(id) { return parseFloat(controls[id].value); }

function fmt(id, v) {
  if (["L","l1left","lmid","l2right","Ain","Aout"].includes(id)) return v.toFixed(2) + " m";
  if (id === "m") return v.toFixed(2) + " kg";
  if (["k1left","kmid","k2right"].includes(id)) return v.toFixed(2) + " N/m";
  if (["phiIn","phiOut"].includes(id)) return v.toFixed(2) + " rad";
  return String(v);
}

function updateValueLabels() {
  Object.keys(valueEls).forEach(id => valueEls[id].textContent = fmt(id, num(id)));
}

function normalize(v) {
  const n = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / n, v[1] / n];
}

function computeState(kMidOverride = null) {
  const L = num("L");
  const l1 = num("l1left");
  const l = num("lmid");
  const l2 = num("l2right");
  const m = num("m");
  const k1 = num("k1left");
  const k = kMidOverride == null ? num("kmid") : kMidOverride;
  const k2 = num("k2right");
  const Ain = num("Ain");
  const Aout = num("Aout");
  const phiIn = num("phiIn");
  const phiOut = num("phiOut");

  const detEq = (k1 + k) * (k + k2) - k * k;
  const b1 = k1 * l1 - k * l;
  const b2 = k * l + k2 * (L - l2);
  const x1eq = (b1 * (k + k2) + k * b2) / detEq;
  const x2eq = ((k1 + k) * b2 + k * b1) / detEq;

  const a = (k1 + k) / m;
  const d = (k + k2) / m;
  const b = -k / m;
  const tr = a + d;
  const disc = Math.sqrt(Math.max(0, (a - d) * (a - d) + 4 * b * b));
  let lam1 = 0.5 * (tr - disc);
  let lam2 = 0.5 * (tr + disc);
  lam1 = Math.max(0, lam1);
  lam2 = Math.max(0, lam2);

  const omega1 = Math.sqrt(lam1);
  const omega2 = Math.sqrt(lam2);

  function eigenvector(lambda) {
    let v;
    if (Math.abs(b) > 1e-12) {
      v = [1, (a - lambda) / (-b)];
    } else {
      v = Math.abs(a - lambda) < Math.abs(d - lambda) ? [1, 0] : [0, 1];
    }
    return normalize(v);
  }

  let v1 = eigenvector(lam1);
  let v2 = eigenvector(lam2);

  if (v1[0] < 0) v1 = [-v1[0], -v1[1]];
  if (v2[0] < 0) v2 = [-v2[0], -v2[1]];

  // Slight deterministic separation when curves are mathematically identical,
  // so all four remain visible and dashed styles can be seen.
  const eps = 0.8;
  const blueSolid = v1[0] + eps;
  const blueDashed = v1[1] - eps;
  const redSolid = v2[0] + eps;
  const redDashed = v2[1] - eps;

  const radius = 0.22;
  const minGap = 2 * radius + 0.10;

  const disp1Bound = Math.abs(Ain * v1[0]) + Math.abs(Aout * v2[0]);
  const disp2Bound = Math.abs(Ain * v1[1]) + Math.abs(Aout * v2[1]);
  const diffBound = Math.abs(Ain * (v1[1] - v1[0])) + Math.abs(Aout * (v2[1] - v2[0]));

  const margins = [x1eq - radius, L - radius - x2eq, (x2eq - x1eq) - minGap];
  const scales = [1];
  if (disp1Bound > 1e-12) scales.push(margins[0] / disp1Bound);
  if (disp2Bound > 1e-12) scales.push(margins[1] / disp2Bound);
  if (diffBound > 1e-12) scales.push(margins[2] / diffBound);

  let safetyScale = Math.min(...scales);
  if (!Number.isFinite(safetyScale)) safetyScale = 1;
  safetyScale = Math.max(0, Math.min(1, 0.94 * safetyScale));

  return {
    L, l1, l, l2, m, k1, k, k2, Ain, Aout, phiIn, phiOut,
    x1eq, x2eq, xcmEq: 0.5 * (x1eq + x2eq), relEq: (x2eq - x1eq), omega1, omega2, v1, v2,
    blueSolid, blueDashed, redSolid, redDashed,
    safetyScale,
    stableGeometry: (x1eq > radius) && (x2eq < L - radius) && (x2eq - x1eq > minGap)
  };
}

function positionsAtTime(t, s) {
  const A1 = s.Ain;
  const A2 = s.Aout;

  const theta1 = s.omega1 * t + s.phiIn;
  const theta2 = s.omega2 * t + s.phiOut;

  const c1 = A1 * Math.cos(theta1);
  const c2 = A2 * Math.cos(theta2);
  const dc1 = -A1 * s.omega1 * Math.sin(theta1);
  const dc2 = -A2 * s.omega2 * Math.sin(theta2);

  const u1 = c1 * s.v1[0] + c2 * s.v2[0];
  const u2 = c1 * s.v1[1] + c2 * s.v2[1];
  const v1 = dc1 * s.v1[0] + dc2 * s.v2[0];
  const v2 = dc1 * s.v1[1] + dc2 * s.v2[1];

  const x1 = s.x1eq + u1;
  const x2 = s.x2eq + u2;
  const xcm = 0.5 * (x1 + x2);
  const rel = x2 - x1;

  const cmPart1 = 0.5 * c1 * (s.v1[0] + s.v1[1]);
  const cmPart2 = 0.5 * c2 * (s.v2[0] + s.v2[1]);
  const relPart1 = c1 * (s.v1[1] - s.v1[0]);
  const relPart2 = c2 * (s.v2[1] - s.v2[0]);

  const mode1InLike = s.v1[0] * s.v1[1] >= 0;
  const inPhaseLike = s.xcmEq + (mode1InLike ? cmPart1 : cmPart2);
  const outOfPhaseLike = s.relEq + (mode1InLike ? relPart2 : relPart1);

  return { x1, x2, v1, v2, xcm, rel, inPhaseLike, outOfPhaseLike };
}

function clearCanvas(ctx, canvas) { ctx.clearRect(0, 0, canvas.width, canvas.height); }

function drawLine(ctx, x1, y1, x2, y2, color, width = 1, dashed = false) {
  ctx.beginPath();
  ctx.setLineDash(dashed ? [10, 7] : []);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.setLineDash([]);
}


function drawSeries(ctx, data, xFn, yFn, color, width = 2, dashed = false) {
  if (!data || data.length < 2) return;
  ctx.beginPath();
  ctx.setLineDash(dashed ? [10, 7] : []);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.moveTo(xFn(data[0]), yFn(data[0]));
  for (let i = 1; i < data.length; i++) {
    ctx.lineTo(xFn(data[i]), yFn(data[i]));
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawText(ctx, txt, x, y, color = TEXT, align = "left") {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(txt, x, y);
}

function drawLegendUniform(ctx, canvas, items, yStart = 26, options = {}) {
  const maxPerRow = options.maxPerRow || 2;
  const left = options.left || 40;
  const right = options.right || (canvas.width - 40);
  const lineLen = options.lineLen || 34;
  const textOffset = options.textOffset || 10;
  const rowGap = options.rowGap || (BASE_FONT + 18);

  const rows = [];
  for (let i = 0; i < items.length; i += maxPerRow) {
    rows.push(items.slice(i, i + maxPerRow));
  }

  rows.forEach((row, rowIndex) => {
    const slot = (right - left) / row.length;
    const y = yStart + rowIndex * rowGap;
    row.forEach((item, i) => {
      const cx = left + (i + 0.5) * slot;
      const x0 = cx - (lineLen / 2) - 16;
      const x1 = x0 + lineLen;
      drawLine(ctx, x0, y, x1, y, item.color, item.width || 2.5, !!item.dashed);
      drawText(ctx, item.label, x1 + textOffset, y + 5, item.color, "left");
    });
  });
}

function drawTextUniform(ctx, canvas, items, y, options = {}) {
  const left = options.left || 36;
  const right = options.right || (canvas.width - 36);
  const align = options.align || "center";
  const slot = (right - left) / items.length;

  items.forEach((item, i) => {
    const x = left + (i + 0.5) * slot;
    drawText(ctx, item.label, x, y, item.color, align);
  });
}


function drawAxes(ctx, canvas, xmin, xmax, ymin, ymax, xlabel, ylabel) {
  const padL = 132, padR = 32, padT = 54, padB = 68;
  const innerPadX = 10, innerPadY = 8;

  clearCanvas(ctx, canvas);
  ctx.font = `${BASE_FONT}px sans-serif`;
  ctx.textBaseline = "middle";

  const plotLeft = padL + innerPadX;
  const plotRight = canvas.width - padR - innerPadX;
  const plotTop = padT + innerPadY;
  const plotBottom = canvas.height - padB - innerPadY;
  const W = Math.max(1, plotRight - plotLeft);
  const H = Math.max(1, plotBottom - plotTop);

  for (let i = 0; i <= 4; i++) {
    const y = plotTop + H * i / 4;
    drawLine(ctx, plotLeft, y, plotRight, y, "rgba(0,0,0,0.08)", 1);
  }
  for (let i = 0; i <= 5; i++) {
    const x = plotLeft + W * i / 5;
    drawLine(ctx, x, plotTop, x, plotBottom, "rgba(0,0,0,0.08)", 1);
  }

  drawLine(ctx, plotLeft, plotBottom, plotRight, plotBottom, AXIS, 1.4);
  drawLine(ctx, plotLeft, plotTop, plotLeft, plotBottom, AXIS, 1.4);

  const fmt = v => {
    const a = Math.abs(v);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  };

  for (let i = 0; i <= 5; i++) {
    const x = plotLeft + W * i / 5;
    const val = xmin + (xmax - xmin) * i / 5;
    drawText(ctx, fmt(val), x, plotBottom + 24, AXIS, "center");
  }

  for (let i = 0; i <= 4; i++) {
    const y = plotTop + H * i / 4;
    const val = ymax - (ymax - ymin) * i / 4;
    drawText(ctx, fmt(val), plotLeft - 16, y, AXIS, "right");
  }

  drawText(ctx, xlabel, plotLeft + W / 2, canvas.height - 18, TEXT, "center");

  ctx.save();
  ctx.translate(28, plotTop + H / 2);
  ctx.rotate(-Math.PI / 2);
  drawText(ctx, ylabel, 0, 0, TEXT, "center");
  ctx.restore();

  return {
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    mapX: x => plotLeft + (x - xmin) / (xmax - xmin) * W,
    mapY: y => plotBottom - (y - ymin) / (ymax - ymin) * H
  };
}


function drawSpring(ctx, xA, xB, y, coils, amp, color) {
  ctx.beginPath();
  ctx.moveTo(xA, y);
  const len = xB - xA;
  for (let i = 1; i <= coils; i++) {
    const x = xA + len * i / (coils + 1);
    const yy = y + (i % 2 === 0 ? -amp : amp);
    ctx.lineTo(x, yy);
  }
  ctx.lineTo(xB, y);
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
}


function drawAnimation(s, pos, regime) {
  clearCanvas(actx, animationCanvas);
  actx.font = `${ANIM_FONT}px sans-serif`;

  const w = animationCanvas.width, h = animationCanvas.height;

  // Shared horizontal scale for BOTH the spring animation and phase x-axis
  const left = 126, right = w - 42;
  const physToPx = x => left + x / s.L * (right - left);

  // ===== TOP: SPRINGS ANIMATION =====
  const animTop = 52;
  const animBottom = 220;
  const ySpring = 136;

  actx.fillStyle = "#d1d5db";
  actx.fillRect(left - 10, animTop + 4, 10, animBottom - animTop - 12);
  actx.fillRect(right, animTop + 4, 10, animBottom - animTop - 12);
  drawLine(actx, left, ySpring, right, ySpring, "#e5e7eb", 1);

  const x1 = physToPx(pos.x1), x2 = physToPx(pos.x2);
  const x1eq = physToPx(s.x1eq), x2eq = physToPx(s.x2eq);

  drawSpring(actx, left, x1 - 18, ySpring, 10, 12, "#111111");
  drawSpring(actx, x1 + 18, x2 - 18, ySpring, 10, 12, "#111111");
  drawSpring(actx, x2 + 18, right, ySpring, 10, 12, "#111111");

  drawLine(actx, x1eq, 72, x1eq, 188, "#cbd5e1", 1);
  drawLine(actx, x2eq, 72, x2eq, 188, "#cbd5e1", 1);

  const mass1Color = regime.motionColor || regime.x1Color;
  const mass2Color = regime.motionColor || regime.x2Color;

  actx.fillStyle = mass1Color;
  actx.beginPath(); actx.arc(x1, ySpring, 18, 0, 2 * Math.PI); actx.fill();
  actx.fillStyle = mass2Color;
  actx.beginPath(); actx.arc(x2, ySpring, 18, 0, 2 * Math.PI); actx.fill();

  drawText(actx, "m", x1, ySpring + 4, "white", "center");
  drawText(actx, "m", x2, ySpring + 4, "white", "center");
  drawText(actx, "x₁", x1, ySpring - 28, regime.x1Color, "center");
  drawText(actx, "x₂", x2, ySpring - 28, regime.x2Color, "center");

  // ===== BOTTOM: PHASE DIAGRAM =====
  // x-axis is aligned and in the SAME SCALE as the spring axis above.
  const phaseTop = 343;
  const phaseBottom = 517;

  const yData = history.length >= 2 ? history.filter(p => p.t >= Math.max(0, simTime - historyWindow)) : [];
  let yMin = Infinity, yMax = -Infinity;
  for (const p of yData) {
    yMin = Math.min(yMin, p.v1, p.v2);
    yMax = Math.max(yMax, p.v1, p.v2);
  }
  if (!Number.isFinite(yMin)) {
    yMin = Math.min(pos.v1, pos.v2) - 1;
    yMax = Math.max(pos.v1, pos.v2) + 1;
  }
  const yPad = Math.max(0.05, 0.12 * (yMax - yMin || 1));
  yMin -= yPad;
  yMax += yPad;

  const mapX = x => physToPx(x);
  const mapY = v => phaseBottom - (v - yMin) / (yMax - yMin) * (phaseBottom - phaseTop);

  // grid
  for (let i = 0; i <= 5; i++) {
    const gx = left + (right - left) * i / 5;
    drawLine(actx, gx, phaseTop, gx, phaseBottom, GRID, 1);
    const val = s.L * i / 5;
    drawText(actx, val.toFixed(2), gx, phaseBottom + 24, AXIS, "center");
  }
  for (let i = 0; i <= 4; i++) {
    const gy = phaseTop + (phaseBottom - phaseTop) * i / 4;
    drawLine(actx, left, gy, right, gy, GRID, 1);
    const val = yMax - (yMax - yMin) * i / 4;
    drawText(actx, val.toFixed(2), left - 18, gy + BASE_FONT * 0.12, AXIS, "right");
  }

  drawLine(actx, left, phaseBottom, right, phaseBottom, AXIS, 1.2);
  drawLine(actx, left, phaseTop, left, phaseBottom, AXIS, 1.2);

  drawText(actx, "x (m)", (left + right) / 2, h - 22, TEXT, "center");
  actx.save();
  actx.translate(30, (phaseTop + phaseBottom) / 2);
  actx.rotate(-Math.PI / 2);
  drawText(actx, "v (m/s)", 0, 0, TEXT, "center");
  actx.restore();

  for (let i = 1; i < yData.length; i++) {
    drawLine(actx, mapX(yData[i - 1].x1), mapY(yData[i - 1].v1), mapX(yData[i].x1), mapY(yData[i].v1), regime.motionColor || regime.x1Color, 2);
    drawLine(actx, mapX(yData[i - 1].x2), mapY(yData[i - 1].v2), mapX(yData[i].x2), mapY(yData[i].v2), regime.motionColor || regime.x2Color, 2);
  }

  const d1x = mapX(pos.x1), d1y = mapY(pos.v1);
  const d2x = mapX(pos.x2), d2y = mapY(pos.v2);

  // vertical guide/projection lines: same x coordinate in both panels
  const guide1Color = regime.motionColor ? (regime.inPhaseSelected ? "rgba(220,38,38,0.45)" : "rgba(37,99,235,0.45)") : "rgba(17,17,17,0.35)";
  const guide2Color = regime.motionColor ? (regime.inPhaseSelected ? "rgba(220,38,38,0.45)" : "rgba(37,99,235,0.45)") : "rgba(107,114,128,0.35)";

  drawLine(actx, x1, ySpring + 18, d1x, d1y, guide1Color, 2);
  drawLine(actx, x2, ySpring + 18, d2x, d2y, guide2Color, 2);

  actx.fillStyle = regime.motionColor || regime.x1Color;
  actx.beginPath(); actx.arc(d1x, d1y, 7, 0, 2 * Math.PI); actx.fill();
  actx.fillStyle = regime.motionColor || regime.x2Color;
  actx.beginPath(); actx.arc(d2x, d2y, 7, 0, 2 * Math.PI); actx.fill();

}


function isBlackLike(color) {
  if (!color) return false;
  const c = String(color).toLowerCase().replace(/\s+/g, "");
  return c === "black" || c === "#000" || c === "#000000" || c === "#111" || c === "#111111" || c === "rgb(0,0,0)" || c === "rgb(17,17,17)";
}

function drawTimePlot(regime) {
  if (history.length < 2) return;
  const latestT = history[history.length - 1].t;
  const earliestT = Math.max(0, latestT - historyWindow);
  const data = history.filter(p => p.t >= earliestT);

  let yMin = Infinity, yMax = -Infinity;
  for (const p of data) { yMin = Math.min(yMin, p.x1, p.x2); yMax = Math.max(yMax, p.x1, p.x2); }
  const pad = Math.max(0.05, 0.12 * (yMax - yMin || 1));
  yMin -= pad; yMax += pad;

  const axes = drawAxes(tctx, timeCanvas, earliestT, latestT || 1, yMin, yMax, "t (s)", "x (m)");
  const timeBothBlack = isBlackLike(regime.x1Color) && isBlackLike(regime.x2Color);
  drawSeries(tctx, data, p => axes.mapX(p.t), p => axes.mapY(p.x1), regime.x1Color, 2, false);
  drawSeries(tctx, data, p => axes.mapX(p.t), p => axes.mapY(p.x2), regime.x2Color, 2, timeBothBlack);
  drawLegendUniform(tctx, timeCanvas, [
    { label: "x₁(t)", color: regime.x1Color, dashed: false, width: 2.2 },
    { label: "x₂(t)", color: regime.x2Color, dashed: timeBothBlack, width: 2.2 }
  ], 28);
}



function updateCMTitle(regime) {
  if (!cmPanelTitle) return;
  if (!cmPanelTitle.dataset.ready) {
    cmPanelTitle.innerHTML =
      '<span class="cm-title-layer cm-title-old">Težišče in relativna koordinata v času</span>' +
      '<span class="cm-title-layer cm-title-new">Sofazni in protifazni del v času</span>';
    cmPanelTitle.dataset.ready = "1";
  }
  const oldLayer = cmPanelTitle.querySelector(".cm-title-old");
  const newLayer = cmPanelTitle.querySelector(".cm-title-new");
  if (!oldLayer || !newLayer) return;
  oldLayer.style.opacity = String(1 - regime.cmMorph);
  newLayer.style.opacity = String(regime.cmMorph);
}

function drawMorphLegendUniform(ctx, canvas, items, alpha, yStart = 26, options = {}) {
  const maxPerRow = options.maxPerRow || 2;
  const left = options.left || 40;
  const right = options.right || (canvas.width - 40);
  const lineLen = options.lineLen || 34;
  const textOffset = options.textOffset || 10;
  const rowGap = options.rowGap || (BASE_FONT + 18);

  const rows = [];
  for (let i = 0; i < items.length; i += maxPerRow) {
    rows.push(items.slice(i, i + maxPerRow));
  }

  rows.forEach((row, rowIndex) => {
    const slot = (right - left) / row.length;
    const y = yStart + rowIndex * rowGap;
    row.forEach((item, i) => {
      const cx = left + (i + 0.5) * slot;
      const x0 = cx - (lineLen / 2) - 16;
      const x1 = x0 + lineLen;
      drawLine(ctx, x0, y, x1, y, item.color, item.width || 2.5, !!item.dashed);
      drawText(ctx, item.oldLabel, x1 + textOffset, y + 5, colorWithAlpha(item.color, 1 - alpha), "left");
      drawText(ctx, item.newLabel, x1 + textOffset, y + 5, colorWithAlpha(item.color, alpha), "left");
    });
  });
}

function drawCMPlot(regime) {
  if (history.length < 2) return;
  const latestT = history[history.length - 1].t;
  const earliestT = Math.max(0, latestT - historyWindow);
  const data = history.filter(p => p.t >= earliestT);

  const alpha = regime.cmMorph;
  const plotData = data.map(p => ({
    t: p.t,
    y1: (1 - alpha) * p.xcm + alpha * p.inPhaseLike,
    y2: (1 - alpha) * p.rel + alpha * p.outOfPhaseLike
  }));

  let yMin = Infinity, yMax = -Infinity;
  for (const p of plotData) {
    yMin = Math.min(yMin, p.y1, p.y2);
    yMax = Math.max(yMax, p.y1, p.y2);
  }
  const pad = Math.max(0.05, 0.12 * (yMax - yMin || 1));
  yMin -= pad;
  yMax += pad;

  updateCMTitle(regime);

  const axes = drawAxes(cmctx, cmCanvas, earliestT, latestT || 1, yMin, yMax, "t (s)", "x (m)");
  drawSeries(cmctx, plotData, p => axes.mapX(p.t), p => axes.mapY(p.y1), RED, 2.6, false);
  drawSeries(cmctx, plotData, p => axes.mapX(p.t), p => axes.mapY(p.y2), BLUE, 2.6, false);

  drawMorphLegendUniform(cmctx, cmCanvas, [
    { oldLabel: "R_cm(t)", newLabel: "s_in(t)", color: RED, dashed: false, width: 2.2 },
    { oldLabel: "r(t)", newLabel: "s_out(t)", color: BLUE, dashed: false, width: 2.2 }
  ], alpha, 28);
}

function drawPhasePlot(regime) {
  if (!phaseCanvas || !phctx || history.length < 2) return;
  const data = history.filter(p => p.t >= Math.max(0, simTime - historyWindow));

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of data) {
    xMin = Math.min(xMin, p.x1, p.x2);
    xMax = Math.max(xMax, p.x1, p.x2);
    yMin = Math.min(yMin, p.v1, p.v2);
    yMax = Math.max(yMax, p.v1, p.v2);
  }
  const xPad = Math.max(0.05, 0.12 * (xMax - xMin || 1));
  const yPad = Math.max(0.05, 0.12 * (yMax - yMin || 1));
  xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;

  const axes = drawAxes(phctx, phaseCanvas, xMin, xMax, yMin, yMax, "x (m)", "v (m/s)");
  for (let i = 1; i < data.length; i++) {
    drawLine(phctx, axes.mapX(data[i - 1].x1), axes.mapY(data[i - 1].v1), axes.mapX(data[i].x1), axes.mapY(data[i].v1), regime.motionColor || regime.x1Color, 2);
    drawLine(phctx, axes.mapX(data[i - 1].x2), axes.mapY(data[i - 1].v2), axes.mapX(data[i].x2), axes.mapY(data[i].v2), regime.motionColor || regime.x2Color, 2);
  }
  drawLegendUniform(phctx, phaseCanvas, [
    { label: "(x₁, v₁)", color: regime.motionColor || regime.x1Color, dashed: false, width: 2.2 },
    { label: "(x₂, v₂)", color: regime.motionColor || regime.x2Color, dashed: false, width: 2.2 }
  ], 28);
}

function drawFrequencyPlot(regime) {
  const kMin = parseFloat(controls.kmid.min), kMax = parseFloat(controls.kmid.max), samples = 396;
  const pts1 = [], pts2 = [];
  let yMax = 0;
  for (let i = 0; i < samples; i++) {
    const kv = kMin + (kMax - kMin) * i / (samples - 1);
    const s = computeState(kv);
    pts1.push([kv, s.omega1]); pts2.push([kv, s.omega2]);
    yMax = Math.max(yMax, s.omega1, s.omega2);
  }
  const axes = drawAxes(fctx, freqCanvas, kMin, kMax, 0, yMax * 1.08 || 1, " k (N/m)", "ω (rad/s)");
  for (let i = 1; i < pts1.length; i++) {
    drawLine(fctx, axes.mapX(pts1[i - 1][0]), axes.mapY(pts1[i - 1][1]), axes.mapX(pts1[i][0]), axes.mapY(pts1[i][1]), BLUE, 2.2);
    drawLine(fctx, axes.mapX(pts2[i - 1][0]), axes.mapY(pts2[i - 1][1]), axes.mapX(pts2[i][0]), axes.mapY(pts2[i][1]), RED, 2.2);
  }
  const current = computeState(), currentK = num("kmid");
  fctx.fillStyle = BLUE; fctx.beginPath(); fctx.arc(axes.mapX(currentK), axes.mapY(current.omega1), 4, 0, 2*Math.PI); fctx.fill();
  fctx.fillStyle = RED; fctx.beginPath(); fctx.arc(axes.mapX(currentK), axes.mapY(current.omega2), 4, 0, 2*Math.PI); fctx.fill();
  drawLegendUniform(fctx, freqCanvas, [
    { label: `ω₁ = ${current.omega1.toFixed(3)} rad/s`, color: BLUE, dashed: false, width: 2.4 },
    { label: `ω₂ = ${current.omega2.toFixed(3)} rad/s`, color: RED, dashed: false, width: 2.4 }
  ], 22, { left: -28 });
}


function drawRatioPlot() {
  const kMin = parseFloat(controls.kmid.min), kMax = parseFloat(controls.kmid.max), samples = 936;
  const Ain = num("Ain");
  const Aout = num("Aout");

  const blueSolid = [], blueDashed = [], redSolid = [], redDashed = [];
  let ymax = 0;

  for (let i = 0; i < samples; i++) {
    const kv = kMin + (kMax - kMin) * i / (samples - 1);
    const s = computeState(kv);

    // Physical amplitude components:
    // lower-frequency / "f" mode scales with Ain
    // upper-frequency / "p" mode scales with Aout
    const yBlueSolid = Ain * s.v1[0];
    const yBlueDashed = Ain * s.v1[1];
    const yRedSolid = Aout * s.v2[0];
    const yRedDashed = Aout * s.v2[1];

    blueSolid.push([kv, yBlueSolid]);
    blueDashed.push([kv, yBlueDashed]);
    redSolid.push([kv, yRedSolid]);
    redDashed.push([kv, yRedDashed]);

    ymax = Math.max(
      ymax,
      Math.abs(yBlueSolid), Math.abs(yBlueDashed),
      Math.abs(yRedSolid), Math.abs(yRedDashed)
    );
  }

  if (ymax < 1e-6) ymax = 1;
  ymax *= 1.18;

  const axes = drawAxes(
    rctx,
    ratioCanvas,
    kMin,
    kMax,
    -ymax,
    ymax,
    " k (N/m)",
    " (m)"
  );

  function plotSeries(pts, color, dashed, width) {
    for (let i = 1; i < pts.length; i++) {
      drawLine(
        rctx,
        axes.mapX(pts[i - 1][0]),
        axes.mapY(pts[i - 1][1]),
        axes.mapX(pts[i][0]),
        axes.mapY(pts[i][1]),
        color,
        width,
        dashed
      );
    }
  }

  plotSeries(redSolid, RED, false, 3.0);
  plotSeries(redDashed, RED, true, 3.0);
  plotSeries(blueSolid, BLUE, false, 3.0);
  plotSeries(blueDashed, BLUE, true, 3.0);

  const currentK = num("kmid");
  const s = computeState();

  const marks = [
    [Aout * s.v2[0], RED],
    [Aout * s.v2[1], RED],
    [Ain * s.v1[0], BLUE],
    [Ain * s.v1[1], BLUE]
  ];
  marks.forEach(([y, c]) => {
    rctx.fillStyle = c;
    rctx.beginPath();
    rctx.arc(axes.mapX(currentK), axes.mapY(y), 4.2, 0, 2 * Math.PI);
    rctx.fill();
  });

    drawLegendUniform(rctx, ratioCanvas, [
    { label: "s1p", color: RED, dashed: false, width: 3.0 },
    { label: "s2p", color: RED, dashed: true, width: 3.0 },
    { label: "s1f", color: BLUE, dashed: false, width: 3.0 },
    { label: "s2f", color: BLUE, dashed: true, width: 3.0 }
  ], 28, { maxPerRow: 4, left: 10, right: ratioCanvas.width - 10, lineLen: 22, textOffset: 6 });
}



let selectedSpringPreset = "equal";

function applySpringPresetButtonState() {
  springPresetEqual.classList.toggle("active", selectedSpringPreset === "equal");
  springPresetK1EqK2.classList.toggle("active", selectedSpringPreset === "k1eqk2");
  springPresetK1EqK.classList.toggle("active", selectedSpringPreset === "k1eqk");
  springPresetK2EqK.classList.toggle("active", selectedSpringPreset === "k2eqk");
  springPresetCustom.classList.toggle("active", selectedSpringPreset === "custom");
}

function updatePresetStates() {
  applySpringPresetButtonState();

  const onlyIn = num("Ain") > 1e-9 && Math.abs(num("Aout")) < 1e-9;
  const onlyOut = num("Aout") > 1e-9 && Math.abs(num("Ain")) < 1e-9;
  const halfHalf =
    num("Ain") > 1e-9 &&
    num("Aout") > 1e-9 &&
    Math.abs(num("Ain") - num("Aout")) < 1e-9 &&
    Math.abs(num("phiIn")) < 1e-9 &&
    Math.abs(num("phiOut")) < 1e-9;

  modePresetIn.classList.toggle("active", onlyIn);
  modePresetOut.classList.toggle("active", onlyOut);
  modePresetHalfHalf.classList.toggle("active", halfHalf);
  modePresetCustom.classList.toggle("active", !(onlyIn || onlyOut || halfHalf));
}


function getRegimeState() {
  const equalSprings =
    Math.abs(num("k1left") - num("kmid")) < 1e-9 &&
    Math.abs(num("k2right") - num("kmid")) < 1e-9;
  const inPhaseSelected = num("Ain") > 1e-9 && Math.abs(num("Aout")) < 1e-9;
  const outOfPhaseSelected = num("Aout") > 1e-9 && Math.abs(num("Ain")) < 1e-9;

  const motionColor = inPhaseSelected ? RED : (outOfPhaseSelected ? BLUE : null);

  const kRef = Math.max(1, Math.abs(num("k1left")), Math.abs(num("kmid")), Math.abs(num("k2right")));
  const asym = Math.max(
    Math.abs(num("k1left") - num("kmid")),
    Math.abs(num("k2right") - num("kmid"))
  ) / kRef;
  const cmMorph = smoothstep(0.008, 0.12, asym);

  return {
    equalSprings,
    inPhaseSelected,
    outOfPhaseSelected,
    motionColor,
    cmMorph,
    x1Color: "#111111",
    x2Color: "#111111",
    cmColor: RED,
    relColor: BLUE
  };
}


function setSliderValueExact(id, value) {
  const el = controls[id];
  const step = baseSliderRanges[id]?.step || parseFloat(el.step) || 0.01;
  const decimals = (String(step).split(".")[1] || "").length;
  el.value = Number(value).toFixed(decimals);
}

function isCurrentConfigurationSafe() {
  if (disableCollisionsCheckbox && !disableCollisionsCheckbox.checked) return true;
  const s = computeState();
  const radius = 0.22;
  const minGap = 2 * radius + 0.10;
  const disp1Bound = Math.abs(s.Ain * s.v1[0]) + Math.abs(s.Aout * s.v2[0]);
  const disp2Bound = Math.abs(s.Ain * s.v1[1]) + Math.abs(s.Aout * s.v2[1]);
  const diffBound = Math.abs(s.Ain * (s.v1[1] - s.v1[0])) + Math.abs(s.Aout * (s.v2[1] - s.v2[0]));
  return s.stableGeometry
    && (s.x1eq - disp1Bound >= radius - 1e-9)
    && (s.x2eq + disp2Bound <= s.L - radius + 1e-9)
    && ((s.x2eq - s.x1eq) - diffBound >= minGap - 1e-9);
}

function findSafeSegmentsForControl(id) {
  const el = controls[id];
  const base = baseSliderRanges[id];
  const originalValue = parseFloat(el.value);
  const step = base.step;

  const safeValues = [];
  for (let raw = base.min; raw <= base.max + 0.5 * step; raw += step) {
    const candidate = Math.max(base.min, Math.min(base.max, Number(raw.toFixed(10))));
    setSliderValueExact(id, candidate);
    if (isCurrentConfigurationSafe()) {
      safeValues.push(candidate);
    }
  }

  setSliderValueExact(id, originalValue);

  if (!safeValues.length) return [];

  const segments = [];
  let segStart = safeValues[0];
  let prev = safeValues[0];

  for (let i = 1; i < safeValues.length; i++) {
    const v = safeValues[i];
    if (v - prev > 1.5 * step) {
      segments.push({ min: segStart, max: prev });
      segStart = v;
    }
    prev = v;
  }
  segments.push({ min: segStart, max: prev });
  return segments;
}

function clampToSegment(value, seg) {
  if (!seg) return value;
  return Math.max(seg.min, Math.min(seg.max, value));
}

function chooseBestSafeSegment(segments, currentValue) {
  if (!segments.length) return null;
  for (const seg of segments) {
    if (currentValue >= seg.min - 1e-12 && currentValue <= seg.max + 1e-12) {
      return seg;
    }
  }
  let best = segments[0];
  let bestDist = Math.min(Math.abs(currentValue - best.min), Math.abs(currentValue - best.max));
  for (const seg of segments.slice(1)) {
    const dist = Math.min(Math.abs(currentValue - seg.min), Math.abs(currentValue - seg.max));
    if (dist < bestDist) {
      best = seg;
      bestDist = dist;
    }
  }
  return best;
}

function updateDynamicSliderRanges(skipId = null) {
  if (disableCollisionsCheckbox && !disableCollisionsCheckbox.checked) return;
  // Iterate a few times so clamping one slider can tighten the safe segments of the others.
  for (let pass = 0; pass < 3; pass++) {
    for (const id of dynamicRangeIds) {
      if (skipId && id === skipId) continue;
      const el = controls[id];
      const currentValue = parseFloat(el.value);
      const segments = findSafeSegmentsForControl(id);
      const base = baseSliderRanges[id];
      const chosen = chooseBestSafeSegment(segments, currentValue);

      if (!chosen) {
        const safeValue = (lastSafeSnapshot && lastSafeSnapshot[id] != null)
          ? parseFloat(lastSafeSnapshot[id])
          : currentValue;
        el.min = String(safeValue);
        el.max = String(safeValue);
        setSliderValueExact(id, safeValue);
        continue;
      }

      el.min = String(chosen.min);
      el.max = String(chosen.max);

      const clamped = clampToSegment(currentValue, chosen);
      if (Math.abs(clamped - currentValue) > 1e-12) {
        setSliderValueExact(id, clamped);
      }

      // Guard against interior unsafe holes by snapping to the nearest safe edge if needed.
      if (!isCurrentConfigurationSafe()) {
        const leftCandidate = chosen.min;
        const rightCandidate = chosen.max;
        setSliderValueExact(id, leftCandidate);
        const leftSafe = isCurrentConfigurationSafe();
        setSliderValueExact(id, rightCandidate);
        const rightSafe = isCurrentConfigurationSafe();

        let repaired = currentValue;
        if (leftSafe && rightSafe) {
          repaired = Math.abs(currentValue - leftCandidate) <= Math.abs(currentValue - rightCandidate)
            ? leftCandidate : rightCandidate;
        } else if (leftSafe) {
          repaired = leftCandidate;
        } else if (rightSafe) {
          repaired = rightCandidate;
        } else {
          repaired = (lastSafeSnapshot && lastSafeSnapshot[id] != null)
            ? parseFloat(lastSafeSnapshot[id])
            : chosen.min;
        }
        setSliderValueExact(id, repaired);
      }
    }
  }
}



function applyCollisionSafetyConstraints(skipId = null) {
  if (disableCollisionsCheckbox && !disableCollisionsCheckbox.checked) return;

  updateDynamicSliderRanges(skipId);

  if (!isCurrentConfigurationSafe() && lastSafeSnapshot) {
    restoreDynamicSnapshot(lastSafeSnapshot);
    updateDynamicSliderRanges(skipId);
  } else if (isCurrentConfigurationSafe()) {
    lastSafeSnapshot = captureDynamicSnapshot();
  }
}

function resetToSafeConfiguration() {
  if (lastSafeSnapshot) {
    restoreDynamicSnapshot(lastSafeSnapshot);
  }
  simTime = 0;
}

function handleCollisionToggle() {
  if (!disableCollisionsCheckbox) return;

  activeSafetyDragId = null;
  if (disableCollisionsCheckbox.checked) {
    resetToSafeConfiguration();
    applyCollisionSafetyConstraints();
    running = false;
    toggleBtn.textContent = "Zaženi";
    lastTimestamp = null;
  } else {
    running = true;
    toggleBtn.textContent = "Ustavi";
    lastTimestamp = null;
  }
  applyCollisionSafetyConstraints();
  resetHistory();
  redrawAll();
}

function redrawAll() {
  updateValueLabels();
  updatePresetStates();
  const s = computeState();
  const pos = positionsAtTime(simTime, s);

  if (statusText) statusText.textContent = "";

  const regime = getRegimeState();
  drawAnimation(s, pos, regime);
  drawTimePlot(regime);
  drawCMPlot(regime);
  drawFrequencyPlot(regime);
  drawRatioPlot();
  drawPhasePlot(regime);
}

function resetHistory() {
  history = [];
  const s = computeState();
  for (let i = 0; i < 2; i++) {
    const p = positionsAtTime(simTime, s);
    history.push({ t: simTime + i * 1e-6, x1: p.x1, x2: p.x2, v1: p.v1, v2: p.v2, xcm: p.xcm, rel: p.rel, inPhaseLike: p.inPhaseLike, outOfPhaseLike: p.outOfPhaseLike });
  }
}

function animationFrame(timestamp) {
  if (lastTimestamp == null) lastTimestamp = timestamp;
  let dt = (timestamp - lastTimestamp) / 1800;
  lastTimestamp = timestamp;
  if (dt > 0.05) dt = 0.05;

  if (running) {
    simTime += dt * playbackSpeed;
    const s = computeState();
    const p = positionsAtTime(simTime, s);
    history.push({ t: simTime, x1: p.x1, x2: p.x2, v1: p.v1, v2: p.v2, xcm: p.xcm, rel: p.rel, inPhaseLike: p.inPhaseLike, outOfPhaseLike: p.outOfPhaseLike });
    while (history.length > 3 && history[0].t < simTime - historyWindow - 0.5) history.shift();
  }

  redrawAll();
  requestAnimationFrame(animationFrame);
}

function setSpringPresetEqual() {
  selectedSpringPreset = "equal";
  const kv = num("kmid");
  controls.k1left.value = kv.toFixed(2);
  controls.k2right.value = kv.toFixed(2);
  applyCollisionSafetyConstraints();
  resetHistory();
  redrawAll();
}
function setSpringPresetK1EqK2() {
  selectedSpringPreset = "k1eqk2";
  const sideVal = 0.5 * (num("k1left") + num("k2right"));
  controls.k1left.value = sideVal.toFixed(2);
  controls.k2right.value = sideVal.toFixed(2);
  applyCollisionSafetyConstraints();
  resetHistory();
  redrawAll();
}

function setSpringPresetK1EqK() {
  selectedSpringPreset = "k1eqk";
  controls.k1left.value = num("kmid").toFixed(2);
  applyCollisionSafetyConstraints();
  resetHistory();
  redrawAll();
}

function setSpringPresetK2EqK() {
  selectedSpringPreset = "k2eqk";
  controls.k2right.value = num("kmid").toFixed(2);
  applyCollisionSafetyConstraints();
  resetHistory();
  redrawAll();
}


function setSpringPresetCustom() {
  selectedSpringPreset = "custom";
  const currentMid = num("kmid");
  let k1 = Math.max(parseFloat(controls.k1left.min), currentMid * 0.70);
  let km = currentMid;
  let k2 = Math.min(parseFloat(controls.k2right.max), currentMid * 1.35);

  if (Math.abs(k1 - km) < 0.05) k1 = Math.max(parseFloat(controls.k1left.min), km - 2.0);
  if (Math.abs(k2 - km) < 0.05) k2 = Math.min(parseFloat(controls.k2right.max), km + 2.0);

  controls.k1left.value = k1.toFixed(2);
  controls.kmid.value = km.toFixed(2);
  controls.k2right.value = k2.toFixed(2);
  applyCollisionSafetyConstraints();
  resetHistory();
  redrawAll();
}

function setModePresetOnlyIn() {
  controls.Ain.value = "0.35"; controls.Aout.value = "0.00";
  controls.phiIn.value = "0.00"; controls.phiOut.value = "0.00";
  resetHistory(); redrawAll();
}

function setModePresetOnlyOut() {
  controls.Ain.value = "0.00"; controls.Aout.value = "0.35";
  controls.phiIn.value = "0.00"; controls.phiOut.value = "0.00";
  resetHistory(); redrawAll();
}

function setModePresetHalfHalf() {
  controls.Ain.value = "0.25";
  controls.Aout.value = "0.25";
  controls.phiIn.value = "0.00";
  controls.phiOut.value = "0.00";
  applyCollisionSafetyConstraints();
  resetHistory();
  redrawAll();
}

function setModePresetCustom() {
  controls.Ain.value = "0.28";
  controls.Aout.value = "0.22";
  controls.phiIn.value = "0.00";
  controls.phiOut.value = "1.57";
  applyCollisionSafetyConstraints();
  resetHistory();
  redrawAll();
}

springPresetEqual.addEventListener("click", setSpringPresetEqual);
springPresetK1EqK2.addEventListener("click", setSpringPresetK1EqK2);
springPresetK1EqK.addEventListener("click", setSpringPresetK1EqK);
springPresetK2EqK.addEventListener("click", setSpringPresetK2EqK);
springPresetCustom.addEventListener("click", setSpringPresetCustom);
modePresetIn.addEventListener("click", setModePresetOnlyIn);
modePresetOut.addEventListener("click", setModePresetOnlyOut);
modePresetHalfHalf.addEventListener("click", setModePresetHalfHalf);
modePresetCustom.addEventListener("click", setModePresetCustom);

Object.values(controls).forEach(el => {
  el.addEventListener("input", () => {
    if (selectedSpringPreset === "equal") {
      if (el.id === "k1left") {
        controls.kmid.value = controls.k1left.value;
        controls.k2right.value = controls.k1left.value;
      } else if (el.id === "kmid") {
        controls.k1left.value = controls.kmid.value;
        controls.k2right.value = controls.kmid.value;
      } else if (el.id === "k2right") {
        controls.k1left.value = controls.k2right.value;
        controls.kmid.value = controls.k2right.value;
      }
    } else if (selectedSpringPreset === "k1eqk") {
      if (el.id === "k1left") controls.kmid.value = controls.k1left.value;
      if (el.id === "kmid") controls.k1left.value = controls.kmid.value;
    } else if (selectedSpringPreset === "k2eqk") {
      if (el.id === "k2right") controls.kmid.value = controls.k2right.value;
      if (el.id === "kmid") controls.k2right.value = controls.kmid.value;
    } else if (selectedSpringPreset === "k1eqk2") {
      if (el.id === "k1left") controls.k2right.value = controls.k1left.value;
      if (el.id === "k2right") controls.k1left.value = controls.k2right.value;
    }

    applyCollisionSafetyConstraints();

    resetHistory();
    redrawAll();
  });
});

toggleBtn.addEventListener("click", () => {
  running = !running;
  toggleBtn.textContent = running ? "Ustavi" : "Zaženi";
});

resetBtn.addEventListener("click", () => {
  activeSafetyDragId = null;
  running = false;
  toggleBtn.textContent = "Zaženi";
  simTime = 0;
  lastTimestamp = null;
  applyCollisionSafetyConstraints();
  resetHistory();
  redrawAll();
});

applyCollisionSafetyConstraints();
updateValueLabels();
updatePresetStates();
resetHistory();
redrawAll();
requestAnimationFrame(animationFrame);









/* immediate button visual feedback */
[
  springPresetEqual,
  springPresetK1EqK2,
  springPresetK1EqK,
  springPresetK2EqK,
  springPresetCustom,
  modePresetIn,
  modePresetOut,
  modePresetHalfHalf,
  modePresetCustom,
  toggleBtn,
  resetBtn
].forEach((btn) => {
  if (!btn) return;

  btn.addEventListener("pointerdown", () => {
    btn.classList.add("is-pressing");
  });

  const clearPress = () => btn.classList.remove("is-pressing");
  btn.addEventListener("pointerup", clearPress);
  btn.addEventListener("pointercancel", clearPress);
  btn.addEventListener("lostpointercapture", clearPress);
  btn.addEventListener("mouseleave", clearPress);
  btn.addEventListener("blur", clearPress);
});


/* sync button selected color immediately */
[
  springPresetEqual,
  springPresetK1EqK2,
  springPresetK1EqK,
  springPresetK2EqK,
  springPresetCustom,
  modePresetIn,
  modePresetOut,
  modePresetHalfHalf,
  modePresetCustom
].forEach((btn) => {
  if (!btn) return;
  btn.addEventListener("click", () => {
    requestAnimationFrame(() => {
      btn.classList.remove("is-pressing");
    });
  }, true);
});
