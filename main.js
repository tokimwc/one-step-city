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
// Effects are render-only. All journey state continues to come from journey().
let thumbPopTimer = null;

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

const INK = '#14183A';
const CREAM = '#FFF4DC';
const YELLOW = '#FFD23F';
const MINT = '#2EC4B6';
const SKY = '#8FD3FF';
const ORANGE = '#FF5A4E';

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
  return {wheelchair:'#1764B1', stroller:'#9D2245', cart:'#065D55'}[person.kind];
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

function shape(x, y, w, h, fill, shadow = false, radius = 0) {
  const pixel = 1 / sceneScale;
  ctx.lineWidth = 3 * pixel; ctx.strokeStyle = INK;
  if (shadow) { ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(x + 4 * pixel, y + 4 * pixel, w, h, radius); ctx.fill(); }
  ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill(); ctx.stroke();
}

function building(person, state) {
  const x = person.x, fill = {wheelchair:ORANGE, stroller:YELLOW, cart:MINT}[person.kind];
  ctx.save();
  ctx.translate(x + (x - 500) * .18, 168); ctx.scale(1.25, 1.25); ctx.translate(-x, -168);
  shape(x - 70, 52, 140, 116, fill, true, 7);
  shape(x - 51, 91, 33, 31, state.arrived ? YELLOW : SKY, false, 4);
  shape(x + 18, 91, 33, 31, state.arrived ? YELLOW : SKY, false, 4);
  shape(x - 16, 125, 32, 43, INK, false, 8);
  circle(x + 7, 149, 3, YELLOW);
  if (person.kind === 'wheelchair') {
    box(x - 71, 73, 142, 17, CREAM);
    for (let n = 0; n < 6; n++) box(x - 71 + n * 24, 73, 12, 17, ORANGE);
    line([[x - 71, 73], [x + 71, 73], [x + 71, 90], [x - 71, 90], [x - 71, 73]], INK, 2 / sceneScale);
  } else {
    shape(x - 29, 60, 58, 16, CREAM, false, 3);
    for (let n = -1; n <= 1; n++) circle(x + n * 15, 68, 3, INK);
  }
  ctx.restore();
}

function character(person, x, y, state = {direct:true, blocked:false}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1.475, 1.475);
  const color = routeColor(person);
  ctx.lineWidth = 2 / sceneScale; ctx.strokeStyle = INK;
  const disk = (cx, cy, r, fill) => { circle(cx,cy,r,fill); ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke(); };
  if (person.kind === 'wheelchair') {
    disk(-6, 14, 17, SKY);
    line([[-6, 14], [10, 14], [20, 26]], INK, 4);
    shape(-9,-10,19,23,color,false,4);
  } else {
    line([[-7, 8], [-10, 29]], INK, 6);line([[7, 8], [11, 29]], INK, 6);
    shape(-11,-12,23,27,color,false,4);
    if (person.kind === 'stroller') {
      line([[8, 0], [18, -10], [24, -10]], INK, 5);
      ctx.fillStyle = ORANGE;ctx.strokeStyle=INK;ctx.lineWidth=2/sceneScale;
      ctx.beginPath();ctx.arc(38,-12,20,Math.PI,0);ctx.closePath();ctx.fill();ctx.stroke();
      shape(19,-9,38,16,CREAM,false,7);
      disk(25,14,5,INK);disk(50,14,5,INK);
    } else {
      line([[8,0],[20,-4],[20,-42],[25,-42]],INK,5);
      shape(26,-37,24,24,YELLOW,false,1);shape(26,-8,24,24,MINT,false,1);
      line([[20,-4],[20,22],[54,22]],INK,5);
      disk(24,27,5,INK);disk(49,27,5,INK);
    }
  }
  disk(0,-25,12,CREAM);
  circle(-4,-27,1.8,INK);circle(4,-27,1.8,INK);
  ctx.lineWidth=1.2/sceneScale;ctx.beginPath();
  if (state.direct && !state.blocked) ctx.arc(0,-24,5,.15,Math.PI-.15);
  else {ctx.moveTo(-4,-20);ctx.lineTo(4,-20);}
  ctx.stroke();ctx.restore();
}

function walkingBob(state, elapsed) {
  return motion.matches || state.arrived || state.blocked ? 0 : Math.sin(elapsed / 85) * 1.5;
}

function bonk(x,y,elapsed) {
  if (motion.matches) return;
  const phase=(elapsed-APPROACH_MS)/PAUSE_MS;
  if(phase<0||phase>=1)return;
  ctx.save();ctx.translate(x+20/sceneScale,y-34/sceneScale);
  ctx.rotate(Math.sin(phase*8)*.12);ctx.fillStyle=YELLOW;ctx.strokeStyle=INK;ctx.lineWidth=2/sceneScale;
  ctx.beginPath();for(let i=0;i<12;i++){const a=i*Math.PI/6,r=(i%2?5:11)/sceneScale;const px=Math.cos(a)*r,py=Math.sin(a)*r;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}

function confetti(elapsed, width, height) {
  if(motion.matches || curb>2 || elapsed<DEADLINE_MS || elapsed>=DEADLINE_MS+1200)return;
  const t=(elapsed-DEADLINE_MS)/1200, colors=[YELLOW,ORANGE,MINT,SKY,CREAM];
  ctx.save();ctx.globalAlpha=1-t;
  for(let i=0;i<40;i++){const a=i*2.39996, speed=35+(i%7)*12;
    const x=width/2+Math.cos(a)*speed*t, y=height*.47+Math.sin(a)*speed*t+90*t*t;
    ctx.save();ctx.translate(x,y);ctx.rotate(a+t*3);shape(-2,-2,5,5,colors[i%5]);ctx.restore();}
  ctx.restore();
}

function tag(label, x, y, fill = CREAM) {
  sceneScale=1;ctx.font='800 12.01px system-ui, sans-serif';
  const w=ctx.measureText(label).width+12;
  shape(x-w/2,y-13,w,19,fill,false,4);text(label,x,y+1,12.01);
}

function arrow(from, to) {
  line([from,to],INK,2);const a=Math.atan2(to[1]-from[1],to[0]-from[0]);
  line([[to[0]-6*Math.cos(a-.5),to[1]-6*Math.sin(a-.5)],to,[to[0]-6*Math.cos(a+.5),to[1]-6*Math.sin(a+.5)]],INK,2);
}

function sceneLabelLayout(mapX,mapY,scale,phone) {
  const p=(x,y)=>[mapX+x*scale,mapY+y*scale];
  const compact=phone && viewHeight-Math.min(104,Math.max(62,viewHeight*.23))<235;
  const rampY=compact?86:Math.max(86,p(100,100)[1]);
  const crossingY=compact?111:Math.max(rampY+25,p(280,225)[1]);
  const streetY=compact?136:Math.max(crossingY+25,p(0,275)[1]);
  const curbTop=compact?150:Math.max(streetY+13,p(280,400)[1]);
  const homeY=compact?86:Math.max(curbTop+55,p(340,580)[1]);
  return {compact,rampY,crossingY,streetY,curbTop,homeY};
}

// Labels occupy a dedicated sidewalk lane outside every authored route.
function sceneTags(mapX,mapY,scale,width,phone,elapsed) {
  const p=(x,y)=>[mapX+x*scale,mapY+y*scale];
  const {compact,rampY,crossingY,streetY,curbTop,homeY}=sceneLabelLayout(mapX,mapY,scale,phone);
  // An unmarked extension of the road carries its name, away from crossings.
  tag('ramp',compact?26:52,rampY);
  line([[74,rampY],p(people[0].bypass,210)],INK,2);
  tag('CROSSWALK',52,crossingY);
  line([[102,crossingY],p(280,275)],INK,2);
  tag('STREET',52,streetY,YELLOW);
  shape(3,curbTop,98,36,YELLOW,false,4);
  text('CURB',52,curbTop+14,12.01);
  text('you control this',52,curbTop+30,12.01);
  line([[101,curbTop+5],p(280,337)],INK,2);
  tag('HOME',compact?78:52,homeY,MINT);
  line([[76,homeY],p(340,580)],INK,2);
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
  box(0,0,width,69,CREAM);
  for(let i=0;i<3;i++)box(i*width/3,0,width/3,3,[ORANGE,YELLOW,MINT][i]);
  people.forEach((person, i) => {
    const left = i * width / 3, center = left + width / 6 - 9;
    const state = journey(person, elapsed);
    text(person.destination, center, 13, width > 600 ? 14 : 12);
    text(person.kind, center, 30, width > 600 ? 14 : 12, routeColor(person));
    text((state.arrived ? 1 : 0) + ' visitor', center, 46, width > 600 ? 14 : 12);
    text(state.direct ? 'straight' : '2.5x longer', center, 63, width > 600 ? 14 : 12);
    if (state.arrived || elapsed >= DEADLINE_MS) statusIcon(left + width / 3 - 14, 22, state.direct);
  });
  line([[0, 69], [width, 69]], INK, 2);
}

function curbDetail(x,y,width,height,phone,now) {
  if(!phone){desktopCurbDetail(x,y,width,height,now);return;}
  ctx.save();ctx.translate(x,y);sceneScale=1;
  box(0,0,width,height,SKY);line([[0,0],[width,0]],INK,3);
  text('Curb detail · enlarged',width/2-24,15,12.01);
  const pxPerCm=Math.min(4,(height-38)/12), radius=5*pxPerCm;
  const floor=height-19,step=curb*pxPerCm,edge=65,right=width-116;
  shape(edge,floor-Math.max(3,step),right-edge,Math.max(3,step),ORANGE);
  for(let sx=edge+5;sx<right-5;sx+=25)box(sx,floor-Math.max(3,step),10,Math.max(3,step),YELLOW);
  line([[edge,floor-step],[right,floor-step]],INK,3);
  line([[8,floor],[right,floor]],INK,3);
  const elapsed=((now-startedAt)%LOOP_MS+LOOP_MS)%LOOP_MS;
  const hop=people.some(p=>curb<=p.threshold)?crossingBump(elapsed).lift:0;
  circle(29,floor-radius-hop,radius,CREAM);ctx.strokeStyle=INK;ctx.lineWidth=3;ctx.beginPath();ctx.arc(29,floor-radius-hop,radius,0,Math.PI*2);ctx.stroke();
  line([[12,floor-radius-hop],[46,floor-radius-hop]],INK,2);circle(29,floor-radius-hop,4,YELLOW);
  text('front wheel, same scale',85,height-5,12.01);
  text(curb+' cm',width-56,floor-13,height<90?26:36);
  ctx.restore();
}

function desktopCurbDetail(x, y, width, height, now) {
  ctx.save(); ctx.translate(x, y); sceneScale = 1;
  box(0,0,width,height,SKY);
  text('Curb detail · enlarged', width / 2, 25, 14);
  // At the target desktop size: 22 px/cm, 264 px at 12 cm,
  // and a 110 px radius wheel representing 5 cm at the same scale.
  const pxPerCm = Math.min(22, (width - 140) / 10, (height - 150) / 14);
  const radius = 5 * pxPerCm;
  const step = curb * pxPerCm;
  const groupHeight = Math.max(2 * radius, step + 58);
  const floor = 44 + (height - 44 + groupHeight) / 2;
  const edge = width - 110;
  const right = width - 16;
  if (step > 0) {
    shape(edge, floor - step, right - edge, step, ORANGE, true);
    for(let sx=edge+5;sx<right-5;sx+=25)box(sx,floor-step,10,step,YELLOW);
    line([[edge, floor], [edge, floor - step], [right, floor - step], [right, floor]], INK, 2);
    box(edge, floor - step - 5, right - edge, 5, CREAM);
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
  circle(4,4,radius,INK);circle(0,0,radius,CREAM);
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    line([[0, 0], [Math.cos(angle) * (radius - 5), Math.sin(angle) * (radius - 5)]], INK, 2);
  }
  circle(0, 0, 6, YELLOW);
  ctx.restore();
  text('front wheel, same scale', 16 + radius, floor + 24, 12);
  ctx.restore();
}

function draw(now) {
  // Initial dimensions are placeholders until resize measures the canvas.
  if (viewWidth <= 1 || viewHeight <= 1) return;
  const elapsed = ((now - startedAt) % LOOP_MS + LOOP_MS) % LOOP_MS;
  const phone = window.matchMedia('(max-width: 899px)').matches;
  const dprX = canvas.width / viewWidth, dprY = canvas.height / viewHeight;
  ctx.setTransform(dprX, 0, 0, dprY, 0, 0); ctx.globalAlpha = 1;
  box(0, 0, viewWidth, viewHeight, CREAM);
  const detailWidth = Math.min(368,viewWidth*.3);
  const mapWidth = phone ? viewWidth : viewWidth-detailWidth-24;
  const detailHeight = phone ? Math.min(104,Math.max(62,viewHeight*.23)) : viewHeight;
  const detailY = phone ? viewHeight-detailHeight : 0;
  const mapHeight = (phone?detailY:viewHeight)-77;
  const mapScale = Math.min((mapWidth-142)/1000,mapHeight/720);
  const mapX = 116+(mapWidth-142-1000*mapScale)/2;
  const mapY = 77+(mapHeight-720*mapScale)/2;
  const {streetY}=sceneLabelLayout(mapX,mapY,mapScale,phone);
  box(0,streetY-16,mapX+1,25,INK);
  ctx.save(); ctx.translate(mapX, mapY); ctx.scale(mapScale, mapScale);
  sceneScale = mapScale;
  box(0,0,1000,214,SKY);
  box(0,214,1000,70,YELLOW);box(0,409,1000,201,CREAM);

  box(0,210,1000,127,INK);
  for(let x=18;x<1000;x+=90)box(x,270,46,5,YELLOW);
  for(let y=217;y<332;y+=30)box(290,y,420,17,'#FFFFFF');
  box(280,213,3/mapScale,121,'#FFFFFF');box(717,213,3/mapScale,121,'#FFFFFF');
  const step=curb*2.2;
  shape(280,337-step,440,Math.max(7,step),ORANGE);
  for(let x=286;x<710;x+=40)box(x,337-step,17,Math.max(7,step),YELLOW);
  line([[280,337-step],[720,337-step]],INK,3/sceneScale);
  // Ramp decks span both road-entry edges at the authored bypasses.
  for(const person of people) for(const y of [210,337]) {
    const w=28/mapScale,x=person.bypass, depth=36/mapScale;
    ctx.fillStyle=CREAM;ctx.strokeStyle=INK;ctx.lineWidth=3/mapScale;
    ctx.beginPath();ctx.moveTo(x-w/2,y-depth/2);ctx.lineTo(x+w/2,y);
    ctx.lineTo(x+w/2,y+depth/2);ctx.lineTo(x-w/2,y+depth/2);
    ctx.closePath();ctx.fill();ctx.stroke();
    line([[x-w/2,y-depth/2],[x-w/2,y+depth/2]],INK,2/mapScale);
  }
  const rang = elapsed >= DEADLINE_MS;
  text(rang ? '3.5 s · bell!' : 'Bell: 3.5 s', 500, 665, 17);
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
    line(route, INK, Math.max(10, 6 / mapScale));
    line(route, routeColor(person), Math.max(6, 3 / mapScale));
    circle(person.x, 580, 7, routeColor(person));
    const [x, y] = state.point;
    ctx.save(); ctx.globalAlpha = fade;
    const bump = state.direct ? crossingBump(elapsed) : { lift: 0, angle: 0 };
    ctx.translate(x + (state.blocked && !motion.matches ? Math.sin(elapsed / 35) * 3 : 0),
      y - (bump.lift + walkingBob(state, elapsed)) / mapScale);
    ctx.rotate(bump.angle);
    if (x > 910) ctx.scale(-1, 1);
    character(person, 0, 0, state);
    if (!state.direct && !state.blocked && elapsed >= APPROACH_MS + PAUSE_MS && !state.arrived) {
      // Static ink sweat marks: also readable with reduced motion enabled.
      line([[-20, -38], [-24, -46]], INK, 2 / mapScale);
      line([[-30, -32], [-37, -36]], INK, 2 / mapScale);
    }
    ctx.restore();
    if (state.blocked) bonk(x,y,elapsed);
  }
  ctx.restore(); sceneScale = 1;
  sceneTags(mapX,mapY,mapScale,mapWidth,phone,elapsed);
  labelBand(mapWidth, elapsed);
  confetti(elapsed,mapWidth,phone?detailY:viewHeight);
  curbDetail(phone ? 0 : mapWidth + 24, detailY,
    phone ? viewWidth : detailWidth, detailHeight, phone, now);
  if (!phone) {
    line([[0, 69], [viewWidth, 69]], INK, 2);
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
  result.dataset.count = String(finalOnTime);
  const outcomes = people.map((person, i) => names[i] + ' to ' + person.destination.toLowerCase() +
    (curb <= person.threshold ? ': direct crossing, arrives on time.' : ': blocked at the curb, takes a detour and arrives late.')).join(' ');
  const summary = 'Curb ' + curb + ' cm: ' + message + '. ' + outcomes;
  canvas.setAttribute('aria-label', 'Top-down city and enlarged curb cross-section. ' + summary);
  if (announce) {
    clearTimeout(announcementTimer);
    announcementTimer = setTimeout(() => {
      document.getElementById('announcement').textContent = summary;
      announcementTimer = null;
    }, 400);
  }
}

function positionHint() {
  const width = slider.getBoundingClientRect().width;
  const hint = document.getElementById('hint');
  hint.style.left = '0px';
  document.querySelectorAll('.threshold-tick').forEach(tick => {
    tick.style.left = (22 + (width - 44) * Number(tick.dataset.value) / 12) + 'px';
  });
}

function restart(announce = false) {
  const next = Number(slider.value);
  if (!motion.matches && people.some(p => (curb <= p.threshold) !== (next <= p.threshold))) {
    slider.classList.remove('pop'); void slider.offsetWidth; slider.classList.add('pop');
    clearTimeout(thumbPopTimer); thumbPopTimer=setTimeout(()=>slider.classList.remove('pop'),220);
  }
  if (next !== curb) previousCurb = curb;
  curb = next;
  heightOutput.innerHTML = `${curb} <small>cm</small>`;
  slider.setAttribute('aria-valuetext', `${curb} centimeters`);
  positionHint();
  people.forEach((person, i) => { document.querySelectorAll('.threshold-tick')[i].style.color = routeColor(person); });
  updateAccessibility(announce);
  startedAt = performance.now();
  draw(startedAt);
}

function resize() {
  // Measure wrapping HTML first; spend only the remaining viewport on the scene.
  const current=canvas.getBoundingClientRect().height;
  const other=document.querySelector('main').getBoundingClientRect().height-current;
  const available=window.innerHeight-other-8;
  canvas.style.height=Math.max(260,Math.min(window.innerWidth<600?430:558,available))+'px';
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
document.getElementById('reset').addEventListener('click', () => { slider.value='9'; restart(true); });

window.addEventListener('resize', resize);
motion.addEventListener('change', () => draw(performance.now()));
restart();
resize();
requestAnimationFrame(frame);
