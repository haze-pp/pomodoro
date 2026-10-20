'use strict';

/* ───────── 기본 상수 ───────── */
const NS = 'http://www.w3.org/2000/svg';
const MAX_MIN = 60;
const CX = 200, CY = 228;          // 다이얼 중심
const R_FACE = 165;                // 다이얼 판 반지름
const R_SECTOR = 118;              // 시간 원판 반지름
const STORE_KEY = 'focus-timer:v1';
const LOG_KEY = 'focus-timer:log:v1'; // 집중 기록은 설정과 따로 저장 (타이머 상태를 저장할 때마다 같이 쓰지 않게)
const MAX_REPEAT = 12;

const THEMES = {
  sage: {
    name: '세이지', bg: '#e4e8df', body: '#b7c4ae', face: '#fbfbf7', sector: '#c8643b',
    knob: '#f4f0e7', pause: '#c8643b', reset: '#4a5847', ticks: '#4a5847', secTick: '#c8643b', phrase: '#c8643b',
    text: 'Begin gently.',
  },
  lavender: {
    name: '라벤더', bg: '#e9e6f1', body: '#c9c1e1', face: '#fdfcff', sector: '#4b3f8f',
    knob: '#f7f4fc', pause: '#4b3f8f', reset: '#4a4466', ticks: '#4a4466', secTick: '#4b3f8f', phrase: '#4b3f8f',
    text: 'Stay with it.',
  },
  charcoal: {
    name: '차콜', bg: '#1f2123', body: '#3a3e42', face: '#f1eee8', sector: '#ee9f35',
    knob: '#2d3034', pause: '#ee9f35', reset: '#f1eee8', ticks: '#3b3f43', secTick: '#ee9f35', phrase: '#b8742a',
    text: 'Deep work\nmode.',
  },
};
const COLOR_FIELDS = [
  ['bg', '배경'], ['body', '본체'], ['face', '다이얼 판'], ['sector', '시간 원판'],
  ['knob', '손잡이'], ['pause', 'START 버튼'], ['reset', 'RESET 버튼'],
  ['ticks', '눈금·숫자'], ['secTick', '초 표시 눈금'], ['phrase', '문구 색'],
];

const DEFAULTS = {
  theme: 'sage',
  customThemes: [],  // 직접 만든 테마 [{ id, name, ...색 }]
  // 세션 프리셋 { name, minutes, mode: 'focus'(집중만, 회차마다 직접 시작) | 'cycle'(집중+휴식 자동 반복), repeat, breakMinutes }
  presets: [30, null, null, null],
  presetsSeeded: true, // 기본 30분 버튼을 한 번 넣었는지
  alarmSeconds: 30,
  alarmSound: true,
  light: false,
  dialSound: true,
  vibrate: true,
  readout: true,
  notify: false,
  timer: null,
};

/* ───────── 저장 ───────── */
function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    const saved = { ...structuredClone(DEFAULTS), ...raw };
    // 예전의 '나만의' 테마 하나 → 직접 만든 테마 목록으로
    if (raw.custom && !raw.customThemes) {
      saved.customThemes = [{ ...raw.custom, id: 'c1', name: '나만의' }];
      if (saved.theme === 'custom') saved.theme = 'c:c1';
    }
    delete saved.custom;
    // 예전에 만든 테마엔 RESET·초 표시 색이 없음 → 당시 화면과 같은 색으로 채움
    for (const t of saved.customThemes) {
      t.reset ??= contrast(t.ticks, t.body) >= 2 ? t.ticks : t.face;
      t.secTick ??= t.sector;
    }
    if (!THEMES[saved.theme] && !customTheme(saved.theme, saved)) saved.theme = DEFAULTS.theme;
    // 예전의 공통 가운데 문구: 직접 만든 테마를 쓰던 중이면 그 테마 문구로 (기본 테마 문구는 고정)
    const oldTheme = customTheme(saved.theme, saved);
    if (typeof raw.phrase === 'string' && oldTheme) oldTheme.text = raw.phrase;
    delete saved.phrase;
    delete saved.phrases;
    // 예전 버전 사용자: 비어 있으면 기본 30분 버튼을 한 번만 채워 줌
    if (!raw.presetsSeeded) {
      if (saved.presets.every((m) => !m)) saved.presets = [...DEFAULTS.presets];
      saved.presetsSeeded = true;
    }
    // 예전의 '분'만 있던 버튼 → 세션 프리셋
    saved.presets = Array.from({ length: 4 }, (_, i) => normalizePreset(saved.presets[i]));
    // 이전 버전의 3단계 음량 설정 → 켬/끔
    if ('volume' in saved) {
      saved.alarmSound = saved.volume > 0;
      delete saved.volume;
    }
    saved.alarmSeconds = Math.min(60, Math.max(1, Math.round(Number(saved.alarmSeconds)) || 30));
    return saved;
  } catch {
    return structuredClone(DEFAULTS);
  }
}
function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}

function normalizePreset(p) {
  if (!p) return null;
  if (typeof p === 'number') p = { minutes: p };
  const minutes = clampInt(p.minutes, 1, MAX_MIN);
  if (!minutes) return null;
  return {
    name: typeof p.name === 'string' ? p.name : '',
    minutes,
    mode: p.mode === 'cycle' ? 'cycle' : 'focus',
    repeat: clampInt(p.repeat, 1, MAX_REPEAT) ?? 1,
    breakMinutes: clampInt(p.breakMinutes, 1, MAX_MIN) ?? 5,
  };
}
const settings = loadSettings();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* 저장 불가 환경 */ }
}

// 직접 만든 테마는 'c:<id>'로 선택됨
function customTheme(themeId, s = settings) {
  return themeId?.startsWith('c:') ? s.customThemes.find((t) => `c:${t.id}` === themeId) : undefined;
}

function themeColors() {
  return THEMES[settings.theme] || customTheme(settings.theme) || THEMES[DEFAULTS.theme];
}

/* ───────── 타이머 상태 ───────── */
const timer = {
  running: false,
  endAt: 0,          // running일 때 종료 시각(ms)
  remainingMs: 0,    // 멈춰 있을 때 남은 시간
  started: false,    // START로 시작한 세션 진행 중(일시정지 포함)
  sessionMinutes: 0, // 지금 구간(집중 또는 휴식)에 맞춘 시간
  name: '',          // 위쪽에 보이는 이름 (선택)
  plan: null,        // 세션 프리셋으로 맞췄을 때 { preset, minutes, mode, repeat, breakMinutes }, 다이얼로만 맞추면 null
  phase: 'focus',    // 'focus' | 'break'
  round: 1,          // 지금(또는 다음) 몇 번째 집중인지
  doneRounds: 0,     // 끝까지 마친 집중 횟수
  focusStart: 0,     // 이번 집중을 시작한 시각 (기록용)
};
let dragging = false;
let alarmActive = false;

function remaining() {
  return timer.running ? Math.max(0, timer.endAt - Date.now()) : timer.remainingMs;
}

function persistTimer() {
  settings.timer = { ...timer };
  save();
}

function restoreTimer() {
  const t = settings.timer;
  if (!t) return;
  Object.assign(timer, t);
  if (t.started === undefined) timer.started = timer.running;
  if (timer.running && timer.endAt <= Date.now()) {
    // 앱이 닫혀 있는 동안 끝난 구간은 조용히 정리 (끝까지 한 집중은 기록)
    while (timer.running && timer.endAt <= Date.now()) endPhase(timer.endAt);
    persistTimer();
  }
}

function start() {
  if (timer.running || timer.remainingMs <= 0) return;
  if (!timer.started && timer.phase === 'focus') timer.focusStart = Date.now();
  timer.started = true;
  timer.running = true;
  timer.endAt = Date.now() + timer.remainingMs;
  holdWakeLock();
  persistTimer();
}

function stopRun() {
  if (!timer.running) return;
  timer.remainingMs = remaining();
  timer.running = false;
  releaseWakeLock();
}

function sessionDone() {
  return !!timer.plan && timer.doneRounds >= timer.plan.repeat;
}

// 지금 구간을 at 시각에 끝내고 다음 구간으로 넘김
// 집중+휴식 모드는 끝난 시각부터 다음 구간을 바로 이어 감 (화면이 꺼져 늦게 확인해도 시간이 밀리지 않게)
function endPhase(at) {
  const p = timer.plan;
  if (timer.phase === 'focus') {
    addLog({
      start: timer.focusStart || at - timer.sessionMinutes * 60000,
      end: at,
      minutes: timer.sessionMinutes,
      name: timer.name,
      round: timer.round,
      rounds: p ? p.repeat : 1,
    });
    timer.doneRounds++;
  }
  const more = p && timer.doneRounds < p.repeat;
  if (more && p.mode === 'cycle') {
    if (timer.phase === 'focus') {
      timer.phase = 'break';
      timer.sessionMinutes = p.breakMinutes;
    } else {
      timer.phase = 'focus';
      timer.round++;
      timer.focusStart = at;
      timer.sessionMinutes = p.minutes;
    }
    timer.endAt = at + timer.sessionMinutes * 60000;
    return timer.phase;
  }
  timer.started = false;
  timer.running = false;
  if (more) {
    // 집중만 모드: 다음 회차 시간을 채워 두고 START를 기다림
    timer.round++;
    timer.sessionMinutes = p.minutes;
    timer.remainingMs = p.minutes * 60000;
    return 'round';
  }
  timer.remainingMs = 0;
  return 'done';
}

function checkDone() {
  if (!timer.running || remaining() > 0) return;
  let kind;
  while (timer.running && timer.endAt <= Date.now()) kind = endPhase(timer.endAt);
  if (!timer.running) releaseWakeLock();
  persistTimer();
  markActivePreset();
  startAlarm(kind);
  render(true);
}

/* ───────── 기록 ───────── */
function loadLog() {
  try {
    const a = JSON.parse(localStorage.getItem(LOG_KEY));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
let focusLog = loadLog();
function saveLog() {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(focusLog)); } catch { /* 저장 불가 환경 */ }
}

function addLog(entry) {
  focusLog.push(entry);
  saveLog();
  logDirty = true;
}

/* ───────── SVG 다이얼 ───────── */
const svg = document.getElementById('clock');

function el(tag, attrs, parent) {
  const node = document.createElementNS(NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(node);
  return node;
}

function polar(r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

const shade = (v, pct, to = '#000') => `color-mix(in srgb, var(${v}) ${pct}%, ${to})`;

let sectorEl, knobRotEl, phraseEl, startG, startCap, startLabel, resetG, resetCap, hitEl;
let startPressed = false;
let resetHolding = false;
const RESET_HOLD_MS = 1000;
const tickEls = [];
const BODY_TOP = 40;               // 본체 윗면 y

function buildClock() {
  // 상단 버튼 (본체 뒤에 그려서 아랫부분이 가려지게)
  // RESET: 진행 중에만 본체 뒤에서 올라옴
  resetG = el('g', { class: 'top-btn reset-g', role: 'button', 'aria-label': '처음 시간으로 되돌리기' }, svg);
  resetCap = makeCap(resetG, {
    x: 246, width: 84, fill: 'var(--reset-bg)', ink: 'var(--reset-ink)',
    label: 'RESET', fontSize: 13, spacing: 2,
  });

  startG = el('g', { class: 'top-btn start-g', role: 'button', 'aria-label': '시작 / 일시정지' }, svg);
  startCap = makeCap(startG, {
    x: 122, width: 156, fill: 'var(--pause)', ink: 'var(--pause-ink)',
    label: 'START', fontSize: 13, spacing: 2,
  });
  startLabel = startCap.querySelector('text');

  // 본체
  const body = { x: 12, y: BODY_TOP, width: 376, height: 372, rx: 40 };
  el('rect', { ...body, y: BODY_TOP + 6, style: `fill:${shade('--body', 80)}` }, svg);
  el('rect', { ...body, style: 'fill:var(--body)' }, svg);

  // 베젤과 다이얼 판
  el('circle', { cx: CX, cy: CY, r: 173, style: `fill:${shade('--body', 90)}` }, svg);
  el('circle', { cx: CX, cy: CY, r: 165, style: 'fill:var(--face)' }, svg);
  el('circle', {
    cx: CX, cy: CY, r: 164, fill: 'none', 'stroke-width': 2,
    style: 'stroke:var(--ticks); opacity:.12',
  }, svg);

  // 눈금: 1분은 점, 5분은 굵은 막대
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0;
    const [x1, y1] = polar(major ? 146 : 154, i * 6);
    const [x2, y2] = polar(156, i * 6);
    const w = major ? 3.2 : 2.6;
    const t = el('line', {
      x1, y1, x2: major ? x2 : x1, y2: major ? y2 : y1,
      'stroke-width': w, 'stroke-linecap': 'round', style: 'stroke:var(--ticks)',
    }, svg);
    t.dataset.w = w;
    tickEls.push(t);
  }

  // 숫자는 10분 간격
  for (let m = 0; m < 60; m += 10) {
    const [x, y] = polar(128, m * 6);
    const t = el('text', {
      x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': 17, 'font-weight': 700, style: 'fill:var(--ticks)',
    }, svg);
    t.textContent = m;
  }

  // 시간 원판
  sectorEl = el('path', { class: 'sector', style: 'fill:var(--sector)' }, svg);

  // 문구 (원판 위에 테두리를 둘러 가려지지 않게)
  phraseEl = el('text', {
    x: CX, y: CY + 72, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 600,
    'font-style': 'italic', 'paint-order': 'stroke', 'stroke-width': 5, 'stroke-linejoin': 'round',
    style: 'fill:var(--phrase); stroke:var(--face)',
  }, svg);

  // 손잡이: 둥근 받침 + 가로지르는 손잡이 막대
  el('circle', { cx: CX, cy: CY + 4, r: 27, fill: 'rgba(0,0,0,.15)' }, svg);
  el('circle', { cx: CX, cy: CY, r: 26, style: `fill:${shade('--knob', 88)}` }, svg);
  knobRotEl = el('g', {}, svg);
  el('rect', {
    x: CX - 8, y: CY - 34, width: 16, height: 68, rx: 8,
    'stroke-width': 1.2, style: `fill:var(--knob); stroke:${shade('--knob', 75)}`,
  }, knobRotEl);
  el('circle', { cx: CX, cy: CY - 25, r: 3.2, style: 'fill:var(--sector)' }, knobRotEl);

  // 터치 영역
  hitEl = el('circle', { cx: CX, cy: CY, r: R_FACE + 10, fill: 'transparent', class: 'dial-hit' }, svg);

  // 누르는 동안 쑥 들어감 (PAUSE는 일시정지 동안 눌린 채로 유지)
  const pressable = (g, set, onClick) => {
    const press = (down) => () => { set(down); render(true); };
    g.addEventListener('pointerdown', () => {
      playClick(1500); // 다이얼보다 낮은 '딸깍'
      if (settings.vibrate && navigator.vibrate) navigator.vibrate(8);
    });
    g.addEventListener('pointerdown', press(true));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) g.addEventListener(ev, press(false));
    g.addEventListener('click', onClick);
  };
  pressable(startG, (v) => { startPressed = v; }, togglePause);

  // RESET은 실수 방지를 위해 길게 누르기: 누르는 동안 천천히 들어가고 끝까지 들어가면 리셋
  let holdTimer = null;
  resetG.addEventListener('pointerdown', (e) => {
    resetG.setPointerCapture(e.pointerId);
    playClick(1500);
    if (timer.phase === 'focus') showHint(RESET_WARNING);
    resetHolding = true;
    render(true);
    holdTimer = setTimeout(() => {
      holdTimer = null;
      resetHolding = false;
      playClick(1500);
      if (settings.vibrate && navigator.vibrate) navigator.vibrate(20);
      resetTimer();
    }, RESET_HOLD_MS);
  });
  const release = () => {
    if (!holdTimer) return;
    clearTimeout(holdTimer);
    holdTimer = null;
    resetHolding = false;
    render(true);
    showHint('RESET은 버튼이 끝까지 들어갈 때까지 길게 눌러 주세요');
  };
  resetG.addEventListener('pointerup', release);
  resetG.addEventListener('pointercancel', release);
  resetG.addEventListener('contextmenu', (e) => e.preventDefault());
}

// 상단 실물 버튼: 버튼 면 + 글자를 한 묶음으로
// 아랫부분은 본체 뒤에 가려지고, 누르면 묶음 전체가 아래로 들어감
const CAP_TOP = 2;
function makeCap(g, { x, width, fill, ink, label, fontSize, spacing }) {
  el('rect', { x: x - 10, y: 0, width: width + 20, height: BODY_TOP, fill: 'transparent' }, g);
  const cap = el('g', { class: 'cap' }, g);
  el('rect', { x, y: CAP_TOP, width, height: 70, rx: 10, style: `fill:${fill}` }, cap);
  const t = el('text', {
    x: x + width / 2, y: (CAP_TOP + BODY_TOP) / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central',
    'font-size': fontSize, 'font-weight': 700, 'letter-spacing': spacing, class: 'cap-label', style: `fill:${ink}`,
  }, cap);
  t.textContent = label;
  return cap;
}

function sectorPath(min) {
  if (min <= 0.002) return '';
  const r = R_SECTOR;
  if (min >= MAX_MIN - 0.002) {
    return `M ${CX} ${CY - r} A ${r} ${r} 0 1 1 ${CX} ${CY + r} A ${r} ${r} 0 1 1 ${CX} ${CY - r} Z`;
  }
  const deg = min * 6;
  const [x, y] = polar(r, deg);
  return `M ${CX} ${CY} L ${CX} ${CY - r} A ${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${x} ${y} Z`;
}

function currentPhrase() {
  return themeColors().text ?? ''; // 기본 테마는 고정 문구, 직접 만든 테마는 편집 창에서 정한 문구
}

function renderPhrase() {
  phraseEl.textContent = '';
  const lines = currentPhrase().split('\n').slice(0, 3);
  lines.forEach((line, i) => {
    const t = el('tspan', { x: CX, dy: i === 0 ? 0 : 19 }, phraseEl);
    t.textContent = line;
  });
}

/* ───────── 렌더링 ───────── */
const readoutEl = document.getElementById('readout');
const hintEl = document.getElementById('hint');
let lastKey = '';
let litTick = -1;

function fmt(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function render(force) {
  const rem = remaining();
  const key = `${Math.floor(rem / 100)}|${timer.running}|${timer.started}|${startPressed}|${resetHolding}|${settings.light}|${settings.readout}|${timer.phase}`;
  if (!force && key === lastKey) return;
  lastKey = key;

  renderSession();
  svg.classList.toggle('break', timer.phase === 'break');
  clearBtn.disabled = !timer.plan && !timer.name && rem <= 0;

  const min = rem / 60000;
  sectorEl.setAttribute('d', sectorPath(min));
  knobRotEl.setAttribute('transform', `rotate(${min * 6} ${CX} ${CY})`);

  // 째깍: 남은 초를 따라 눈금 하나가 한 칸씩 움직임
  const idx = timer.running && rem > 0 ? Math.ceil(rem / 1000) % 60 : -1;
  if (idx !== litTick) {
    if (litTick >= 0) {
      tickEls[litTick].style.stroke = 'var(--ticks)';
      tickEls[litTick].setAttribute('stroke-width', tickEls[litTick].dataset.w);
    }
    if (idx >= 0) {
      tickEls[idx].style.stroke = 'var(--secTick)';
      tickEls[idx].setAttribute('stroke-width', Number(tickEls[idx].dataset.w) + 2.4);
    }
    litTick = idx;
  }

  // 상단 버튼 눌림 상태
  // 진행 중엔 버튼이 눌려 들어가 있고, 올라와 있으면 대기·일시정지 상태
  startCap.classList.toggle('pressed', startPressed || timer.running);
  resetCap.classList.toggle('holding', resetHolding);
  // 진행 중엔 START/PAUSE가 왼쪽으로 비켜서고 RESET이 올라옴
  startG.classList.toggle('shifted', timer.started);
  resetG.classList.toggle('shown', timer.started);
  startLabel.textContent = timer.running ? 'PAUSE' : timer.started ? 'RESUME' : 'START';


  // 숫자 표시
  // 다이얼을 돌리는 동안엔 손가락에 가려지지 않게 항상 크게 표시
  readoutEl.classList.toggle('hidden', !settings.readout && !dragging);
  readoutEl.classList.toggle('setting', dragging);
  if (rem > 0) {
    readoutEl.textContent = (timer.phase === 'break' ? '휴식 · ' : '') +
      (timer.started && !timer.running ? 'PAUSED · ' : '') + fmt(rem);
  } else if (alarmActive) {
    readoutEl.textContent = '끝! 화면을 눌러 알람 끄기';
  } else {
    readoutEl.textContent = timer.plan?.repeat > 1 && sessionDone() ? '세션 완료' : '0:00';
  }
  // 시작하면 자주 쓰는 시간 버튼이 빠지고 시계가 가운데로
  document.body.classList.toggle('focus', timer.started);
  // 집중 시간이 흐르는 동안만 잠금. 휴식 중 기록 화면을 보다가 집중이 시작되면 타이머 화면으로 돌아옴
  const locked = timer.running && timer.phase === 'focus';
  if (document.body.classList.toggle('locked', locked) && pager.scrollLeft) pager.scrollTo({ left: 0 });
}

/* ───────── 세션 이름·회차 ───────── */
const sessionNameEl = document.getElementById('sessionName');
const roundsEl = document.getElementById('rounds');
let sessionKey = '';

function renderSession() {
  const p = timer.plan;
  const key = `${timer.name}|${p?.repeat}|${timer.round}|${timer.doneRounds}|${timer.phase}`;
  if (key === sessionKey) return;
  sessionKey = key;

  sessionNameEl.textContent = timer.name || '+ 이름';
  sessionNameEl.classList.toggle('empty', !timer.name);
  sessionNameEl.setAttribute('aria-label', timer.name ? `이름: ${timer.name} (눌러서 바꾸기)` : '이름 붙이기');

  // 반복 횟수만큼 동그라미: 마친 회차는 채우고, 지금 회차는 테두리 강조
  roundsEl.textContent = '';
  if (!p || p.repeat < 2) {
    roundsEl.removeAttribute('aria-label');
    return;
  }
  for (let i = 1; i <= p.repeat; i++) {
    const dot = document.createElement('span');
    dot.className = 'round-dot';
    if (i <= timer.doneRounds) dot.classList.add('done');
    else if (i === timer.round && timer.phase === 'focus') dot.classList.add('current');
    roundsEl.appendChild(dot);
  }
  roundsEl.setAttribute('aria-label', `${p.repeat}회 중 ${timer.doneRounds}회 완료`);
}

const nameDialog = document.getElementById('nameDialog');
const nameInput = document.getElementById('nameInput');

sessionNameEl.addEventListener('click', () => {
  nameInput.value = timer.name;
  nameDialog.returnValue = '';
  nameDialog.showModal();
  nameInput.select();
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    nameDialog.close('save');
  }
});
nameDialog.addEventListener('close', () => {
  if (nameDialog.returnValue !== 'save') return;
  timer.name = nameInput.value.trim();
  persistTimer();
  render(true);
});

function frame() {
  checkDone();
  render(dragging);
  requestAnimationFrame(frame);
}

/* ───────── 소리 ───────── */
let actx = null;
let clickBuf = null;
let alarmGain = null;

function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function playClick(freq = 3200) {
  if (!settings.dialSound) return;
  const a = audio();
  if (!a) return;
  if (!clickBuf) {
    const n = Math.floor(a.sampleRate * 0.025);
    clickBuf = a.createBuffer(1, n, a.sampleRate);
    const d = clickBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 6);
  }
  const src = a.createBufferSource();
  src.buffer = clickBuf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 0.9;
  const g = a.createGain();
  g.gain.value = 0.9;
  src.connect(bp).connect(g).connect(a.destination);
  src.start();
}

const ALARM_GAIN = 0.18;

function beepPattern(seconds, gainValue) {
  const a = audio();
  if (!a || gainValue <= 0) return null;
  const master = a.createGain();
  master.gain.value = gainValue;
  master.connect(a.destination);
  const t0 = a.currentTime + 0.05;
  for (let s = 0; s < seconds; s++) {
    for (let k = 0; k < 4; k++) {
      const t = t0 + s + k * 0.12;
      const o = a.createOscillator();
      o.type = 'square';
      o.frequency.value = 2050;
      const g = a.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.005);
      g.gain.setValueAtTime(1, t + 0.065);
      g.gain.linearRampToValueAtTime(0, t + 0.075);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.08);
    }
  }
  return master;
}

/* ───────── 알람 ───────── */
const flashEl = document.getElementById('flash');
let alarmTimeout = null;
let flashTimer = null;

// 다음 구간이 자동으로 이어질 때는 짧게만 울림
function alarmMessage(kind) {
  const p = timer.plan;
  if (kind === 'break') return ['휴식 시간이에요', `${p.breakMinutes}분 쉬고 다시 집중해요.`];
  if (kind === 'focus') return ['다시 집중할 시간이에요', `${p.repeat}회 중 ${timer.round}회차를 시작했어요.`];
  if (kind === 'round') return ['집중 시간 끝!', `${p.repeat}회 중 ${timer.doneRounds}회를 마쳤어요. START를 눌러 다음 회차를 시작해요.`];
  if (p?.repeat > 1) return ['세션 완료!', `${p.repeat}회를 모두 마쳤어요.`];
  return ['집중 시간 끝!', `${timer.sessionMinutes}분 타이머가 끝났어요.`];
}

function startAlarm(kind = 'done') {
  stopAlarm();
  alarmActive = true;
  const auto = kind === 'break' || kind === 'focus';
  const secs = auto ? Math.min(3, settings.alarmSeconds) : settings.alarmSeconds;

  alarmGain = settings.alarmSound ? beepPattern(secs, ALARM_GAIN) : null;

  if (settings.vibrate && navigator.vibrate) {
    const pattern = [];
    for (let s = 0; s < secs; s++) pattern.push(70, 50, 70, 50, 70, 50, 70, 570);
    navigator.vibrate(pattern);
  }

  if (settings.light) {
    let n = 0;
    flashEl.hidden = false;
    flashTimer = setInterval(() => {
      flashEl.classList.toggle('on');
      if (++n >= secs * 2) stopFlash();
    }, 500);
    flashEl.classList.add('on');
  }

  if (settings.notify && document.hidden && 'Notification' in window &&
      Notification.permission === 'granted' && navigator.serviceWorker) {
    const [title, body] = alarmMessage(kind);
    navigator.serviceWorker.ready.then((reg) => reg.showNotification(timer.name ? `${title} · ${timer.name}` : title, {
      body,
      tag: 'focus-timer',
      icon: 'icons/icon-192.png',
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true,
    })).catch(() => {});
  }

  alarmTimeout = setTimeout(stopAlarm, secs * 1000 + 300);
}

function stopFlash() {
  clearInterval(flashTimer);
  flashTimer = null;
  flashEl.classList.remove('on');
  flashEl.hidden = true;
}

function stopAlarm() {
  if (!alarmActive) return;
  alarmActive = false;
  clearTimeout(alarmTimeout);
  stopFlash();
  if (alarmGain) {
    try { alarmGain.disconnect(); } catch { /* 이미 해제됨 */ }
    alarmGain = null;
  }
  if (navigator.vibrate) navigator.vibrate(0);
  render(true);
}

/* ───────── 화면 꺼짐 방지 ───────── */
let wakeLock = null;

async function holdWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* 지원 안 함 / 거부됨 */ }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

/* ───────── 상단 버튼 ───────── */
function togglePause() {
  audio();
  stopAlarm();
  if (timer.running) {
    stopRun();
    hideHint();
  } else if (timer.remainingMs > 0) {
    start();
    showHint(RUNNING_HINT); // 버튼이 들어가 보이지 않으니 멈추는 법을 잠깐 안내
  }
  else showHint(sessionDone() && timer.plan.repeat > 1 ? '세션을 모두 마쳤어요. 다시 하려면 프리셋을 눌러 주세요' : DEFAULT_HINT);
  persistTimer();
  render(true);
}

const DEFAULT_HINT = hintEl.textContent;
const RUNNING_HINT = '잠시 멈추려면 눌려 있는 버튼을 한 번 더 눌러 주세요';
const RESET_WARNING = 'RESET하면 지금 하던 집중 시간은 기록되지 않아요';
let hintTimer = null;

// 안내 문구를 잠깐 바꿔 흔들어 보여 주기
function showHint(msg = DEFAULT_HINT) {
  clearTimeout(hintTimer);
  hintEl.textContent = msg;
  hintEl.classList.remove('nudge');
  void hintEl.offsetWidth; // 애니메이션 다시 시작
  hintEl.classList.add('nudge');
  hintTimer = setTimeout(() => {
    hintEl.classList.remove('nudge');
    hintEl.textContent = DEFAULT_HINT;
  }, 2600);
}

function hideHint() {
  clearTimeout(hintTimer);
  hintEl.classList.remove('nudge');
  hintEl.textContent = DEFAULT_HINT;
}

function resetTimer() {
  audio();
  stopAlarm();
  stopRun();
  timer.started = false;
  timer.remainingMs = timer.sessionMinutes * 60000; // 이번 구간의 처음 시간으로 (하던 집중은 기록하지 않음)
  timer.focusStart = 0;
  persistTimer();
  markActivePreset();
  render(true);
}

/* ───────── 다이얼 돌리기 ───────── */
let drag = null;

function pointerDeg(e) {
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const deg = Math.atan2(p.x - CX, -(p.y - CY)) * 180 / Math.PI;
  return (deg + 360) % 360;
}

function setupDial() {
  hitEl.addEventListener('pointerdown', (e) => {
    audio(); // 사용자 제스처로 오디오 잠금 해제
    // 진행 중(일시정지 포함)에는 실수로 바뀌지 않게 다이얼 잠금
    if (timer.started) {
      showHint('진행 중에는 다이얼이 잠겨 있어요. 다시 맞추려면 RESET을 눌러 주세요');
      return;
    }
    hitEl.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, last: Math.round(remaining() / 60000) };
  });

  hitEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.moved = true;
      dragging = true;
      stopAlarm();
    }
    let m = Math.round(pointerDeg(e) / 6);
    // 0 ↔ 60 경계를 넘어가지 않게 (실제 다이얼처럼 끝에서 멈춤)
    if (drag.last >= 45 && m <= 15) m = MAX_MIN;
    else if (drag.last <= 15 && m >= 45) m = 0;
    if (m !== drag.last) {
      playClick();
      if (settings.vibrate && navigator.vibrate) navigator.vibrate(4);
      drag.last = m;
    }
    timer.remainingMs = m * 60000;
    timer.sessionMinutes = m;
    leaveSession();
  });

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    dragging = false;
    if (moved) {
      markActivePreset();
      persistTimer();
    }
    render(true);
  };
  hitEl.addEventListener('pointerup', end);
  hitEl.addEventListener('pointercancel', end);
}

// 다이얼로 직접 맞추면 프리셋 세션에서 빠져 한 번만 쓰는 타이머가 됨 (프리셋 이름도 같이 비움)
function leaveSession() {
  if (timer.plan) timer.name = '';
  timer.plan = null;
  timer.phase = 'focus';
  timer.round = 1;
  timer.doneRounds = 0;
}

// 알람이 울리는 중에는 화면 어디를 눌러도 끄기
document.addEventListener('pointerdown', () => { if (alarmActive) stopAlarm(); }, true);

/* ───────── 세션 프리셋 (자주 쓰는 시간) ───────── */
const presetsNav = document.getElementById('presets');
const presetDialog = document.getElementById('presetDialog');
const presetName = document.getElementById('presetName');
const presetMinutes = document.getElementById('presetMinutes');
const presetBreak = document.getElementById('presetBreak');
const presetRepeat = document.getElementById('presetRepeat');
const breakField = document.getElementById('breakField');
const modeInputs = [...document.querySelectorAll('input[name="presetMode"]')];
const presetDelete = document.getElementById('presetDelete');
let editingPreset = -1;

function renderPresets() {
  presetsNav.textContent = '';
  settings.presets.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset' + (p ? '' : ' empty');
    if (p) {
      // 이름이 있으면 이름, 아래 줄에 시간·반복 (×: 직접 시작, ↻: 휴식 넣어 자동 반복)
      const main = document.createElement('span');
      main.className = 'p-main';
      main.textContent = p.name || `${p.minutes}분`;
      const sub = [p.name ? `${p.minutes}분` : '', p.repeat > 1 ? `${p.mode === 'cycle' ? '↻' : '×'}${p.repeat}` : '']
        .filter(Boolean).join(' ');
      b.append(main);
      if (sub) {
        const subEl = document.createElement('span');
        subEl.className = 'p-sub';
        subEl.textContent = sub;
        b.append(subEl);
      }
      const desc = [p.name, `${p.minutes}분`];
      if (p.repeat > 1) desc.push(p.mode === 'cycle' ? `휴식 ${p.breakMinutes}분 넣어 ${p.repeat}회 자동 반복` : `${p.repeat}회`);
      b.setAttribute('aria-label', `${desc.filter(Boolean).join(' ')} (길게 눌러 편집)`);
    } else {
      b.textContent = '+';
      b.setAttribute('aria-label', '세션 프리셋 추가');
    }

    let pressTimer = null;
    let longPressed = false;
    b.addEventListener('pointerdown', () => {
      longPressed = false;
      if (!p) return;
      pressTimer = setTimeout(() => {
        longPressed = true;
        if (navigator.vibrate) navigator.vibrate(15);
        openPresetDialog(i);
      }, 550);
    });
    const cancel = () => clearTimeout(pressTimer);
    b.addEventListener('pointerup', cancel);
    b.addEventListener('pointerleave', cancel);
    b.addEventListener('pointercancel', cancel);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (longPressed) return;
      if (!p) openPresetDialog(i);
      else usePreset(i);
    });
    presetsNav.appendChild(b);
  });
  markActivePreset();
}

function markActivePreset() {
  const buttons = presetsNav.children;
  settings.presets.forEach((p, i) => {
    buttons[i]?.classList.toggle('active', !!p && timer.plan?.preset === i && !sessionDone());
  });
}

function usePreset(i, quiet) {
  const p = settings.presets[i];
  if (!quiet) {
    audio();
    playClick();
  }
  stopAlarm();
  stopRun();
  timer.started = false;
  timer.plan = { preset: i, ...p };
  timer.name = p.name;
  timer.phase = 'focus';
  timer.round = 1;
  timer.doneRounds = 0;
  timer.focusStart = 0;
  timer.remainingMs = p.minutes * 60000;
  timer.sessionMinutes = p.minutes;
  persistTimer();
  markActivePreset();
  render(true);
}

// 맨 왼쪽 초기화: 프리셋 선택과 이름을 지우고 다이얼을 0으로
const clearBtn = document.getElementById('clearBtn');
clearBtn.addEventListener('click', () => {
  // 회차를 하나 이상 마친 세션이 아직 남아 있으면 한 번 확인
  const p = timer.plan;
  if (p && timer.doneRounds > 0 && !sessionDone()) {
    const label = timer.name ? `'${timer.name}' 세션` : '진행 중인 세션';
    if (!confirm(`${label}(${p.repeat}회 중 ${timer.doneRounds}회 완료)이 초기화돼요. 되돌릴 수 없어요.\n마친 회차는 기록에 남아요.`)) return;
  }
  audio();
  playClick();
  stopAlarm();
  stopRun();
  timer.started = false;
  leaveSession();
  timer.name = '';
  timer.focusStart = 0;
  timer.remainingMs = 0;
  timer.sessionMinutes = 0;
  persistTimer();
  markActivePreset();
  render(true);
});

function presetMode() {
  return modeInputs.find((r) => r.checked)?.value ?? 'focus';
}

function renderBreakField() {
  breakField.hidden = presetMode() !== 'cycle';
}
for (const r of modeInputs) r.addEventListener('change', renderBreakField);

function openPresetDialog(i) {
  editingPreset = i;
  const current = settings.presets[i];
  const dialMin = Math.round(remaining() / 60000);
  const p = current || normalizePreset({ minutes: timer.phase === 'focus' && dialMin > 0 ? dialMin : 25 });
  presetName.value = p.name;
  presetMinutes.value = p.minutes;
  presetBreak.value = p.breakMinutes;
  presetRepeat.value = p.repeat;
  for (const r of modeInputs) r.checked = r.value === p.mode;
  renderBreakField();
  document.getElementById('presetTitle').textContent = current ? '세션 프리셋 수정' : '세션 프리셋';
  presetDelete.hidden = !current;
  presetDialog.returnValue = '';
  presetDialog.showModal();
}

presetDelete.addEventListener('click', () => {
  settings.presets[editingPreset] = null;
  if (timer.plan?.preset === editingPreset) timer.plan.preset = -1; // 진행 중인 세션은 그대로 두고 버튼과의 연결만 끊음
  save();
  renderPresets();
  presetDialog.close('delete');
});

presetDialog.addEventListener('close', () => {
  if (presetDialog.returnValue !== 'save') return;
  const p = normalizePreset({
    name: presetName.value.trim(),
    minutes: presetMinutes.value,
    mode: presetMode(),
    repeat: presetRepeat.value,
    breakMinutes: presetBreak.value,
  });
  if (!p) return;
  settings.presets[editingPreset] = p;
  save();
  renderPresets();
  // 맞춰 둔 채 아직 시작하지 않은 프리셋을 고쳤으면 바로 반영
  if (timer.plan?.preset === editingPreset && !timer.started && timer.doneRounds === 0) usePreset(editingPreset, true);
});

/* ───────── 테마 ───────── */
const metaTheme = document.querySelector('meta[name="theme-color"]');

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// 버튼 색이 밝으면 어두운 글자, 어두우면 흰 글자
function inkOn(hex) {
  return luminance(hex) > 0.4 ? 'rgba(30,32,30,.78)' : 'rgba(255,255,255,.92)';
}

function applyTheme() {
  const c = themeColors();
  const root = document.documentElement.style;
  for (const [key] of COLOR_FIELDS) root.setProperty(`--${key}`, c[key]);
  root.setProperty('--pause-ink', inkOn(c.pause));
  root.setProperty('--reset-bg', c.reset);
  root.setProperty('--reset-ink', inkOn(c.reset));
  root.setProperty('--ink', inkOn(c.bg));
  root.setProperty('--body-ink', inkOn(c.body));
  metaTheme.setAttribute('content', c.bg);
  renderPhrase();
}

/* ───────── 설정 화면 ───────── */
const settingsDialog = document.getElementById('settingsDialog');
const themeList = document.getElementById('themeList');

const editThemeBtn = document.getElementById('editThemeBtn');
const themeActions = document.getElementById('themeActions');

function themeCard(t, selected) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'theme-card' + (selected ? ' selected' : '');
  const sw = document.createElement('span');
  sw.className = 'swatch';
  for (const k of ['body', 'sector', 'knob']) {
    const i = document.createElement('i');
    i.style.background = t[k];
    sw.appendChild(i);
  }
  const label = document.createElement('span');
  label.className = 'theme-name';
  label.textContent = t.name;
  b.append(sw, label);
  return b;
}

function selectTheme(themeId) {
  settings.theme = themeId;
  save();
  applyTheme();
  renderSettings();
}

function renderThemeList() {
  themeList.textContent = '';
  for (const [id, t] of Object.entries(THEMES)) {
    const b = themeCard(t, settings.theme === id);
    b.addEventListener('click', () => selectTheme(id));
    themeList.appendChild(b);
  }
  for (const t of settings.customThemes) {
    const themeId = `c:${t.id}`;
    const b = themeCard(t, settings.theme === themeId);
    // 짧게 누르면 선택, 길게 누르면 수정
    let pressTimer = null;
    let longPressed = false;
    b.addEventListener('pointerdown', () => {
      longPressed = false;
      pressTimer = setTimeout(() => {
        longPressed = true;
        if (navigator.vibrate) navigator.vibrate(15);
        openThemeEditor(t.id);
      }, 550);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(pressTimer));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.addEventListener('click', () => { if (!longPressed) selectTheme(themeId); });
    themeList.appendChild(b);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'theme-card add-theme';
  add.innerHTML = '<span class="plus">+</span><span class="theme-name">새 테마</span>';
  add.addEventListener('click', () => openThemeEditor(null));
  themeList.appendChild(add);

  // 고른 테마가 안 보이는 곳에 있으면 보이게 밀어 줌
  themeList.querySelector('.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  const current = customTheme(settings.theme);
  // 직접 만든 테마를 고르면 제목 줄 오른쪽에 수정·삭제 아이콘
  themeActions.hidden = !current;
}

editThemeBtn.addEventListener('click', () => {
  const current = customTheme(settings.theme);
  if (current) openThemeEditor(current.id);
});

/* ───────── 색상 편집기: 큰 네모(채도·밝기) + 색상 막대 ───────── */
const partChips = document.getElementById('partChips');
const pickerEl = document.getElementById('picker');
const svBox = document.getElementById('svBox');
const svThumb = document.getElementById('svThumb');
const hueBar = document.getElementById('hueBar');
const hueThumb = document.getElementById('hueThumb');
const pickPreview = document.getElementById('pickPreview');
const hexInput = document.getElementById('hexInput');
const rgbInputs = ['rIn', 'gIn', 'bIn'].map((id) => document.getElementById(id));

const selectedParts = new Set(['sector']);
let draft = null;        // 편집 중인 테마 (저장 전까지는 앱에 반영 안 됨)
let editingId = null;    // 수정 중인 테마 id, 새 테마면 null
const hsv = { h: 0, s: 0, v: 0 };

const toHex = (rgb) => `#${rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function hsvToRgb({ h, s, v }) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return [f(5), f(3), f(1)];
}

function rgbToHsv([r, g, b]) {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

// '#C8643B', 'c8643b', '#c63', 'rgb(200, 100, 59)', '200,100,59', '200 100 59' → '#c8643b'
function parseColor(text) {
  const s = text.trim().toLowerCase();
  let m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((ch) => ch + ch).join('') : m[1];
    return `#${h}`;
  }
  m = s.match(/^(?:rgb\s*\()?\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)?$/);
  if (m) {
    const v = m.slice(1).map(Number);
    if (v.every((n) => n <= 255)) return toHex(v);
  }
  return null;
}

// 선택기 화면(손잡이 위치, 값 입력칸)을 hsv에 맞춤. skip: 지금 입력 중인 칸은 건드리지 않음
function renderPicker(skip) {
  const hex = toHex(hsvToRgb(hsv));
  svBox.style.setProperty('--hue', `hsl(${hsv.h} 100% 50%)`);
  svThumb.style.left = `${hsv.s * 100}%`;
  svThumb.style.top = `${(1 - hsv.v) * 100}%`;
  svThumb.style.background = hex;
  hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
  pickPreview.style.background = hex;
  if (skip !== hexInput) {
    hexInput.value = hex.toUpperCase();
    hexInput.classList.remove('invalid');
  }
  if (skip !== 'rgb') fromHex(hex).forEach((n, i) => { rgbInputs[i].value = n; });
  pickerEl.classList.toggle('inactive', selectedParts.size === 0);
}

// 선택한 부분 모두에 현재 색 적용 (한 프레임에 한 번만)
let applyQueued = 0;
function applyPicked() {
  if (applyQueued || selectedParts.size === 0) return;
  applyQueued = requestAnimationFrame(() => {
    applyQueued = 0;
    const hex = toHex(hsvToRgb(hsv));
    for (const key of selectedParts) draft[key] = hex;
    renderChips();
    renderPreview();
  });
}

function setFromHex(hex, skip) {
  Object.assign(hsv, rgbToHsv(fromHex(hex)));
  renderPicker(skip);
  applyPicked();
}

function renderChips() {
  const c = draft;
  partChips.textContent = '';
  for (const [key, label] of COLOR_FIELDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'part-chip' + (selectedParts.has(key) ? ' selected' : '');
    b.setAttribute('aria-pressed', selectedParts.has(key));
    const dot = document.createElement('span');
    dot.className = 'swatch-dot';
    dot.style.background = c[key];
    const name = document.createElement('span');
    name.textContent = label;
    b.append(dot, name);
    b.addEventListener('click', () => {
      if (selectedParts.has(key)) {
        selectedParts.delete(key);
      } else {
        selectedParts.add(key);
        if (selectedParts.size === 1) {
          // 하나만 골랐으면 그 부분의 지금 색에서 시작
          Object.assign(hsv, rgbToHsv(fromHex(draft[key])));
        } else {
          // 여러 개를 고르면 지금 선택기 색으로 맞춤
          recordStep();
          applyPicked();
        }
      }
      renderChips();
      renderPicker();
    });
    partChips.appendChild(b);
  }
}

function renderColorFields() {
  const first = [...selectedParts][0];
  if (first) Object.assign(hsv, rgbToHsv(fromHex(draft[first])));
  renderChips();
  renderPicker();
}

/* ───────── 테마 만들기·수정 팝업 ───────── */
const themeDialog = document.getElementById('themeDialog');
const themeNameInput = document.getElementById('themeName');
const themePreview = document.getElementById('themePreview');
const themeDeleteBtn = document.getElementById('themeDelete');
const themePhraseInput = document.getElementById('themePhrase');
const copyFrom = document.getElementById('copyFrom');

// 다른 테마의 색과 문구를 편집 중인 테마로 복사 (이름은 그대로)
function renderCopyFrom() {
  copyFrom.textContent = '';
  const sources = [...Object.values(THEMES), ...settings.customThemes.filter((t) => t.id !== editingId)];
  for (const t of sources) {
    const b = themeCard(t, false);
    b.classList.add('mini');
    b.addEventListener('click', () => {
      recordStep();
      for (const [key] of COLOR_FIELDS) draft[key] = t[key];
      draft.text = t.text ?? '';
      themePhraseInput.value = draft.text;
      renderColorFields();
      renderPreview();
      playClick(1500);
    });
    copyFrom.appendChild(b);
  }
}
const previewText = themePreview.querySelector('.tp-text');

themePhraseInput.addEventListener('input', () => {
  startTyping(themePhraseInput);
  draft.text = themePhraseInput.value;
  renderPreview();
});
themeNameInput.addEventListener('input', () => {
  startTyping(themeNameInput);
  draft.name = themeNameInput.value;
});

/* 되돌리기·다시 하기: 바꾸기 직전 상태를 쌓아 둠 (드래그 한 번, 입력 한 번 = 한 단계) */
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
let undoStack = [];
let redoStack = [];
let typingIn = null;

function recordStep() {
  undoStack.push({ ...draft });
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  renderHistoryButtons();
}

// 같은 칸에 이어서 입력하는 동안은 한 단계로 묶음
function startTyping(field) {
  if (typingIn === field) return;
  typingIn = field;
  recordStep();
}
for (const ev of ['change', 'blur']) document.addEventListener(ev, () => { typingIn = null; }, true);

function renderHistoryButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

function restore(snapshot) {
  cancelAnimationFrame(applyQueued);
  applyQueued = 0;
  typingIn = null;
  draft = { ...snapshot };
  themeNameInput.value = draft.name ?? '';
  themePhraseInput.value = draft.text ?? '';
  renderColorFields();
  renderPreview();
  renderHistoryButtons();
}

undoBtn.addEventListener('click', () => {
  if (!undoStack.length) return;
  redoStack.push({ ...draft });
  restore(undoStack.pop());
});
redoBtn.addEventListener('click', () => {
  if (!redoStack.length) return;
  undoStack.push({ ...draft });
  restore(redoStack.pop());
});

function renderPreview() {
  for (const [key] of COLOR_FIELDS) themePreview.style.setProperty(`--p-${key}`, draft[key]);
  themePreview.style.setProperty('--p-pause-ink', inkOn(draft.pause));
  themePreview.style.setProperty('--p-reset-ink', inkOn(draft.reset));
  previewText.textContent = (draft.text || '').split('\n')[0];
}

function openThemeEditor(id) {
  editingId = id;
  const src = id
    ? settings.customThemes.find((t) => t.id === id)
    : { ...themeColors(), text: currentPhrase(), name: `나의 테마 ${settings.customThemes.length + 1}` };
  draft = { ...src };
  themeNameInput.value = draft.name;
  themePhraseInput.value = draft.text ?? '';
  document.getElementById('themeDialogTitle').textContent = id ? '테마 수정' : '새 테마';
  themeDeleteBtn.hidden = !id;
  selectedParts.clear();
  selectedParts.add('sector');
  undoStack = [];
  redoStack = [];
  typingIn = null;
  renderHistoryButtons();
  renderCopyFrom();
  renderColorFields();
  renderPreview();
  themeDialog.returnValue = '';
  themeDialog.showModal();
}

themeDialog.addEventListener('close', () => {
  if (themeDialog.returnValue !== 'save') return;
  draft.name = (draft.name ?? '').trim() || `나의 테마 ${settings.customThemes.length + 1}`;
  if (editingId) {
    const i = settings.customThemes.findIndex((t) => t.id === editingId);
    settings.customThemes[i] = { ...draft, id: editingId };
  } else {
    editingId = Date.now().toString(36);
    settings.customThemes.push({ ...draft, id: editingId });
  }
  selectTheme(`c:${editingId}`);
});

function deleteTheme(id) {
  const t = settings.customThemes.find((x) => x.id === id);
  if (!t || !confirm(`'${t.name}' 테마를 삭제할까요?`)) return false;
  settings.customThemes = settings.customThemes.filter((x) => x.id !== id);
  if (settings.theme === `c:${id}`) settings.theme = DEFAULTS.theme;
  selectTheme(settings.theme);
  return true;
}

themeDeleteBtn.addEventListener('click', () => {
  if (deleteTheme(editingId)) themeDialog.close('delete');
});

document.getElementById('deleteThemeBtn').addEventListener('click', () => {
  const current = customTheme(settings.theme);
  if (current) deleteTheme(current.id);
});

// 네모·막대를 손가락으로 끌어서 고르기
function dragOn(el, onMove) {
  const move = (e) => {
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    onMove(x, y);
    renderPicker();
    applyPicked();
  };
  el.addEventListener('pointerdown', (e) => {
    if (selectedParts.size === 0) return;
    recordStep();
    el.setPointerCapture(e.pointerId);
    move(e);
    el.addEventListener('pointermove', move);
  });
  const stop = () => el.removeEventListener('pointermove', move);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
}
dragOn(svBox, (x, y) => { hsv.s = x; hsv.v = 1 - y; });
dragOn(hueBar, (x) => { hsv.h = Math.min(359.9, x * 360); });

hexInput.addEventListener('input', () => {
  const hex = parseColor(hexInput.value);
  hexInput.classList.toggle('invalid', !hex && hexInput.value.trim() !== '');
  if (hex) {
    startTyping(hexInput);
    setFromHex(hex, hexInput);
  }
});
hexInput.addEventListener('change', () => renderPicker());

rgbInputs.forEach((input) => {
  input.addEventListener('input', () => {
    const v = rgbInputs.map((i) => Number(i.value));
    if (v.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) && rgbInputs.every((i) => i.value !== '')) {
      startTyping(input);
      setFromHex(toHex(v), 'rgb');
    }
  });
  input.addEventListener('change', () => renderPicker());
});

const alarmSecondsInput = document.getElementById('alarmSecondsInput');
const alarmSecondsValue = document.getElementById('alarmSecondsValue');

function renderAlarmSeconds() {
  alarmSecondsInput.value = settings.alarmSeconds;
  alarmSecondsValue.textContent = `${settings.alarmSeconds}초`;
  // 슬라이더 채워진 부분 표시
  alarmSecondsInput.style.setProperty('--fill', `${((settings.alarmSeconds - 1) / 59) * 100}%`);
}

alarmSecondsInput.addEventListener('input', () => {
  settings.alarmSeconds = Number(alarmSecondsInput.value);
  renderAlarmSeconds();
  save();
});

const toggles = {
  optAlarmSound: 'alarmSound',
  optDialSound: 'dialSound',
  optVibrate: 'vibrate',
  optReadout: 'readout',
  optLight: 'light',
  optNotify: 'notify',
};
for (const [id, key] of Object.entries(toggles)) {
  const input = document.getElementById(id);
  input.addEventListener('change', async () => {
    settings[key] = input.checked;
    if (key === 'notify' && input.checked) {
      if (!('Notification' in window)) {
        settings.notify = false;
      } else if (Notification.permission !== 'granted') {
        settings.notify = (await Notification.requestPermission()) === 'granted';
      }
      input.checked = settings.notify;
    }
    if (key === 'alarmSound' && input.checked) beepPattern(1, ALARM_GAIN); // 미리 듣기
    save();
    render(true);
  });
}

function renderSettings() {
  renderThemeList();
  renderAlarmSeconds();
  for (const [id, key] of Object.entries(toggles)) document.getElementById(id).checked = !!settings[key];
}

document.getElementById('settingsBtn').addEventListener('click', () => {
  audio();
  renderSettings();
  settingsDialog.showModal();
  themeList.querySelector('.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});

/* ───────── 사용 방법 ───────── */
const helpDialog = document.getElementById('helpDialog');
document.getElementById('helpBtn').addEventListener('click', () => helpDialog.showModal());

/* ───────── 기록 화면 ───────── */
const HM_WEEKS = 18; // 잔디에 보이는 주 수 (약 4개월)
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const heatmapEl = document.getElementById('heatmap');
const hmMonthsEl = document.getElementById('hmMonths');
const logSummaryEl = document.getElementById('logSummary');
const dayTitleEl = document.getElementById('dayTitle');
const dayListEl = document.getElementById('dayList');
let logDirty = true;
let selectedDay = null; // 'YYYY-M-D', 없으면 오늘

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const clock = (t) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function fmtDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

// 하루 집중 시간에 따른 잔디 진하기 (0~4)
function level(min) {
  if (!min) return 0;
  if (min < 30) return 1;
  if (min < 60) return 2;
  if (min < 120) return 3;
  return 4;
}

function renderLog() {
  logDirty = false;
  // 날짜별로 묶기 (시작한 날 기준)
  const byDay = new Map();
  for (const r of focusLog) {
    const k = dayKey(new Date(r.start));
    if (!byDay.has(k)) byDay.set(k, { minutes: 0, items: [] });
    const d = byDay.get(k);
    d.minutes += r.minutes;
    d.items.push(r);
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayKey = dayKey(today);
  if (!selectedDay) selectedDay = todayKey;

  // 요약: 오늘, 최근 7일, 연속 일수
  const minutesOn = (d) => byDay.get(dayKey(d))?.minutes ?? 0;
  let week = 0, weekCount = 0;
  for (let i = 0; i < 7; i++) {
    const d = byDay.get(dayKey(addDays(today, -i)));
    week += d?.minutes ?? 0;
    weekCount += d?.items.length ?? 0;
  }
  let streak = 0;
  for (let i = minutesOn(today) ? 0 : 1; minutesOn(addDays(today, -i)); i++) streak++;
  const todayData = byDay.get(todayKey);
  logSummaryEl.textContent = '';
  for (const [label, value, sub] of [
    ['오늘', fmtDuration(todayData?.minutes ?? 0), `${todayData?.items.length ?? 0}회`],
    ['최근 7일', fmtDuration(week), `${weekCount}회`],
    ['연속', `${streak}일`, streak ? '이어 가는 중' : '오늘 시작해요'],
  ]) {
    const tile = document.createElement('div');
    tile.className = 'stat';
    tile.innerHTML = '<span class="stat-label"></span><b class="stat-value"></b><span class="stat-sub"></span>';
    tile.children[0].textContent = label;
    tile.children[1].textContent = value;
    tile.children[2].textContent = sub;
    logSummaryEl.appendChild(tile);
  }

  // 잔디: 열 = 주(일요일 시작), 행 = 요일, 맨 오른쪽 열이 이번 주
  const first = addDays(today, -(HM_WEEKS - 1) * 7 - today.getDay());
  heatmapEl.textContent = '';
  hmMonthsEl.textContent = '';
  // 그 주에 1일이 들어 있으면 월 표시 (맨 처음 열은 바로 옆에 다음 달 표시가 없을 때만)
  const monthOf = (w) => {
    const weekStart = addDays(first, w * 7);
    return [...Array(7)].map((_, i) => addDays(weekStart, i)).find((d) => d.getDate() === 1 && d <= today);
  };
  for (let w = 0; w < HM_WEEKS; w++) {
    const label = document.createElement('span');
    const weekStart = addDays(first, w * 7);
    const monthStart = monthOf(w) || (w === 0 && !monthOf(1) && !monthOf(2) && weekStart);
    if (monthStart) label.textContent = `${monthStart.getMonth() + 1}월`;
    hmMonthsEl.appendChild(label);
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      const cell = document.createElement('span');
      cell.className = 'hm-cell';
      if (d > today) {
        cell.classList.add('future');
      } else {
        const k = dayKey(d);
        const min = byDay.get(k)?.minutes ?? 0;
        cell.dataset.day = k;
        cell.dataset.level = level(min);
        cell.title = `${d.getMonth() + 1}월 ${d.getDate()}일 · ${fmtDuration(min)}`;
        if (k === selectedDay) cell.classList.add('selected');
      }
      heatmapEl.appendChild(cell);
    }
  }

  // 고른 날의 세션 목록
  const [y, m, dd] = selectedDay.split('-').map(Number);
  const sel = new Date(y, m - 1, dd);
  const day = byDay.get(selectedDay);
  dayTitleEl.textContent = `${m}월 ${dd}일 (${WEEKDAYS[sel.getDay()]})` + (day ? ` · ${fmtDuration(day.minutes)}` : '');
  dayListEl.textContent = '';
  if (!day) {
    const li = document.createElement('li');
    li.className = 'day-empty';
    li.textContent = '이 날은 기록이 없어요';
    dayListEl.appendChild(li);
    return;
  }
  for (const r of [...day.items].sort((a, b) => a.start - b.start)) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="dl-time"></span><span class="dl-name"></span><span class="dl-min"></span>';
    li.children[0].textContent = `${clock(r.start)} – ${clock(r.end)}`;
    const name = li.children[1];
    name.textContent = r.name || '집중';
    name.classList.toggle('unnamed', !r.name);
    if (r.rounds > 1) {
      const small = document.createElement('small');
      small.textContent = ` ${r.round}/${r.rounds}`;
      name.appendChild(small);
    }
    li.children[2].textContent = `${r.minutes}분`;
    dayListEl.appendChild(li);
  }
}

heatmapEl.addEventListener('click', (e) => {
  const k = e.target.dataset?.day;
  if (!k) return;
  selectedDay = k;
  renderLog();
});

/* ───────── 옆으로 넘기는 페이지 ───────── */
const pager = document.getElementById('pager');
const pageDots = [...document.querySelectorAll('#pageDots button')];
let currentPage = 0;

function onPageChange() {
  const i = Math.round(pager.scrollLeft / pager.clientWidth);
  if (i === currentPage) return;
  currentPage = i;
  pageDots.forEach((b, j) => {
    b.classList.toggle('on', j === i);
    b.setAttribute('aria-current', j === i ? 'page' : 'false');
  });
  if (i === 1) {
    selectedDay = null; // 기록을 열 때마다 오늘부터
    renderLog();
  }
}
pager.addEventListener('scroll', onPageChange, { passive: true });
pageDots.forEach((b, i) => b.addEventListener('click', () => {
  pager.scrollTo({ left: i * pager.clientWidth, behavior: 'smooth' });
}));
// 기록 화면을 보는 동안 새 기록이 생기면 다시 그림
setInterval(() => { if (currentPage === 1 && logDirty) renderLog(); }, 1000);

/* ───────── 기록 내보내기·가져오기 ───────── */
const importFile = document.getElementById('importFile');

document.getElementById('exportLog').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'focus-timer', version: 1, log: focusLog }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `focus-timer-기록-${dayKey(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

document.getElementById('importLog').addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  importFile.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.log;
    if (!Array.isArray(list)) throw new Error('형식이 달라요');
    // 같은 시각에 시작한 기록은 이미 있는 것으로 보고 건너뜀
    const known = new Set(focusLog.map((r) => r.start));
    let added = 0;
    for (const r of list) {
      if (!Number.isFinite(r?.start) || !Number.isFinite(r?.end) || !Number.isFinite(r?.minutes) || known.has(r.start)) continue;
      focusLog.push({
        start: r.start, end: r.end, minutes: r.minutes,
        name: typeof r.name === 'string' ? r.name : '',
        round: Number(r.round) || 1, rounds: Number(r.rounds) || 1,
      });
      known.add(r.start);
      added++;
    }
    focusLog.sort((a, b) => a.start - b.start);
    saveLog();
    renderLog();
    alert(added ? `기록 ${added}개를 가져왔어요.` : '새로 가져올 기록이 없어요.');
  } catch {
    alert('기록 파일을 읽지 못했어요. 이 앱에서 내보낸 파일인지 확인해 주세요.');
  }
});

/* ───────── 앱 상태 변화 ───────── */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkDone();
    if (timer.running) holdWakeLock();
    render(true);
  }
});
// 백그라운드에서는 requestAnimationFrame이 멈추므로 별도로 확인
setInterval(checkDone, 1000);

/* ───────── 시작 ───────── */
buildClock();
setupDial();
restoreTimer();
applyTheme();
renderPresets();
if (timer.running) holdWakeLock();
render(true);
requestAnimationFrame(frame);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
