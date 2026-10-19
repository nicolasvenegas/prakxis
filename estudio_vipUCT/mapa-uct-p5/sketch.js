// Mapa de Investigación UCT, versión p5.js
// p5 dibuja y maneja el mouse. d3-force solo calcula las posiciones de los nodos.
// Archivos en la misma carpeta: index.html, sketch.js y graph.json
// Teclas: 1 a 4 cambian el modo, Esc deselecciona.

const PAL = ['#5e9bff', '#ff7b72', '#5fd38d', '#f0c75e', '#a58bff', '#f58ad0', '#37cfc4', '#b9d067', '#8b98aa', '#ffab4d', '#8ad6ff', '#d9b38c'];
const MODOS = [['coauth', 'Coautoría'], ['theme', 'Temas'], ['time', 'Línea de tiempo'], ['intl', 'Internacional']];
const FONDO = [10, 15, 21];
const TEXTO = [232, 238, 245];
const ACENTO = [138, 180, 255];

let G, N, E, K;
let cnt = [], med = [], intlS = [], cols = [];
let sim, sn = [], links = [], hubs = {}, smap = new Map(), orden = [];
let modo = 'coauth', minW = 4, sel = -1, hov = -1;
let vecinos = new Set(), coincide = new Set();
let vista = { x: 0, y: 0, k: 1 };
let arrastre = 0, pulsoEnLienzo = false, sobreUI = false;
let buscador, deslizador, etiquetaMin, botones = [];

const xAnio = d3.scaleLinear().domain([2002, 2026]).range([-380, 380]).clamp(true);
const carril = c => (c - 5.5) * 38;
const anillo = (c, R) => { const a = -Math.PI / 2 + 2 * Math.PI * c / 12; return { x: R * Math.cos(a), y: R * Math.sin(a), ang: a }; };
const plegar = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function preload() {
  G = loadJSON('graph.json');
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont('Arial');
  strokeJoin(ROUND);

  N = G.nodes;
  K = G.clusters.length;
  E = G.edges.map(e => ({ a: e[0], b: e[1], w: e[2].length }));
  const adj = new Map();
  E.forEach(e => {
    (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push({ nodo: e.b, w: e.w });
    (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push({ nodo: e.a, w: e.w });
  });
  window.adj = adj;
  cnt = N.map(n => n.ws.length);
  med = N.map(n => {
    const ys = n.ws.map(w => w[0]).sort((a, b) => a - b);
    return ys.length ? ys[ys.length >> 1] : 0;
  });
  intlS = N.map(n => {
    const con = n.ws.filter(w => w[2] >= 0);
    return con.length ? con.filter(w => w[2] === 1).length / con.length : -1;
  });

  crearUI();
  document.addEventListener('mousemove', ev => { sobreUI = ev.target.tagName !== 'CANVAS'; });
  vista = { x: width / 2 - 120, y: height / 2, k: Math.min(1.2, Math.min(width, height) / 880) };
  reconstruir();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

/* ---------- interfaz (elementos DOM de p5) ---------- */

function crearUI() {
  const ui = document.getElementById('ui');

  const fila1 = createDiv();
  fila1.parent(ui);
  fila1.class('fila');
  MODOS.forEach(([id, nombre], i) => {
    const b = createButton((i + 1) + ' ' + nombre);
    b.parent(fila1);
    b.mousePressed(() => cambiarModo(id));
    botones.push([id, b]);
  });

  buscador = createInput('', 'search');
  buscador.parent(ui);
  buscador.attribute('placeholder', 'Buscar nombre o término, p. ej. mapuche');
  buscador.input(buscar);
  buscador.elt.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') {
      const mejor = [...coincide].sort((a, b) => cnt[b] - cnt[a])[0];
      if (mejor !== undefined) irA(mejor);
    }
  });

  const fila2 = createDiv();
  fila2.parent(ui);
  fila2.class('fila');
  etiquetaMin = createSpan('');
  etiquetaMin.parent(fila2);
  deslizador = createSlider(1, 20, minW, 1);
  deslizador.parent(fila2);
  deslizador.input(() => { minW = deslizador.value(); actualizarEtiquetaMin(); reconstruir(); });
  actualizarEtiquetaMin();
  pintarBotones();
}

function actualizarEtiquetaMin() {
  etiquetaMin.html('Mínimo de trabajos: ' + minW);
}

function pintarBotones() {
  botones.forEach(([id, b]) => b.elt.classList.toggle('activo', id === modo));
}

function cambiarModo(id) {
  modo = id;
  pintarBotones();
  reconstruir();
}

/* ---------- construcción del grafo ---------- */

function colorDe(i) {
  if (modo === 'time') {
    const t = constrain((med[i] - 2002) / 24, 0, 1);
    return d3.interpolateRgb('#3d5f9e', '#ffc857')(t);
  }
  if (modo === 'intl') {
    return intlS[i] < 0 ? '#56657a' : d3.interpolateRgb('#6b7d95', '#ff9f43')(intlS[i]);
  }
  return PAL[N[i].c];
}

function reconstruir() {
  if (sim) sim.stop();
  const previas = new Map();
  sn.forEach(n => { if (!n.hub) previas.set(n.i, { x: n.x, y: n.y }); });
  const vistaPrevia = { ...vista };
  sn = []; smap = new Map(); links = []; hubs = {};

  for (let i = 0; i < N.length; i++) {
    if (cnt[i] < minW) continue;
    const p = previas.get(i) || anillo(N[i].c, 200);
    const o = { i, r: Math.min(13, 2.4 + Math.sqrt(cnt[i]) * 1.1), x: p.x, y: p.y };
    sn.push(o);
    smap.set(i, o);
    cols[i] = color(colorDe(i));
  }
  orden = sn.slice().sort((a, b) => cnt[b.i] - cnt[a.i]);

  const m = modo;
  if (m === 'theme') {
    new Set(sn.map(n => N[n.i].c)).forEach(c => {
      const h = anillo(c, 230);
      const o = { hub: true, c, r: 0, x: h.x, y: h.y, fx: h.x, fy: h.y, ang: h.ang };
      hubs[c] = o;
      sn.push(o);
    });
    sn.forEach(n => { if (!n.hub) links.push({ source: n, target: hubs[N[n.i].c], w: 1 }); });
  } else {
    E.forEach(e => {
      const a = smap.get(e.a), b = smap.get(e.b);
      if (a && b) links.push({ source: a, target: b, w: e.w });
    });
  }

  const gx = d => d.hub ? d.x : m === 'theme' ? 0 : m === 'time' ? xAnio(med[d.i]) : anillo(N[d.i].c, 250).x;
  const gy = d => d.hub ? d.y : m === 'theme' ? 0 : m === 'time' ? carril(N[d.i].c) : anillo(N[d.i].c, 250).y;

  sim = d3.forceSimulation(sn).alpha(0.3).alphaDecay(0.04).velocityDecay(0.4)
    .force('charge', d3.forceManyBody().strength(d => d.hub ? 0 : -(10 + d.r * 1.4)).distanceMax(200))
    .force('collide', d3.forceCollide(d => d.hub ? 0 : d.r + 1.5).strength(0.85))
    .force('link', d3.forceLink(links).distance(m === 'theme' ? 32 : m === 'time' ? 18 : 24)
      .strength(l => m === 'theme' ? 0.3 : Math.min(0.8, 0.2 + 0.1 * l.w)))
    .force('x', d3.forceX(gx).strength(m === 'time' ? 0.5 : m === 'theme' ? 0.01 : 0.05))
    .force('y', d3.forceY(gy).strength(m === 'time' ? 0.45 : m === 'theme' ? 0.01 : 0.05));

  vista = vistaPrevia;
  calcularVecinos();
  document.getElementById('pie').textContent =
    sn.filter(n => !n.hub).length + ' investigadores · ' + links.length + (m === 'theme' ? ' vínculos a temas' : ' conexiones');
}

function calcularVecinos() {
  vecinos = new Set();
  if (sel < 0) return;
  links.forEach(l => {
    if (l.source.hub || l.target.hub) return;
    if (l.source.i === sel) vecinos.add(l.target.i);
    else if (l.target.i === sel) vecinos.add(l.source.i);
  });
}

/* ---------- dibujo ---------- */

function atenuado(i) {
  if (sel >= 0) return !(i === sel || vecinos.has(i));
  if (coincide.size > 0) return !coincide.has(i);
  return false;
}

function trazarEnlaces(lista, css, alfa, grosor) {
  if (!lista.length) return;
  const ctx = drawingContext;
  ctx.beginPath();
  for (const l of lista) { ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); }
  ctx.globalAlpha = alfa;
  ctx.strokeStyle = css;
  ctx.lineWidth = grosor / vista.k;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function draw() {
  background(...FONDO);
  const k = vista.k, ctx = drawingContext;

  const h = sobreUI ? null : elegirNodo();
  hov = h ? h.i : -1;
  cursor(h ? HAND : ARROW);

  if (modo === 'time') ejeTiempo();

  push();
  translate(vista.x, vista.y);
  scale(k);

  const normal = [], doble = [], fuerte = [], resaltado = [], tenue = [];
  for (const l of links) {
    const ia = l.source.hub ? -1 : l.source.i, ib = l.target.hub ? -1 : l.target.i;
    if (sel >= 0) { (ia === sel || ib === sel ? resaltado : tenue).push(l); continue; }
    if (coincide.size > 0 && !(coincide.has(ia) || coincide.has(ib))) { tenue.push(l); continue; }
    if (modo !== 'theme' && l.w >= 4) fuerte.push(l);
    else if (modo !== 'theme' && l.w >= 2) doble.push(l);
    else normal.push(l);
  }
  const base = modo === 'time' ? 0.16 : 0.3;
  trazarEnlaces(tenue, '#8ca2c4', 0.05, 0.8);
  trazarEnlaces(normal, '#8ca2c4', base, 0.8);
  trazarEnlaces(doble, '#8ca2c4', base + 0.1, 1.4);
  trazarEnlaces(fuerte, '#8ca2c4', base + 0.2, 2.3);
  trazarEnlaces(resaltado, '#8ab4ff', 0.95, 1.6);

  noStroke();
  for (const n of sn) {
    if (n.hub) continue;
    ctx.globalAlpha = atenuado(n.i) ? 0.15 : 1;
    fill(cols[n.i]);
    circle(n.x, n.y, n.r * 2);
  }
  ctx.globalAlpha = 1;

  for (const c in hubs) {
    const o = hubs[c];
    fill(...FONDO); stroke(PAL[c]); strokeWeight(3 / k);
    circle(o.x, o.y, 18);
  }

  noFill();
  if (sel >= 0 && smap.get(sel)) {
    const o = smap.get(sel);
    stroke(...ACENTO); strokeWeight(2.4 / k);
    circle(o.x, o.y, (o.r + 3.5 / k) * 2);
  }
  if (hov >= 0 && hov !== sel && smap.get(hov)) {
    const o = smap.get(hov);
    stroke(...TEXTO); strokeWeight(1.6 / k);
    circle(o.x, o.y, (o.r + 2.5 / k) * 2);
  }
  pop();

  etiquetas();
  tooltip();
}

function ejeTiempo() {
  const k = vista.k;
  textSize(11); textAlign(CENTER, CENTER);
  for (let y = 2005; y <= 2025; y += 5) {
    const sx = xAnio(y) * k + vista.x;
    if (sx < 20 || sx > width - 10) continue;
    stroke(36, 49, 66, 150); strokeWeight(1);
    line(sx, 150, sx, height - 6);
    noStroke(); fill(146, 163, 184);
    text(y, sx, 140);
  }
}

function etiquetas() {
  const k = vista.k, ocupados = [];
  textSize(11.5); textAlign(LEFT, CENTER);

  const poner = (txt, x, y, forzar, color, peso) => {
    textStyle(peso || NORMAL);
    const w = textWidth(txt);
    let lx = x + 9;
    if (lx + w > width - 6) lx = x - 18 - w;
    const r = { x0: lx, y0: y - 8, x1: lx + w, y1: y + 8 };
    if (r.x1 < 0 || r.x0 > width || r.y1 < 0 || r.y0 > height) return false;
    if (!forzar && ocupados.some(o => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0)) return false;
    ocupados.push(r);
    stroke(...FONDO); strokeWeight(3.2); fill(...(color || TEXTO));
    text(txt, lx, y);
    return true;
  };
  const px = o => ({ x: o.x * k + vista.x, y: o.y * k + vista.y });

  if (modo === 'theme') {
    for (const c in hubs) {
      const p = px(hubs[c]), a = hubs[c].ang, izq = Math.cos(a) < -0.35;
      textAlign(izq ? RIGHT : LEFT, CENTER); textStyle(BOLD);
      stroke(...FONDO); strokeWeight(3.2); fill(color(PAL[c]));
      text(G.clusters[c].n, p.x + (izq ? -16 : 16), p.y);
      textAlign(LEFT, CENTER);
    }
  }
  if (modo === 'time') {
    const vistos = new Set(sn.filter(n => !n.hub).map(n => N[n.i].c));
    textStyle(BOLD);
    vistos.forEach(c => {
      const sy = carril(c) * k + vista.y;
      if (sy < 160 || sy > height - 20) return;
      stroke(...FONDO); strokeWeight(3.2); fill(color(PAL[c]));
      text(G.clusters[c].n, 12, sy);
    });
  }

  if (sel >= 0 && smap.get(sel)) {
    const o = smap.get(sel), p = px(o);
    poner(N[sel].n, p.x + o.r * k, p.y, true, null, BOLD);
    [...vecinos].sort((a, b) => cnt[b] - cnt[a]).slice(0, 10).forEach(j => {
      const q = smap.get(j); if (q) { const s = px(q); poner(N[j].n, s.x + q.r * k, s.y, false); }
    });
  } else if (coincide.size > 0) {
    [...coincide].sort((a, b) => cnt[b] - cnt[a]).slice(0, 14).forEach(j => {
      const q = smap.get(j); if (q) { const s = px(q); poner(N[j].n, s.x + q.r * k, s.y, false); }
    });
  } else {
    const limite = Math.min(70, Math.floor(7 * k * k) + 5);
    let n = 0;
    for (const o of orden) {
      if (n >= limite) break;
      const p = px(o);
      if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) continue;
      if (poner(N[o.i].n, p.x + o.r * k, p.y, false)) n++;
    }
  }
  textStyle(NORMAL);
}

function tooltip() {
  if (hov < 0 || sobreUI) return;
  const l1 = N[hov].n, l2 = cnt[hov] + (cnt[hov] === 1 ? ' trabajo' : ' trabajos') + ' · ' + G.clusters[N[hov].c].n;
  textSize(12); textStyle(NORMAL); textAlign(LEFT, TOP);
  const w = Math.max(textWidth(l1), textWidth(l2)) + 16;
  const x = Math.min(mouseX + 14, width - w - 8), y = Math.max(8, mouseY - 52);
  fill(16, 23, 32); stroke(36, 49, 66); strokeWeight(1);
  rect(x, y, w, 42, 6);
  noStroke(); fill(...TEXTO); text(l1, x + 8, y + 6);
  fill(146, 163, 184); text(l2, x + 8, y + 23);
}

/* ---------- ratón y teclado ---------- */

function elegirNodo() {
  const wx = (mouseX - vista.x) / vista.k, wy = (mouseY - vista.y) / vista.k;
  let mejor = null, md = 1e9;
  for (const n of sn) {
    if (n.hub) continue;
    const d = Math.hypot(n.x - wx, n.y - wy);
    if (d <= n.r + 5 / vista.k && d < md) { md = d; mejor = n; }
  }
  return mejor;
}

function mousePressed(ev) {
  pulsoEnLienzo = ev.target.tagName === 'CANVAS';
  arrastre = 0;
}

function mouseDragged() {
  if (!pulsoEnLienzo) return;
  vista.x += movedX; vista.y += movedY;
  arrastre += Math.abs(movedX) + Math.abs(movedY);
}

function mouseReleased() {
  if (!pulsoEnLienzo || arrastre > 4) return;
  const n = elegirNodo();
  elegir(n ? n.i : -1);
}

function mouseWheel(ev) {
  if (ev.target.tagName !== 'CANVAS') return true;
  const nk = constrain(vista.k * (ev.delta < 0 ? 1.12 : 1 / 1.12), 0.25, 10);
  vista.x = mouseX - (mouseX - vista.x) * (nk / vista.k);
  vista.y = mouseY - (mouseY - vista.y) * (nk / vista.k);
  vista.k = nk;
  return false;
}

function keyPressed() {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (key >= '1' && key <= String(MODOS.length)) cambiarModo(MODOS[+key - 1][0]);
  if (keyCode === ESCAPE) elegir(-1);
}

/* ---------- búsqueda, selección y ficha ---------- */

function buscar() {
  const q = plegar(buscador.value().trim());
  coincide = new Set();
  if (q.length < 2) return;
  for (let i = 0; i < N.length; i++) {
    if (cnt[i] < minW) continue;
    if (plegar(N[i].n).includes(q) || N[i].terms.some(t => plegar(t).includes(q))) coincide.add(i);
  }
}

function elegir(i) {
  sel = i;
  calcularVecinos();
  mostrarFicha(i);
}

function irA(i) {
  if (cnt[i] < minW) {
    minW = Math.max(1, cnt[i]);
    deslizador.value(minW);
    actualizarEtiquetaMin();
    reconstruir();
  }
  elegir(i);
  const o = smap.get(i);
  if (o) {
    vista.k = Math.max(vista.k, 1.4);
    vista.x = (width - 330) / 2 - o.x * vista.k;
    vista.y = height / 2 - o.y * vista.k;
  }
}

function el(tag, texto, atributos) {
  const e = document.createElement(tag);
  if (texto) e.textContent = texto;
  if (atributos) Object.assign(e, atributos);
  return e;
}

function filaBoton(j, derecha) {
  const b = el('button', '', { className: 'fila-btn', type: 'button' });
  b.append(el('span', N[j].n), el('span', derecha, { className: 'num' }));
  b.addEventListener('click', () => irA(j));
  return b;
}

function mostrarFicha(i) {
  const p = document.getElementById('panel');
  p.replaceChildren();
  if (i < 0) { p.classList.remove('abierto'); return; }
  p.classList.add('abierto');
  const n = N[i];
  const citas = n.ws.reduce((s, w) => s + w[1], 0);

  p.append(el('h2', n.n));
  p.append(el('a', 'Perfil en OpenAlex ↗', { href: 'https://openalex.org/' + n.id, target: '_blank', rel: 'noopener' }));
  p.append(el('p', cnt[i] + ' trabajos · ' + citas + ' citas · ' + G.clusters[n.c].n));

  if (n.terms.length) {
    p.append(el('h3', 'Términos frecuentes'));
    const chips = el('div', '', { className: 'chips' });
    n.terms.forEach(t => chips.append(el('span', t, { className: 'chip' })));
    p.append(chips);
  }

  const co = (window.adj?.get(i) || []).slice().sort((a, b) => b.w - a.w);
  p.append(el('h3', 'Coautores en este mapa (' + co.length + ')'));
  co.slice(0, 8).forEach(({ nodo: j, w }) => p.append(filaBoton(j, w + (w === 1 ? ' trabajo' : ' trabajos'))));

  p.append(el('h3', 'Trabajos más citados'));
  n.top.forEach(([titulo, anio, citasT, doi]) => {
    const d = el('div', '', { className: 'trabajo' });
    if (doi && doi.startsWith('https://')) d.append(el('a', titulo, { href: doi, target: '_blank', rel: 'noopener' }));
    else d.append(el('span', titulo));
    d.append(el('div', anio + ' · ' + citasT + ' citas', { className: 'meta' }));
    p.append(d);
  });
  p.scrollTop = 0;
}
