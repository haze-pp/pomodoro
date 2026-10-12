'use strict';

/* ───────── 기본 상수 ───────── */
const NS = 'http://www.w3.org/2000/svg';
const MAX_MIN = 60;
const CX = 200, CY = 228;          // 다이얼 중심
const R_FACE = 165;                // 다이얼 판 반지름
const R_SECTOR = 118;              // 시간 원판 반지름
const STORE_KEY = 'focus-timer:v1';

const THEMES = {
  sage: {
    name: '세이지', bg: '#e4e8df', body: '#b7c4ae', face: '#fbfbf7', sector: '#c8643b',
    knob: '#f4f0e7', pause: '#c8643b', ticks: '#4a5847', phrase: '#c8643b',
    text: 'Begin gently.',
  },
  lavender: {
    name: '라벤더', bg: '#e9e6f1', body: '#c9c1e1', face: '#fdfcff', sector: '#4b3f8f',
    knob: '#f7f4fc', pause: '#4b3f8f', ticks: '#4a4466', phrase: '#4b3f8f',
    text: 'Stay with it.',
  },
  charcoal: {
    name: '차콜', bg: '#1f2123', body: '#3a3e42', face: '#f1eee8', sector: '#ee9f35',
    knob: '#2d3034', pause: '#ee9f35', ticks: '#3b3f43', phrase: '#b8742a',
    text: 'Deep work\nmode.',
  },
};
const COLOR_FIELDS = [
  ['bg', '배경'], ['body', '본체'], ['face', '다이얼 판'], ['sector', '시간 원판'],
  ['knob', '손잡이'], ['pause', 'START 버튼'],
  ['ticks', '눈금·숫자'], ['phrase', '문구 색'],
];

const DEFAULTS = {
  theme: 'sage',
  custom: null,
  presets: [30, null, null, null],
  presetsSeeded: true, // 기본 30분 버튼을 한 번 넣었는지
  alarmSeconds: 30,
  alarmSound: true,
  light: false,
  dialSound: true,
  vibrate: true,
  readout: true,
  notify: false,
  phrase: null,      // 가운데 문구 (null이면 테마 기본 문구)
  timer: null,
};

/* ───────── 저장 ───────── */
function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    const saved = { ...DEFAULTS, ...raw };
    if (saved.theme !== 'custom' && !THEMES[saved.theme]) saved.theme = DEFAULTS.theme;
    // 예전 버전 사용자: 비어 있으면 기본 30분 버튼을 한 번만 채워 줌
    if (!raw.presetsSeeded) {
      if (saved.presets.every((m) => !m)) saved.presets = [...DEFAULTS.presets];
      saved.presetsSeeded = true;
    }
    // 이전 버전의 3단계 음량 설정 → 켬/끔
    if ('volume' in saved) {
      saved.alarmSound = saved.volume > 0;
      delete saved.volume;
    }
    saved.alarmSeconds = Math.min(60, Math.max(1, Math.round(Number(saved.alarmSeconds)) || 30));
    return saved;
  } catch {
    return { ...DEFAULTS };
  }
}
const settings = loadSettings();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* 저장 불가 환경 */ }
}

function themeColors() {
  if (settings.theme === 'custom' && settings.custom) return settings.custom;
  return THEMES[settings.theme] || THEMES[DEFAULTS.theme];
}

/* ───────── 타이머 상태 ───────── */
const timer = {
  running: false,
  endAt: 0,          // running일 때 종료 시각(ms)
  remainingMs: 0,    // 멈춰 있을 때 남은 시간
  started: false,    // START로 시작한 세션 진행 중(일시정지 포함)
  sessionMinutes: 0, // 이번에 맞춘 시간(알림 문구용)
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
    // 앱이 닫혀 있는 동안 끝난 타이머는 조용히 정리
    timer.started = false;
    timer.running = false;
    timer.remainingMs = 0;
  }
}

function start() {
  if (timer.running || timer.remainingMs <= 0) return;
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

function finish() {
  timer.started = false;
  timer.running = false;
  timer.remainingMs = 0;
  releaseWakeLock();
  persistTimer();
  markActivePreset();
  startAlarm();
  render(true);
}

function checkDone() {
  if (timer.running && remaining() <= 0) finish();
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
  sectorEl = el('path', { style: 'fill:var(--sector)' }, svg);

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
  return settings.phrase ?? themeColors().text ?? '';
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
  const key = `${Math.floor(rem / 100)}|${timer.running}|${timer.started}|${startPressed}|${resetHolding}|${settings.light}|${settings.readout}`;
  if (!force && key === lastKey) return;
  lastKey = key;

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
      tickEls[idx].style.stroke = 'var(--sector)';
      tickEls[idx].setAttribute('stroke-width', Number(tickEls[idx].dataset.w) + 2.4);
    }
    litTick = idx;
  }

  // 상단 버튼 눌림 상태
  startCap.classList.toggle('pressed', startPressed || (timer.started && !timer.running));
  resetCap.classList.toggle('holding', resetHolding);
  // 진행 중엔 START/PAUSE가 왼쪽으로 비켜서고 RESET이 올라옴
  startG.classList.toggle('shifted', timer.started);
  resetG.classList.toggle('shown', timer.started);
  startLabel.textContent = timer.started ? 'PAUSE' : 'START';
  // 일시정지 중엔 안내 문구를 계속 보여 줌 (잠깐 뜨는 안내가 있으면 그게 우선)
  const paused = timer.started && !timer.running;
  if (!hintEl.classList.contains('nudge')) hintEl.textContent = baseHint();
  hintEl.classList.toggle('sticky', paused);

  // 숫자 표시
  // 다이얼을 돌리는 동안엔 손가락에 가려지지 않게 항상 크게 표시
  readoutEl.classList.toggle('hidden', !settings.readout && !dragging);
  readoutEl.classList.toggle('setting', dragging);
  if (rem > 0) {
    readoutEl.textContent = (timer.started && !timer.running ? 'PAUSED · ' : '') + fmt(rem);
  } else {
    readoutEl.textContent = alarmActive ? '끝! 화면을 눌러 알람 끄기' : '0:00';
  }
  // 시작하면 자주 쓰는 시간 버튼이 빠지고 시계가 가운데로
  document.body.classList.toggle('focus', timer.started);
}

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

function startAlarm() {
  stopAlarm();
  alarmActive = true;
  const secs = settings.alarmSeconds;

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
    navigator.serviceWorker.ready.then((reg) => reg.showNotification('집중 시간 끝!', {
      body: `${timer.sessionMinutes}분 타이머가 끝났어요.`,
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
  if (timer.running) stopRun();
  else if (timer.remainingMs > 0) start();
  else showHint();
  persistTimer();
  render(true);
}

const DEFAULT_HINT = hintEl.textContent;
const PAUSED_HINT = '일시정지 중이에요. 이어서 하려면 버튼을 한 번 더 눌러 주세요';
const baseHint = () => (timer.started && !timer.running ? PAUSED_HINT : DEFAULT_HINT);
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
    hintEl.textContent = baseHint();
  }, 2600);
}

function resetTimer() {
  audio();
  stopAlarm();
  stopRun();
  timer.started = false;
  timer.remainingMs = timer.sessionMinutes * 60000; // 처음 맞춘 시간으로
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

// 알람이 울리는 중에는 화면 어디를 눌러도 끄기
document.addEventListener('pointerdown', () => { if (alarmActive) stopAlarm(); }, true);

/* ───────── 자주 쓰는 시간 ───────── */
const presetsNav = document.getElementById('presets');
const presetDialog = document.getElementById('presetDialog');
const presetMinutes = document.getElementById('presetMinutes');
const presetDelete = document.getElementById('presetDelete');
let editingPreset = -1;

function renderPresets() {
  presetsNav.textContent = '';
  settings.presets.forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset' + (m ? '' : ' empty');
    b.textContent = m ? `${m}분` : '+';
    b.setAttribute('aria-label', m ? `${m}분으로 맞추기 (길게 눌러 편집)` : '자주 쓰는 시간 추가');

    let pressTimer = null;
    let longPressed = false;
    b.addEventListener('pointerdown', () => {
      longPressed = false;
      if (!m) return;
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
      if (!m) openPresetDialog(i);
      else usePreset(m);
    });
    presetsNav.appendChild(b);
  });
  markActivePreset();
}

function markActivePreset() {
  const buttons = presetsNav.children;
  settings.presets.forEach((m, i) => {
    buttons[i]?.classList.toggle('active', !!m && m === timer.sessionMinutes && remaining() > 0);
  });
}

function usePreset(m) {
  audio();
  stopAlarm();
  stopRun();
  timer.started = false;
  timer.remainingMs = m * 60000;
  timer.sessionMinutes = m;
  playClick();
  persistTimer();
  markActivePreset();
  render(true);
}

function openPresetDialog(i) {
  editingPreset = i;
  const current = settings.presets[i];
  const dialMin = Math.round(remaining() / 60000);
  presetMinutes.value = current || (dialMin > 0 ? dialMin : 25);
  presetDelete.hidden = !current;
  presetDialog.returnValue = '';
  presetDialog.showModal();
  presetMinutes.select();
}

presetDelete.addEventListener('click', () => {
  settings.presets[editingPreset] = null;
  save();
  renderPresets();
  presetDialog.close('delete');
});

presetDialog.addEventListener('close', () => {
  if (presetDialog.returnValue !== 'save') return;
  const v = Math.round(Number(presetMinutes.value));
  if (v >= 1 && v <= MAX_MIN) {
    settings.presets[editingPreset] = v;
    save();
    renderPresets();
  }
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
  // RESET은 눈금 색으로 칠하되, 본체와 구분이 안 되면 다이얼 판 색으로
  const resetBg = contrast(c.ticks, c.body) >= 2 ? c.ticks : c.face;
  root.setProperty('--reset-bg', resetBg);
  root.setProperty('--reset-ink', inkOn(resetBg));
  root.setProperty('--ink', inkOn(c.bg));
  root.setProperty('--body-ink', inkOn(c.body));
  metaTheme.setAttribute('content', c.bg);
  renderPhrase();
}

/* ───────── 설정 화면 ───────── */
const settingsDialog = document.getElementById('settingsDialog');
const themeList = document.getElementById('themeList');
const colorFields = document.getElementById('colorFields');
const phraseInput = document.getElementById('phraseInput');
const phraseReset = document.getElementById('phraseReset');

function ensureCustom() {
  if (settings.theme !== 'custom' || !settings.custom) {
    settings.custom = { ...themeColors(), name: '나만의' };
    settings.theme = 'custom';
  }
  return settings.custom;
}

function renderThemeList() {
  themeList.textContent = '';
  const entries = Object.entries(THEMES).map(([id, t]) => [id, t]);
  entries.push(['custom', settings.custom || { ...themeColors(), name: '나만의' }]);
  for (const [id, t] of entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-card' + (settings.theme === id ? ' selected' : '');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    for (const k of ['body', 'sector', 'knob']) {
      const i = document.createElement('i');
      i.style.background = t[k];
      sw.appendChild(i);
    }
    const label = document.createElement('span');
    label.textContent = id === 'custom' ? '나만의' : t.name;
    b.append(sw, label);
    b.addEventListener('click', () => {
      if (id === 'custom') ensureCustom();
      else settings.theme = id;
      save();
      applyTheme();
      renderSettings();
      document.getElementById('customBox').open = id === 'custom';
    });
    themeList.appendChild(b);
  }
}

function renderColorFields() {
  colorFields.textContent = '';
  const c = themeColors();
  for (const [key, label] of COLOR_FIELDS) {
    const wrap = document.createElement('label');
    wrap.className = 'color-field';
    const input = document.createElement('input');
    input.type = 'color';
    input.value = c[key];
    input.addEventListener('input', () => {
      ensureCustom()[key] = input.value;
      save();
      applyTheme();
      renderThemeList();
    });
    const span = document.createElement('span');
    span.textContent = label;
    wrap.append(input, span);
    colorFields.appendChild(wrap);
  }
}

function renderPhraseInput() {
  phraseInput.value = currentPhrase();
  phraseReset.hidden = settings.phrase === null;
}

phraseInput.addEventListener('input', () => {
  settings.phrase = phraseInput.value;
  phraseReset.hidden = false;
  save();
  renderPhrase();
});

phraseReset.addEventListener('click', () => {
  settings.phrase = null;
  save();
  renderPhrase();
  renderPhraseInput();
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
  renderColorFields();
  renderPhraseInput();
  renderAlarmSeconds();
  for (const [id, key] of Object.entries(toggles)) document.getElementById(id).checked = !!settings[key];
}

document.getElementById('settingsBtn').addEventListener('click', () => {
  audio();
  renderSettings();
  document.getElementById('customBox').open = settings.theme === 'custom';
  settingsDialog.showModal();
});

/* ───────── 사용 방법 ───────── */
const helpDialog = document.getElementById('helpDialog');
document.getElementById('helpBtn').addEventListener('click', () => helpDialog.showModal());

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
