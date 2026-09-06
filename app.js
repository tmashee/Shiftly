const DAY = 'day';
const NIGHT = 'night';
const OFF = 'off';
const CRECHE = 'creche';
const PEOPLE = { intel: 'Intel', pfizer: 'Pfizer', creche: 'Crèche' };
const DEFAULT_SETTINGS = {
  intelFirstPattern: [3, -3, 4, -4, 3, -3, 4, -4, 4, -3, 3, -4, 4, -3, 3, -4],
  intelSecondPattern: [3, -4, 4, -3, 3, -4, 4, -4, 3, -3, 4, -4, 3, -3, 4, -3],
  intelAnchor: '2026-01-11', pfizerAnchor: '2025-06-30',
  pfizerPattern: [2, -2, 3, -2, 2, -3],
  crecheDays: [1, 2, 5]
};

const savedSettings = JSON.parse(localStorage.getItem('shiftly-settings') || '{}');
const savedPfizerPattern = Array.isArray(savedSettings.pfizerPattern) && savedSettings.pfizerPattern.every(Number.isInteger)
  ? savedSettings.pfizerPattern : DEFAULT_SETTINGS.pfizerPattern;
const state = {
  displayedMonth: new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), 1)),
  selectedDate: todayUTC(),
  settings: { ...DEFAULT_SETTINGS, ...savedSettings, pfizerPattern: savedPfizerPattern },
  overrides: JSON.parse(localStorage.getItem('shiftly-overrides') || '{}'),
  notes: JSON.parse(localStorage.getItem('shiftly-notes') || '{}'),
  theme: localStorage.getItem('shiftly-theme') || 'light'
};

function utcDate(year, month, day) { return new Date(Date.UTC(year, month - 1, day)); }
function dayKey(date) { return date.toISOString().slice(0, 10); }
function addDays(date, amount) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + amount); return next; }
function diffDays(a, b) { return Math.round((b - a) / 86400000); }
function mod(value, length) { return ((value % length) + length) % length; }
function format(date, options) { return new Intl.DateTimeFormat('en-IE', { ...options, timeZone: 'UTC' }).format(date); }

function patternShift(date, pattern, anchor, switchDays, startsWithDay) {
  const difference = diffDays(anchor, date);
  const cycleLength = pattern.reduce((sum, segment) => sum + Math.abs(segment), 0);
  const cycleDay = mod(difference, cycleLength);
  let cursor = 0;
  for (const segment of pattern) {
    const length = Math.abs(segment);
    if (cycleDay >= cursor && cycleDay < cursor + length) {
      if (segment < 0) return OFF;
      const switchPosition = mod(difference, switchDays * 2);
      const isDay = startsWithDay ? switchPosition < switchDays : switchPosition >= switchDays;
      return isDay ? DAY : NIGHT;
    }
    cursor += length;
  }
  return OFF;
}

function intel(date) {
  const july = utcDate(date.getUTCFullYear(), 7, 1);
  return date >= july
    ? patternShift(date, state.settings.intelSecondPattern, july, 28, false)
    : patternShift(date, state.settings.intelFirstPattern, dateFromInput(state.settings.intelAnchor), 28, false);
}

function pfizer(date) {
  const daysFromAnchor = diffDays(dateFromInput(state.settings.pfizerAnchor), date);
  const pattern = state.settings.pfizerPattern;
  const cycleLength = pattern.reduce((sum, segment) => sum + Math.abs(segment), 0);
  const cycleDay = mod(daysFromAnchor, cycleLength);
  const cycleNumber = Math.floor(daysFromAnchor / cycleLength);
  let cursor = 0;
  let workBlock = 0;
  for (const segment of pattern) {
    const length = Math.abs(segment);
    if (cycleDay >= cursor && cycleDay < cursor + length) {
      if (segment < 0) return OFF;
      return mod(workBlock + cycleNumber, 2) === 0 ? DAY : NIGHT;
    }
    if (segment > 0) workBlock += 1;
    cursor += length;
  }
  return OFF;
}

function creche(date) {
  if (date < utcDate(date.getUTCFullYear(), 9, 1)) return OFF;
  return state.settings.crecheDays.includes(date.getUTCDay()) ? CRECHE : OFF;
}

function shiftsFor(date) {
  const override = state.overrides[dayKey(date)] || {};
  return { intel: override.intel || intel(date), pfizer: override.pfizer || pfizer(date), creche: override.creche || creche(date) };
}

function typeLabel(type) { return ({ day: 'DAY', night: 'NIGHT', off: 'OFF', creche: 'ON' })[type]; }
function statusDescription(type) { return ({ day: 'Day shift', night: 'Night shift', off: 'Rest day', creche: 'Crèche' })[type]; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }

function render() { renderHero(); renderMonth(); renderOverlap(); }

function renderHero() {
  const date = state.selectedDate;
  const shifts = shiftsFor(date);
  const note = state.notes[dayKey(date)];
  const active = Object.entries(shifts).filter(([, type]) => type !== OFF);
  const title = active.length ? `${active.length} shift${active.length > 1 ? 's' : ''} today` : 'A day to recharge';
  const isToday = dayKey(date) === dayKey(todayUTC());
  document.querySelector('#nextShift').innerHTML = `<p class="overline">${isToday ? 'TODAY · ' : ''}${format(date, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}</p><div class="shift-main"><div><p class="shift-name">${isToday ? title : 'Pattern for this day'}</p><p class="shift-meta">${active.length ? `${active.length} scheduled` : 'No scheduled shifts'}</p></div><div class="shift-mark">${active.length ? '✦' : '☼'}</div></div><div class="selected-shifts">${Object.entries(shifts).map(([name, type]) => `<div class="selected-shift ${type}"><strong>${name.charAt(0).toUpperCase()} · ${PEOPLE[name]}</strong><span>${typeLabel(type)}</span></div>`).join('')}</div>${note?.text ? `<p class="selected-note"><strong>${note.type === 'note' ? 'NOTE' : typeLabel(note.type) || note.type.toUpperCase()}</strong> ${escapeHtml(note.text)}</p>` : ''}<button id="editDayButton" class="edit-day-button" type="button">Edit selected day</button>`;
  document.querySelector('#editDayButton').addEventListener('click', openEditor);
}

function renderMonth() {
  const view = state.displayedMonth;
  document.querySelector('#monthHeading').textContent = format(view, { month: 'long', year: 'numeric' });
  const grid = document.querySelector('#calendarGrid');
  grid.innerHTML = '';
  const startOffset = (view.getUTCDay() + 6) % 7;
  const start = addDays(view, -startOffset);
  const today = todayUTC();
  for (let index = 0; index < 42; index += 1) {
    const date = addDays(start, index);
    const shifts = shiftsFor(date);
    const inMonth = date.getUTCMonth() === view.getUTCMonth();
    const button = document.createElement('button');
    button.type = 'button';
    const overlap = shifts.intel !== OFF && shifts.pfizer !== OFF;
    button.className = `calendar-day${inMonth ? '' : ' outside'}${dayKey(date) === dayKey(today) ? ' today' : ''}${dayKey(date) === dayKey(state.selectedDate) ? ' selected' : ''}${overlap ? ' overlap' : ''}`;
    button.innerHTML = `${state.notes[dayKey(date)] ? '<i class="note-indicator" aria-label="Note added"></i>' : ''}<span class="date-number">${date.getUTCDate()}</span><span class="day-dots">${Object.entries(shifts).map(([name, type]) => `<i class="dot ${name} ${type}" aria-label="${PEOPLE[name]} ${typeLabel(type)}">${name.charAt(0).toUpperCase()}</i>`).join('')}</span>`;
    button.addEventListener('click', () => selectDay(date));
    grid.appendChild(button);
  }
}

function renderOverlap() {
  const month = state.displayedMonth;
  const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const overlaps = [];
  for (let day = 1; day <= days; day += 1) {
    const date = utcDate(month.getUTCFullYear(), month.getUTCMonth() + 1, day);
    const shifts = shiftsFor(date);
    if (shifts.intel !== OFF && shifts.pfizer !== OFF) overlaps.push(day);
  }
  const count = overlaps.length;
  document.querySelector('#overlapCount').textContent = `${count} day${count === 1 ? '' : 's'}`;
  document.querySelector('#overlapCard').innerHTML = `<div class="overlap-number">${count}</div><div><strong>Intel & Pfizer both working</strong><p>${count ? `They overlap on ${overlaps.join(', ')} ${format(month, { month: 'long' })}.` : `No shared working days in ${format(month, { month: 'long' })}.`}</p></div>`;
}

function selectDay(date) { state.selectedDate = date; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function openSettings() {
  const settings = state.settings;
  document.querySelector('#intelFirstPattern').value = settings.intelFirstPattern.join(', ');
  document.querySelector('#intelSecondPattern').value = settings.intelSecondPattern.join(', ');
  document.querySelector('#intelAnchor').value = settings.intelAnchor;
  document.querySelector('#pfizerAnchor').value = settings.pfizerAnchor;
  document.querySelector('#pfizerPattern').value = settings.pfizerPattern.join(', ');
  document.querySelector('#themeToggle').checked = state.theme === 'dark';
  document.querySelector('#crecheDays').innerHTML = [['M', 1], ['T', 2], ['W', 3], ['T', 4], ['F', 5], ['S', 6], ['S', 0]].map(([label, value]) => `<label class="weekday-option"><input type="checkbox" value="${value}" ${settings.crecheDays.includes(value) ? 'checked' : ''}>${label}</label>`).join('');
  document.querySelector('#sheetScrim').classList.remove('is-hidden'); document.querySelector('#settingsSheet').classList.remove('is-hidden');
}
function closeSettings() { document.querySelector('#sheetScrim').classList.add('is-hidden'); document.querySelector('#settingsSheet').classList.add('is-hidden'); }
function openEditor() {
  const date = state.selectedDate; const shifts = shiftsFor(date);
  document.querySelector('#dayEditorTitle').textContent = format(date, { day: 'numeric', month: 'long' });
  document.querySelector('#editorContent').innerHTML = Object.entries(shifts).map(([name, type]) => {
    const allowed = name === 'creche' ? [DAY, OFF] : [DAY, NIGHT, OFF];
    return `<div class="sheet-row"><div><strong>${PEOPLE[name]}</strong><span>Pattern: ${statusDescription(type)}</span></div><div class="sheet-toggle">${allowed.map(option => `<button class="type-button ${option === type ? 'selected' : ''}" data-person="${name}" data-type="${option}">${typeLabel(option)}</button>`).join('')}</div></div>`;
  }).join('');
  document.querySelectorAll('.type-button').forEach(button => button.addEventListener('click', saveDayOverride));
  const note = state.notes[dayKey(date)] || { type: 'note', text: '' };
  document.querySelector('#noteType').value = note.type;
  document.querySelector('#noteText').value = note.text;
  document.querySelector('#sheetScrim').classList.remove('is-hidden'); document.querySelector('#dayEditor').classList.remove('is-hidden');
}
function closeEditor() { document.querySelector('#sheetScrim').classList.add('is-hidden'); document.querySelector('#dayEditor').classList.add('is-hidden'); }
function syncAutomaticNote(key, date) {
  const override = state.overrides[key] || {};
  const toggledPeople = ['intel', 'pfizer'].filter(person => override[person] && override[person] !== ({ intel, pfizer, creche })[person](date));
  const note = state.notes[key];
  const isAutomatic = note?.automatic || /^(Intel|Pfizer) (Leave|OT)(, (Intel|Pfizer) (Leave|OT))*$/.test(note?.text || '');
  if (toggledPeople.length) {
    const allOff = toggledPeople.every(person => override[person] === OFF);
    state.notes[key] = { type: allOff ? 'leave' : 'overtime', text: toggledPeople.map(person => `${PEOPLE[person]} ${override[person] === OFF ? 'Leave' : 'OT'}`).join(', '), automatic: true };
  } else if (isAutomatic) delete state.notes[key];
}
function saveDayOverride(event) { const { person, type } = event.currentTarget.dataset; const key = dayKey(state.selectedDate); const originalType = ({ intel, pfizer, creche })[person](state.selectedDate); if (type === originalType) { if (state.overrides[key]) { delete state.overrides[key][person]; if (!Object.keys(state.overrides[key]).length) delete state.overrides[key]; } } else { state.overrides[key] = { ...(state.overrides[key] || {}), [person]: type }; } syncAutomaticNote(key, state.selectedDate); localStorage.setItem('shiftly-overrides', JSON.stringify(state.overrides)); localStorage.setItem('shiftly-notes', JSON.stringify(state.notes)); openEditor(); render(); }
function resetSelectedDay() { const key = dayKey(state.selectedDate); delete state.overrides[key]; delete state.notes[key]; localStorage.setItem('shiftly-overrides', JSON.stringify(state.overrides)); localStorage.setItem('shiftly-notes', JSON.stringify(state.notes)); closeEditor(); render(); }
function saveNote() { const type = document.querySelector('#noteType').value; const text = document.querySelector('#noteText').value.trim(); state.notes[dayKey(state.selectedDate)] = { type, text }; localStorage.setItem('shiftly-notes', JSON.stringify(state.notes)); closeEditor(); render(); }
function parsePattern(value) { const pattern = value.split(',').map(item => Number(item.trim())); if (!pattern.length || pattern.some(item => !Number.isInteger(item) || item === 0)) throw new Error('Use comma-separated non-zero whole numbers.'); return pattern; }
function dateFromInput(value) { const [year, month, day] = value.split('-').map(Number); return utcDate(year, month, day); }
function saveSettings(event) {
  event.preventDefault();
  try {
    state.settings = { intelFirstPattern: parsePattern(document.querySelector('#intelFirstPattern').value), intelSecondPattern: parsePattern(document.querySelector('#intelSecondPattern').value), intelAnchor: document.querySelector('#intelAnchor').value, pfizerAnchor: document.querySelector('#pfizerAnchor').value, pfizerPattern: parsePattern(document.querySelector('#pfizerPattern').value), crecheDays: [...document.querySelectorAll('#crecheDays input:checked')].map(input => Number(input.value)) };
    setTheme(document.querySelector('#themeToggle').checked ? 'dark' : 'light');
    localStorage.setItem('shiftly-settings', JSON.stringify(state.settings)); closeSettings(); render();
  } catch (error) { alert(error.message); }
}
function todayUTC() { const local = new Date(); return utcDate(local.getFullYear(), local.getMonth() + 1, local.getDate()); }
function goToday() { const today = todayUTC(); state.displayedMonth = utcDate(today.getUTCFullYear(), today.getUTCMonth() + 1, 1); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function setTheme(theme) { state.theme = theme; document.documentElement.dataset.theme = theme; localStorage.setItem('shiftly-theme', theme); }
function exportColor(type) { return ({ day: '#ffb36b', night: '#6e5ae6', off: '#e4e6e3', creche: '#f47e96' })[type]; }
function yearSvg(year) {
  const width = 1200, height = 1540, columns = 3, cardW = 350, cardH = 345, gapX = 35, gapY = 35, startX = 55, startY = 120;
  let content = `<rect width="${width}" height="${height}" fill="#f8f8f6"/><text x="55" y="65" font-family="Arial,sans-serif" font-size="35" font-weight="700" fill="#19212d">Shiftly · ${year}</text><text x="55" y="92" font-family="Arial,sans-serif" font-size="15" fill="#78818c">Intel, Pfizer and Crèche shift calendar</text>`;
  for (let month = 0; month < 12; month += 1) {
    const x = startX + (month % columns) * (cardW + gapX), y = startY + Math.floor(month / columns) * (cardH + gapY);
    const first = utcDate(year, month + 1, 1), offset = (first.getUTCDay() + 6) % 7, start = addDays(first, -offset);
    content += `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="20" fill="#fff" stroke="#e8e8e4"/><text x="${x + 18}" y="${y + 30}" font-family="Arial,sans-serif" font-size="19" font-weight="700" fill="#19212d">${format(first,{month:'long'})}</text>`;
    ['M','T','W','T','F','S','S'].forEach((label, i) => { content += `<text x="${x + 26 + i * 45}" y="${y + 58}" text-anchor="middle" font-family="Arial" font-size="10" fill="#78818c">${label}</text>`; });
    for (let index = 0; index < 42; index += 1) { const date = addDays(start, index), shifts = shiftsFor(date), cellX = x + 10 + (index % 7) * 47, cellY = y + 70 + Math.floor(index / 7) * 43, faded = date.getUTCMonth() !== month ? .32 : 1; content += `<g opacity="${faded}"><text x="${cellX + 18}" y="${cellY + 14}" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="#19212d">${date.getUTCDate()}</text>${Object.entries(shifts).map(([name,type], pos) => `<circle cx="${cellX + 9 + pos * 10}" cy="${cellY + 29}" r="4" fill="${exportColor(type)}"/><text x="${cellX + 9 + pos * 10}" y="${cellY + 31}" text-anchor="middle" font-family="Arial" font-size="5" font-weight="700" fill="#fff">${name.charAt(0).toUpperCase()}</text>`).join('')}</g>`; }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
}
function downloadBlob(blob, filename) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
function exportImage() { const year = state.displayedMonth.getUTCFullYear(), svg = yearSvg(year), image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1540; canvas.getContext('2d').drawImage(image, 0, 0); canvas.toBlob(blob => downloadBlob(blob, `shiftly-${year}.png`), 'image/png'); }; image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
function exportPdf() { const year = state.displayedMonth.getUTCFullYear(), svg = yearSvg(year), printWindow = window.open('', '_blank'); if (!printWindow) return; printWindow.document.write(`<title>Shiftly ${year}</title><style>@page{size:A4 portrait;margin:8mm}body{margin:0}img{display:block;width:100%;height:auto}</style><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`); printWindow.document.close(); printWindow.onload = () => printWindow.print(); }

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js');
setTheme(state.theme);

document.querySelector('#previousMonth').addEventListener('click', () => { state.displayedMonth = utcDate(state.displayedMonth.getUTCFullYear(), state.displayedMonth.getUTCMonth(), 1); renderMonth(); renderOverlap(); });
document.querySelector('#nextMonth').addEventListener('click', () => { state.displayedMonth = utcDate(state.displayedMonth.getUTCFullYear(), state.displayedMonth.getUTCMonth() + 2, 1); renderMonth(); renderOverlap(); });
document.querySelector('#todayButton').addEventListener('click', goToday);
document.querySelector('#settingsButton').addEventListener('click', openSettings);
document.querySelector('#closeSettings').addEventListener('click', closeSettings);
document.querySelector('#sheetScrim').addEventListener('click', () => { closeSettings(); closeEditor(); });
document.querySelector('#settingsForm').addEventListener('submit', saveSettings);
document.querySelector('#closeEditor').addEventListener('click', closeEditor);
document.querySelector('#resetDay').addEventListener('click', resetSelectedDay);
document.querySelector('#saveNote').addEventListener('click', saveNote);
document.querySelector('#exportImage').addEventListener('click', exportImage);
document.querySelector('#exportPdf').addEventListener('click', exportPdf);
render();
