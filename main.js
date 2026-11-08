'use strict';

const canvas = document.getElementById('city');
const ctx = canvas.getContext('2d');
const slider = document.getElementById('curb');
const heightOutput = document.getElementById('height');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const LOOP_MS = 6000;
const DEADLINE_MS = 3500;
const DIRECT_MS = 2400;
const DETOUR_MS = 4900;
const APPROACH_MS = 1290;
const PAUSE_MS = 600;
const result = document.getElementById('result');
const lesson = document.getElementById('lesson');
const initial = new URLSearchParams(location.search).get('curb');
if (initial !== null && initial.trim() !== '' && Number.isFinite(Number(initial))) {
  slider.value = String(Math.max(0, Math.min(12, Math.round(Number(initial)))));
}
const people = [
  { kind: 'wheelchair', destination: 'BAKERY', threshold: 2, x: 340, bypass: 40, color: '#356d8a', roof: '#c9805e' },
  { kind: 'stroller', destination: 'CAFE', threshold: 6, x: 500, bypass: 800, color: '#9e5361', roof: '#cfac59' },
  { kind: 'cart', destination: 'SHOP', threshold: 8, x: 660, bypass: 960, color: '#6a7344', roof: '#809b83' }
];
let curb = Number(slider.value);
let previousCurb = null;
let hasMovedSlider = false;
let sceneScale = 1;
let startedAt = performance.now();
let viewWidth = 1;
let viewHeight = 1;
let announcementTimer = null;
const discoveries = people.map(() => ({ low: false, high: false, found: false }));
const pendingLimits = new Set();

function updateDiscovery() {
  people.forEach((person, i) => {
    const seen = discoveries[i];
    if (curb <= person.threshold) seen.low = true;
    else seen.high = true;
    const tick = document.querySelectorAll('.threshold-tick')[i];
    tick.style.color = routeColor(person);
    if (!seen.found && seen.low && seen.high) {
      seen.found = true;
      pendingLimits.add(person.kind);
      tick.classList.add('found');
    }
    tick.querySelector('.tick-limit').textContent = seen.found ? 'max ' + person.threshold + ' cm' : '?';
  });
  const count = discoveries.filter(seen => seen.found).length;
  document.getElementById('discovery').textContent = count === 3
    ? 'All three limits found. The lowest one decides who gets left behind.'
    : "Find each person's limit: " + count + ' of 3 found';
}

// Both options are authored polylines. Each detour is 1,000 scene units;
// each straight crossing is 400. This is an illustration, not route finding.
function routeFor(person, height) {
  return height <= person.threshold
    ? [[person.x, 580], [person.x, 180]]
    : [[person.x, 580], [person.x, 365], [person.bypass, 365], [person.bypass, 180], [person.x, 180]];
}

function journey(person, elapsed) {
  const direct = curb <= person.threshold;
  const arrival = direct ? DIRECT_MS : DETOUR_MS;
  let distance;
  if (direct) {
    distance = 400 * Math.min(1, elapsed / (motion.matches ? 250 : DIRECT_MS));
  } else if (elapsed < APPROACH_MS) {
    distance = 215 * Math.min(1, elapsed / (motion.matches ? 150 : APPROACH_MS));
  } else if (elapsed < APPROACH_MS + PAUSE_MS) {
    distance = 215;
  } else {
    // Reduced motion keeps the deadline meaningful while shortening travel.
    const travel = motion.matches ? 250 : DETOUR_MS - APPROACH_MS - PAUSE_MS;
    distance = 215 + 785 * Math.min(1, Math.max(0, (elapsed - (DETOUR_MS - travel)) / travel));
  }
  return { direct, arrived: elapsed >= (direct && motion.matches ? 250 : arrival),
    blocked: !direct && elapsed >= APPROACH_MS && elapsed < APPROACH_MS + PAUSE_MS,
    point: pointAlong(routeFor(person, curb), distance) };
}

function routeLength(route) {
  return route.slice(1).reduce((total, p, i) => total + Math.hypot(p[0] - route[i][0], p[1] - route[i][1]), 0);
}

function pointAlong(route, distance) {
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (distance <= length) {
      const t = Math.max(0, distance / length);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    distance -= length;
  }
  return route[route.length - 1];
}

const INK = '#101820';
const ORANGE = '#FF5A1F';

function box(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function line(points, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.stroke();
}

function circle(x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function text(label, x, y, size, color = INK) {
  // The tiny margin also covers Canvas font-size rounding at fractional scales.
  ctx.font = '700 ' + Math.max(size, 12.01 / sceneScale) + 'px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText(label, x, y);
}

function routeColor(person) {
  return {wheelchair:'#164E70', stroller:'#76233F', cart:'#374D1A'}[person.kind];
}

// Draw in local units, scaled to a 20 CSS-pixel status symbol.
function statusIcon(x, y, onTime) {
  ctx.save(); ctx.translate(x, y); ctx.scale(20 / sceneScale / 20, 20 / sceneScale / 20);
  box(-10, -10, 20, 20, '#FFFFFF');
  if (onTime) line([[-8, 0], [-2, 7], [8, -8]], INK, 2);
  else {
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.stroke();
    line([[0, -5], [0, 0], [5, 3]], INK, 2);
  }
  ctx.restore();
}

function building(person, state) {
  const x = person.x;
  box(x - 66, 64, 132, 108, INK);
  box(x - 62, 68, 124, 100, '#FFFFFF');
  box(x - 72, 54, 144, 18, INK);
  box(x - 46, 97, 27, 32, state.arrived ? ORANGE : INK);
  box(x + 19, 97, 27, 32, state.arrived ? ORANGE : INK);
  box(x - 12, 122, 24, 50, INK);
}

function character(person, x, y) {
  ctx.save(); ctx.translate(x, y);
  if (x > 910) ctx.scale(-1, 1);
  circle(0, 16, 22, '#FFFFFF');
  if (person.kind === 'wheelchair') {
    ctx.strokeStyle = INK; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(-5, 12, 15, 0, Math.PI * 2); ctx.stroke();
    line([[-3, -3], [1, 13], [19, 13], [24, 22]], INK, 5);
    box(-8, -10, 19, 23, routeColor(person));
    circle(1, -18, 10, INK);
  } else {
    line([[-6, 10], [-10, 26]], INK, 6);
    line([[7, 10], [11, 26]], INK, 6);
    box(-12, -12, 24, 29, routeColor(person));
    circle(0, -21, 10, INK);
    if (person.kind === 'stroller') {
      line([[8, 0], [18, -10], [24, -10]], INK, 5);
      ctx.fillStyle = routeColor(person); ctx.strokeStyle = INK; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(38, -12, 20, Math.PI, 0); ctx.lineTo(18, -12); ctx.fill(); ctx.stroke();
      box(19, -9, 38, 14, '#FFFFFF');
      line([[18, -9], [23, 7], [52, 7], [58, -9]], INK, 4);
      circle(25, 12, 6, INK); circle(50, 12, 6, INK);
    } else {
      line([[8, 0], [20, -4], [20, -42], [25, -42]], INK, 5);
      box(26, -37, 25, 25, INK);
      box(26, -8, 25, 25, INK);
      line([[38, -34], [38, -15]], '#FFFFFF', 3);
      line([[38, -5], [38, 14]], '#FFFFFF', 3);
      line([[20, -4], [20, 21], [55, 21]], INK, 5);
      circle(24, 26, 6, INK); circle(49, 26, 6, INK);
    }
  }
  ctx.restore();
}

// Render-only feedback: the authored route point and arrival clock stay untouched.
function crossingBump(elapsed) {
  if (motion.matches || curb === 0) return { lift: 0, angle: 0 };
  const crossingAt = (580 - 337) / 400 * DIRECT_MS;
  const phase = (elapsed - crossingAt) / 400;
  if (phase <= 0 || phase >= 1) return { lift: 0, angle: 0 };
  const envelope = Math.sin(Math.PI * phase) ** 2;
  return { lift: 10 * curb / 8 * envelope,
    angle: .09 * curb / 8 * Math.sin(phase * Math.PI * 2) * envelope };
}

function labelBand(width, elapsed) {
  sceneScale = 1;
  people.forEach((person, i) => {
    const left = i * width / 3, center = left + width / 6 - 9;
    const state = journey(person, elapsed);
    text(person.destination, center, 12, 12);
    text(person.kind, center, 25, 12, routeColor(person));
    text((state.arrived ? 1 : 0) + ' visitor', center, 39, 12);
    text(state.direct ? 'straight' : '2.5x longer', center, 53, 12);
    if (state.arrived || elapsed >= DEADLINE_MS) statusIcon(left + width / 3 - 14, 22, state.direct);
  });
  line([[0, 60], [width, 60]], INK, 2);
}

function curbDetail(x, y, width, height, phone, now) {
  if (!phone) {
    desktopCurbDetail(x, y, width, height, now);
    return;
  }
  ctx.save(); ctx.translate(x, y); sceneScale = 1;
  const floor = height - (phone ? 12 : 90);
  const step = curb * (phone ? 4 : 8);
  const edge = phone ? 64 : 78;
  const right = width - (phone ? 116 : 24);
  line([[0, 0], [width, 0]], INK, 2);
  text('Curb detail - enlarged', width / 2, 20, phone ? 12 : 14);
  if (step > 0) {
    box(edge, floor - step, right - edge, step, ORANGE);
    line([[edge, floor], [edge, floor - step], [right, floor - step], [right, floor]], INK, 2);
    box(edge, floor - step - 5, right - edge, 5, '#FFFFFF');
    line([[edge, floor - step], [edge, floor - step - 5], [right, floor - step - 5]], INK, 2);
  }
  line([[12, floor], [right, floor]], INK, 2);
  // A small crossing marker gives the phone detail the same hop as the sprites.
  const elapsed = ((now - startedAt) % LOOP_MS + LOOP_MS) % LOOP_MS;
  const hop = people.some(person => curb <= person.threshold) ? crossingBump(elapsed).lift : 0;
  circle(edge - 18, floor - 5 - hop, 5, INK);
  if (!hasMovedSlider && !motion.matches) {
    ctx.save(); ctx.globalAlpha = .35 + .4 * (1 + Math.sin(now / 380)) / 2;
    ctx.strokeStyle = INK; ctx.lineWidth = 1;
    ctx.strokeRect(edge - 5, floor - step - 10, right - edge + 10, step + 15);
    ctx.restore();
  }
  text(curb + ' cm', phone ? width - 56 : width / 2, phone ? floor - 12 : 150, phone ? 36 : 80);
  ctx.restore();
}

function desktopCurbDetail(x, y, width, height, now) {
  ctx.save(); ctx.translate(x, y); sceneScale = 1;
  text('Curb detail - enlarged', width / 2, 25, 14);
  // At the target desktop size: 22 px/cm, 264 px at 12 cm,
  // and a 110 px radius wheel representing 5 cm at the same scale.
  const pxPerCm = Math.min(22, (width - 38) / 15, (height - 108) / 14);
  const radius = 5 * pxPerCm;
  const step = curb * pxPerCm;
  const groupHeight = Math.max(2 * radius, step + 58);
  const floor = 44 + (height - 44 + groupHeight) / 2;
  const edge = width - 110;
  const right = width - 16;
  if (step > 0) {
    box(edge, floor - step, right - edge, step, ORANGE);
    line([[edge, floor], [edge, floor - step], [right, floor - step], [right, floor]], INK, 2);
    box(edge, floor - step - 5, right - edge, 5, '#FFFFFF');
    line([[edge, floor - step], [edge, floor - step - 5], [right, floor - step - 5]], INK, 2);
  } else {
    box(edge, floor - 3, right - edge, 3, ORANGE);
  }
  line([[12, floor], [right, floor]], INK, 2);
  text(curb === 0 ? '0 cm - level' : curb + ' cm', (edge + right) / 2,
    floor - step - 18, curb === 0 ? 18 : 38);
  if (!hasMovedSlider && !motion.matches) {
    ctx.save(); ctx.globalAlpha = .35 + .4 * (1 + Math.sin(now / 380)) / 2;
    ctx.strokeStyle = INK; ctx.lineWidth = 1;
    ctx.strokeRect(edge - 5, floor - step - 10, right - edge + 10, step + 15);
    ctx.restore();
  }
  const roll = motion.matches ? 0 : Math.min(8, ((now - startedAt + LOOP_MS) % LOOP_MS) / 160);
  const elapsed = ((now - startedAt) % LOOP_MS + LOOP_MS) % LOOP_MS;
  const hop = people.some(person => curb <= person.threshold) ? crossingBump(elapsed).lift : 0;
  ctx.save(); ctx.translate(16 + radius - 8 + roll, floor - radius - hop);
  ctx.rotate(roll / radius);
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    line([[0, 0], [Math.cos(angle) * (radius - 5), Math.sin(angle) * (radius - 5)]], INK, 2);
  }
  circle(0, 0, 5, INK);
  ctx.restore();
  text('front wheel, same scale', 16 + radius, floor + 24, 12);
  ctx.restore();
}

function draw(now) {
  // Initial dimensions are placeholders until resize measures the canvas.
  if (viewWidth <= 1 || viewHeight <= 1) return;
  const elapsed = ((now - startedAt) % LOOP_MS + LOOP_MS) % LOOP_MS;
  const phone = window.matchMedia('(max-width: 600px)').matches;
  const dprX = canvas.width / viewWidth, dprY = canvas.height / viewHeight;
  ctx.setTransform(dprX, 0, 0, dprY, 0, 0); ctx.globalAlpha = 1;
  box(0, 0, viewWidth, viewHeight, '#FFFFFF');
  const mapWidth = phone ? viewWidth : viewWidth - 392;
  const mapHeight = phone ? 258 : viewHeight - 62;
  const mapScale = Math.min(mapWidth / 1000, mapHeight / (phone ? 760 : 666));
  const mapX = (mapWidth - 1000 * mapScale) / 2;
  const mapY = phone ? 62 + (mapHeight - 760 * mapScale) / 2
    : 62 + (mapHeight - 666 * mapScale) / 2 - 38 * mapScale;
  ctx.save(); ctx.translate(mapX, mapY); ctx.scale(mapScale, mapScale);
  sceneScale = mapScale;
  box(0, 284, 1000, 125, INK);
  for (let x = 24; x < 1000; x += 88) box(x, 344, 43, 3, '#FFFFFF');
  box(80, 296, 700, 85, '#FFFFFF');
  for (let x = 290; x < 710; x += 41) box(x, 296, 22, 85, INK);
  const step = curb * 2.2;
  box(80, 337 - step, 700, step, ORANGE);
  line([[80, 337 - step], [780, 337 - step]], INK, 3);
  if (!hasMovedSlider && !motion.matches) {
    ctx.save(); ctx.globalAlpha = .35 + .4 * (1 + Math.sin(now / 380)) / 2;
    ctx.strokeStyle = INK; ctx.lineWidth = 1 / sceneScale;
    ctx.strokeRect(74, 327 - step, 712, step + 16); ctx.restore();
  }
  const rang = elapsed >= DEADLINE_MS;
  box(488, 626, 24, 22, INK);
  line([[483, 649], [517, 649]], INK, 3); circle(500, 654, 3, INK);
  if (rang) { line([[475, 628], [470, 621]], INK, 3); line([[525, 628], [530, 621]], INK, 3); }
  text(rang ? 'DEADLINE · 3.5 s' : 'BELL AT 3.5 s', 500, phone ? 716 : 688, 17);
  const fade = motion.matches ? 1 : Math.min(1, elapsed / 150, (LOOP_MS - elapsed) / 150);
  for (const person of people) {
    const state = journey(person, elapsed);
    building(person, state);
    const route = routeFor(person, curb);
    if (previousCurb !== null) {
      ctx.save(); ctx.setLineDash([2, 12]); ctx.globalAlpha = .55;
      line(routeFor(person, previousCurb).map(([x, y]) => [x - 10, y]), routeColor(person), 4);
      ctx.restore();
    }
    line(route, '#FFFFFF', 11);
    line(route, routeColor(person), 6);
    circle(person.x, 580, 7, routeColor(person));
    const [x, y] = state.point;
    ctx.save(); ctx.globalAlpha = fade;
    const bump = state.direct ? crossingBump(elapsed) : { lift: 0, angle: 0 };
    ctx.translate(x + (state.blocked && !motion.matches ? Math.sin(elapsed / 35) * 3 : 0),
      y - bump.lift / mapScale);
    ctx.rotate(bump.angle);
    if (x > 910) ctx.scale(-1, 1);
    character(person, 0, 0);
    if (!state.direct && !state.blocked && elapsed >= APPROACH_MS + PAUSE_MS && !state.arrived) {
      // Static ink sweat marks: also readable with reduced motion enabled.
      line([[-20, -38], [-24, -46]], INK, 2 / mapScale);
      line([[-30, -32], [-37, -36]], INK, 2 / mapScale);
    }
    ctx.restore();
    if (state.blocked) {
      line([[x + 32, y - 40], [x + 44, y - 28]], INK, 4);
      line([[x + 44, y - 40], [x + 32, y - 28]], INK, 4);
      text('BLOCKED', x, person.kind === 'stroller' ? 490 : 435, 15);
    }
  }
  // Authored crossings: markers explain the fixed bypasses without changing routes.
  for (const person of people) {
    const x = person.bypass;
    ctx.save(); ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 2 / mapScale;
    ctx.beginPath(); ctx.moveTo(x - 15, 346); ctx.lineTo(x + 15, 326);
    ctx.lineTo(x + 15, 346); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  ctx.restore(); sceneScale = 1;
  labelBand(mapWidth, elapsed);
  curbDetail(phone ? 0 : mapWidth + 24, phone ? 328 : 0,
    phone ? viewWidth : 368, phone ? 104 : viewHeight, phone, now);
  if (!phone) {
    line([[0, 60], [viewWidth, 60]], INK, 2);
    line([[mapWidth + 12, 0], [mapWidth + 12, viewHeight]], INK, 2);
  }
  const onTime = people.filter(person => curb <= person.threshold && journey(person, elapsed).arrived).length;
  lesson.style.visibility = curb <= 2 && onTime === 3 ? 'visible' : 'hidden';
}

function updateAccessibility(announce) {
  const names = ['Wheelchair user', 'Stroller user', 'Cart user'];
  const finalOnTime = people.filter(person => curb <= person.threshold).length;
  const message = `${finalOnTime} of 3 arrive on time`;
  result.textContent = message;
  const outcomes = people.map((person, i) => names[i] + ' to ' + person.destination.toLowerCase() +
    (curb <= person.threshold ? ': direct crossing, arrives on time.' : ': blocked at the curb, takes a detour and arrives late.')).join(' ');
  const summary = 'Curb ' + curb + ' cm: ' + message + '. ' + outcomes;
  canvas.setAttribute('aria-label', 'Top-down city and enlarged curb cross-section. ' + summary);
  if (announce) {
    clearTimeout(announcementTimer);
    announcementTimer = setTimeout(() => {
      const found = [...pendingLimits].map(name => 'Limit found: ' + name + '.').join(' ');
      document.getElementById('announcement').textContent = summary + (found ? ' ' + found : '');
      pendingLimits.clear();
      announcementTimer = null;
    }, 400);
  }
}

function positionHint() {
  const width = slider.getBoundingClientRect().width;
  const hint = document.getElementById('hint');
  hint.style.left = '0px';
  document.querySelectorAll('.threshold-tick').forEach(tick => {
    tick.style.left = (16 + (width - 32) * Number(tick.dataset.value) / 12) + 'px';
  });
}

function restart(announce = false) {
  const next = Number(slider.value);
  if (next !== curb) previousCurb = curb;
  curb = next;
  heightOutput.innerHTML = `${curb} <small>cm</small>`;
  slider.setAttribute('aria-valuetext', `${curb} centimeters`);
  positionHint();
  updateDiscovery();
  updateAccessibility(announce);
  startedAt = performance.now();
  draw(startedAt);
}

function resize() {
  const bounds = canvas.getBoundingClientRect();
  viewWidth = bounds.width;
  viewHeight = bounds.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(viewWidth * dpr));
  canvas.height = Math.max(1, Math.round(viewHeight * dpr));
  positionHint();
  draw(performance.now());
}

function frame(now) {
  draw(now);
  requestAnimationFrame(frame);
}

slider.addEventListener('input', () => {
  hasMovedSlider = true;
  document.getElementById('hint').classList.add('settled');
  restart(true);
});
document.getElementById('reset').addEventListener('click', () => {
  discoveries.forEach(seen => { seen.low = false; seen.high = false; seen.found = false; });
  pendingLimits.clear();
  document.querySelectorAll('.threshold-tick').forEach(tick => tick.classList.remove('found'));
  slider.value = '9'; restart(true);
});
window.addEventListener('resize', resize);
motion.addEventListener('change', () => draw(performance.now()));
restart();
resize();
requestAnimationFrame(frame);
