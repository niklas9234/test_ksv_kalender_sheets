// app.js
// 1) HIER den veröffentlichten CSV-Link aus Google Sheets eintragen:
const CC_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTcFOBJa--mTuXyw4fDP_T7vu4r2g_p89Q8FRt5cWMMdE7FDnIM2lD9JFncfHyYplApE-LV7yr-svEn/pub?gid=102280899&single=true&output=csv";

// 2) Jahre: aktuelles + nächstes (Browser-Jahr)
function getYearOptions() {
  const y = new Date().getFullYear();
  return [y, y + 1];
}

const CC_MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];
const CC_DOW_SHORT = ["So", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Fr", "Sa"]; // JS getDay() index
const CC_WEEKEND_DOW = [
  { key: "fri", jsDay: 5, label: "Fr" },
  { key: "sat", jsDay: 6, label: "Sa" },
  { key: "sun", jsDay: 0, label: "So" },
];

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseIsoDate(iso) {
  // iso: YYYY-MM-DD
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDisplayDE(dateObj) {
  // "Montag, 13.04" wie in deinem Sheet
  const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(dateObj);
  const d = dateObj.getDate(); // ohne führende 0
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  return `${weekday}, ${d}.${m}`;
}

// --- CSV parsing (robust enough for published sheet) ---
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

async function loadFromCsv() {
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

  // Map: iso -> label (nur echte Einträge aus dem Sheet)
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delim);
    const iso = (cols[idxIso] || "").trim();
    const label = (cols[idxDisp] || "").trim();
    if (!iso) continue;
    map.set(iso, label || "");
  }
  return map;
}

// Samstag belegt => Sonntag automatisch belegt
function applySaturdayBlocksSunday(baseMap) {
  const out = new Map(baseMap);

  for (const [iso, label] of baseMap.entries()) {
    const d = parseIsoDate(iso);
    if (d.getDay() === 6) { // Samstag
      const sunday = addDays(d, 1);
      const sunIso = isoDate(sunday);
      if (!out.has(sunIso)) {
        // Sonntag bekommt "normal belegt" – wir erzeugen ein Display-Label
        out.set(sunIso, formatDisplayDE(sunday));
      }
    }
  }
  return out;
}

function monthName(year, monthIndex) {
  return `${CC_MONTHS[monthIndex]} ${year}`;
}

function getBookedWeekdaysInMonth(year, monthIndex, busyMap) {
  // Mo–Do (JS: 1..4) nur wenn in Daten
  const out = [];
  for (const [iso, label] of busyMap.entries()) {
    const d = parseIsoDate(iso);
    if (d.getFullYear() !== year) continue;
    if (d.getMonth() !== monthIndex) continue;
    const dow = d.getDay();
    if (dow >= 1 && dow <= 4) {
      out.push({ iso, label: label || formatDisplayDE(d), dateObj: d });
    }
  }
  out.sort((a, b) => a.iso.localeCompare(b.iso));
  return out;
}

function getWeekendRowsForMonth(year, monthIndex) {
  // Wochenenden werden über Freitage definiert (jede Freitag startet einen Block Fr/Sa/So)
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);

  // finde den ersten Freitag, der in diesem Monat liegt
  let d = new Date(first);
  while (d.getDay() !== 5) d = addDays(d, 1);

  const rows = [];
  while (d <= last) {
    const fri = new Date(d);
    const sat = addDays(fri, 1);
    const sun = addDays(fri, 2);
    rows.push({ fri, sat, sun });
    d = addDays(d, 7);
  }
  return rows;
}

function renderMonth(year, monthIndex, busyMap) {
  const monthEl = document.createElement("section");
  monthEl.className = "month";

  const h = document.createElement("h2");
  h.textContent = monthName(year, monthIndex);
  monthEl.appendChild(h);

  // Wochenenden
  const wTitle = document.createElement("div");
  wTitle.className = "section-title";
  //wTitle.textContent = "Wochenenden (Fr–So)";
  monthEl.appendChild(wTitle);

  const weekendGrid = document.createElement("div");
  weekendGrid.className = "weekend-grid";

  const rows = getWeekendRowsForMonth(year, monthIndex);
  for (const row of rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "weekend-row";

    for (const dayObj of [row.fri, row.sat, row.sun]) {
      const iso = isoDate(dayObj);
      const inMonth = dayObj.getMonth() === monthIndex;
      const booked = busyMap.has(iso);

      const cell = document.createElement("div");
      cell.className = `cell ${booked ? "busy" : "free"} ${inMonth ? "" : "out"}`;

      const top = document.createElement("div");
      top.className = "cell-top";

      const day = document.createElement("div");
      day.className = "day";
      day.textContent = String(dayObj.getDate());

      const dow = document.createElement("div");
      dow.className = "dow";
      dow.textContent = CC_DOW_SHORT[dayObj.getDay()];

      top.appendChild(day);
      top.appendChild(dow);

      const tag = document.createElement("div");
      tag.className = "tag";
      tag.textContent = booked ? "belegt" : "frei";

      cell.appendChild(top);
      cell.appendChild(tag);

      const label = busyMap.get(iso) || formatDisplayDE(dayObj);
      cell.title = booked ? `${label} – belegt` : `${label} – frei`;

      rowEl.appendChild(cell);
    }

    weekendGrid.appendChild(rowEl);
  }

  monthEl.appendChild(weekendGrid);

  // Mo–Do nur wenn belegt
  const weekdayBookings = getBookedWeekdaysInMonth(year, monthIndex, busyMap);

  const wdTitle = document.createElement("div");
  wdTitle.className = "section-title";
  //wdTitle.textContent = "Mo–Do (nur bei Vermietung)";
  monthEl.appendChild(wdTitle);

  if (weekdayBookings.length === 0) {
    const none = document.createElement("div");
    none.className = "muted";
    none.style.fontSize = "13px";
    none.textContent = "Keine Vermietungen an Mo–Do.";
    monthEl.appendChild(none);
  } else {
    const list = document.createElement("ul");
    list.className = "weekday-list";

    for (const b of weekdayBookings) {
      const li = document.createElement("li");
      li.className = "weekday-item";

      const label = document.createElement("div");
      label.className = "label";
      label.textContent = b.label || formatDisplayDE(b.dateObj);

      const pill = document.createElement("div");
      pill.className = "pill";
      pill.textContent = "belegt";

      li.title = `${label.textContent} – belegt`;
      li.appendChild(label);
      li.appendChild(pill);
      list.appendChild(li);
    }

    monthEl.appendChild(list);
  }

  return monthEl;
}

function renderYear(year, busyMap) {
  const root = document.getElementById("cc-root");
  root.innerHTML = "";

  for (let m = 0; m < 12; m++) {
    root.appendChild(renderMonth(year, m, busyMap));
  }
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
      const base = await loadFromCsv();
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
  ALL_BUSY = null; // force re-fetch
  reload();
});
document.getElementById("cc-year").addEventListener("change", reload);
reload();