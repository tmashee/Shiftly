import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { browserLocalPersistence, getAuth, GoogleAuthProvider, linkWithPopup, setPersistence, signInAnonymously, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { doc, getFirestore, onSnapshot, setDoc } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCJgBqGe9HvTLdzg3Sn8lbGetWpj8nGtNU',
  authDomain: 'shiftly-4102a.firebaseapp.com',
  projectId: 'shiftly-4102a',
  storageBucket: 'shiftly-4102a.firebasestorage.app',
  messagingSenderId: '274876588338',
  appId: '1:274876588338:web:e7071fcf4fa56c3fe3b72b',
  measurementId: 'G-8LWRFKCB1Y'
};
const firebaseApp = initializeApp(firebaseConfig);
const firebaseAuth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);
let cloudDocument;
let cloudReady = false;
let currentUserId;
let currentUserLabel = 'Anonymous device';
let undoSnapshot;
let cloudWriteQueue = Promise.resolve();
let stopCloudListener;

// Shift status values and default schedule configuration.
const DAY = 'day';
const NIGHT = 'night';
const OFF = 'off';
const CRECHE = 'creche';
const DEFAULT_PEOPLE = { intel: 'Int', pfizer: 'Pfi', creche: 'Crè' };
const DEFAULT_SETTINGS = {
  intelFirstPattern: [3, -3, 4, -4, 3, -3, 4, -4, 4, -3, 3, -4, 4, -3, 3, -4],
  intelSecondPattern: [3, -4, 4, -3, 3, -4, 4, -4, 3, -3, 4, -4, 3, -3, 4, -3],
  intelAnchor: '2026-01-11', pfizerAnchor: '2025-06-30',
  pfizerPattern: [2, -2, 3, -2, 2, -3],
  crecheDays: [1, 2, 5]
};

// Restore saved preferences before building the application state.
function readStoredObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    return {};
  }
}
function isValidPattern(pattern) { return Array.isArray(pattern) && pattern.length > 0 && pattern.every(value => Number.isInteger(value) && value !== 0); }
function isValidCrecheDays(days) { return Array.isArray(days) && days.length > 0 && days.every(day => Number.isInteger(day) && day >= 0 && day <= 6) && new Set(days).size === days.length; }
function isValidDateInput(value) { const date = new Date(`${value}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()); }
const savedSettings = readStoredObject('shiftly-settings');
const savedVisibility = readStoredObject('shiftly-calendar-visibility');
const state = {
  displayedMonth: new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), 1)),
  selectedDate: todayUTC(),
  settings: {
    intelName: typeof savedSettings.intelName === 'string' && savedSettings.intelName.trim() ? savedSettings.intelName.trim() : DEFAULT_PEOPLE.intel,
    pfizerName: typeof savedSettings.pfizerName === 'string' && savedSettings.pfizerName.trim() ? savedSettings.pfizerName.trim() : DEFAULT_PEOPLE.pfizer,
    crecheName: typeof savedSettings.crecheName === 'string' && savedSettings.crecheName.trim() ? savedSettings.crecheName.trim() : DEFAULT_PEOPLE.creche,
    intelFirstPattern: isValidPattern(savedSettings.intelFirstPattern) ? [...savedSettings.intelFirstPattern] : [...DEFAULT_SETTINGS.intelFirstPattern],
    intelSecondPattern: isValidPattern(savedSettings.intelSecondPattern) ? [...savedSettings.intelSecondPattern] : [...DEFAULT_SETTINGS.intelSecondPattern],
    intelAnchor: isValidDateInput(savedSettings.intelAnchor) ? savedSettings.intelAnchor : DEFAULT_SETTINGS.intelAnchor,
    pfizerAnchor: isValidDateInput(savedSettings.pfizerAnchor) ? savedSettings.pfizerAnchor : DEFAULT_SETTINGS.pfizerAnchor,
    pfizerPattern: isValidPattern(savedSettings.pfizerPattern) ? [...savedSettings.pfizerPattern] : [...DEFAULT_SETTINGS.pfizerPattern],
    crecheDays: isValidCrecheDays(savedSettings.crecheDays) ? [...savedSettings.crecheDays] : [...DEFAULT_SETTINGS.crecheDays]
  },
  overrides: readStoredObject('shiftly-overrides'),
  visibility: { intel: savedVisibility.intel !== false, pfizer: savedVisibility.pfizer !== false, creche: savedVisibility.creche !== false },
  notes: readStoredObject('shiftly-notes'),
  theme: localStorage.getItem('shiftly-theme') === 'light' ? 'light' : 'dark'
};

function setSyncStatus(label, stateClass = '') { const element = document.querySelector('#syncStatus'); if (element) { element.textContent = label; element.className = `sync-status ${stateClass}`; } }
function cloudData() { return { settings: state.settings, overrides: state.overrides, notes: state.notes, syncMeta: { updatedAt: new Date().toISOString(), updatedBy: currentUserId || 'unknown', updatedByLabel: currentUserLabel } }; }
function saveCloudState() {
  if (!cloudReady) return;
  setSyncStatus('Saving', 'saving');
  const payload = cloudData();
  cloudWriteQueue = cloudWriteQueue.then(() => setDoc(cloudDocument, payload)).then(() => setSyncStatus('Synced', 'synced')).catch(error => { setSyncStatus(error.code === 'permission-denied' ? 'Sign in' : 'Offline', 'offline'); const authStatus = document.querySelector('#authStatus'); if (authStatus && error.code === 'permission-denied') authStatus.textContent = 'Google sign-in is required to save changes.'; console.error('Unable to sync Shiftly data.', error); });
}
function rememberUndo() { undoSnapshot = { kind: 'all', data: JSON.parse(JSON.stringify({ settings: state.settings, overrides: state.overrides, notes: state.notes })) }; const button = document.querySelector('#undoButton'); if (button) button.disabled = false; }
function rememberDayUndo(key) { undoSnapshot = { kind: 'day', key, override: state.overrides[key] ? JSON.parse(JSON.stringify(state.overrides[key])) : null, note: state.notes[key] ? JSON.parse(JSON.stringify(state.notes[key])) : null }; const button = document.querySelector('#undoButton'); if (button) button.disabled = false; }
function undoLastChange() {
  if (!undoSnapshot) return;
  if (undoSnapshot.kind === 'day') {
    if (undoSnapshot.override) state.overrides[undoSnapshot.key] = undoSnapshot.override;
    else delete state.overrides[undoSnapshot.key];
    if (undoSnapshot.note) state.notes[undoSnapshot.key] = undoSnapshot.note;
    else delete state.notes[undoSnapshot.key];
  } else {
    state.settings = undoSnapshot.data.settings;
    state.overrides = undoSnapshot.data.overrides;
    state.notes = undoSnapshot.data.notes;
  }
  localStorage.setItem('shiftly-settings', JSON.stringify(state.settings));
  localStorage.setItem('shiftly-overrides', JSON.stringify(state.overrides));
  localStorage.setItem('shiftly-notes', JSON.stringify(state.notes));
  undoSnapshot = null;
  document.querySelector('#undoButton').disabled = true;
  saveCloudState();
  render();
  if (!document.querySelector('#settingsSheet').classList.contains('is-hidden')) openSettings();
  else if (!document.querySelector('#dayEditor').classList.contains('is-hidden')) openEditor();
}
function applyCloudData(data) {
  if (data.settings && typeof data.settings === 'object') state.settings = { ...state.settings, ...data.settings };
  if (data.overrides && typeof data.overrides === 'object') state.overrides = data.overrides;
  if (data.notes && typeof data.notes === 'object') state.notes = data.notes;
  if (data.syncMeta) {
    const updatedAt = new Date(data.syncMeta.updatedAt);
    const syncStatus = document.querySelector('#syncStatus');
    if (syncStatus) syncStatus.title = `Last updated by ${data.syncMeta.updatedByLabel || 'another device'} at ${updatedAt.toLocaleString()}`;
    const notice = document.querySelector('#remoteChangeNotice');
    const isRecentRemote = data.syncMeta.updatedBy && data.syncMeta.updatedBy !== currentUserId && Date.now() - updatedAt.getTime() < 120000;
    if (notice) { const updater = data.syncMeta.updatedByLabel && data.syncMeta.updatedByLabel !== 'Anonymous device' ? data.syncMeta.updatedByLabel : 'another device'; notice.textContent = isRecentRemote ? `Updated by ${updater} at ${updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''; notice.classList.toggle('is-hidden', !isRecentRemote); }
  }
  localStorage.setItem('shiftly-settings', JSON.stringify(state.settings));
  localStorage.setItem('shiftly-overrides', JSON.stringify(state.overrides));
  localStorage.setItem('shiftly-notes', JSON.stringify(state.notes));
  render();
}
function listenForCloudState() {
  if (stopCloudListener) stopCloudListener();
  stopCloudListener = onSnapshot(cloudDocument, snapshot => {
    cloudReady = true;
    setSyncStatus('Synced', 'synced');
    if (snapshot.exists()) applyCloudData(snapshot.data());
    else if (firebaseAuth.currentUser?.isAnonymous) setSyncStatus('Sign in', 'offline');
    else saveCloudState();
  }, error => { cloudReady = false; setSyncStatus(error.code === 'permission-denied' ? 'Sign in' : 'Offline', 'offline'); const authStatus = document.querySelector('#authStatus'); if (authStatus && error.code === 'permission-denied') authStatus.textContent = 'Google sign-in is required to sync changes.'; console.error('Unable to listen for Shiftly updates.', error); });
}
async function initializeCloudSync() {
  try {
    await setPersistence(firebaseAuth, browserLocalPersistence);
    await firebaseAuth.authStateReady();
    const credential = firebaseAuth.currentUser ? { user: firebaseAuth.currentUser } : await signInAnonymously(firebaseAuth);
    currentUserId = credential.user.uid;
    currentUserLabel = credential.user.displayName || credential.user.email || 'Anonymous device';
    updateAuthStatus(credential.user);
    cloudDocument = doc(firestore, 'shared', 'schedule');
    listenForCloudState();
  } catch (error) {
    setSyncStatus(error.code === 'auth/operation-not-allowed' ? 'Sign in' : 'Offline', 'offline');
    const authStatus = document.querySelector('#authStatus');
    if (authStatus && error.code === 'auth/operation-not-allowed') authStatus.textContent = 'Google sign-in is required for cloud sync.';
    console.error('Shiftly cloud sync is unavailable.', error);
  }
}
async function signInWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    const user = firebaseAuth.currentUser;
    const result = user?.isAnonymous ? await linkWithPopup(user, provider) : await signInWithPopup(firebaseAuth, provider);
    currentUserId = result.user.uid;
    currentUserLabel = result.user.displayName || result.user.email || 'Google account';
    updateAuthStatus(result.user);
    if (!cloudDocument) cloudDocument = doc(firestore, 'shared', 'schedule');
    cloudReady = true;
    listenForCloudState();
    saveCloudState();
  } catch (error) {
    if (error.code === 'auth/credential-already-in-use' || error.code === 'auth/provider-already-linked') {
      try {
        const result = await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
        currentUserId = result.user.uid;
        currentUserLabel = result.user.displayName || result.user.email || 'Google account';
        updateAuthStatus(result.user);
        setSyncStatus('Synced', 'synced');
        if (!cloudDocument) cloudDocument = doc(firestore, 'shared', 'schedule');
        cloudReady = true;
        listenForCloudState();
        return;
      } catch (signInError) {
        console.error('Unable to sign in with Google.', signInError);
      }
    }
    alert(error.code === 'auth/popup-closed-by-user' ? 'Google sign-in was cancelled.' : 'Google sign-in was unavailable. Enable Google in Firebase Authentication.');
  }
}
function updateAuthStatus(user) { const identity = user?.displayName || user?.email || 'Google account'; const element = document.querySelector('#authStatus'); const button = document.querySelector('#googleSignIn'); const signOutButton = document.querySelector('#signOutButton'); const isAnonymous = !user || user.isAnonymous; if (element) element.textContent = isAnonymous ? 'Anonymous sync is active on this device.' : `Signed in as ${identity}.`; if (button) { button.textContent = isAnonymous ? 'Continue with Google' : identity; button.classList.toggle('is-hidden', !isAnonymous); } if (signOutButton) signOutButton.classList.toggle('is-hidden', isAnonymous); }
async function signOutUser() {
  await signOut(firebaseAuth);
  currentUserId = null;
  currentUserLabel = 'Anonymous device';
  cloudReady = false;
  if (stopCloudListener) stopCloudListener();
  stopCloudListener = null;
  updateAuthStatus({ isAnonymous: true });
  setSyncStatus('Loading', 'saving');
  const credential = await signInAnonymously(firebaseAuth);
  currentUserId = credential.user.uid;
  cloudDocument = doc(firestore, 'shared', 'schedule');
  listenForCloudState();
}

function people() { return { intel: state.settings.intelName, pfizer: state.settings.pfizerName, creche: state.settings.crecheName }; }
function personInitial(name) { return name.trim().charAt(0).toUpperCase(); }

// Date helpers keep calendar calculations independent of local timezones.
function utcDate(year, month, day) { return new Date(Date.UTC(year, month - 1, day)); }
function dayKey(date) { return date.toISOString().slice(0, 10); }
function addDays(date, amount) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + amount); return next; }
function diffDays(a, b) { return Math.round((b - a) / 86400000); }
function mod(value, length) { return ((value % length) + length) % length; }
function format(date, options) { return new Intl.DateTimeFormat('en-IE', { ...options, timeZone: 'UTC' }).format(date); }

// Convert a repeating pattern into a day, night, or off shift.
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

// Calculate each schedule from its configured pattern.
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

// Combine calculated shifts with any date-specific overrides.
function shiftsFor(date) {
  const override = state.overrides[dayKey(date)] || {};
  return { intel: override.intel || intel(date), pfizer: override.pfizer || pfizer(date), creche: override.creche || creche(date) };
}

function typeLabel(type) { return ({ day: 'DAY', night: 'NIGHT', off: 'OFF', creche: 'ON', hospital: 'HOSPITAL APPOINTMENT' })[type]; }
function statusDescription(type) { return ({ day: 'Day shift', night: 'Night shift', off: 'Rest day', creche: people().creche })[type]; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }

// Refresh all visible calendar content after state changes.
function render() { renderHero(); renderMonth(); }

// Render the selected-day summary and monthly overlap count.
function renderHero() {
  const date = state.selectedDate;
  const shifts = shiftsFor(date);
  const note = state.notes[dayKey(date)];
  const active = Object.entries(shifts).filter(([, type]) => type !== OFF);
  const title = active.length ? `${active.length} shift${active.length > 1 ? 's' : ''} today` : 'A day to recharge';
  const isToday = dayKey(date) === dayKey(todayUTC());
  const month = state.displayedMonth;
  const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  let overlapCount = 0;
  for (let day = 1; day <= days; day += 1) {
    const monthDate = utcDate(month.getUTCFullYear(), month.getUTCMonth() + 1, day);
    const monthShifts = shiftsFor(monthDate);
    if (monthShifts.intel !== OFF && monthShifts.pfizer !== OFF) overlapCount += 1;
  }
  document.querySelector('#nextShift').innerHTML = `<p class="overline">${isToday ? 'TODAY · ' : ''}${format(date, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}</p><div class="shift-main"><div><p class="shift-name">${isToday ? title : 'Pattern for this day'}</p><p class="shift-meta">${active.length ? `${active.length} scheduled` : 'No scheduled shifts'}</p></div><div class="header-summary"><span class="overlap-summary" aria-label="${overlapCount} shift overlap days">${overlapCount} overlap</span></div></div><div class="selected-shifts" aria-label="Calendars">${Object.entries(shifts).map(([name, type]) => `<button class="selected-shift ${type} calendar-toggle ${state.visibility[name] ? 'selected' : ''}" type="button" data-calendar="${name}" aria-pressed="${state.visibility[name]}" aria-label="${escapeHtml(people()[name])} calendar ${state.visibility[name] ? 'visible' : 'hidden'}"><strong>${personInitial(people()[name])} · ${escapeHtml(people()[name])}</strong><span>${typeLabel(type)}</span></button>`).join('')}</div>${note?.text ? `<p class="selected-note"><strong>${note.type === 'note' ? 'NOTE' : typeLabel(note.type) || note.type.toUpperCase()}</strong> ${escapeHtml(note.text)}</p>` : ''}<button id="editDayButton" class="edit-day-button" type="button">Edit selected day</button>`;
  document.querySelectorAll('.calendar-toggle').forEach(button => button.addEventListener('click', toggleCalendarVisibility));
  document.querySelector('#editDayButton').addEventListener('click', openEditor);
}

// Build the calendar grid, including notes, markers, and overlaps.
function renderMonth() {
  const view = state.displayedMonth;
  document.querySelector('#monthHeading').textContent = format(view, { month: 'long', year: 'numeric' });
  const names = people();
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
    const overlap = state.visibility.intel && state.visibility.pfizer && shifts.intel !== OFF && shifts.pfizer !== OFF;
    button.className = `calendar-day${inMonth ? '' : ' outside'}${dayKey(date) === dayKey(today) ? ' today' : ''}${dayKey(date) === dayKey(state.selectedDate) ? ' selected' : ''}${overlap ? ' overlap' : ''}`;
    button.innerHTML = `${state.notes[dayKey(date)] ? '<i class="note-indicator" aria-label="Note added"></i>' : ''}<span class="date-number">${date.getUTCDate()}</span><span class="day-dots">${Object.entries(shifts).filter(([name]) => state.visibility[name]).map(([name, type]) => `<i class="dot ${name} ${type}" aria-label="${escapeHtml(names[name])} ${typeLabel(type)}">${personInitial(names[name])}</i>`).join('')}</span>`;
    button.addEventListener('click', () => selectDay(date));
    grid.appendChild(button);
  }
}
function toggleCalendarVisibility(event) { const name = event.currentTarget.dataset.calendar; state.visibility[name] = !state.visibility[name]; localStorage.setItem('shiftly-calendar-visibility', JSON.stringify(state.visibility)); render(); }

// Update the selected day and return the view to the top.
function selectDay(date) { state.selectedDate = date; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
// Open and populate the schedule settings sheet.
function openSettings() {
  const settings = state.settings;
  document.querySelector('#intelNameLabel').firstChild.textContent = `${settings.intelName} calendar name`;
  document.querySelector('#intelFirstPatternLabel').firstChild.textContent = `${settings.intelName} pattern — January to June`;
  document.querySelector('#intelSecondPatternLabel').firstChild.textContent = `${settings.intelName} pattern — July to December`;
  document.querySelector('#intelAnchorLabel').firstChild.textContent = `${settings.intelName} anchor date`;
  document.querySelector('#pfizerNameLabel').firstChild.textContent = `${settings.pfizerName} calendar name`;
  document.querySelector('#pfizerAnchorLabel').firstChild.textContent = `${settings.pfizerName} cycle anchor date`;
  document.querySelector('#pfizerPatternLabel').firstChild.textContent = `${settings.pfizerName} shift pattern`;
  document.querySelector('#crecheNameLabel').firstChild.textContent = `${settings.crecheName} calendar name`;
  document.querySelector('#crecheDaysLabel').firstChild.textContent = `${settings.crecheName} working days`;
  document.querySelector('#intelName').value = settings.intelName;
  document.querySelector('#pfizerName').value = settings.pfizerName;
  document.querySelector('#crecheName').value = settings.crecheName;
  document.querySelector('#intelFirstPattern').value = settings.intelFirstPattern.join(', ');
  document.querySelector('#intelSecondPattern').value = settings.intelSecondPattern.join(', ');
  document.querySelector('#intelAnchor').value = settings.intelAnchor;
  document.querySelector('#pfizerAnchor').value = settings.pfizerAnchor;
  document.querySelector('#pfizerPattern').value = settings.pfizerPattern.join(', ');
  document.querySelector('#themeToggle').checked = state.theme === 'dark';
  document.querySelector('#crecheDays').value = settings.crecheDays.join(', ');
  document.querySelector('#sheetScrim').classList.remove('is-hidden'); document.querySelector('#settingsSheet').classList.remove('is-hidden');
}
function closeSettings() { document.querySelector('#sheetScrim').classList.add('is-hidden'); document.querySelector('#settingsSheet').classList.add('is-hidden'); }
function openHelp() { document.querySelector('#sheetScrim').classList.remove('is-hidden'); document.querySelector('#helpSheet').classList.remove('is-hidden'); }
function closeHelp() { document.querySelector('#sheetScrim').classList.add('is-hidden'); document.querySelector('#helpSheet').classList.add('is-hidden'); }
// Open the selected-day editor with current shifts and note details.
function openEditor() {
  const date = state.selectedDate; const shifts = shiftsFor(date);
  document.querySelector('#dayEditorTitle').textContent = format(date, { day: 'numeric', month: 'long' });
  document.querySelector('#editorContent').innerHTML = Object.entries(shifts).map(([name, type]) => {
    const allowed = name === 'creche' ? [DAY, OFF] : [DAY, NIGHT, OFF];
    return `<div class="sheet-row"><div><strong>${escapeHtml(people()[name])}</strong><span>Pattern: ${statusDescription(type)}</span></div><div class="sheet-toggle">${allowed.map(option => `<button class="type-button ${option === type ? 'selected' : ''}" data-person="${name}" data-type="${option}">${typeLabel(option)}</button>`).join('')}</div></div>`;
  }).join('');
  document.querySelectorAll('.type-button').forEach(button => button.addEventListener('click', saveDayOverride));
  const note = state.notes[dayKey(date)] || { type: 'note', text: '' };
  document.querySelector('#noteType').value = note.type;
  document.querySelector('#noteText').value = note.text;
  updateNotePlaceholder();
  document.querySelector('#sheetScrim').classList.remove('is-hidden'); document.querySelector('#dayEditor').classList.remove('is-hidden');
}
function closeEditor() { document.querySelector('#sheetScrim').classList.add('is-hidden'); document.querySelector('#dayEditor').classList.add('is-hidden'); }
// Keep generated leave/overtime notes synchronized with shift overrides.
function syncAutomaticNote(key, date) {
  const override = state.overrides[key] || {};
  const toggledPeople = ['intel', 'pfizer'].filter(person => override[person] && override[person] !== ({ intel, pfizer, creche })[person](date));
  const note = state.notes[key];
  const names = people();
  const isAutomatic = note?.automatic || new RegExp(`^(${[names.intel, names.pfizer].map(escapeRegExp).join('|')}) (Leave|OT)(, (${[names.intel, names.pfizer].map(escapeRegExp).join('|')}) (Leave|OT))*$`).test(note?.text || '');
  if (toggledPeople.length) {
    const allOff = toggledPeople.every(person => override[person] === OFF);
    state.notes[key] = { type: allOff ? 'leave' : 'overtime', text: toggledPeople.map(person => `${people()[person]} ${override[person] === OFF ? 'Leave' : 'OT'}`).join(', '), automatic: true };
  } else if (isAutomatic) delete state.notes[key];
}
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// Save a shift toggle, or remove it when the original pattern is selected.
function saveDayOverride(event) { const { person, type } = event.currentTarget.dataset; const key = dayKey(state.selectedDate); rememberDayUndo(key); const originalType = ({ intel, pfizer, creche })[person](state.selectedDate); if (type === originalType) { if (state.overrides[key]) { delete state.overrides[key][person]; if (!Object.keys(state.overrides[key]).length) delete state.overrides[key]; } } else { state.overrides[key] = { ...(state.overrides[key] || {}), [person]: type }; } syncAutomaticNote(key, state.selectedDate); localStorage.setItem('shiftly-overrides', JSON.stringify(state.overrides)); localStorage.setItem('shiftly-notes', JSON.stringify(state.notes)); saveCloudState(); openEditor(); render(); }
function resetSelectedDay() { const key = dayKey(state.selectedDate); rememberDayUndo(key); delete state.overrides[key]; delete state.notes[key]; localStorage.setItem('shiftly-overrides', JSON.stringify(state.overrides)); localStorage.setItem('shiftly-notes', JSON.stringify(state.notes)); saveCloudState(); closeEditor(); render(); }
function saveNote() { const key = dayKey(state.selectedDate); rememberDayUndo(key); const type = document.querySelector('#noteType').value; const text = document.querySelector('#noteText').value.trim(); state.notes[key] = { type, text }; localStorage.setItem('shiftly-notes', JSON.stringify(state.notes)); saveCloudState(); closeEditor(); render(); }
function updateNotePlaceholder() { document.querySelector('#noteText').placeholder = document.querySelector('#noteType').value === 'hospital' ? 'Time & Location' : 'Optional details'; }
function parsePattern(value) { const pattern = value.split(',').map(item => Number(item.trim())); if (!pattern.length || pattern.some(item => !Number.isInteger(item) || item === 0)) throw new Error('Use comma-separated non-zero whole numbers.'); return pattern; }
function parseCrecheDays(value) { const parts = value.split(',').map(item => item.trim()); if (!parts.length || parts.some(part => part === '')) throw new Error('Use unique comma-separated weekday numbers from 0 to 6.'); const days = parts.map(Number); if (days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(days).size !== days.length) throw new Error('Use unique comma-separated weekday numbers from 0 to 6.'); return days; }
function dateFromInput(value) { const [year, month, day] = value.split('-').map(Number); return utcDate(year, month, day); }
// Validate and persist edited patterns and appearance settings.
function saveSettings(event) {
  event.preventDefault();
  try {
    const names = { intelName: document.querySelector('#intelName').value.trim(), pfizerName: document.querySelector('#pfizerName').value.trim(), crecheName: document.querySelector('#crecheName').value.trim() };
    if (Object.values(names).some(name => !name)) throw new Error('Calendar names cannot be empty.');
    const nextSettings = { ...names, intelFirstPattern: parsePattern(document.querySelector('#intelFirstPattern').value), intelSecondPattern: parsePattern(document.querySelector('#intelSecondPattern').value), intelAnchor: document.querySelector('#intelAnchor').value, pfizerAnchor: document.querySelector('#pfizerAnchor').value, pfizerPattern: parsePattern(document.querySelector('#pfizerPattern').value), crecheDays: parseCrecheDays(document.querySelector('#crecheDays').value) };
    rememberUndo();
    state.settings = nextSettings;
    setTheme(document.querySelector('#themeToggle').checked ? 'dark' : 'light');
    localStorage.setItem('shiftly-settings', JSON.stringify(state.settings)); saveCloudState(); closeSettings(); render();
  } catch (error) { alert(error.message); }
}
// Restore defaults and remove every saved calendar customization.
function resetAllChanges() {
  if (!confirm('Reset patterns, shift changes, notes, and theme to the defaults?')) return;
  rememberUndo();
  state.settings = { ...DEFAULT_SETTINGS, intelName: DEFAULT_PEOPLE.intel, pfizerName: DEFAULT_PEOPLE.pfizer, crecheName: DEFAULT_PEOPLE.creche, intelFirstPattern: [...DEFAULT_SETTINGS.intelFirstPattern], intelSecondPattern: [...DEFAULT_SETTINGS.intelSecondPattern], pfizerPattern: [...DEFAULT_SETTINGS.pfizerPattern], crecheDays: [...DEFAULT_SETTINGS.crecheDays] };
  state.overrides = {};
  state.notes = {};
  setTheme('dark');
  localStorage.removeItem('shiftly-settings');
  localStorage.removeItem('shiftly-overrides');
  localStorage.removeItem('shiftly-notes');
  localStorage.removeItem('shiftly-calendar-visibility');
  state.visibility = { intel: true, pfizer: true, creche: true };
  saveCloudState();
  openSettings();
  render();
}
function todayUTC() { const local = new Date(); return utcDate(local.getFullYear(), local.getMonth() + 1, local.getDate()); }
function goToday() { const today = todayUTC(); state.displayedMonth = utcDate(today.getUTCFullYear(), today.getUTCMonth() + 1, 1); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function changeMonth(amount) { state.displayedMonth = utcDate(state.displayedMonth.getUTCFullYear(), state.displayedMonth.getUTCMonth() + amount + 1, 1); renderMonth(); renderHero(); }
function setTheme(theme) { const nextTheme = theme === 'light' ? 'light' : 'dark'; state.theme = nextTheme; document.documentElement.dataset.theme = nextTheme; localStorage.setItem('shiftly-theme', nextTheme); const toggle = document.querySelector('#themeToggle'); if (toggle) toggle.checked = nextTheme === 'dark'; const label = document.querySelector('#themeModeLabel'); if (label) label.textContent = nextTheme === 'dark' ? 'Dark' : 'Light'; }
function exportColor(type) { return ({ day: '#ffb36b', night: '#6e5ae6', off: '#e4e6e3', creche: '#f47e96' })[type]; }
// Create the SVG used by image and print/PDF exports.
function yearSvg(year) {
  const width = 1200, height = 1540, columns = 3, cardW = 350, cardH = 345, gapX = 35, gapY = 35, startX = 55, startY = 120;
  const names = people();
  let content = `<rect width="${width}" height="${height}" fill="#f8f8f6"/><text x="55" y="65" font-family="Arial,sans-serif" font-size="35" font-weight="700" fill="#19212d">Shiftly · ${year}</text><text x="55" y="92" font-family="Arial,sans-serif" font-size="15" fill="#78818c">${escapeHtml(names.intel)}, ${escapeHtml(names.pfizer)} and ${escapeHtml(names.creche)} shift calendar</text>`;
  for (let month = 0; month < 12; month += 1) {
    const x = startX + (month % columns) * (cardW + gapX), y = startY + Math.floor(month / columns) * (cardH + gapY);
    const first = utcDate(year, month + 1, 1), offset = (first.getUTCDay() + 6) % 7, start = addDays(first, -offset);
    content += `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="20" fill="#fff" stroke="#e8e8e4"/><text x="${x + 18}" y="${y + 30}" font-family="Arial,sans-serif" font-size="19" font-weight="700" fill="#19212d">${format(first,{month:'long'})}</text>`;
    ['M','T','W','T','F','S','S'].forEach((label, i) => { content += `<text x="${x + 26 + i * 45}" y="${y + 58}" text-anchor="middle" font-family="Arial" font-size="10" fill="#78818c">${label}</text>`; });
    for (let index = 0; index < 42; index += 1) { const date = addDays(start, index), shifts = shiftsFor(date), cellX = x + 10 + (index % 7) * 47, cellY = y + 70 + Math.floor(index / 7) * 43, faded = date.getUTCMonth() !== month ? .32 : 1; content += `<g opacity="${faded}"><text x="${cellX + 18}" y="${cellY + 14}" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="#19212d">${date.getUTCDate()}</text>${Object.entries(shifts).filter(([name]) => state.visibility[name]).map(([name,type], pos) => `<circle cx="${cellX + 9 + pos * 10}" cy="${cellY + 29}" r="4" fill="${exportColor(type)}"/><text x="${cellX + 9 + pos * 10}" y="${cellY + 31}" text-anchor="middle" font-family="Arial" font-size="5" font-weight="700" fill="#fff">${personInitial(names[name])}</text>`).join('')}</g>`; }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
}
function downloadBlob(blob, filename) { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
function escapeIcs(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function unescapeIcs(value) { return value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }
function exportIcs() {
  const events = Object.entries(state.notes).filter(([, note]) => note.type === 'hospital').map(([dateKey, note], index) => {
    const date = dateKey.replace(/-/g, '');
    const time = String(note.text || '').match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
    const location = String(note.text || '').match(/(?:^|[;|\n])\s*location:\s*([^;|\n]+)/i);
    const start = time ? `DTSTART:${date}T${time[1]}${time[2]}00` : `DTSTART;VALUE=DATE:${date}`;
    return ['BEGIN:VEVENT', `UID:shiftly-${dateKey}-${index}@shiftly`, `DTSTAMP:${date}T000000Z`, start, 'SUMMARY:Hospital appointment', location ? `LOCATION:${escapeIcs(location[1].trim())}` : '', `DESCRIPTION:${escapeIcs(note.text)}`, 'END:VEVENT'].filter(Boolean).join('\r\n');
  });
  const calendar = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shiftly//Hospital appointments//EN', ...events, 'END:VCALENDAR'].join('\r\n');
  downloadBlob(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }), 'shiftly-hospital-appointments.ics');
}
function importIcs(event) {
  const file = event.currentTarget.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const lines = String(reader.result).replace(/\r\n[ \t]/g, '').split(/\r?\n/);
    let appointment;
    let imported = 0;
    lines.forEach(line => {
      if (line === 'BEGIN:VEVENT') appointment = {};
      else if (line === 'END:VEVENT' && appointment?.date) { rememberUndo(); state.notes[appointment.date] = { type: 'hospital', text: appointment.description || '' }; imported += 1; appointment = null; }
      else if (appointment) {
        const separator = line.indexOf(':');
        if (separator < 0) return;
        const key = line.slice(0, separator);
        const value = unescapeIcs(line.slice(separator + 1));
        if (key.startsWith('DTSTART')) { const date = value.slice(0, 8); appointment.date = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`; }
        if (key === 'DESCRIPTION') appointment.description = value;
      }
    });
    if (imported) { localStorage.setItem('shiftly-notes', JSON.stringify(state.notes)); saveCloudState(); render(); }
    event.currentTarget.value = '';
  };
  reader.readAsText(file);
}
function exportImage() { const year = state.displayedMonth.getUTCFullYear(), svg = yearSvg(year), image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1540; canvas.getContext('2d').drawImage(image, 0, 0); canvas.toBlob(blob => downloadBlob(blob, `shiftly-${year}.png`), 'image/png'); }; image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
function exportPdf() { const year = state.displayedMonth.getUTCFullYear(), svg = yearSvg(year), printWindow = window.open('', '_blank'); if (!printWindow) return; printWindow.document.write(`<title>Shiftly ${year}</title><style>@page{size:A4 portrait;margin:8mm}body{margin:0}img{display:block;width:100%;height:auto}</style><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`); printWindow.document.close(); printWindow.onload = () => printWindow.print(); }

// Register the offline app shell when served over HTTP(S).
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js');
setTheme(state.theme);

document.querySelector('#previousMonth').addEventListener('click', () => changeMonth(-1));
document.querySelector('#nextMonth').addEventListener('click', () => changeMonth(1));
let swipeStartX = null;
document.querySelector('#calendarGrid').addEventListener('touchstart', event => { if (event.touches.length === 1) swipeStartX = event.touches[0].clientX; }, { passive: true });
document.querySelector('#calendarGrid').addEventListener('touchend', event => { if (swipeStartX === null) return; const distance = event.changedTouches[0].clientX - swipeStartX; swipeStartX = null; if (Math.abs(distance) < 55) return; changeMonth(distance < 0 ? 1 : -1); }, { passive: true });
document.querySelector('#todayButton').addEventListener('click', goToday);
document.querySelector('#themeToggle').addEventListener('change', event => setTheme(event.currentTarget.checked ? 'dark' : 'light'));
document.querySelector('#settingsButton').addEventListener('click', openSettings);
document.querySelector('#closeSettings').addEventListener('click', closeSettings);
document.querySelector('#sheetScrim').addEventListener('click', () => { closeSettings(); closeEditor(); closeHelp(); });
document.querySelector('#helpButton').addEventListener('click', openHelp);
document.querySelector('#closeHelp').addEventListener('click', closeHelp);
document.querySelector('#settingsForm').addEventListener('submit', saveSettings);
document.querySelector('#closeEditor').addEventListener('click', closeEditor);
document.querySelector('#resetDay').addEventListener('click', resetSelectedDay);
document.querySelector('#saveNote').addEventListener('click', saveNote);
document.querySelector('#noteType').addEventListener('change', updateNotePlaceholder);
document.querySelector('#exportImage').addEventListener('click', exportImage);
document.querySelector('#exportPdf').addEventListener('click', exportPdf);
document.querySelector('#resetAllChanges').addEventListener('click', resetAllChanges);
document.querySelector('#googleSignIn').addEventListener('click', signInWithGoogle);
document.querySelector('#signOutButton').addEventListener('click', signOutUser);
document.querySelector('#exportIcs').addEventListener('click', exportIcs);
document.querySelector('#importIcs').addEventListener('change', importIcs);
render();
initializeCloudSync();
