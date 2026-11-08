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
let lastResult = '';
let startedAt = performance.now();
let viewWidth = 1;
let viewHeight = 1;

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

function box(x, y, w, h, color, radius = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
}

function line(points, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.stroke();
}

function circle(x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function text(label, x, y, size, color = '#42594b') {
  ctx.font = `600 ${Math.max(size, 12 / sceneScale)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText(label, x, y);
}

function statusIcon(x, y, onTime) {
  circle(x, y, 15, '#f8f0d9');
  if (onTime) line([[x - 7, y], [x - 2, y + 5], [x + 8, y - 6]], '#31594b', 3);
  else {
    ctx.strokeStyle = '#665947'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke();
    line([[x, y - 6], [x, y], [x + 5, y + 3]], '#665947', 2);
  }
}

function building(person, state, elapsed) {
  const x = person.x;
  box(x - 66, 64, 132, 108, '#f8f0d9', 7);
  box(x - 72, 54, 144, 25, person.roof, 6);
  ctx.save();
  if (state.arrived) { ctx.shadowColor = '#f2bb59'; ctx.shadowBlur = 20; }
  box(x - 46, 97, 27, 32, state.arrived ? '#ffce76' : '#b5c6ba', 3);
  box(x + 19, 97, 27, 32, state.arrived ? '#ffce76' : '#b5c6ba', 3);
  ctx.restore();
  box(x - 12, 122, 24, 50, '#6c7c6d', 3);
  text(person.destination, x, 37, 23);
  text(`${state.arrived ? 1 : 0} visitor`, x, 261, 17);
  if (state.arrived || elapsed >= DEADLINE_MS) statusIcon(x + 58, 157, state.direct);
}

function tree(x, y) {
  box(x - 4, y + 10, 8, 27, '#9c8b69', 2);
  circle(x, y, 26, '#bdcfaa');
  circle(x - 10, y - 5, 18, '#aec49b');
}

function character(person, x, y) {
  ctx.save();
  ctx.translate(x, y);
  if (x > 910) ctx.scale(-1, 1);
  circle(0, 16, 22, '#d1d8c6');
  if (person.kind === 'wheelchair') {
    ctx.strokeStyle = '#344b4d';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(-5, 12, 15, 0, Math.PI * 2); ctx.stroke();
    line([[-3, -3], [1, 13], [19, 13], [24, 22]], '#344b4d', 5);
    box(-8, -10, 19, 23, person.color, 6);
    circle(1, -18, 10, '#bd8864');
  } else {
    line([[-6, 10], [-10, 26]], '#344b4d', 6);
    line([[7, 10], [11, 26]], '#344b4d', 6);
    box(-12, -12, 24, 29, person.color, 8);
    circle(0, -21, 10, '#bd8864');
    if (person.kind === 'stroller') {
      line([[8, 0], [22, -10], [28, 3]], '#344b4d', 4);
      box(18, -28, 30, 30, '#d49b8e', 12);
      line([[20, -10], [45, -10]], '#9e5361', 4);
      circle(23, 5, 5, '#344b4d'); circle(44, 5, 5, '#344b4d');
    } else {
      line([[9, 1], [25, -7], [29, 20], [49, 20]], '#344b4d', 4);
      box(24, -10, 27, 24, '#b9905c', 2);
      line([[37, -10], [37, 14]], '#e1c291', 3);
      circle(29, 24, 5, '#344b4d'); circle(49, 24, 5, '#344b4d');
    }
  }
  ctx.restore();
}

function draw(now) {
  const elapsed = ((now - startedAt) % LOOP_MS + LOOP_MS) % LOOP_MS;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  box(0, 0, canvas.width, canvas.height, '#e9edde');
  sceneScale = Math.min(viewWidth / 1000, viewHeight / 760);
  const scale = Math.min(canvas.width / 1000, canvas.height / 760);
  ctx.setTransform(scale, 0, 0, scale, (canvas.width - 1000 * scale) / 2, (canvas.height - 760 * scale) / 2);
  box(0, 0, 1000, 760, '#e9edde');
  box(18, 218, 964, 50, '#dce3d1', 18);
  box(18, 427, 964, 209, '#dce3d1', 18);
  box(0, 284, 1000, 125, '#c3cbc1');
  for (let x = 24; x < 1000; x += 88) box(x, 344, 43, 3, '#e6eadf');
  box(80, 306, 700, 62, '#e0e5d9');
  for (let x = 290; x < 710; x += 41) box(x, 296, 22, 85, '#f4f2df');
  // The two ends are open, giving the authored detours a place to cross.
  // Raise the top face while keeping the authored crossing in place.
  const stepHeight = curb * 2.2;
  const stepTop = 337 - stepHeight;
  ctx.save();
  ctx.shadowColor = '#344b4d40'; ctx.shadowBlur = curb ? 10 : 0;
  ctx.shadowOffsetY = curb ? 5 : 0;
  box(80, stepTop, 700, stepHeight + 3, '#7d806d', 2);
  ctx.restore();
  box(80, stepTop - 7, 700, 8, '#faf6dd', 2);
  line([[82, stepTop + 2], [778, stepTop + 2]], '#aaab91', 2);
  if (!hasMovedSlider && !motion.matches) {
    ctx.save();
    ctx.globalAlpha = .35 + .4 * (1 + Math.sin(now / 380)) / 2;
    ctx.strokeStyle = '#a56832'; ctx.lineWidth = 1.5 / sceneScale;
    ctx.beginPath(); ctx.roundRect(74, stepTop - 13, 712, stepHeight + 23, 6); ctx.stroke();
    ctx.restore();
  }
  text(`${curb} cm`, 140, stepTop - 25, 23, '#596759');
  tree(155, 143); tree(845, 130); tree(170, 660); tree(840, 660);
  box(450, 670, 100, 13, '#b69e75', 3);
  box(460, 684, 7, 14, '#7b806a', 2); box(533, 684, 7, 14, '#7b806a', 2);
  // A silent canvas bell marks the deadline; no sound or external icons.
  const rang = elapsed >= DEADLINE_MS;
  ctx.save(); ctx.translate(500, 641);
  box(-12, -15, 24, 22, rang ? '#d8a248' : '#9ba78d', 10);
  line([[-17, 8], [17, 8]], '#596759', 3); circle(0, 13, 3, '#596759');
  if (rang) { line([[-25, -13], [-30, -20]], '#a87735', 3); line([[25, -13], [30, -20]], '#a87735', 3); }
  ctx.restore();
  text(rang ? 'DEADLINE · 3.5 s' : 'BELL AT 3.5 s', 500, 716, 17);
  const fade = motion.matches ? 1 : Math.min(1, elapsed / 150, (LOOP_MS - elapsed) / 150);
  for (const person of people) {
    const state = journey(person, elapsed);
    building(person, state, elapsed);
    const route = routeFor(person, curb);
    if (previousCurb !== null) {
      ctx.save(); ctx.setLineDash([2, 12]); ctx.globalAlpha = .45;
      // Offset the old trace slightly so identical route sections remain legible.
      line(routeFor(person, previousCurb).map(([x, y]) => [x - 10, y]), person.color, 4);
      ctx.restore();
    }
    line(route, person.color, 6);
    circle(person.x, 580, 7, person.color);
    const [x, y] = state.point;
    ctx.save(); ctx.globalAlpha = fade;
    character(person, x + (state.blocked && !motion.matches ? Math.sin(elapsed / 35) * 3 : 0), y);
    ctx.restore();
    if (state.blocked) {
      line([[x + 32, y - 40], [x + 44, y - 28]], '#794b36', 4);
      line([[x + 44, y - 40], [x + 32, y - 28]], '#794b36', 4);
      // Stagger the middle label to leave room for the larger phone text.
      text('BLOCKED', x, person.kind === 'stroller' ? 490 : 435, 15, '#794b36');
    }
  }
  const onTime = people.filter(person => curb <= person.threshold && journey(person, elapsed).arrived).length;
  const message = `${onTime} of 3 arrived on time`;
  if (message !== lastResult) { result.textContent = message; lastResult = message; }
  lesson.style.visibility = curb <= 2 && onTime === 3 ? 'visible' : 'hidden';
}

function restart() {
  const next = Number(slider.value);
  if (next !== curb) previousCurb = curb;
  curb = next;
  heightOutput.innerHTML = `${curb} <small>cm</small>`;
  slider.setAttribute('aria-valuetext', `${curb} centimeters`);
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
  draw(performance.now());
}

function frame(now) {
  draw(now);
  requestAnimationFrame(frame);
}

slider.addEventListener('input', () => {
  hasMovedSlider = true;
  document.getElementById('hint').classList.add('settled');
  restart();
});
document.getElementById('reset').addEventListener('click', () => { slider.value = '9'; restart(); });
window.addEventListener('resize', resize);
motion.addEventListener('change', () => draw(performance.now()));
restart();
resize();
requestAnimationFrame(frame);
