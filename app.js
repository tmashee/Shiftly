const state = {
  year: new Date().getUTCFullYear(),
  visible: { intel: true, pfizer: true, creche: true },
  overrides: JSON.parse(localStorage.getItem('shiftCalendar.overrides') || '{}'),
  settings: JSON.parse(localStorage.getItem('shiftCalendar.settings') || '{"weekends":true,"currentMonth":true}')
};

const DAY = 'day';
const NIGHT = 'night';
const OFF = 'off';
const CRECHE = 'creche';

// Scheduling rules taken from Shift-Cal, reimplemented independently.
const INTEL_FIRST_HALF = [3,-3,4,-4,3,-3,4,-4,4,-3,3,-4,4,-3,3,-4];
const INTEL_SECOND_HALF = [3,-4,4,-3,3,-4,4,-4,3,-3,4,-4,3,-3,4,-3];
const INTEL_ANCHOR = utcDate(2026, 1, 11);
const PFIZER_ANCHOR = utcDate(2025, 6, 30);
const PFIZER_CYCLE_LENGTH = 28;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function utcDate(year, month, day) { return new Date(Date.UTC(year, month - 1, day)); }
function parseKey(key) { const [y,m,d] = key.split('-').map(Number); return utcDate(y,m,d); }
function dayKey(date) { return date.toISOString().slice(0,10); }
function startOfDay(date) { return utcDate(date.getUTCFullYear(), date.getUTCMonth()+1, date.getUTCDate()); }
function addDays(date, amount) { const next = new Date(date); next.setUTCDate(next.getUTCDate()+amount); return next; }
function diffDays(start, end) { return Math.round((startOfDay(end)-startOfDay(start))/86400000); }
function mod(n,m) { return ((n % m)+m) % m; }
function isSameDay(a,b) { return dayKey(a)===dayKey(b); }
function format(date, options) { return new Intl.DateTimeFormat(undefined,{...options,timeZone:'UTC'}).format(date); }
function fullDate(date) { return format(date,{weekday:'long',month:'long',day:'numeric',year:'numeric'}); }
function monthName(monthIndex) { return format(utcDate(2020,monthIndex+1,1),{month:'long'}); }

function intelPatternForDate(date) {
  const july = utcDate(date.getUTCFullYear(),7,1);
  return date >= july ? INTEL_SECOND_HALF : INTEL_FIRST_HALF;
}

function intelStartForDate(date) {
  const july = utcDate(date.getUTCFullYear(),7,1);
  return date >= july ? july : INTEL_ANCHOR;
}

function patternShift(date, pattern, anchor, switchDays, startsWithDay, byCalendarDays=false) {
  const daysDiff = diffDays(anchor,date);
  const total = pattern.reduce((sum,segment)=>sum+Math.abs(segment),0);
  const cycleDay = mod(daysDiff,total);
  let cursor=0;
  let workDaysSeen=0;

  for (const segment of pattern) {
    const length=Math.abs(segment);
    const working=segment>0;
    if (cycleDay>=cursor && cycleDay<cursor+length) {
      if (!working) return OFF;
      const dayInSegment=cycleDay-cursor;
      const workDayNumber=workDaysSeen+dayInSegment+1;
      const switchInterval=switchDays*2;
      let isDay;
      if (byCalendarDays) {
        const calendarCycleDay=mod(daysDiff,switchInterval);
        isDay=startsWithDay ? calendarCycleDay<switchDays : calendarCycleDay>=switchDays;
      } else {
        const workCycleDay=((workDayNumber-1)%switchInterval)+1;
        isDay=startsWithDay ? workCycleDay<=switchDays : workCycleDay>switchDays;
      }
      return isDay ? DAY : NIGHT;
    }
    cursor += length;
    if (working) workDaysSeen += length;
  }
  return OFF;
}

function intel(date) {
  return patternShift(date,intelPatternForDate(date),intelStartForDate(date),28,false,true);
}

function pfizer(date) {
  const daysDiff=diffDays(PFIZER_ANCHOR,date);
  const cycleDay=mod(daysDiff,PFIZER_CYCLE_LENGTH);
  const firstCycle=cycleDay<14;
  const patternDay=cycleDay%14;

  if (patternDay<=1) return firstCycle ? DAY : NIGHT;
  if (patternDay<=3) return OFF;
  if (patternDay<=6) return firstCycle ? NIGHT : DAY;
  if (patternDay<=8) return OFF;
  if (patternDay<=10) return firstCycle ? DAY : NIGHT;
  return OFF;
}

function creche(date) {
  const september=utcDate(date.getUTCFullYear(),9,1);
  if (date<september) return OFF;
  return [1,2,4].includes(date.getUTCDay()) ? CRECHE : OFF;
}

function calculatedShifts(date) {
  const override=state.overrides[dayKey(date)] || {};
  return {
    intel: override.intel || intel(date),
    pfizer: override.pfizer || pfizer(date),
    creche: creche(date)
  };
}

function shiftLabel(type) { return ({day:'DAY',night:'NIGHT',off:'OFF',creche:'CRECHE'})[type] || 'OFF'; }
function badgeClass(type) { return ({day:'badge-day',night:'badge-night',off:'badge-off',creche:'badge-creche'})[type] || 'badge-off'; }
function visibleNames() { return Object.entries(state.visible).filter(([,visible])=>visible).map(([key])=>key); }

function render() {
  $('#yearTitle').textContent=state.year;
  const today=startOfDay(new Date());
  const calendar=$('#calendar');
  calendar.innerHTML='';
  for (let month=0; month<12; month++) calendar.appendChild(renderMonth(state.year,month,today));
  renderSummary(today);
  wireCalendarDays();
}

function renderMonth(year,month,today) {
  const card=document.createElement('section');
  card.className='month-card';

  const title=document.createElement('div');
  title.className='month-title';
  title.textContent=`${monthName(month)} ${year}`;
  card.appendChild(title);

  const weekdays=document.createElement('div');
  weekdays.className='weekdays';
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(day=>{
    const element=document.createElement('div');
    element.className='weekday';
    element.textContent=day;
    weekdays.appendChild(element);
  });
  card.appendChild(weekdays);

  const grid=document.createElement('div');
  grid.className='grid';
  const first=utcDate(year,month+1,1);
  const offset=first.getUTCDay();
  const last=utcDate(year,month+1,0);
  const cellCount=Math.ceil((offset+last.getUTCDate())/7)*7;
  const start=addDays(first,-offset);

  for (let i=0;i<cellCount;i++) {
    const date=addDays(start,i);
    const inMonth=date.getUTCMonth()===month;
    const button=document.createElement('button');
    button.className='day-cell';
    button.dataset.date=dayKey(date);
    button.type='button';
    button.setAttribute('aria-label',fullDate(date));
    if (!inMonth) button.classList.add('muted');
    if (isSameDay(date,today)) button.classList.add('today');
    if (state.settings.weekends && [0,6].includes(date.getUTCDay())) button.classList.add('weekend');
    if (state.overrides[dayKey(date)]) button.classList.add('override');

    const number=document.createElement('div');
    number.className='day-number';
    number.textContent=date.getUTCDate();
    button.appendChild(number);

    const stack=document.createElement('div');
    stack.className='shift-stack';
    const shifts=calculatedShifts(date);
    for (const key of ['intel','pfizer','creche']) {
      if (!state.visible[key]) continue;
      if (key==='creche' && shifts.creche===OFF) continue;
      const badge=document.createElement('span');
      badge.className=`shift-badge ${badgeClass(shifts[key])}`;
      const shortName=key==='intel'?'I':key==='pfizer'?'P':'C';
      badge.textContent=`${shortName} ${shiftLabel(shifts[key])}`;
      stack.appendChild(badge);
    }
    button.appendChild(stack);
    grid.appendChild(button);
  }

  card.appendChild(grid);
  return card;
}

function renderSummary(today) {
  const shifts=calculatedShifts(today);
  $('#summaryDateLabel').textContent='TODAY';
  $('#summaryDate').textContent=fullDate(today);
  const grid=$('#summaryGrid');
  grid.innerHTML='';
  for (const [key,name] of [['intel','Intel'],['pfizer','Pfizer'],['creche','Crèche']]) {
    if (!state.visible[key]) continue;
    const pill=document.createElement('div');
    pill.className='summary-pill';
    pill.innerHTML=`<strong>${name}</strong><span>${shiftLabel(shifts[key])}</span>`;
    grid.appendChild(pill);
  }
  if (!visibleNames().length) {
    grid.innerHTML='<div class="summary-empty">Select a shift above to display it.</div>';
  }
}

function wireCalendarDays() {
  $$('.day-cell').forEach(button=>{
    button.addEventListener('click',()=>openDaySheet(parseKey(button.dataset.date)));
  });
}

function openSheet(sheetId) {
  $('#backdrop').classList.remove('hidden');
  $('#'+sheetId).classList.remove('hidden');
  document.body.classList.add('sheet-open');
}
function closeSheets() {
  $$('.bottom-sheet').forEach(sheet=>sheet.classList.add('hidden'));
  $('#backdrop').classList.add('hidden');
  document.body.classList.remove('sheet-open');
}

let activeDate=null;
let draft={intel:null,pfizer:null};

function openDaySheet(date) {
  activeDate=date;
  const shifts=calculatedShifts(date);
  const override=state.overrides[dayKey(date)] || {};
  draft={intel:override.intel || null,pfizer:override.pfizer || null};
  $('#sheetWeekday').textContent=format(date,{weekday:'long'}).toUpperCase();
  $('#sheetTitle').textContent=format(date,{month:'long',day:'numeric',year:'numeric'});
  $('#sheetBody').innerHTML='';

  for (const [key,name] of [['intel','Intel'],['pfizer','Pfizer']]) {
    const section=document.createElement('div');
    section.className='sheet-section';
    const heading=document.createElement('h3'); heading.textContent=name; section.appendChild(heading);
    const grid=document.createElement('div'); grid.className='shift-option-grid';
    for (const type of [DAY,NIGHT,OFF]) {
      const btn=document.createElement('button');
      btn.type='button'; btn.className='shift-option'; btn.textContent=shiftLabel(type);
      const selected=(draft[key] || shifts[key])===type;
      if (selected) btn.classList.add('selected');
      btn.addEventListener('click',()=>{
        draft[key]=type;
        grid.querySelectorAll('.shift-option').forEach(x=>x.classList.remove('selected'));
        btn.classList.add('selected');
      });
      grid.appendChild(btn);
    }
    section.appendChild(grid);
    const note=document.createElement('div'); note.className='sheet-note';
    note.textContent=`Pattern: ${shiftLabel(shifts[key])}${override[key]?' • custom override':''}`;
    section.appendChild(note);
    $('#sheetBody').appendChild(section);
  }
  openSheet('daySheet');
}

function saveOverride() {
  if (!activeDate) return;
  const key=dayKey(activeDate);
  const base={intel:intel(activeDate),pfizer:pfizer(activeDate)};
  const next={...state.overrides[key]};
  for (const keyName of ['intel','pfizer']) {
    if (draft[keyName] && draft[keyName]!==base[keyName]) next[keyName]=draft[keyName];
    else delete next[keyName];
  }
  if (next.intel || next.pfizer) state.overrides[key]=next; else delete state.overrides[key];
  localStorage.setItem('shiftCalendar.overrides',JSON.stringify(state.overrides));
  closeSheets(); render();
}

function resetOverride() {
  if (!activeDate) return;
  delete state.overrides[dayKey(activeDate)];
  localStorage.setItem('shiftCalendar.overrides',JSON.stringify(state.overrides));
  closeSheets(); render();
}

function openSettings() {
  $('#weekendToggle').checked=Boolean(state.settings.weekends);
  $('#currentMonthToggle').checked=Boolean(state.settings.currentMonth);
  openSheet('settingsSheet');
}
function saveSettings() {
  state.settings.weekends=$('#weekendToggle').checked;
  state.settings.currentMonth=$('#currentMonthToggle').checked;
  localStorage.setItem('shiftCalendar.settings',JSON.stringify(state.settings));
  closeSheets(); render();
}

function setFilter(key) {
  state.visible[key]=!state.visible[key];
  const button=$(`[data-filter="${key}"]`);
  button.classList.toggle('active',state.visible[key]);
  render();
}

function goToday() {
  state.year=new Date().getUTCFullYear();
  render();
  if (state.settings.currentMonth) {
    requestAnimationFrame(()=>{
      const target=$$('.month-card')[new Date().getUTCMonth()];
      target?.scrollIntoView({behavior:'smooth',block:'start'});
    });
  }
}

$('#prevYear').addEventListener('click',()=>{state.year--;render();});
$('#nextYear').addEventListener('click',()=>{state.year++;render();});
$('#todayBtn').addEventListener('click',goToday);
$('#settingsBtn').addEventListener('click',openSettings);
$$('.filter-chip').forEach(button=>button.addEventListener('click',()=>setFilter(button.dataset.filter)));
$('#saveOverrideBtn').addEventListener('click',saveOverride);
$('#resetOverrideBtn').addEventListener('click',resetOverride);
$('#weekendToggle').addEventListener('change',saveSettings);
$('#currentMonthToggle').addEventListener('change',saveSettings);
$('#backdrop').addEventListener('click',closeSheets);
$$('[data-close="true"]').forEach(button=>button.addEventListener('click',closeSheets));

document.addEventListener('keydown',(event)=>{ if(event.key==='Escape') closeSheets(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}

render();
