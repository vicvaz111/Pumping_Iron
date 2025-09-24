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
  async deleteWorkout(id) {
    await this.sql`delete from workouts where id = ${id}::int`;
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
  if (name === 'new-workout') safeCall(initNewWorkoutView);
  if (name === 'past-workouts') safeCall(renderWorkoutsList);
  if (name === 'progress') safeCall(initProgressView);
}

// Global click handlers for navigation and quick actions
document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('[data-nav]');
  if (navBtn) {
    showView(navBtn.getAttribute('data-nav'));
    return;
  }

  const freshBtn = e.target.closest('[data-start-fresh-workout]');
  if (freshBtn) {
    handleStartFreshWorkout();
    return;
  }

  const startExistingBtn = e.target.closest('[data-start-workout]');
  if (startExistingBtn) {
    const workoutId = startExistingBtn.getAttribute('data-start-workout');
    handleStartRecentWorkout(workoutId);
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
let recentWorkouts = [];
let recentWorkoutsError = null;
let newWorkoutMode = 'chooser';
const RECENT_WORKOUT_LIMIT = 5;
const workoutDraft = {
  name: '',
  entries: [], // { exerciseId, sets: [{ weight, unit, reps }] }
};

async function initNewWorkoutView() {
  await refreshNewWorkoutSelectors({ includeWorkouts: true });
  const hasDraft = workoutDraft.entries.length > 0 || (workoutDraft.name && workoutDraft.name.trim());
  if (newWorkoutMode === 'builder' || hasDraft) {
    showNewWorkoutBuilder();
  } else {
    showNewWorkoutChooser();
  }
}

async function refreshNewWorkoutSelectors(options = {}) {
  const { includeWorkouts = false } = options;
  const select = $('#select-exercise');
  let exercises = [];
  try {
    exercises = await Data.getExercises();
  } catch (e) {
    alertModal(`Cannot load exercises. ${e.message || e}`);
    return;
  }
  currentExercises = exercises;
  if (select) select.innerHTML = exercises.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  const nameInput = $('#workout-name');
  if (nameInput) nameInput.value = workoutDraft.name || '';
  renderWorkoutPlan();

  if (includeWorkouts) {
    setRecentWorkoutsLoading();
    try {
      recentWorkouts = await Data.getWorkouts();
      recentWorkoutsError = null;
    } catch (err) {
      recentWorkouts = [];
      recentWorkoutsError = err.message || String(err);
    }
    renderRecentWorkouts();
  }
}

function showNewWorkoutChooser({ resetDraft = false } = {}) {
  if (resetDraft) {
    resetWorkoutDraft();
  }
  newWorkoutMode = 'chooser';
  $('#new-workout-chooser')?.classList.remove('hidden');
  $('#new-workout-builder')?.classList.add('hidden');
  renderRecentWorkouts();
}

function showNewWorkoutBuilder() {
  newWorkoutMode = 'builder';
  $('#new-workout-chooser')?.classList.add('hidden');
  $('#new-workout-builder')?.classList.remove('hidden');
  renderWorkoutPlan();
}

function resetWorkoutDraft() {
  workoutDraft.name = '';
  workoutDraft.entries = [];
  setsState = null;
  const nameInput = $('#workout-name');
  if (nameInput) nameInput.value = '';
  $('#sets-entry')?.classList.add('hidden');
  renderWorkoutPlan();
}

function renderRecentWorkouts() {
  const list = $('#recent-workouts-list');
  if (!list) return;
  list.innerHTML = '';
  if (recentWorkoutsError) {
    const msg = document.createElement('div');
    msg.className = 'meta';
    msg.textContent = `Cannot load recent workouts. ${recentWorkoutsError}`;
    list.appendChild(msg);
    return;
  }
  const toRender = recentWorkouts.slice(0, RECENT_WORKOUT_LIMIT);
  if (!toRender.length) {
    const empty = document.createElement('div');
    empty.className = 'meta';
    empty.textContent = 'No workouts yet. Finish one to reuse it here.';
    list.appendChild(empty);
    return;
  }
  toRender.forEach((w) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div>
        <div><strong>${w.name}</strong></div>
        <div class="meta">${fmtDate(w.date)} • ${w.entries.length} exercises</div>
      </div>
      <div class="row gap">
        <button class="btn sm" type="button" data-start-workout="${w.id}">Start</button>
      </div>
    `;
    list.appendChild(row);
  });
}

function setRecentWorkoutsLoading() {
  setRecentWorkoutsMessage('Loading recent workouts…');
}

function setRecentWorkoutsMessage(message) {
  const list = $('#recent-workouts-list');
  if (!list) return;
  list.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'meta';
  msg.textContent = message;
  list.appendChild(msg);
}

function loadWorkoutIntoDraft(workout) {
  if (!workout) return;
  workoutDraft.name = workout.name || '';
  workoutDraft.entries = (workout.entries || []).map(normalizeEntry);
  showNewWorkoutBuilder();
  renderWorkoutPlan();
  const nameInput = $('#workout-name');
  if (nameInput) nameInput.focus();
}

function normalizeEntry(entry) {
  return {
    key: uid(),
    exerciseId: entry.exerciseId,
    sets: (entry.sets || []).map(normalizeSet),
  };
}

function normalizeSet(set) {
  if (typeof set === 'number') {
    return { weight: null, unit: 'lb', reps: Number(set) || 0 };
  }
  if (!set || typeof set !== 'object') {
    return { weight: null, unit: 'lb', reps: 0 };
  }
  const repsNum = Number(set.reps);
  const rawWeight = set.weight;
  const weightNum = rawWeight === '' || rawWeight == null ? null : Number(rawWeight);
  const unit = set.unit || 'lb';
  return {
    weight: Number.isFinite(weightNum) ? weightNum : null,
    unit,
    reps: Number.isFinite(repsNum) ? repsNum : 0,
  };
}

function handleStartFreshWorkout() {
  resetWorkoutDraft();
  showNewWorkoutBuilder();
  $('#workout-name')?.focus();
}

function handleStartRecentWorkout(workoutId) {
  if (!workoutId) return;
  const workout = recentWorkouts.find(w => String(w.id) === String(workoutId));
  if (!workout) return;
  loadWorkoutIntoDraft(workout);
}

document.getElementById('btn-back-to-chooser')?.addEventListener('click', () => {
  showNewWorkoutChooser({ resetDraft: true });
});

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

let setsState = null; // { exerciseId, total, idx, sets, entryKey?, initialSets: [] }
let lastUnit = localStorage.getItem('pi_unit') || 'lb';

// Weight steppers (for mobile where minus key may be hard to access)
const weightStep = () => {
  const el = document.getElementById('weight-input');
  const s = parseFloat(el?.getAttribute('step') || '0.5');
  return Number.isFinite(s) && s > 0 ? s : 0.5;
};
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'weight-inc') {
    const el = document.getElementById('weight-input');
    if (!el) return;
    const cur = parseFloat(el.value);
    const val = Number.isFinite(cur) ? cur : 0;
    el.value = String(val + weightStep());
  }
  if (e.target && e.target.id === 'weight-dec') {
    const el = document.getElementById('weight-input');
    if (!el) return;
    const cur = parseFloat(el.value);
    const val = Number.isFinite(cur) ? cur : 0;
    el.value = String(val - weightStep());
  }
});

function getExerciseName(id) {
  const match = currentExercises.find(ex => String(ex.id) === String(id));
  return match?.name || 'Unknown';
}

function openSetsEntry({ exerciseId, total, entryKey = null, initialSets = [] }) {
  const normalizedInitial = initialSets.map(s => (s == null ? null : normalizeSet(s)));
  const totalSets = Math.max(1, normalizedInitial.length || total);
  const paddedInitial = Array.from({ length: totalSets }, (_, idx) => normalizedInitial[idx] ?? null);
  setsState = {
    exerciseId,
    total: totalSets,
    idx: 0,
    sets: [],
    entryKey,
    initialSets: paddedInitial,
  };
  const setsInput = $('#sets-count');
  if (setsInput) setsInput.value = totalSets;
  const setsEntry = $('#sets-entry');
  if (setsEntry) setsEntry.classList.remove('hidden');
  $('#sets-entry-title').textContent = entryKey ? `Edit Sets: ${getExerciseName(exerciseId)}` : `Enter Reps: ${getExerciseName(exerciseId)}`;
  updateSetLabel();
  populateSetEntryFields();
  renderSetsProgress();
  updateSetActionButton();
  $('#reps-input')?.focus();
}

$('#btn-begin-sets').addEventListener('click', () => {
  const exerciseId = $('#select-exercise').value;
  const total = Math.max(1, parseInt($('#sets-count').value || '1', 10));
  if (!exerciseId || !total) return;
  openSetsEntry({ exerciseId, total });
});

function populateSetEntryFields() {
  if (!setsState) return;
  const { idx, sets, initialSets } = setsState;
  const source = sets[idx] ?? initialSets[idx] ?? { weight: null, unit: lastUnit, reps: '' };
  const weightEl = $('#weight-input');
  const unitEl = $('#weight-unit');
  const repsEl = $('#reps-input');
  if (weightEl) weightEl.value = source.weight != null ? String(source.weight) : '';
  if (unitEl) unitEl.value = source.unit || lastUnit;
  if (repsEl) repsEl.value = source.reps ? String(source.reps) : '';
}

function updateSetLabel() {
  if (!setsState) return;
  $('#set-label').textContent = `Set ${Math.min(setsState.idx + 1, setsState.total)} of ${setsState.total}`;
}

function updateSetActionButton() {
  const btn = $('#btn-next-set');
  if (!btn || !setsState) return;
  const isLast = setsState.idx >= setsState.total - 1;
  btn.textContent = isLast ? (setsState.entryKey ? 'Save Changes' : 'Finish Exercise') : 'Next';
}

function renderSetsProgress() {
  const cont = $('#sets-progress');
  if (!cont || !setsState) return;
  cont.innerHTML = '';
  for (let i = 0; i < setsState.total; i++) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    const current = setsState.sets[i] ?? setsState.initialSets[i];
    chip.textContent = current ? formatSetForDisplay(current, i) : `Set ${i + 1}`;
    cont.appendChild(chip);
  }
}

function formatSetForDisplay(set, idx) {
  if (!set) return `Set ${idx + 1}`;
  const normalized = normalizeSet(set);
  const repsText = `${normalized.reps} reps`;
  if (normalized.weight == null) return `Set ${idx + 1}: ${repsText}`;
  return `Set ${idx + 1}: ${normalized.weight} ${normalized.unit || 'lb'}×${normalized.reps}`;
}

function commitSetsState() {
  if (!setsState) return;
  const finalSets = setsState.sets.slice(0, setsState.total).map((s) => {
    const normalized = normalizeSet(s);
    return { weight: normalized.weight, unit: normalized.unit, reps: normalized.reps };
  });
  if (setsState.entryKey) {
    const entry = workoutDraft.entries.find(en => en.key === setsState.entryKey);
    if (entry) entry.sets = finalSets;
  } else {
    workoutDraft.entries.push({ key: uid(), exerciseId: setsState.exerciseId, sets: finalSets });
  }
  setsState = null;
  $('#sets-entry')?.classList.add('hidden');
  renderWorkoutPlan();
}

$('#btn-next-set').addEventListener('click', () => {
  if (!setsState) return;
  const repsVal = $('#reps-input')?.value ?? '';
  const reps = parseInt(repsVal, 10);
  if (!Number.isFinite(reps) || reps <= 0) {
    alert('Please enter a valid positive number of reps.');
    return;
  }
  const weightRaw = $('#weight-input')?.value ?? '';
  let weight = null;
  if (weightRaw !== '') {
    const parsed = parseFloat(weightRaw);
    if (!Number.isFinite(parsed)) {
      alert('Please enter a valid weight.');
      return;
    }
    weight = parsed;
  }
  const unit = ($('#weight-unit')?.value || 'lb');
  setsState.sets[setsState.idx] = { weight, unit, reps };
  lastUnit = unit;
  localStorage.setItem('pi_unit', lastUnit);
  setsState.idx++;
  renderSetsProgress();
  if (setsState.idx >= setsState.total) {
    commitSetsState();
    return;
  }
  updateSetLabel();
  updateSetActionButton();
  populateSetEntryFields();
  $('#reps-input')?.focus();
});

$('#btn-cancel-sets').addEventListener('click', () => {
  setsState = null;
  $('#sets-entry')?.classList.add('hidden');
});

function beginEditEntry(entryKey) {
  const entry = workoutDraft.entries.find(en => String(en.key) === String(entryKey));
  if (!entry) return;
  const initialSets = (entry.sets || []).map(s => ({ ...normalizeSet(s) }));
  openSetsEntry({ exerciseId: entry.exerciseId, total: initialSets.length || 1, entryKey, initialSets });
  const select = $('#select-exercise');
  if (select) select.value = entry.exerciseId;
}

function renderWorkoutPlan() {
  const cont = $('#workout-plan');
  if (!cont) return;
  if (!workoutDraft.entries.length) {
    cont.innerHTML = '<div class="meta">No exercises added yet.</div>';
    return;
  }
  const exById = indexById(currentExercises || []);
  cont.innerHTML = '';
  workoutDraft.entries.forEach((entry) => {
    if (!entry.key) entry.key = uid();
    const card = document.createElement('div');
    card.className = 'item-row plan-entry';
    card.dataset.entryKey = entry.key;
    const exName = exById[entry.exerciseId]?.name || 'Unknown';
    const setsSummary = (entry.sets || []).map((s, idx) => formatSetForDisplay(s, idx)).join(', ');
    card.innerHTML = `
      <div class="entry-main">
        <button class="drag-handle" type="button" aria-label="Reorder"><span>⋮⋮</span></button>
        <div class="entry-body">
          <div><strong>${exName}</strong></div>
          <div class="meta">${setsSummary || 'No sets yet.'}</div>
        </div>
      </div>
      <div class="entry-actions">
        <button class="btn sm ghost" data-edit-entry="${entry.key}">Edit</button>
        <button class="btn sm danger" data-remove-entry="${entry.key}">Remove</button>
      </div>
    `;
    cont.appendChild(card);
  });
}

let dragState = null;

const workoutPlanEl = document.getElementById('workout-plan');
if (workoutPlanEl) {
  workoutPlanEl.addEventListener('pointerdown', handlePlanPointerDown);
  workoutPlanEl.addEventListener('click', handlePlanClick);
}

function handlePlanClick(e) {
  const editKey = e.target?.getAttribute?.('data-edit-entry');
  if (editKey) {
    beginEditEntry(editKey);
    return;
  }
  const removeKey = e.target?.getAttribute?.('data-remove-entry');
  if (removeKey) {
    workoutDraft.entries = workoutDraft.entries.filter(en => String(en.key) !== String(removeKey));
    renderWorkoutPlan();
  }
}

function handlePlanPointerDown(e) {
  const handle = e.target.closest('.drag-handle');
  if (!handle) return;
  if (e.button && e.button !== 0) return;
  if (workoutDraft.entries.length <= 1) return;
  const item = handle.closest('.plan-entry');
  const container = document.getElementById('workout-plan');
  if (!item || !container) return;
  e.preventDefault();
  const rect = item.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const placeholder = document.createElement('div');
  placeholder.className = 'plan-placeholder';
  placeholder.style.height = `${rect.height}px`;
  container.insertBefore(placeholder, item);
  container.appendChild(item);
  item.classList.add('dragging');
  item.style.width = `${rect.width}px`;
  item.style.position = 'absolute';
  item.style.left = '0px';
  item.style.top = `${rect.top - containerRect.top}px`;
  item.style.zIndex = '50';
  item.style.pointerEvents = 'none';
  container.classList.add('reordering');
  document.body.classList.add('dragging-reorder');
  dragState = {
    pointerId: e.pointerId,
    item,
    container,
    placeholder,
    offsetY: e.clientY - rect.top,
  };
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragEnd);
}

function onDragMove(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  e.preventDefault();
  const { item, container, placeholder, offsetY } = dragState;
  const containerRect = container.getBoundingClientRect();
  const rawTop = e.clientY - containerRect.top - offsetY;
  const maxTop = Math.max(0, container.scrollHeight - placeholder.offsetHeight);
  const clampedTop = Math.max(0, Math.min(rawTop, maxTop));
  item.style.top = `${clampedTop}px`;

  const entries = Array.from(container.querySelectorAll('.plan-entry')).filter(el => el !== item);
  for (const entry of entries) {
    const rect = entry.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      if (entry !== placeholder) container.insertBefore(placeholder, entry);
      return;
    }
  }
  container.insertBefore(placeholder, item);
}

function onDragEnd(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragEnd);
  const { item, container, placeholder } = dragState;
  placeholder.replaceWith(item);
  item.classList.remove('dragging');
  item.style.position = '';
  item.style.left = '';
  item.style.top = '';
  item.style.width = '';
  item.style.zIndex = '';
  item.style.pointerEvents = '';
  container.classList.remove('reordering');
  document.body.classList.remove('dragging-reorder');
  const entryMap = Object.fromEntries(workoutDraft.entries.map(en => [String(en.key), en]));
  const orderedKeys = Array.from(container.querySelectorAll('.plan-entry')).map(el => el.dataset.entryKey);
  workoutDraft.entries = orderedKeys.map(key => entryMap[key]).filter(Boolean);
  dragState = null;
  renderWorkoutPlan();
}

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
    const entriesForSave = workoutDraft.entries.map(({ key, ...rest }) => ({
      ...rest,
      sets: (rest.sets || []).map(s => ({
        weight: s.weight == null ? null : s.weight,
        unit: s.unit || 'lb',
        reps: s.reps,
      })),
    }));
    await Data.addWorkout({ id: uid(), name: workoutDraft.name.trim(), date: Date.now(), entries: entriesForSave });
    resetWorkoutDraft();
    newWorkoutMode = 'chooser';
    showView('past-workouts');
  });
});

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
      <div class="row gap">
        <button class="btn sm ghost" data-open-workout="${w.id}">Open</button>
        <button class="btn sm danger" data-del-workout="${w.id}">Delete</button>
      </div>
    `;
    list.appendChild(row);
  });

  list.addEventListener('click', handleOpenWorkout);
  list.addEventListener('click', handleDeleteWorkout);

  function handleOpenWorkout(e) {
    const id = e.target.getAttribute('data-open-workout');
    if (!id) return;
    const w = workouts.find(x => String(x.id) === String(id));
    if (!w) return;
    renderWorkoutDetail(w, exIdx);
  }

  function handleDeleteWorkout(e) {
    const id = e.target.getAttribute('data-del-workout');
    if (!id) return;
    confirmModal('Delete this workout? This cannot be undone.', async () => {
      try {
        await Data.deleteWorkout(id);
        renderWorkoutsList();
      } catch (err) {
        alertModal(`Cannot delete workout. ${err.message || err}`);
      }
    });
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
        const sets = (en.sets || []).map((s,i) => formatSetForDisplay(s, i)).join(', ');
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
  // Return { labels: [dates], series: [ { name, color, points:[{x,offset,y,reps,date,setNumber}], visible:true } ], domain }
  let workouts = [];
  try { workouts = (await Data.getWorkouts()).slice().sort((a,b)=>a.date-b.date); }
  catch (e) { alertModal(`Cannot load progress. ${e.message || e}`); return { labels: [], series: [], domain: { min: 0, max: 1 } }; }

  const timeline = [];
  let maxSets = 0;
  workouts.forEach((w) => {
    const entry = w.entries.find(e => e.exerciseId === exerciseId);
    if (!entry) return;
    const sets = Array.isArray(entry.sets) ? entry.sets : [];
    maxSets = Math.max(maxSets, sets.length);
    timeline.push({ workout: w, sets });
  });

  const labels = timeline.map(item => fmtDate(item.workout.date));
  if (!timeline.length) return { labels, series: [], domain: { min: 0, max: 1 } };

  const offsetStep = maxSets > 1 ? 0.12 : 0;
  const halfSpread = offsetStep * ((maxSets - 1) / 2);
  const pointsBySetIndex = new Map();

  timeline.forEach((item, workoutIdx) => {
    (item.sets || []).forEach((s, sIdx) => {
      const reps = typeof s === 'number' ? Number(s) : Number(s?.reps);
      const rawWeight = typeof s === 'number' ? null : (s?.weight ?? null);
      const unit = (typeof s === 'number' || !s || s.unit == null) ? 'lb' : s.unit;
      if (rawWeight == null || rawWeight === '') return;
      const numericWeight = Number(rawWeight);
      if (!Number.isFinite(numericWeight)) return;
      const weightLb = unit === 'kg' ? numericWeight * 2.20462 : numericWeight;
      const offset = offsetStep ? (sIdx - (maxSets - 1) / 2) * offsetStep : 0;
      if (!pointsBySetIndex.has(sIdx)) pointsBySetIndex.set(sIdx, []);
      pointsBySetIndex.get(sIdx).push({
        x: workoutIdx,
        offset,
        y: weightLb,
        reps: Number.isFinite(reps) ? reps : null,
        date: item.workout.date,
        workoutName: item.workout.name,
        setNumber: sIdx + 1,
      });
    });
  });

  const series = Array.from(pointsBySetIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([sIdx, pts], i) => ({
      name: `Set ${sIdx + 1}`,
      color: seriesColors[i % seriesColors.length],
      points: pts,
      visible: true,
    }));

  const domain = {
    min: -halfSpread,
    max: (labels.length - 1) + halfSpread,
  };

  return { labels, series, domain };
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
