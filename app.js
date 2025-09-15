// Pumping Iron - SPA with localStorage persistence

// ---- Utilities ----
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: '2-digit' });
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const toLocal = (ms) => new Date(ms).toLocaleString(undefined, {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false, timeZoneName: 'short'
});

// Color palette for series
const seriesColors = [
  '#6c5ce7', '#00b894', '#e17055', '#0984e3', '#e84393', '#fdcb6e', '#2d3436', '#636e72'
];

// ---- Data Layer (API with local fallback) ----
const DB = {
  k: { exercises: 'pi_exercises', workouts: 'pi_workouts' },
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : (fallback ?? null); }
    catch { return fallback ?? null; }
  },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
};

const Data = {
  sql: null,
  async init() {
    const url = window.NEON_DATABASE_URL || '';
    if (!url) throw new Error('NEON_DATABASE_URL is not configured');
    const mod = await import('https://esm.sh/@neondatabase/serverless');
    const { neon, neonConfig } = mod;
    neonConfig.fetchConnectionCache = true;
    this.sql = neon(url);
    // Ensure schema exists
    await this.sql`create table if not exists exercises (
      id serial primary key,
      name text not null,
      created_at timestamptz not null default now()
    );`;
    await this.sql`create table if not exists workouts (
      id serial primary key,
      name text not null,
      date timestamptz not null default now(),
      entries jsonb not null default '[]',
      created_at timestamptz not null default now()
    );`;
  },
  // Exercises
  async getExercises() {
    const rows = await this.sql`select id::text as id, name from exercises order by id asc`;
    return rows;
  },
  async addExercise(name) {
    await this.sql`insert into exercises(name) values (${name})`;
    return await this.getExercises();
  },
  async updateExercise(id, name) {
    await this.sql`update exercises set name = ${name} where id = ${id}::int`;
    return await this.getExercises();
  },
  async deleteExercise(id) {
    await this.sql`delete from exercises where id = ${id}::int`;
    return await this.getExercises();
  },
  // Workouts
  async getWorkouts() {
    const rows = await this.sql`
      select id::text as id, name, (extract(epoch from date)*1000)::bigint as epoch_ms, entries
      from workouts
      order by date desc, id desc`;
    return rows.map(r => ({ id: String(r.id), name: r.name, date: Number(r.epoch_ms), entries: r.entries || [] }));
  },
  async addWorkout(workout) {
    const { name, date, entries } = workout;
    await this.sql`insert into workouts(name, date, entries) values (${name}, to_timestamp(${Math.floor(date/1000)}), ${JSON.stringify(entries)}::jsonb)`;
    return await this.getWorkouts();
  },
};

function seedIfEmpty() { /* disabled for GitHub Pages DB-only mode */ }

// ---- Router ----
const views = {
  home: '#view-home',
  exercises: '#view-exercises',
  'new-workout': '#view-new-workout',
  'past-workouts': '#view-past-workouts',
  progress: '#view-progress',
};

function showView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const sel = views[name] || views.home;
  const el = $(sel);
  if (el) el.classList.add('active');
  // Toggle home background
  document.body.classList.toggle('home-bg', name === 'home');
  // Per-view refresh
  if (name === 'exercises') safeCall(renderExerciseList);
  if (name === 'new-workout') safeCall(refreshNewWorkoutSelectors);
  if (name === 'past-workouts') safeCall(renderWorkoutsList);
  if (name === 'progress') safeCall(initProgressView);
}

// Nav buttons
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-nav]');
  if (btn) {
    showView(btn.getAttribute('data-nav'));
  }
});

// ---- Manage Exercises ----
async function renderExerciseList() {
  const list = $('#exercise-list');
  let data = [];
  try { data = await Data.getExercises(); }
  catch (e) { return alertModal(`Cannot load exercises. ${e.message || e}`); }
  list.innerHTML = '';

  // Header row
  const header = document.createElement('div');
  header.className = 'item-row header';
  header.innerHTML = `
    <div><strong>Name</strong></div>
    <div class="row gap"><span class="meta">Actions</span></div>
  `;
  list.appendChild(header);

  // Data rows
  data.forEach(ex => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div>
        <div class="name">${ex.name}</div>
      </div>
      <div class="row gap">
        <button class="btn sm ghost" data-edit="${ex.id}">Edit</button>
        <button class="btn sm danger" data-del="${ex.id}">Delete</button>
      </div>
    `;
    list.appendChild(row);
  });
}

$('#btn-add-exercise').addEventListener('click', () => {
  const form = document.getElementById('add-exercise-form');
  const input = document.getElementById('add-exercise-input');
  form.classList.remove('hidden');
  input.value = '';
  input.focus();
});

document.getElementById('add-exercise-cancel').addEventListener('click', () => {
  document.getElementById('add-exercise-form').classList.add('hidden');
});

async function saveNewExerciseFromInput() {
  const input = document.getElementById('add-exercise-input');
  const name = (input.value || '').trim();
  if (!name) { alert('Please enter an exercise name.'); return; }
  try { await Data.addExercise(name); }
  catch (e) { return alertModal(`Cannot add exercise. ${e.message || e}`); }
  renderExerciseList();
  refreshNewWorkoutSelectors();
  document.getElementById('add-exercise-form').classList.add('hidden');
}

document.getElementById('add-exercise-save').addEventListener('click', saveNewExerciseFromInput);
document.getElementById('add-exercise-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveNewExerciseFromInput();
});

$('#exercise-list').addEventListener('click', async (e) => {
  const id = e.target.getAttribute('data-edit');
  if (id) {
    let list = [];
    try { list = await Data.getExercises(); } catch (e) { return alertModal(`Cannot edit exercise. ${e.message || e}`); }
    const ex = list.find(x => String(x.id) === String(id));
    const name = prompt('Edit exercise name', ex?.name || '');
    if (name && ex) {
      try { await Data.updateExercise(ex.id, name.trim()); }
      catch (e2) { return alertModal(`Cannot update exercise. ${e2.message || e2}`); }
      renderExerciseList();
      refreshNewWorkoutSelectors();
    }
  }
  const delId = e.target.getAttribute('data-del');
  if (delId) {
    confirmModal('Delete this exercise? This will not remove past workouts.', () => {
      Data.deleteExercise(delId)
        .then(() => { renderExerciseList(); refreshNewWorkoutSelectors(); })
        .catch(err => alertModal(`Cannot delete exercise. ${err.message || err}`));
    });
  }
});

// ---- New Workout Flow ----
let currentExercises = [];
const workoutDraft = {
  name: '',
  entries: [], // { exerciseId, sets: [{ weight, unit, reps }] }
};

async function refreshNewWorkoutSelectors() {
  const select = $('#select-exercise');
  let ex = [];
  try { ex = await Data.getExercises(); } catch (e) { return alertModal(`Cannot load exercises. ${e.message || e}`); }
  currentExercises = ex;
  select.innerHTML = ex.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  $('#workout-name').value = workoutDraft.name || '';
  renderWorkoutPlan();
}

$('#workout-name').addEventListener('input', (e) => {
  workoutDraft.name = e.target.value;
});

$('#sets-inc').addEventListener('click', () => {
  const input = $('#sets-count');
  input.value = Math.max(1, parseInt(input.value || '1', 10) + 1);
});
$('#sets-dec').addEventListener('click', () => {
  const input = $('#sets-count');
  input.value = Math.max(1, parseInt(input.value || '1', 10) - 1);
});

let setsState = null; // { exerciseId, total, idx, sets: [{weight,unit,reps}] }
let lastUnit = localStorage.getItem('pi_unit') || 'lb';

$('#btn-begin-sets').addEventListener('click', () => {
  const exerciseId = $('#select-exercise').value;
  const total = Math.max(1, parseInt($('#sets-count').value || '1', 10));
  if (!exerciseId || !total) return;
  setsState = { exerciseId, total, idx: 0, sets: [] };
  $('#sets-entry').classList.remove('hidden');
  const exName = $('#select-exercise').selectedOptions[0]?.textContent || '';
  $('#sets-entry-title').textContent = `Enter Reps: ${exName}`;
  updateSetLabel();
  $('#reps-input').value = '';
  const wEl = document.getElementById('weight-input');
  if (wEl) wEl.value = '';
  const unitEl = document.getElementById('weight-unit');
  if (unitEl) unitEl.value = lastUnit;
  renderSetsProgress();
});

function updateSetLabel() {
  $('#set-label').textContent = `Set ${setsState.idx + 1} of ${setsState.total}`;
}

function renderSetsProgress() {
  const cont = $('#sets-progress');
  cont.innerHTML = '';
  for (let i = 0; i < setsState.total; i++) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    const s = setsState.sets[i];
    chip.textContent = s ? `Set ${i+1}: ${s.weight ?? 0} ${s.unit || 'lb'}×${s.reps}` : `Set ${i+1}`;
    cont.appendChild(chip);
  }
}

$('#btn-next-set').addEventListener('click', () => {
  const reps = parseInt($('#reps-input').value || '', 10);
  const weight = parseFloat(($('#weight-input')?.value || '0'));
  const unit = ($('#weight-unit')?.value || 'lb');
  if (!Number.isFinite(reps) || reps <= 0) {
    alert('Please enter a valid positive number of reps.');
    return;
  }
  if (!Number.isFinite(weight) || weight < 0) {
    alert('Please enter a valid non-negative weight.');
    return;
  }
  setsState.sets[setsState.idx] = { weight, unit, reps };
  lastUnit = unit;
  localStorage.setItem('pi_unit', lastUnit);
  setsState.idx++;
  if (setsState.idx >= setsState.total) {
    // Commit to draft
    workoutDraft.entries.push({ exerciseId: setsState.exerciseId, sets: setsState.sets.slice() });
    setsState = null;
    $('#sets-entry').classList.add('hidden');
    renderWorkoutPlan();
  } else {
    $('#reps-input').value = '';
    const wEl = document.getElementById('weight-input');
    if (wEl) wEl.value = '';
    const unitEl = document.getElementById('weight-unit');
    if (unitEl) unitEl.value = lastUnit;
    updateSetLabel();
    renderSetsProgress();
  }
});

$('#btn-cancel-sets').addEventListener('click', () => {
  setsState = null;
  $('#sets-entry').classList.add('hidden');
});

function renderWorkoutPlan() {
  const cont = $('#workout-plan');
  if (!workoutDraft.entries.length) {
    cont.innerHTML = '<div class="meta">No exercises added yet.</div>';
    return;
  }
  const exById = indexById(currentExercises || []);
  cont.innerHTML = '';
  workoutDraft.entries.forEach((en, idx) => {
    const card = document.createElement('div');
    card.className = 'item-row';
    const exName = exById[en.exerciseId]?.name || 'Unknown';
    card.innerHTML = `
      <div>
        <div><strong>${exName}</strong></div>
        <div class="meta">${en.sets.map((s,i)=> (typeof s === 'number') ? `Set ${i+1}: ${s} reps` : `Set ${i+1}: ${s.weight ?? 0} ${s.unit || 'lb'}×${s.reps}`).join(', ')}</div>
      </div>
      <div class="row gap">
        <button class="btn sm ghost" data-remove-entry="${idx}">Remove</button>
      </div>
    `;
    cont.appendChild(card);
  });
}

$('#workout-plan').addEventListener('click', (e) => {
  const idxStr = e.target.getAttribute('data-remove-entry');
  if (idxStr) {
    const idx = parseInt(idxStr, 10);
    workoutDraft.entries.splice(idx, 1);
    renderWorkoutPlan();
  }
});

$('#btn-finish-workout').addEventListener('click', () => {
  if (!workoutDraft.entries.length) {
    alert('Please add at least one exercise to your workout.');
    return;
  }
  const defaultName = `Workout — ${new Date().toLocaleString()}`;
  if (!workoutDraft.name || !workoutDraft.name.trim()) {
    workoutDraft.name = defaultName;
    const nameInput = document.getElementById('workout-name');
    if (nameInput) nameInput.value = workoutDraft.name;
  }
  confirmModal('Finish workout and save?', async () => {
    await Data.addWorkout({ id: uid(), name: workoutDraft.name.trim(), date: Date.now(), entries: workoutDraft.entries.slice() });
    // Reset draft
    workoutDraft.name = '';
    workoutDraft.entries = [];
    showView('past-workouts');
  });
});

function getExerciseById(id) {
  return DB.get(DB.k.exercises, []).find(x => x.id === id);
}
function indexById(arr) {
  return Object.fromEntries(arr.map(x => [x.id, x]));
}

// ---- Past Workouts ----
async function renderWorkoutsList() {
  const list = $('#workouts-list');
  let workouts = [], exercises = [];
  try { [workouts, exercises] = await Promise.all([Data.getWorkouts(), Data.getExercises()]); }
  catch (e) { return alertModal(`Cannot load workouts. ${e.message || e}`); }
  const exIdx = indexById(exercises);
  list.innerHTML = '';
  const detail = $('#workout-detail');
  detail.classList.add('hidden');
  workouts.forEach(w => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div>
        <div><strong>${w.name}</strong></div>
        <div class="meta">${fmtDate(w.date)} • ${w.entries.length} exercises</div>
      </div>
      <div><button class="btn sm ghost" data-open-workout="${w.id}">Open</button></div>
    `;
    list.appendChild(row);
  });

  list.addEventListener('click', handleOpenWorkout);

  function handleOpenWorkout(e) {
    const id = e.target.getAttribute('data-open-workout');
    if (!id) return;
    const w = workouts.find(x => String(x.id) === String(id));
    if (!w) return;
    renderWorkoutDetail(w, exIdx);
  }
}

function renderWorkoutDetail(w, exIdx) {
  const detail = $('#workout-detail');
  detail.classList.remove('hidden');
  detail.innerHTML = `
    <div class="row gap" style="justify-content: space-between;">
      <h3 style="margin: 0;">${w.name}</h3>
      <div class="meta">${fmtDate(w.date)}</div>
    </div>
    <div style="margin-top:8px; display:grid; gap:8px;">
      ${w.entries.map(en => {
        const exName = exIdx[en.exerciseId]?.name || 'Unknown';
        const sets = en.sets.map((s,i)=> (typeof s === 'number') ? `Set ${i+1}: ${s} reps` : `Set ${i+1}: ${s.weight ?? 0} ${s.unit || 'lb'}×${s.reps}`).join(', ');
        return `<div class="item-row"><div><strong>${exName}</strong><div class=meta>${sets}</div></div></div>`;
      }).join('')}
    </div>
  `;
}

// ---- Progress ----
async function initProgressView() {
  const select = $('#progress-exercise');
  let ex = [];
  try { ex = await Data.getExercises(); } catch (e) { return alertModal(`Cannot load exercises. ${e.message || e}`); }
  select.innerHTML = ex.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  if (ex.length) {
    drawProgressChart(select.value);
  } else {
    const ctx = getChartContext();
    clearChart(ctx);
  }
}

$('#progress-exercise').addEventListener('change', (e) => {
  drawProgressChart(e.target.value);
});

async function gatherExerciseProgress(exerciseId) {
  // Return { labels: [dates], series: [ { name:'Set 1', color, points:[{x,y,reps,date}], visible:true } ] }
  let workouts = [];
  try { workouts = (await Data.getWorkouts()).slice().sort((a,b)=>a.date-b.date); }
  catch (e) { alertModal(`Cannot load progress. ${e.message || e}`); return { labels: [], series: [] }; }
  const labels = [];
  const pointsBySetIndex = new Map();
  workouts.forEach((w) => {
    const entry = w.entries.find(e => e.exerciseId === exerciseId);
    if (!entry) return;
    const label = fmtDate(w.date);
    labels.push(label);
    entry.sets.forEach((s, sIdx) => {
      const reps = typeof s === 'number' ? s : s.reps;
      const weight = typeof s === 'number' ? null : (s.weight ?? null);
      const unit = (typeof s === 'number' || s.unit == null) ? 'lb' : s.unit;
      if (weight == null) return; // skip points without weight
      const weightLb = unit === 'kg' ? weight * 2.20462 : weight;
      if (!pointsBySetIndex.has(sIdx)) pointsBySetIndex.set(sIdx, []);
      pointsBySetIndex.get(sIdx).push({ x: labels.length - 1, y: weightLb, reps, date: w.date, workoutName: w.name });
    });
  });

  const series = Array.from(pointsBySetIndex.entries()).map(([sIdx, pts], i) => ({
    name: `Set ${sIdx + 1}`,
    color: seriesColors[i % seriesColors.length],
    points: pts,
    visible: true,
  }));
  return { labels, series };
}

function getChartContext() {
  const canvas = $('#progress-chart');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { canvas, ctx, width: w, height: h };
}

function clearChart({ ctx, width, height }) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
}

function drawAxes(ctx, width, height, padding, labels, yMax) {
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  // horizontal grid lines
  const rows = 4;
  for (let i = 0; i <= rows; i++) {
    const y = padding + ((height - padding*2) * i) / rows;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }
  // y-axis labels
  ctx.fillStyle = '#6b7280';
  ctx.font = '12px system-ui, sans-serif';
  for (let i = 0; i <= rows; i++) {
    const val = Math.round(yMax * (1 - i / rows));
    const y = padding + ((height - padding*2) * i) / rows + 4;
    ctx.fillText(String(val), padding - 30, y);
  }
  // y-axis title
  ctx.save();
  ctx.translate(4, height/2);
  ctx.rotate(-Math.PI/2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Weight (lb)', 0, 0);
  ctx.restore();
  // x-axis labels
  const step = Math.max(1, Math.floor(labels.length / 5));
  labels.forEach((lab, i) => {
    if (i % step !== 0) return;
    const x = padding + i * ((width - padding*2) / Math.max(1, labels.length - 1));
    ctx.fillText(lab, x - 16, height - padding + 14);
  });
}

async function drawProgressChart(exerciseId) {
  const chart = getChartContext();
  clearChart(chart);
  const { labels, series } = await gatherExerciseProgress(exerciseId);

  const padding = 40;
  const { ctx, width, height } = chart;

  // Compute yMax
  const allY = series.flatMap(s => s.visible ? s.points.map(p => p.y) : []);
  const yMax = Math.max(10, Math.max(0, ...allY) * 1.2);

  drawAxes(ctx, width, height, padding, labels, yMax);

  // Scales
  const xScale = (i) => padding + (labels.length <= 1 ? 0 : i * ((width - padding*2) / (labels.length - 1)));
  const yScale = (v) => padding + (height - padding*2) * (1 - v / yMax);

  // Draw series lines
  series.forEach((s) => {
    if (!s.visible || s.points.length === 0) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const x = xScale(p.x);
      const y = yScale(p.y);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Points
    ctx.fillStyle = s.color;
    s.points.forEach(p => {
      const x = xScale(p.x), y = yScale(p.y);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2); ctx.fill();
    });
  });

  // Legend with toggles
  const legend = $('#chart-legend');
  legend.innerHTML = '';
  series.forEach((s, idx) => {
    const key = document.createElement('div');
    key.className = 'key';
    key.innerHTML = `<span class="swatch" style="background:${s.visible ? s.color : '#ccc'}"></span>${s.name}`;
    key.addEventListener('click', () => {
      s.visible = !s.visible;
      drawProgressChart(exerciseId);
    });
    legend.appendChild(key);
  });

  // Hover tooltip
  const tooltip = createOrGetTooltip();
  chart.canvas.onmousemove = (ev) => {
    const rect = chart.canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const hit = findClosestPoint(series, labels, mx, my, padding, width, height, yMax);
    if (hit) {
      tooltip.style.display = 'block';
      tooltip.style.left = `${ev.clientX + 10}px`;
      tooltip.style.top = `${ev.clientY + 10}px`;
      tooltip.innerHTML = `${hit.seriesName}<br>${labels[hit.point.x]} — ${hit.point.y.toFixed(1)} lb • ${hit.point.reps} reps`;
    } else {
      tooltip.style.display = 'none';
    }
  };
  chart.canvas.onmouseleave = () => { const t = $('#chart-tooltip'); if (t) t.style.display = 'none'; };
}

function createOrGetTooltip() {
  let el = document.getElementById('chart-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chart-tooltip';
    el.style.position = 'fixed';
    el.style.pointerEvents = 'none';
    el.style.background = 'white';
    el.style.border = '1px solid #ddd';
    el.style.borderRadius = '8px';
    el.style.boxShadow = '0 4px 14px rgba(0,0,0,0.15)';
    el.style.padding = '6px 8px';
    el.style.fontSize = '12px';
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}

function findClosestPoint(series, labels, mx, my, padding, width, height, yMax) {
  if (labels.length === 0) return null;
  const xScale = (i) => padding + (labels.length <= 1 ? 0 : i * ((width - padding*2) / (labels.length - 1)));
  const yScale = (v) => padding + (height - padding*2) * (1 - v / yMax);
  let best = null;
  series.forEach(s => {
    if (!s.visible) return;
    s.points.forEach(p => {
      const x = xScale(p.x), y = yScale(p.y);
      const dx = mx - x, dy = my - y;
      const d2 = dx*dx + dy*dy;
      if (best == null || d2 < best.d2) best = { d2, seriesName: s.name, point: p };
    });
  });
  if (best && best.d2 < 20*20) return best;
  return null;
}

// ---- Modal ----
function confirmModal(message, onConfirm) {
  const modal = $('#modal');
  $('#modal-message').textContent = message;
  modal.classList.remove('hidden');
  const cleanup = () => { modal.classList.add('hidden'); ok.removeEventListener('click', okH); cancel.removeEventListener('click', cancelH); };
  const ok = $('#modal-confirm');
  const cancel = $('#modal-cancel');
  const okH = () => { cleanup(); onConfirm?.(); };
  const cancelH = () => cleanup();
  ok.addEventListener('click', okH);
  cancel.addEventListener('click', cancelH);
}

function alertModal(message) {
  const modal = $('#modal');
  $('#modal-message').textContent = message;
  // Hide cancel, set confirm to OK
  const ok = $('#modal-confirm');
  const cancel = $('#modal-cancel');
  const prevText = ok.textContent;
  ok.textContent = 'OK';
  cancel.classList.add('hidden');
  modal.classList.remove('hidden');
  const cleanup = () => {
    modal.classList.add('hidden');
    ok.removeEventListener('click', okH);
    ok.textContent = prevText;
    cancel.classList.remove('hidden');
  };
  const okH = () => cleanup();
  ok.addEventListener('click', okH);
}

function safeCall(fn) {
  try { const r = fn(); if (r && typeof r.then === 'function') r.catch(e => alertModal(e.message || String(e))); }
  catch (e) { alertModal(e.message || String(e)); }
}

// ---- Init ----
// Initialize; require API; show popup on failure
(async () => {
  try {
    await Data.init();
  } catch (e) {
    alertModal(`Cannot connect to Neon database. ${e.message || e}`);
  }
  showView('home');
})();

// ---- Export CSV ----
function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function downloadBlob(filename, mime, data) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'btn-export-csv') {
    try {
      const [workouts, exercises] = await Promise.all([Data.getWorkouts(), Data.getExercises()]);
      const exIdx = indexById(exercises);
      const rows = [];
      rows.push(['workout_id','workout_name','date_local','exercise','set_number','weight_lb','reps','unit']);
      workouts.forEach(w => {
        (w.entries || []).forEach(en => {
          const exName = exIdx[en.exerciseId]?.name || 'Unknown';
          (en.sets || []).forEach((s, i) => {
            let reps, weight, unit;
            if (typeof s === 'number') { reps = s; weight = ''; unit=''; }
            else { reps = s.reps; weight = s.weight ?? ''; unit = s.unit || 'lb'; }
            const weightLb = unit === 'kg' && weight !== '' ? (Number(weight) * 2.20462) : weight;
            rows.push([
              w.id,
              w.name,
              toLocal(w.date),
              exName,
              i+1,
              weightLb === '' ? '' : Number(weightLb).toFixed(1),
              reps,
              unit
            ]);
          });
        });
      });
      const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
      downloadBlob('pumping_iron_export.csv', 'text/csv;charset=utf-8', csv);
    } catch (err) {
      alertModal(`Export failed. ${err.message || err}`);
    }
  }
});

// Responsive redraw for chart on resize
window.addEventListener('resize', () => {
  const progressVisible = $('#view-progress')?.classList.contains('active');
  if (!progressVisible) return;
  const exId = $('#progress-exercise')?.value;
  if (exId) drawProgressChart(exId);
});
