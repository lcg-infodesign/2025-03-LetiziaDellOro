// ============================================================================
// LAYOUT: canvas accanto alla sidebar. Questi valori devono riflettere il CSS.
// ============================================================================
const SIDEBAR_W = 320 + 32; // 320 = larghezza sidebar; +32 ≈ margin/padding sinistro del canvas-holder
const HEADER_H  = 56;       // altezza della fascia dei titoli (header)

// --- CALIBRAZIONE immagine mappa --------------------------------------------
// La  PNG non coincide perfettamente con la proiezione equirettangolare “pura”.
// Applico quindi uno SHIFT percentuale sul rettangolo della mappa disegnata:
//  - CAL_X < 0 sposta i punti a sinistra (in percentuale della larghezza disegnata)
//  - CAL_Y > 0 sposta i punti verso il basso (in percentuale dell’altezza disegnata)
const CAL_X = -0.03;  // -3% della larghezza della mappa (verso sinistra)
const CAL_Y =  0.12;  // +12% dell’altezza della mappa (verso il basso)

// Ridimensiono/creo il canvas in base allo SPAZIO REALE rimasto nel layout.
function sizeCanvasToLayout(){
  // imposto minimi per evitare canvas minuscoli su schermi stretti
  const availW = Math.max(320, windowWidth  - SIDEBAR_W - 32); // -32 ≈ padding del holder
  const availH = Math.max(320, windowHeight - HEADER_H  - 24); // -24 ≈ “respiro” in basso

  if (!window._cnv) {
    // Creo il canvas UNA volta e lo monto dentro #canvas-holder (HTML)
    window._cnv = createCanvas(availW, availH).parent('canvas-holder');
  } else {
    // Se esiste già, lo ridimensiono: fondamentale quando cambia la finestra
    resizeCanvas(availW, availH);
  }
}

// ============================================================================
// DATI GLOBALI
// ============================================================================
let worldMap;
let volcanoesRows = [];
let volcanoPositions = []; // cache: coordinate e metadati per hover
let hoveredVolcano = null;
let volcanoesRaw = [];

// (lato legenda nel DOM 
const LEGEND_SIDE = "right";

// ---- NEW: estremi dataset per mappare con map() “stile prof”
let MIN_LAT = null, MAX_LAT = null, MIN_LON = null, MAX_LON = null; // NEW

// ============================================================================
// CARICAMENTO (p5 preload): immagine mappa + CSV (come array di righe)
// ============================================================================
function preload() {
  worldMap     = loadImage('mappa-del-mondo.png');
  volcanoesRaw = loadStrings('volcanoes-2025-10-27 - Es.3.csv');
}

// ============================================================================
// SETUP
// ============================================================================
function setup() {
  sizeCanvasToLayout();     // creo/posiziono il canvas in base al layout
  background(0);
  textFont('Arial');

  // Parsing “flessibile” del CSV
  volcanoesRows = parseCSVFlexible(volcanoesRaw);

  // ---- NEW: calcolo min/max lat/lon dal dataset (stile prof)
  const lats = [];
  const lons = [];
  for (const r of volcanoesRows) {
    const la = getNumVal(r, 'Latitude');
    const lo = getNumVal(r, 'Longitude');
    if (Number.isFinite(la)) lats.push(la);
    if (Number.isFinite(lo)) lons.push(lo);
  }
  if (lats.length && lons.length) {
    MIN_LAT = Math.min(...lats);
    MAX_LAT = Math.max(...lats);
    MIN_LON = Math.min(...lons);
    MAX_LON = Math.max(...lons);
  } // (se il CSV è vuoto, i MIN/MAX resteranno null e useremo il fallback) // NEW

  const legend = document.getElementById('legend');
  if (legend) {
    legend.classList.remove('left','right');
    legend.classList.add(LEGEND_SIDE === 'left' ? 'left' : 'right');
  }
}

// Alla modifica della finestra, ricalcolo la dimensione corretta del canvas
function windowResized(){ sizeCanvasToLayout(); }

// ============================================================================
// DRAW: disegno mappa + griglia + vulcani + gestione hover/tooltip
// ============================================================================
function draw() {
  background(0);

  // 1) Adatto l’immagine della mappa dentro al canvas mantenendo le proporzioni
  //    e la centro. Uso un max-height più “comodo” (0.9 dell’altezza del canvas).
  let mapW = width * 0.9;
  let mapH = (worldMap.height / worldMap.width) * mapW;
  if (mapH > height * 0.9) {              // se usce in altezza
    mapH = height * 0.9;                   // la limito
    mapW = (worldMap.width / worldMap.height) * mapH; // e ricalcolo la larghezza
  }
  const mapX = (width  - mapW) / 2;       // centro orizzontale
  const mapY = (height - mapH) / 2;       // centro verticale 

  // 2) Mappa + griglia
  image(worldMap, mapX, mapY, mapW, mapH);
  drawCoordinateGrid(mapX, mapY, mapW, mapH);

  // 3) Disegno vulcani (e salvo posizioni/metadati per hover)
  drawVolcanoes(mapX, mapY, mapW, mapH);

  // 4) Hover + tooltip HTML (il box è un elemento <div id="tip"> nel DOM)
  handleVolcanoHover();
  updateTooltip();
}

// ============================================================================
// PARSING CSV “flessibile” 
// - Riconosce automaticamente ; o , come separatore
// - La regex `splitter` evita di spezzare dentro ai campi tra virgolette
// ============================================================================
const norm = s => String(s).toLowerCase().replace(/[\s_()\-]/g, '');

function parseCSVFlexible(lines) {
  const headerLine = lines.find(l => l && l.trim()) || '';
  const delim = headerLine.includes(';') ? ';' : ',';                    // auto-detect
  const splitter = new RegExp(`${delim}(?=(?:[^"]*"[^"]*")*[^"]*$)`);    // split fuori dalle virgolette

  const header     = headerLine.split(splitter).map(h => h.replace(/^"|"$/g,'').trim());
  const headerNorm = header.map(norm);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const parts = raw.split(splitter).map(v => v.replace(/^"|"$/g,'').trim());
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[headerNorm[c] || `col${c}`] = parts[c] ?? '';
    rows.push(obj);
  }
  return rows;
}

function getVal(rowObj, wantedName) {
  const key = norm(wantedName);
  return (key in rowObj) ? rowObj[key] : '';
}
function getNumVal(rowObj, wantedName) {
  // Converte “12,5” → 12.5 e gestisce NaN
  const v = parseFloat(String(getVal(rowObj, wantedName)).replace(',', '.'));
  return Number.isFinite(v) ? v : NaN;
}

// ============================================================================
// PROIEZIONE / GRIGLIA
// - Proiezione equirettangolare standard per convertire (lat,lon) → (x,y)
// - + offset di calibrazione (CAL_X, CAL_Y) per allineare i punti alla tua PNG
// ============================================================================
function latLonToPixel(lat, lon, mapX, mapY, mapW, mapH) {
  // --- NEW: se ho min/max dal dataset, uso map() “stile prof”.
  if (MIN_LAT !== null && MAX_LAT !== null && MIN_LON !== null && MAX_LON !== null) {
    let x = map(lon, MIN_LON, MAX_LON, mapX, mapX + mapW);
    let y = map(lat, MAX_LAT, MIN_LAT, mapY, mapY + mapH); // lat “capovolta”
    // calibrazione rispetto alla PNG (come già previsto)
    x += mapW * CAL_X;
    y += mapH * CAL_Y;
    return { x, y };
  }
  // Fallback: formula precedente in caso mancassero gli estremi
  const x = mapX + ((lon + 180) / 360) * mapW + mapW * CAL_X; // shift orizzontale
  const y = mapY + ((90  -  lat) / 180) * mapH + mapH * CAL_Y; // shift verticale
  return { x, y };
}

function drawCoordinateGrid(mapX, mapY, mapW, mapH) {
  stroke(100, 100, 100, 140); strokeWeight(1);
  textSize(11); textAlign(CENTER, TOP); fill(200);

  // Meridiani (lon ogni 30°) + etichette in basso
  for (let lon = -180; lon <= 180; lon += 30) {
    const a = latLonToPixel( 90, lon, mapX, mapY, mapW, mapH);
    const b = latLonToPixel(-90, lon, mapX, mapY, mapW, mapH);
    line(a.x, a.y, b.x, b.y);
    noStroke(); text(lon + "°", a.x, mapY + mapH + 8); stroke(100, 100, 100, 140);
  }

  // Paralleli (lat ogni 30°) + etichette a sinistra
  for (let lat = -90; lat <= 90; lat += 30) {
    const a = latLonToPixel(lat, -180, mapX, mapY, mapW, mapH);
    const b = latLonToPixel(lat,  180, mapX, mapY, mapW, mapH);
    line(a.x, a.y, b.x, b.y);
    noStroke(); textAlign(RIGHT, CENTER); text(lat + "°", mapX - 10, a.y);
    stroke(100, 100, 100, 140); textAlign(CENTER, TOP);
  }

  // Equatore un po’ più marcato 
  stroke(180, 180, 180, 200); strokeWeight(2);
  const e1 = latLonToPixel(0, -180, mapX, mapY, mapW, mapH);
  const e2 = latLonToPixel(0,  180, mapX, mapY, mapW, mapH);
  line(e1.x, e1.y, e2.x, e2.y);

}

// ============================================================================
// VULCANI + GLIFI
// - Converto ogni riga → coordinate proiettate
// - Filtro se escono dal rettangolo mappa (es. per sicurezza)
// - Mappo elevazione → dimensione, status → colore, eruzione → alpha
// ============================================================================
function drawVolcanoes(mapX, mapY, mapW, mapH) {
  volcanoPositions = [];
  if (!volcanoesRows.length) return;

  for (const row of volcanoesRows) {
    const lat = getNumVal(row, 'Latitude');
    const lon = getNumVal(row, 'Longitude');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const pos = latLonToPixel(lat, lon, mapX, mapY, mapW, mapH);
    // Sicurezza: disegno solo se il punto cade dentro il rettangolo della mappa
    if (pos.x < mapX || pos.x > mapX + mapW || pos.y < mapY || pos.y > mapY + mapH) continue;

    const name      = getVal(row, 'Volcano Name') || 'Unknown';
    const country   = getVal(row, 'Country')      || 'Unknown';
    const location  = getVal(row, 'Location')     || 'Unknown';
    const type      = getVal(row, 'Type')         || 'Unknown';
    const status    = getVal(row, 'Status')       || 'Unknown';
    const eruption  = getVal(row, 'Last Known Eruption') || 'Unknown';
    const elevation = getNumVal(row, 'Elevation (m)');

    // Elevazione → diametro (clamp tra 3 e 12)
    const size  = Number.isFinite(elevation) ? constrain(map(Math.abs(elevation), 0, 6000, 3, 12), 3, 12) : 4;
    // Tipo → glifo circolare
    const glyph = typeToCircleGlyph(type);
    // Status → colore giallo→rosso
    const col   = statusToYellowRed(status);

    // “Opacità informativa”: più recente = più opaco
    const e = String(eruption);
    col.setAlpha(e.includes('D1') ? 255 : e.includes('D2') ? 240 : e.includes('U') ? 220 : 200);

    // Disegno il glifo
    drawCircleGlyph(pos.x, pos.y, size, glyph, col);

    // Salvo i dati per hover/tooltip
    volcanoPositions.push({
      x:pos.x, y:pos.y, size,
      name, country, location, elevation: Number.isFinite(elevation) ? elevation : 0,
      type, status, eruption
    });
  }
}

// Mappatura tipo → glifo (tutte variazioni “a cerchio” per una famiglia coerente)
function typeToCircleGlyph(type) {
  const t = String(type).toLowerCase();

  if (t.includes('stratovolcano') || t.includes('somma')) return 'circle';
  if (t.includes('shield')) return 'triangle';
  if (t.includes('field') || t.includes('fissure')) return 'square';
  if (t.includes('caldera') || t.includes('maar') || t.includes('tuff')) return 'ring';
  if (t.includes('complex') || t.includes('compound')) return 'pentagon';
  if (t.includes('submarine') || t.includes('subglacial')) return 'cross';
  if (t.includes('cinder') || t.includes('pyroclastic')) return 'rect';
  if (t.includes('dome')) return 'star';
  if (t.includes('crater') || t.includes('other')) return 'oval';

  return 'circle'; // fallback
}

// Status → colore (giallo → arancio → rosso). Le soglie sono qualitative.
function statusToYellowRed(status) {
  const c1 = color(255, 210, 0), c2 = color(230, 40, 20);
  const s = String(status).toLowerCase();
  let t = 0.35;
  if (s.includes('pleistocene')) t = 0.10;   // più “vecchio” = più verso il giallo
  else if (s.includes('holocene')) t = 0.55; // intermedio
  else if (s.includes('historical')) t = 1.00; // documentato = rosso
  return lerpColor(c1, c2, constrain(t, 0, 1));
}

// Disegno effettivo dei glifi circolari (tutte varianti coerenti)
function drawCircleGlyph(x, y, size, kind, col) {
  push();
  stroke(col);
  fill(col);
  strokeWeight(1.2);

  switch (kind) {
    case 'circle': // Stratovolcano / Somma
      ellipse(x, y, size * 1.8, size * 1.8);
      break;

    case 'triangle': // Shield
      // triangolo equilatero punta in su
      const h = size * 1.8;
      triangle(x, y - h * 0.58, x - h * 0.5, y + h * 0.42, x + h * 0.5, y + h * 0.42);
      break;

    case 'square': // Volcanic field / Fissures
      rectMode(CENTER);
      rect(x, y, size * 1.8, size * 1.8);
      break;

    case 'ring': // Caldera / Maar / Tuff
      noFill();
      ellipse(x, y, size * 2.0, size * 2.0);
      break;

    case 'pentagon': // Complex / Compound
      drawRegularPolygon(x, y, 5, size * 1.2);
      break;

    case 'cross': // Submarine / Subglacial
      noFill();
      strokeWeight(1.6);
      line(x - size * 1.2, y, x + size * 1.2, y);
      line(x, y - size * 1.2, x, y + size * 1.2);
      break;

    case 'rect': // Pyroclastic & Cinder cones
      rectMode(CENTER);
      rect(x, y, size * 2.4, size * 1.0);
      break;

    case 'star': // Lava dome
      drawStar5(x, y, size * 1.2, size * 0.55);
      break;

    case 'oval': // Crater / Others
      ellipse(x, y, size * 2.4, size * 1.4);
      break;

    default: // fallback
      ellipse(x, y, size * 1.8, size * 1.8);
  }

  pop();
}

// ---------- helper per le nuove forme ----------
function drawRegularPolygon(cx, cy, n, r) {
  beginShape();
  for (let i = 0; i < n; i++) {
    const a = -HALF_PI + (TWO_PI * i) / n;
    vertex(cx + cos(a) * r, cy + sin(a) * r);
  }
  endShape(CLOSE);
}

function drawStar5(cx, cy, rOuter, rInner) {
  beginShape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = -HALF_PI + (TWO_PI * i) / 10;
    vertex(cx + cos(a) * r, cy + sin(a) * r);
  }
  endShape(CLOSE);
}

// ============================================================================
// HOVER / TOOLTIP
// - handleVolcanoHover: trova il primo vulcano “vicino” al mouse
// - updateTooltip: compila/posiziona il <div id="tip"> (HTML) vicino al mouse
// ============================================================================
function handleVolcanoHover() {
  hoveredVolcano = null;
  for (const v of volcanoPositions) {
    if (dist(mouseX, mouseY, v.x, v.y) <= v.size + 4) { hoveredVolcano = v; break; }
  }
  document.body.style.cursor = hoveredVolcano ? 'pointer' : 'default';
}

function updateTooltip() {
  const tip = document.getElementById('tip');
  if (!tip) return;                 // se nel DOM non c’è il box, esco
  if (!hoveredVolcano) { tip.hidden = true; return; }

  const v = hoveredVolcano;
  tip.innerHTML = `
    <div class="name">${v.name}</div>
    <div>Country: ${v.country}</div>
    <div>Location: ${v.location}</div>
    <div>Elevation: ${v.elevation} m</div>
    <div>Type: ${v.type}</div>
    <div>Last Eruption: ${v.eruption}</div>
  `;

  // Posiziono vicino al mouse, ma “clamp” dentro allo schermo per non farlo uscire
  const pad = 12;
  let x = mouseX + 16, y = mouseY + 16;
  const w = tip.offsetWidth  || 260;
  const h = tip.offsetHeight || 128;
  if (x + w + pad > window.innerWidth)  x = mouseX - w - 16;
  if (y + h + pad > window.innerHeight) y = mouseY - h - 16;
  tip.style.left = `${x}px`;
  tip.style.top  = `${y}px`;
  tip.hidden = false;
}
