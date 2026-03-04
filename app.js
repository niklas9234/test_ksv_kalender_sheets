// app.js
// Minimal-Stand: jeder Monat zeigt NUR seine Tage.
// Einzige Zusatzregel: Samstag belegt => Sonntag auch belegt.

const CC_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTcFOBJa--mTuXyw4fDP_T7vu4r2g_p89Q8FRt5cWMMdE7FDnIM2lD9JFncfHyYplApE-LV7yr-svEn/pub?gid=102280899&single=true&output=csv";

// Jahre: aktuelles + nächstes
function getYearOptions() {
  const y = new Date().getFullYear();
  return [y, y + 1];
}

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];

const DOW_DE = ["MO", "DI", "MI", "DO", "FR", "SA", "SO"]; // Anzeige

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

// 0=Mo..6=So
function monFirstDowIndex(date) {
  return (date.getDay() + 6) % 7;
}

function formatDisplayDE(dateObj) {
  const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(dateObj);
  const d = dateObj.getDate();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  return `${weekday}, ${d}.${m}`;
}

// --- CSV parsing ---
function detectDelimiter(line) {
  const semis = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return semis >= commas ? ";" : ",";
}

function splitCsvLine(line, delim) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delim && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur.trim());
  return out.map((s) => s.replace(/^"|"$/g, "").trim());
}

async function loadBusyMapFromCsv() {
  const res = await fetch(CC_CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`CSV HTTP ${res.status}`);

  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return new Map();

  const delim = detectDelimiter(lines[0]);
  const header = splitCsvLine(lines[0], delim);

  const idxIso = header.indexOf("date_iso");
  const idxDisp = header.indexOf("date_display");
  if (idxIso === -1 || idxDisp === -1) {
    throw new Error(`CSV Header braucht date_iso & date_display. Gefunden: ${header.join(" | ")}`);
  }

  const map = new Map(); // iso -> label
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delim);
    const iso = (cols[idxIso] || "").trim();
    const label = (cols[idxDisp] || "").trim();
    if (!iso) continue;
    map.set(iso, label || "");
  }
  return map;
}

// Samstag belegt => Sonntag belegt
function applySaturdayBlocksSunday(baseMap) {
  const out = new Map(baseMap);

  for (const [iso] of baseMap.entries()) {
    const d = parseIsoDate(iso);
    if (d.getDay() === 6) { // Samstag
      const sun = addDays(d, 1);
      const sunIso = isoDate(sun);
      if (!out.has(sunIso)) out.set(sunIso, formatDisplayDE(sun));
    }
  }

  return out;
}

// --- Rendering ---
function createDayCell({ date, busyMap }) {
  const dowIndex = monFirstDowIndex(date);
  const isWeekendColumn = dowIndex >= 4; // Fr, Sa, So
  const key = isoDate(date);
  const booked = busyMap.has(key);

  const cell = document.createElement("div");
  cell.className = `day ${booked ? "busy" : "free"} ${isWeekendColumn ? "long" : "short"}`;

  const top = document.createElement("div");
  top.className = "top";

  const num = document.createElement("div");
  num.className = "num";
  num.textContent = String(date.getDate());

  top.appendChild(num);

  const bottom = document.createElement("div");
  bottom.className = "bottom";
  bottom.textContent = isWeekendColumn ? (booked ? "belegt" : "frei") : "";

  cell.appendChild(top);
  cell.appendChild(bottom);

  const label = busyMap.get(key) || formatDisplayDE(date);
  cell.title = booked ? `${label} – belegt` : `${label} – frei`;

  return cell;
}

function createPlaceholder() {
  const el = document.createElement("div");
  el.className = "day out placeholder";
  el.setAttribute("aria-hidden", "true");
  return el;
}

function renderMonth(year, monthIndex, busyMap) {
  const monthEl = document.createElement("section");
  monthEl.className = "month";

  const h = document.createElement("h2");
  h.textContent = `${MONTHS_DE[monthIndex]} ${year}`;
  monthEl.appendChild(h);

  const dow = document.createElement("div");
  dow.className = "cal-dow";
  for (const dowLabel of DOW_DE) {
    const el = document.createElement("div");
    el.textContent = dowLabel;
    dow.appendChild(el);
  }
  monthEl.appendChild(dow);

  const grid = document.createElement("div");
  grid.className = "cal-grid";

  const first = new Date(year, monthIndex, 1);
  const pad = monFirstDowIndex(first); // 0..6
  const dim = daysInMonth(year, monthIndex);

  // leading placeholders
  for (let i = 0; i < pad; i++) {
    grid.appendChild(createPlaceholder());
  }

  // actual days (only days that belong to this month)
  for (let day = 1; day <= dim; day++) {
    const date = new Date(year, monthIndex, day);
    grid.appendChild(createDayCell({ date, busyMap }));
  }

  // trailing placeholders to complete the last week
  const total = pad + dim;
  const rest = (7 - (total % 7)) % 7;
  for (let i = 0; i < rest; i++) {
    grid.appendChild(createPlaceholder());
  }

  monthEl.appendChild(grid);
  return monthEl;
}

function renderYear(year, busyMap) {
  const root = document.getElementById("cc-root");
  root.innerHTML = "";
  for (let m = 0; m < 12; m++) root.appendChild(renderMonth(year, m, busyMap));
}

function setupYearSelect() {
  const sel = document.getElementById("cc-year");
  const years = getYearOptions();
  sel.innerHTML = "";
  for (const y of years) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    sel.appendChild(opt);
  }
  sel.value = String(years[0]);
}

let ALL_BUSY = null;

async function reload() {
  const status = document.getElementById("cc-status");
  const year = parseInt(document.getElementById("cc-year").value, 10);

  try {
    status.textContent = "Lade…";
    if (!ALL_BUSY) {
      const base = await loadBusyMapFromCsv();
      ALL_BUSY = applySaturdayBlocksSunday(base);
    }
    renderYear(year, ALL_BUSY);
    status.textContent = `OK (${new Date().toLocaleString("de-DE")})`;
  } catch (e) {
    status.textContent = `Fehler: ${e.message}`;
  }
}

// init
setupYearSelect();
document.getElementById("cc-reload").addEventListener("click", () => {
  ALL_BUSY = null;
  reload();
});
document.getElementById("cc-year").addEventListener("change", reload);
reload();
