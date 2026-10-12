'use strict';

/* ───────── 기본 상수 ───────── */
const NS = 'http://www.w3.org/2000/svg';
const MAX_MIN = 60;
const CX = 200, CY = 228;          // 다이얼 중심
const R_FACE = 162;                // 다이얼 판 반지름
const R_SECTOR = 112;              // 시간 원판 반지름
const STORE_KEY = 'focus-timer:v1';

const THEMES = {
  classic: {
    name: '클래식', bg: '#cfdcd4', body: '#ece6dd', face: '#fbfaf6', sector: '#2f6b4f',
    knob: '#e6c18f', pause: '#2f7a57', light: '#f2994a', ticks: '#5d625e', phrase: '#2f6b4f',
    text: 'Great things\ntake time.',
  },
  butter: {
    name: '버터', bg: '#d6dbe7', body: '#f6edcb', face: '#f5f0e0', sector: '#1f4fa0',
    knob: '#f5c451', pause: '#2f5daa', light: '#f5c451', ticks: '#2f5daa', phrase: '#2f5daa',
    text: 'One thing\nat a time.',
  },
  tomato: {
    name: '토마토', bg: '#cfe0e4', body: '#93bfd6', face: '#f8f7f4', sector: '#d6312b',
    knob: '#e2dfd9', pause: '#e6e3dd', light: '#d23a33', ticks: '#5a5f63', phrase: '#d6312b',
    text: 'Flow with your\nown rhythm.',
  },
};

const COLOR_FIELDS = [
  ['bg', '배경'], ['body', '본체'], ['face', '다이얼 판'], ['sector', '시간 원판'],
  ['knob', '손잡이'], ['pause', '일시정지 버튼'], ['light', '라이트 버튼'],
  ['ticks', '눈금·숫자'], ['phrase', '문구 색'],
];

const DEFAULTS = {
  theme: 'classic',
  custom: null,
  presets: [null, null, null, null],
  alarmSeconds: 30,
  volume: 1,
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
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    return { ...DEFAULTS, ...saved };
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
  return THEMES[settings.theme] || THEMES.classic;
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

let sectorEl, knobRotEl, phraseEl, pauseCap, pauseLabel, lightCap, lightLabel, hitEl;
let pausePressed = false;
const tickEls = [];

function buildClock() {
  // 상단 버튼 (본체 뒤에 그려서 아랫부분이 가려지게)
  const pauseG = el('g', { class: 'top-btn', role: 'button', 'aria-label': '시작 / 일시정지' }, svg);
  el('rect', { x: 50, y: 0, width: 180, height: 40, fill: 'transparent' }, pauseG);
  pauseCap = el('rect', { x: 60, rx: 6, width: 160, height: 60, style: 'fill:var(--pause)' }, pauseG);
  pauseLabel = el('text', {
    x: 140, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 15,
    'font-weight': 700, 'letter-spacing': 2, class: 'cap-label', style: 'fill:var(--pause-ink)',
  }, pauseG);

  const lightG = el('g', { class: 'top-btn', role: 'button', 'aria-label': '라이트' }, svg);
  el('rect', { x: 262, y: 0, width: 112, height: 40, fill: 'transparent' }, lightG);
  lightCap = el('rect', { x: 270, rx: 16, width: 96, height: 60, style: 'fill:var(--light)' }, lightG);
  lightLabel = el('text', {
    x: 318, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 13,
    'font-weight': 700, 'letter-spacing': 1.5, class: 'cap-label', style: 'fill:var(--light-ink)',
  }, lightG);
  lightLabel.textContent = 'LIGHT';

  // 본체
  el('rect', { x: 12, y: 42, width: 376, height: 374, rx: 34, style: `fill:${shade('--body', 82)}` }, svg);
  el('rect', { x: 12, y: 36, width: 376, height: 374, rx: 34, style: 'fill:var(--body)' }, svg);

  // 테두리(투명 커버 느낌)
  el('circle', { cx: CX, cy: CY, r: 173, style: `fill:${shade('--body', 86)}` }, svg);
  el('circle', { cx: CX, cy: CY, r: 169, style: `fill:${shade('--body', 70, '#fff')}` }, svg);
  el('circle', { cx: CX, cy: CY, r: R_FACE, style: 'fill:var(--face)' }, svg);

  // 눈금
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0;
    const [x1, y1] = polar(156, i * 6);
    const [x2, y2] = polar(major ? 143 : 149, i * 6);
    tickEls.push(el('line', {
      x1, y1, x2, y2,
      'stroke-width': major ? 1.8 : 1,
      'stroke-linecap': 'round',
      style: 'stroke:var(--ticks)',
    }, svg));
  }

  // 숫자
  for (let m = 0; m < 60; m += 5) {
    const [x, y] = polar(130, m * 6);
    const t = el('text', {
      x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': 12, 'font-weight': 500, style: 'fill:var(--ticks)',
    }, svg);
    t.textContent = m;
  }

  // 0 위치 기준선
  el('line', {
    x1: CX, y1: CY - R_SECTOR, x2: CX, y2: CY - 156,
    'stroke-width': 1, style: 'stroke:var(--ticks); opacity:.55',
  }, svg);

  // 문구
  phraseEl = el('text', {
    x: CX, y: CY + 64, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 500,
    style: 'fill:var(--phrase)',
  }, svg);

  // 시간 원판
  sectorEl = el('path', { style: 'fill:var(--sector)' }, svg);

  // 손잡이
  el('circle', { cx: CX + 2, cy: CY + 5, r: 30, fill: 'rgba(0,0,0,.16)' }, svg);
  el('circle', { cx: CX, cy: CY, r: 29, style: 'fill:var(--knob)' }, svg);
  knobRotEl = el('g', {}, svg);
  for (let i = 0; i < 40; i++) {
    const [x1, y1] = polar(24.5, i * 9);
    const [x2, y2] = polar(29, i * 9);
    el('line', { x1, y1, x2, y2, 'stroke-width': 1.2, style: `stroke:${shade('--knob', 72)}` }, knobRotEl);
  }
  el('circle', { cx: CX, cy: CY, r: 23, style: `fill:${shade('--knob', 82, '#fff')}` }, knobRotEl);
  el('line', {
    x1: CX, y1: CY - 6, x2: CX, y2: CY - 18, 'stroke-width': 2.4, 'stroke-linecap': 'round',
    style: `stroke:${shade('--knob', 55)}`,
  }, knobRotEl);

  // 터치 영역
  hitEl = el('circle', { cx: CX, cy: CY, r: R_FACE + 10, fill: 'transparent', class: 'dial-hit' }, svg);

  // 시작/일시정지 버튼은 누르는 동안만 눌린 모양
  const press = (down) => () => { pausePressed = down; render(true); };
  pauseG.addEventListener('pointerdown', press(true));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) pauseG.addEventListener(ev, press(false));
  pauseG.addEventListener('click', togglePause);
  lightG.addEventListener('click', toggleLight);
}

// 상단 버튼: 본체 윗면(y=36) 위로 보이는 높이를 바꿔 눌림 표현
function setCap(cap, label, pressed, upY, downY) {
  const y = pressed ? downY : upY;
  cap.setAttribute('y', y);
  label.setAttribute('y', (y + 36) / 2 + 1);
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

function renderPhrase() {
  phraseEl.textContent = '';
  const lines = (themeColors().text || '').split('\n').slice(0, 3);
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
  const key = `${Math.floor(rem / 100)}|${timer.running}|${timer.started}|${pausePressed}|${settings.light}|${settings.readout}`;
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
      tickEls[litTick].setAttribute('stroke-width', litTick % 5 === 0 ? 1.8 : 1);
    }
    if (idx >= 0) {
      tickEls[idx].style.stroke = 'var(--sector)';
      tickEls[idx].setAttribute('stroke-width', 3.2);
    }
    litTick = idx;
  }

  // 상단 버튼 눌림 상태
  setCap(pauseCap, pauseLabel, pausePressed, 0, 13);
  pauseLabel.textContent = timer.running ? 'PAUSE' : 'START';
  setCap(lightCap, lightLabel, settings.light, 4, 15);

  // 숫자 표시
  // 다이얼을 돌리는 동안엔 손가락에 가려지지 않게 항상 크게 표시
  readoutEl.classList.toggle('hidden', !settings.readout && !dragging);
  readoutEl.classList.toggle('setting', dragging);
  if (rem > 0) {
    readoutEl.textContent = (timer.started && !timer.running ? '일시정지 · ' : '') + fmt(rem);
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

function playClick() {
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
  bp.frequency.value = 3200;
  bp.Q.value = 0.9;
  const g = a.createGain();
  g.gain.value = 0.9;
  src.connect(bp).connect(g).connect(a.destination);
  src.start();
}

const VOLUME_GAIN = [0, 0.05, 0.22];

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

  alarmGain = beepPattern(secs, VOLUME_GAIN[settings.volume] ?? 0);

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
  else nudgeHint();
  playClick();
  persistTimer();
  render(true);
}

function nudgeHint() {
  hintEl.classList.remove('nudge');
  void hintEl.offsetWidth; // 애니메이션 다시 시작
  hintEl.classList.add('nudge');
}

function toggleLight() {
  audio();
  settings.light = !settings.light;
  playClick();
  save();
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
      stopRun();
      timer.started = false; // 다시 맞추는 중 → START를 눌러야 시작
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

// 버튼 색이 밝으면 어두운 글자, 어두우면 흰 글자
function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? 'rgba(30,32,30,.78)' : 'rgba(255,255,255,.92)';
}

function applyTheme() {
  const c = themeColors();
  const root = document.documentElement.style;
  for (const [key] of COLOR_FIELDS) root.setProperty(`--${key}`, c[key]);
  root.setProperty('--pause-ink', inkOn(c.pause));
  root.setProperty('--light-ink', inkOn(c.light));
  metaTheme.setAttribute('content', c.bg);
  renderPhrase();
}

/* ───────── 설정 화면 ───────── */
const settingsDialog = document.getElementById('settingsDialog');
const themeList = document.getElementById('themeList');
const colorFields = document.getElementById('colorFields');
const phraseInput = document.getElementById('phraseInput');

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
  phraseInput.value = c.text || '';
}

phraseInput.addEventListener('input', () => {
  ensureCustom().text = phraseInput.value;
  save();
  applyTheme();
  renderThemeList();
});

document.querySelectorAll('.segmented').forEach((group) => {
  const key = group.dataset.setting;
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings[key] = Number(b.dataset.value);
    save();
    renderSettings();
    if (key === 'volume') beepPattern(1, VOLUME_GAIN[settings.volume]); // 미리 듣기
  });
});

const toggles = {
  optDialSound: 'dialSound',
  optVibrate: 'vibrate',
  optReadout: 'readout',
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
    save();
    render(true);
  });
}

function renderSettings() {
  renderThemeList();
  renderColorFields();
  document.querySelectorAll('.segmented').forEach((group) => {
    const v = String(settings[group.dataset.setting]);
    for (const b of group.children) b.classList.toggle('selected', b.dataset.value === v);
  });
  for (const [id, key] of Object.entries(toggles)) document.getElementById(id).checked = !!settings[key];
}

document.getElementById('settingsBtn').addEventListener('click', () => {
  audio();
  renderSettings();
  document.getElementById('customBox').open = settings.theme === 'custom';
  settingsDialog.showModal();
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
