const DB_NAME = "pplEliteDB";
const DB_VERSION = 1;
const UI_KEY = "pplElite.ui";
const SPLITS = ["Push", "Pull", "Legs"];
const STORE_NAMES = [
  "exercises",
  "templates",
  "templateExercises",
  "workouts",
  "workoutExercises",
  "setLogs",
  "cardioLogs",
  "activeSession",
  "meta"
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = (prefix) => `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
const nowIso = () => new Date().toISOString();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const num = (value) => Number.isFinite(parseFloat(value)) ? parseFloat(value) : 0;
const int = (value) => Number.isFinite(parseInt(value, 10)) ? parseInt(value, 10) : 0;
const dateKey = (value) => new Date(value).toISOString().slice(0, 10);
const localDateInput = (value) => {
  const d = value ? new Date(value) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const localTimeInput = (value) => {
  const d = value ? new Date(value) : new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const fromDateTime = (date, time) => new Date(`${date}T${time || "00:00"}`).toISOString();
const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
const fmtDate = (value) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
const fmtDateTime = (value) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
const fmtTimer = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};
const escapeHtml = (str = "") => String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let db;
let state = {
  tab: "home",
  selectedSplit: "Push",
  templateRows: [],
  allWorkouts: [],
  active: null,
  activeStartedAt: null,
  search: "",
  analytics: null
};

const dbApi = {
  open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        STORE_NAMES.forEach((name) => {
          if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: "id" });
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  tx(names, mode = "readonly") {
    return db.transaction(names, mode);
  },
  getAll(store) {
    return new Promise((resolve, reject) => {
      const req = dbApi.tx([store]).objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
  get(store, id) {
    return new Promise((resolve, reject) => {
      const req = dbApi.tx([store]).objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  put(store, value) {
    return new Promise((resolve, reject) => {
      const req = dbApi.tx([store], "readwrite").objectStore(store).put(value);
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  },
  delete(store, id) {
    return new Promise((resolve, reject) => {
      const req = dbApi.tx([store], "readwrite").objectStore(store).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  clear(store) {
    return new Promise((resolve, reject) => {
      const req = dbApi.tx([store], "readwrite").objectStore(store).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  bulkPut(store, rows) {
    return new Promise((resolve, reject) => {
      const tx = dbApi.tx([store], "readwrite");
      rows.forEach((row) => tx.objectStore(store).put(row));
      tx.oncomplete = () => resolve(rows);
      tx.onerror = () => reject(tx.error);
    });
  },
  bulkDelete(store, ids) {
    return new Promise((resolve, reject) => {
      const tx = dbApi.tx([store], "readwrite");
      ids.forEach((id) => tx.objectStore(store).delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
};

async function seedIfNeeded() {
  const seeded = await dbApi.get("meta", "seeded");
  if (seeded) return;

  const createdAt = nowIso();
  const exerciseData = [
    ["bench", "Barbell Bench Press", "Chest", ["Chest"], ["Triceps", "Front Delts"], "5-8", 4, "Barbell"],
    ["ohp", "Overhead Press", "Shoulders", ["Delts"], ["Triceps"], "5-8", 4, "Barbell"],
    ["incline_db", "Incline Dumbbell Press", "Chest", ["Upper Chest"], ["Delts"], "8-12", 3, "Dumbbells"],
    ["pushdown", "Tricep Pushdown", "Arms", ["Triceps"], [], "10-15", 3, "Cable"],
    ["deadlift", "Deadlift", "Back", ["Posterior Chain"], ["Lats"], "3-5", 3, "Barbell"],
    ["row", "Barbell Row", "Back", ["Mid Back"], ["Biceps"], "6-10", 4, "Barbell"],
    ["pulldown", "Lat Pulldown", "Back", ["Lats"], ["Biceps"], "8-12", 4, "Cable"],
    ["cable_row", "Seated Cable Row", "Back", ["Mid Back"], ["Rear Delts"], "8-12", 3, "Cable"],
    ["curl", "Dumbbell Curl", "Arms", ["Biceps"], [], "10-15", 3, "Dumbbells"],
    ["squat", "Back Squat", "Legs", ["Quads", "Glutes"], ["Core"], "4-8", 4, "Barbell"],
    ["leg_press", "Leg Press", "Legs", ["Quads"], ["Glutes"], "10-15", 4, "Machine"],
    ["rdl", "Romanian Deadlift", "Hamstrings", ["Hamstrings"], ["Glutes", "Back"], "6-10", 4, "Barbell"],
    ["leg_curl", "Leg Curl", "Hamstrings", ["Hamstrings"], [], "10-15", 3, "Machine"],
    ["calf", "Calf Raise", "Calves", ["Calves"], [], "12-20", 4, "Machine"]
  ].map(([id, name, category, primaryMuscles, secondaryMuscles, defaultRepRange, defaultSetCount, equipment]) => ({
    id, name, category, primaryMuscles, secondaryMuscles, defaultRepRange, defaultSetCount, equipment, createdAt
  }));

  const templates = SPLITS.map((split) => ({
    id: split.toLowerCase(),
    name: `${split} Day`,
    splitType: split,
    orderedExerciseIds: [],
    createdAt,
    updatedAt: createdAt
  }));

  const templateMap = {
    Push: ["bench", "ohp", "incline_db", "pushdown"],
    Pull: ["deadlift", "row", "pulldown", "cable_row", "curl"],
    Legs: ["squat", "leg_press", "rdl", "leg_curl", "calf"]
  };
  const templateExercises = [];
  templates.forEach((template) => {
    const ids = templateMap[template.splitType];
    template.orderedExerciseIds = ids;
    ids.forEach((exerciseId, orderIndex) => {
      const exercise = exerciseData.find((item) => item.id === exerciseId);
      templateExercises.push({
        id: `${template.id}_${exerciseId}`,
        templateId: template.id,
        exerciseId,
        orderIndex,
        defaultSets: exercise.defaultSetCount,
        defaultRepRange: exercise.defaultRepRange,
        enabledByDefault: true
      });
    });
  });

  await dbApi.bulkPut("exercises", exerciseData);
  await dbApi.bulkPut("templates", templates);
  await dbApi.bulkPut("templateExercises", templateExercises);
  await dbApi.put("meta", { id: "seeded", value: true, createdAt });
}

async function removeLegacyDemoHistory() {
  const removed = await dbApi.get("meta", "demoHistoryRemoved");
  if (removed) return;
  const demoNotes = new Set(["Strong pace. Kept rests tight.", "Heavy top set, clean backoffs."]);
  const [workouts, workoutExercises, setLogs, cardioLogs] = await Promise.all([
    dbApi.getAll("workouts"),
    dbApi.getAll("workoutExercises"),
    dbApi.getAll("setLogs"),
    dbApi.getAll("cardioLogs")
  ]);
  const demoWorkoutIds = workouts
    .filter((workout) => demoNotes.has(workout.notes) && SPLITS.includes(workout.splitType) && workout.title === `${workout.splitType} Day`)
    .map((workout) => workout.id);
  const demoExerciseIds = workoutExercises
    .filter((exercise) => demoWorkoutIds.includes(exercise.workoutSessionId))
    .map((exercise) => exercise.id);
  await dbApi.bulkDelete("setLogs", setLogs.filter((set) => demoExerciseIds.includes(set.workoutExerciseLogId)).map((set) => set.id));
  await dbApi.bulkDelete("workoutExercises", demoExerciseIds);
  await dbApi.bulkDelete("cardioLogs", cardioLogs.filter((cardio) => demoWorkoutIds.includes(cardio.workoutSessionId)).map((cardio) => cardio.id));
  await dbApi.bulkDelete("workouts", demoWorkoutIds);
  await dbApi.put("meta", { id: "demoHistoryRemoved", value: true, removedCount: demoWorkoutIds.length, updatedAt: nowIso() });
}

async function hydrate() {
  const pref = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
  state.selectedSplit = pref.lastSelectedSplit || "Push";
  await loadTemplateRows();
  await loadActive();
  await refreshAnalytics();
}

async function loadTemplateRows() {
  const [templates, templateExercises, exercises] = await Promise.all([
    dbApi.getAll("templates"),
    dbApi.getAll("templateExercises"),
    dbApi.getAll("exercises")
  ]);
  const template = templates.find((row) => row.splitType === state.selectedSplit);
  const rows = templateExercises
    .filter((row) => row.templateId === template?.id)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((row) => ({ ...row, exercise: exercises.find((ex) => ex.id === row.exerciseId) }))
    .filter((row) => row.exercise);
  state.templateRows = rows;
}

async function loadActive() {
  const active = await dbApi.get("activeSession", "current");
  state.active = active?.session || null;
  state.activeStartedAt = state.active?.startedAt || null;
}

async function refreshAnalytics() {
  const data = await loadHistoryData();
  state.allWorkouts = data.workouts;
  state.analytics = buildAnalytics(data);
}

async function loadHistoryData() {
  const [workouts, workoutExercises, setLogs, cardioLogs] = await Promise.all([
    dbApi.getAll("workouts"),
    dbApi.getAll("workoutExercises"),
    dbApi.getAll("setLogs"),
    dbApi.getAll("cardioLogs")
  ]);
  const enriched = workouts
    .map((workout) => ({
      ...workout,
      exercises: workoutExercises
        .filter((ex) => ex.workoutSessionId === workout.id)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((ex) => ({
          ...ex,
          sets: setLogs.filter((set) => set.workoutExerciseLogId === ex.id).sort((a, b) => a.setNumber - b.setNumber)
        })),
      cardio: cardioLogs.filter((cardio) => cardio.workoutSessionId === workout.id)
    }))
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  return { workouts: enriched, workoutExercises, setLogs, cardioLogs };
}

function buildAnalytics({ workouts }) {
  const finished = workouts.filter((w) => w.status === "finished");
  const byDate = new Set(finished.map((w) => dateKey(w.startedAt)));
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    const key = localDateInput(cursor);
    if (!byDate.has(key)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const bestByExercise = {};
  const trendByExercise = {};
  finished.slice().reverse().forEach((workout) => {
    workout.exercises.forEach((exercise) => {
      const completed = exercise.sets.filter((set) => set.completed);
      const bestSet = completed.reduce((best, set) => {
        const e1rm = set.weight * (1 + set.reps / 30);
        return e1rm > best.e1rm ? { ...set, e1rm, date: workout.startedAt } : best;
      }, { e1rm: 0 });
      if (bestSet.e1rm) {
        const name = exercise.exerciseNameSnapshot;
        trendByExercise[name] = trendByExercise[name] || [];
        trendByExercise[name].push(Math.round(bestSet.e1rm));
        if (!bestByExercise[name] || bestSet.e1rm > bestByExercise[name].e1rm) {
          bestByExercise[name] = { ...bestSet, name };
        }
      }
    });
  });

  const keyLift = bestByExercise["Back Squat"] ? "Back Squat" : Object.keys(bestByExercise)[0];
  const keyTrend = trendByExercise[keyLift] || [];
  const weeklyStart = new Date();
  weeklyStart.setDate(weeklyStart.getDate() - 6);
  weeklyStart.setHours(0, 0, 0, 0);
  const weeklyCardio = finished
    .filter((w) => new Date(w.startedAt) >= weeklyStart)
    .flatMap((w) => w.cardio)
    .reduce((sum, item) => sum + num(item.durationMinutes), 0);

  const monthly = {};
  finished.forEach((w) => {
    const key = new Date(w.startedAt).toLocaleString(undefined, { month: "short" });
    monthly[key] = (monthly[key] || 0) + 1;
  });

  return {
    streak,
    workoutDates: byDate,
    keyLift,
    keyBest: bestByExercise[keyLift] || null,
    keyTrend,
    weeklyCardio,
    monthly
  };
}

function totalVolume(workout) {
  return workout.exercises.reduce((sum, ex) => sum + ex.sets.reduce((inner, set) => inner + (set.completed ? num(set.weight) * int(set.reps) : 0), 0), 0);
}

function renumberSets(sets) {
  sets.forEach((set, index) => {
    set.setNumber = index + 1;
  });
}

function render() {
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.tab === state.tab));
  if (state.tab === "home") renderHome();
  if (state.tab === "active") renderActive();
  if (state.tab === "history") renderHistory();
}

function renderHome() {
  $("#view").innerHTML = `
    <div class="stack">
      ${streakCard()}
      <section class="stack">
        <div class="section-head">
          <div>
            <h2>Split Loadout</h2>
            <p>Choose, trim, reorder, then launch.</p>
          </div>
        </div>
        ${segmented()}
        <div id="template-list" class="exercise-list">
          ${state.templateRows.map(templateExerciseCard).join("")}
        </div>
        <div class="button-row">
          <button class="ghost-btn" data-action="add-exercise" type="button">Add Exercise</button>
          <button class="ghost-btn" data-action="enable-all" type="button">Enable All</button>
        </div>
        <button class="primary-btn" data-action="start-workout" type="button">START WORKOUT</button>
      </section>
    </div>
  `;
  bindHome();
}

function streakCard() {
  const analytics = state.analytics || {};
  const today = new Date();
  const cells = [];
  for (let i = 20; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = localDateInput(d);
    cells.push(`<span class="day-cell ${analytics.workoutDates?.has(key) ? "done" : ""} ${key === localDateInput(today) ? "today" : ""}">${d.getDate()}</span>`);
  }
  return `
    <section class="card streak-card">
      <div class="streak-main">
        <div>
          <span class="eyebrow">${today.toLocaleString(undefined, { month: "long" })} Streak</span>
          <p class="muted">Current run across saved and imported sessions.</p>
          <div class="streak-number">${analytics.streak || 0}<span>DAYS</span></div>
        </div>
        <div class="flame">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.6 2.2c.5 2.9-.7 4.7-2.1 6.3-1.2 1.4-2.6 2.9-2.6 5.1 0 2.1 1.5 3.7 3.6 3.7 2.5 0 4.4-2 4.4-4.7 1.5 1.2 2.5 3 2.5 5 0 3.1-2.6 5.4-6.3 5.4-4.1 0-7-2.8-7-6.8 0-3.1 1.8-5.2 3.5-7.1 1.6-1.9 3.2-3.7 3-6.9h1Z"/></svg>
        </div>
      </div>
      <div class="calendar-grid">${cells.join("")}</div>
    </section>
  `;
}

function segmented() {
  return `<div class="segmented">${SPLITS.map((split) => `<button class="segment ${split === state.selectedSplit ? "active" : ""}" data-split="${split}" type="button">${split}</button>`).join("")}</div>`;
}

function templateExerciseCard(row) {
  return `
    <article class="exercise-card" draggable="true" data-id="${row.id}">
      <button class="toggle-dot ${row.enabledByDefault ? "active" : ""}" data-action="toggle-template" data-id="${row.id}" type="button" aria-label="Toggle exercise">✓</button>
      <div>
        <div class="exercise-title">${escapeHtml(row.exercise.name)}</div>
        <div class="exercise-meta">${escapeHtml(row.exercise.category)} • ${row.defaultSets} sets • ${escapeHtml(row.defaultRepRange)}</div>
      </div>
      <button class="drag-handle" type="button" aria-label="Reorder">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h8v2H8V6Zm0 5h8v2H8v-2Zm0 5h8v2H8v-2Z"/></svg>
      </button>
    </article>
  `;
}

function bindHome() {
  $$(".segment").forEach((button) => button.addEventListener("click", async () => {
    state.selectedSplit = button.dataset.split;
    localStorage.setItem(UI_KEY, JSON.stringify({ lastSelectedSplit: state.selectedSplit }));
    await loadTemplateRows();
    render();
  }));
  $$("[data-action='toggle-template']").forEach((button) => button.addEventListener("click", async () => {
    const row = state.templateRows.find((item) => item.id === button.dataset.id);
    row.enabledByDefault = !row.enabledByDefault;
    row.updatedAt = nowIso();
    await dbApi.put("templateExercises", stripExercise(row));
    render();
  }));
  $("[data-action='enable-all']")?.addEventListener("click", async () => {
    state.templateRows.forEach((row) => row.enabledByDefault = true);
    await dbApi.bulkPut("templateExercises", state.templateRows.map(stripExercise));
    render();
  });
  $("[data-action='add-exercise']")?.addEventListener("click", () => openExerciseModal());
  $("[data-action='start-workout']")?.addEventListener("click", startWorkout);
  bindTemplateDrag();
}

function stripExercise(row) {
  const { exercise, ...rest } = row;
  return rest;
}

function bindTemplateDrag() {
  let dragId = null;
  $$(".exercise-card").forEach((card) => {
    card.addEventListener("dragstart", () => {
      dragId = card.dataset.id;
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", async (event) => {
      event.preventDefault();
      const targetId = card.dataset.id;
      if (!dragId || dragId === targetId) return;
      const from = state.templateRows.findIndex((row) => row.id === dragId);
      const to = state.templateRows.findIndex((row) => row.id === targetId);
      const [moved] = state.templateRows.splice(from, 1);
      state.templateRows.splice(to, 0, moved);
      state.templateRows.forEach((row, index) => row.orderIndex = index);
      await dbApi.bulkPut("templateExercises", state.templateRows.map(stripExercise));
      render();
    });
  });
}

async function startWorkout() {
  if (state.active && !confirm("A workout is already active. Replace it with a new one?")) return;
  const selected = state.templateRows.filter((row) => row.enabledByDefault);
  if (!selected.length) return toast("Enable at least one exercise.");
  const startedAt = nowIso();
  const session = {
    id: uid("active"),
    title: `${state.selectedSplit} Day`,
    splitType: state.selectedSplit,
    startedAt,
    endedAt: null,
    durationSeconds: 0,
    status: "active",
    notes: "",
    source: "normal",
    exercises: selected.map((row, index) => ({
      id: uid("active_ex"),
      exerciseId: row.exerciseId,
      exerciseNameSnapshot: row.exercise.name,
      orderIndex: index,
      notes: "",
      sets: Array.from({ length: row.defaultSets }, (_, setIndex) => ({
        id: uid("active_set"),
        setNumber: setIndex + 1,
        weight: "",
        reps: "",
        completed: false,
        isWarmup: false,
        rir: ""
      }))
    })),
    cardio: {
      id: uid("active_cardio"),
      type: "treadmill",
      durationMinutes: "",
      distance: "",
      distanceUnit: "mi",
      calories: "",
      notes: ""
    }
  };
  state.active = session;
  state.activeStartedAt = startedAt;
  await persistActive();
  state.tab = "active";
  render();
  toast("Workout started.");
}

async function persistActive() {
  if (!state.active) {
    await dbApi.clear("activeSession");
    return;
  }
  await dbApi.put("activeSession", { id: "current", session: state.active, updatedAt: nowIso() });
}

function renderActive() {
  if (!state.active) {
    $("#view").innerHTML = `
      <div class="stack">
        <section class="empty-state">
          <strong>No active workout</strong>
          <p class="muted">Start Push, Pull, or Legs from Home and the session will survive refresh.</p>
        </section>
        <button class="primary-btn" data-action="go-home" type="button">CHOOSE SPLIT</button>
      </div>
    `;
    $("[data-action='go-home']").addEventListener("click", () => { state.tab = "home"; render(); });
    return;
  }
  $("#view").innerHTML = `
    <div class="stack">
      <section class="card active-hero">
        <div>
          <span class="eyebrow">${escapeHtml(state.active.splitType)} Session</span>
          <h1 class="screen-title">${escapeHtml(state.active.title)}</h1>
          <p class="muted">${focusCopy(state.active.splitType)}</p>
        </div>
        <div id="timer" class="timer-pill">${fmtTimer(activeSeconds())}</div>
      </section>
      <div class="stack">
        ${state.active.exercises.map((exercise, index) => activeExerciseCard(exercise, index)).join("")}
      </div>
      ${cardioCard(state.active.cardio)}
      <div class="field">
        <label>Workout Notes</label>
        <textarea data-active-field="notes" placeholder="Notes">${escapeHtml(state.active.notes || "")}</textarea>
      </div>
      <button class="primary-btn" data-action="finish-workout" type="button">FINISH WORKOUT</button>
      <button class="danger-btn" data-action="discard-workout" type="button">DISCARD WORKOUT</button>
    </div>
  `;
  bindActive();
}

function activeSeconds() {
  return Math.max(0, Math.floor((Date.now() - new Date(state.activeStartedAt).getTime()) / 1000));
}

function focusCopy(split) {
  return split === "Push" ? "Chest • Delts • Triceps" : split === "Pull" ? "Back • Biceps • Posterior chain" : "Quads • Hamstrings • Calves";
}

function activeExerciseCard(exercise, index) {
  return `
    <section class="card log-card" data-ex-index="${index}">
      <div class="log-head">
        <div>
          <div class="exercise-title">${escapeHtml(exercise.exerciseNameSnapshot)}</div>
          <div class="exercise-meta">Tap weight, reps, then lock the set.</div>
        </div>
        <button class="small-btn" data-action="add-set" data-ex-index="${index}" type="button">+ Set</button>
      </div>
      <div class="set-grid">
        <div class="set-row header"><span>Set</span><span>Weight</span><span>Reps</span><span>Done</span><span></span></div>
        ${exercise.sets.map((set, setIndex) => `
          <div class="set-row">
            <div class="set-number">${set.setNumber}</div>
            <input inputmode="decimal" type="number" min="0" step="0.5" value="${escapeHtml(set.weight)}" data-set-field="weight" data-ex-index="${index}" data-set-index="${setIndex}" aria-label="Weight">
            <input inputmode="numeric" type="number" min="0" step="1" value="${escapeHtml(set.reps)}" data-set-field="reps" data-ex-index="${index}" data-set-index="${setIndex}" aria-label="Reps">
            <button class="complete-btn ${set.completed ? "done" : ""}" data-action="toggle-set" data-ex-index="${index}" data-set-index="${setIndex}" type="button">✓</button>
            <button class="remove-set-btn" data-action="remove-set" data-ex-index="${index}" data-set-index="${setIndex}" type="button" aria-label="Delete set">−</button>
          </div>
        `).join("")}
      </div>
      <div class="field" style="margin-top:10px">
        <label>Exercise Notes</label>
        <input type="text" value="${escapeHtml(exercise.notes || "")}" data-ex-note="${index}" placeholder="Optional note">
      </div>
    </section>
  `;
}

function cardioCard(cardio = {}) {
  return `
    <section class="card log-card">
      <div class="log-head">
        <div>
          <div class="exercise-title">Cardio Finisher</div>
          <div class="exercise-meta">Optional conditioning closeout.</div>
        </div>
        <span class="metric-badge">BLUE ZONE</span>
      </div>
      <div class="cardio-grid">
        <div class="field">
          <label>Type</label>
          <select data-cardio-field="type">
            ${["treadmill", "stairmaster", "assault bike", "rower", "custom"].map((type) => `<option ${cardio.type === type ? "selected" : ""} value="${type}">${type}</option>`).join("")}
          </select>
        </div>
        <div class="two-col">
          <div class="field"><label>Minutes</label><input inputmode="decimal" type="number" min="0" step="0.5" value="${escapeHtml(cardio.durationMinutes || "")}" data-cardio-field="durationMinutes"></div>
          <div class="field"><label>Distance</label><input inputmode="decimal" type="number" min="0" step="0.01" value="${escapeHtml(cardio.distance || "")}" data-cardio-field="distance"></div>
        </div>
        <div class="two-col">
          <div class="field"><label>Unit</label><select data-cardio-field="distanceUnit"><option ${cardio.distanceUnit === "mi" ? "selected" : ""}>mi</option><option ${cardio.distanceUnit === "km" ? "selected" : ""}>km</option></select></div>
          <div class="field"><label>Calories</label><input inputmode="numeric" type="number" min="0" step="1" value="${escapeHtml(cardio.calories || "")}" data-cardio-field="calories"></div>
        </div>
        <div class="field"><label>Notes</label><input type="text" value="${escapeHtml(cardio.notes || "")}" data-cardio-field="notes" placeholder="Optional cardio note"></div>
      </div>
    </section>
  `;
}

function bindActive() {
  clearInterval(window.pplTimer);
  window.pplTimer = setInterval(() => {
    const timer = $("#timer");
    if (timer && state.active) timer.textContent = fmtTimer(activeSeconds());
  }, 1000);

  $$("[data-set-field]").forEach((input) => input.addEventListener("input", async () => {
    const ex = state.active.exercises[int(input.dataset.exIndex)];
    const set = ex.sets[int(input.dataset.setIndex)];
    set[input.dataset.setField] = input.value;
    await persistActive();
  }));
  $$("[data-action='toggle-set']").forEach((button) => button.addEventListener("click", async () => {
    const set = state.active.exercises[int(button.dataset.exIndex)].sets[int(button.dataset.setIndex)];
    set.completed = !set.completed;
    await persistActive();
    render();
  }));
  $$("[data-action='add-set']").forEach((button) => button.addEventListener("click", async () => {
    const ex = state.active.exercises[int(button.dataset.exIndex)];
    ex.sets.push({ id: uid("active_set"), setNumber: ex.sets.length + 1, weight: "", reps: "", completed: false, isWarmup: false, rir: "" });
    await persistActive();
    render();
  }));
  $$("[data-action='remove-set']").forEach((button) => button.addEventListener("click", async () => {
    const ex = state.active.exercises[int(button.dataset.exIndex)];
    ex.sets.splice(int(button.dataset.setIndex), 1);
    renumberSets(ex.sets);
    await persistActive();
    render();
  }));
  $$("[data-ex-note]").forEach((input) => input.addEventListener("input", async () => {
    state.active.exercises[int(input.dataset.exNote)].notes = input.value;
    await persistActive();
  }));
  $$("[data-cardio-field]").forEach((input) => input.addEventListener("input", async () => {
    state.active.cardio[input.dataset.cardioField] = input.value;
    await persistActive();
  }));
  $("[data-active-field='notes']").addEventListener("input", async (event) => {
    state.active.notes = event.target.value;
    await persistActive();
  });
  $("[data-action='finish-workout']").addEventListener("click", finishWorkout);
  $("[data-action='discard-workout']").addEventListener("click", async () => {
    if (!confirm("Discard this active workout?")) return;
    state.active = null;
    await persistActive();
    render();
  });
}

async function finishWorkout() {
  const hasCompleted = state.active.exercises.some((ex) => ex.sets.some((set) => set.completed && num(set.weight) >= 0 && int(set.reps) > 0));
  if (!hasCompleted && !confirm("No completed lifting sets found. Save anyway?")) return;
  const endedAt = nowIso();
  const workout = {
    id: uid("w"),
    title: state.active.title,
    splitType: state.active.splitType,
    startedAt: state.active.startedAt,
    endedAt,
    durationSeconds: activeSeconds(),
    status: "finished",
    notes: state.active.notes || "",
    createdAt: state.active.startedAt,
    updatedAt: endedAt,
    source: state.active.source || "normal"
  };
  const workoutExercises = state.active.exercises.map((ex, index) => ({
    id: uid("wel"),
    workoutSessionId: workout.id,
    exerciseId: ex.exerciseId,
    exerciseNameSnapshot: ex.exerciseNameSnapshot,
    orderIndex: index,
    notes: ex.notes || "",
    _sets: ex.sets
  }));
  const sets = workoutExercises.flatMap((ex) => ex._sets.map((set, index) => ({
    id: uid("set"),
    workoutExerciseLogId: ex.id,
    setNumber: index + 1,
    weight: num(set.weight),
    reps: int(set.reps),
    completed: Boolean(set.completed),
    isWarmup: Boolean(set.isWarmup),
    rir: set.rir === "" ? null : int(set.rir)
  })));
  const cardio = state.active.cardio && (num(state.active.cardio.durationMinutes) || num(state.active.cardio.distance) || num(state.active.cardio.calories))
    ? [{ ...state.active.cardio, id: uid("cardio"), workoutSessionId: workout.id, durationMinutes: num(state.active.cardio.durationMinutes), distance: num(state.active.cardio.distance), calories: int(state.active.cardio.calories) }]
    : [];
  await dbApi.put("workouts", workout);
  await dbApi.bulkPut("workoutExercises", workoutExercises.map(({ _sets, ...ex }) => ex));
  await dbApi.bulkPut("setLogs", sets);
  if (cardio.length) await dbApi.bulkPut("cardioLogs", cardio);
  state.active = null;
  await persistActive();
  await refreshAnalytics();
  state.tab = "history";
  render();
  toast("Workout saved.");
}

function renderHistory() {
  const query = state.search.trim().toLowerCase();
  const workouts = state.allWorkouts.filter((workout) => {
    if (!query) return true;
    const haystack = [
      workout.title,
      workout.splitType,
      workout.notes,
      fmtDateTime(workout.startedAt),
      ...workout.exercises.map((ex) => `${ex.exerciseNameSnapshot} ${ex.notes || ""}`)
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  $("#view").innerHTML = `
    <div class="stack">
      <div class="history-actions">
        <div class="search-box">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20.4 18.9-4.3-4.3a7.2 7.2 0 1 0-1.5 1.5l4.3 4.3 1.5-1.5ZM5.2 10.5a5.3 5.3 0 1 1 10.6 0 5.3 5.3 0 0 1-10.6 0Z"/></svg>
          <input id="history-search" type="search" value="${escapeHtml(state.search)}" placeholder="Search history">
        </div>
        <button class="small-btn" data-action="import-workout" type="button">Import</button>
      </div>
      ${progressCards()}
      <section class="stack">
        <div class="section-head">
          <div>
            <h2>Recent Workouts</h2>
            <p>${workouts.length} logged sessions</p>
          </div>
        </div>
        <div class="recent-list">
          ${workouts.length ? workouts.map(recentWorkoutCard).join("") : `<div class="empty-state">No matching workouts.</div>`}
        </div>
      </section>
    </div>
  `;
  $("#history-search").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderHistory();
    $("#history-search").focus();
  });
  $("[data-action='import-workout']").addEventListener("click", () => openWorkoutEditor(createBlankWorkout("imported"), true));
  $$("[data-workout-id]").forEach((button) => button.addEventListener("click", () => openWorkoutById(button.dataset.workoutId)));
}

function progressCards() {
  const a = state.analytics || {};
  const trend = a.keyTrend?.slice(-8) || [];
  const max = Math.max(1, ...trend);
  const best = a.keyBest;
  const previous = trend.length > 1 ? trend[trend.length - 2] : 0;
  const gain = trend.length ? Math.round(trend[trend.length - 1] - previous) : 0;
  const cardioPct = clamp((a.weeklyCardio || 0) / 90 * 100, 0, 100);
  return `
    <section class="progress-grid">
      <article class="card progress-card">
        <div class="metric-line">
          <div>
            <span class="eyebrow">Strength Progress</span>
            <div class="exercise-title">${escapeHtml(a.keyLift || "No Lift Yet")} Progress</div>
          </div>
          <span class="gain">${gain >= 0 ? "+" : ""}${gain} lb</span>
        </div>
        <div class="big-metric">${best ? Math.round(best.e1rm) : 0}<span style="font-size:14px;color:var(--muted)"> est 1RM</span></div>
        <div class="spark">${trend.length ? trend.map((value) => `<span style="height:${clamp(value / max * 100, 14, 100)}%"></span>`).join("") : "<span></span><span></span><span></span>"}</div>
      </article>
      <article class="card progress-card">
        <div class="metric-line">
          <div>
            <span class="eyebrow">Cardio Stamina</span>
            <div class="exercise-title">Weekly Conditioning</div>
          </div>
          <span class="metric-badge">${Math.round(a.weeklyCardio || 0)} min</span>
        </div>
        <p class="muted">Zone 2, finishers, and imported cardio totals.</p>
        <div class="progress-track"><div class="progress-fill" style="width:${cardioPct}%"></div></div>
      </article>
    </section>
  `;
}

function recentWorkoutCard(workout) {
  const volume = Math.round(totalVolume(workout)).toLocaleString();
  const cardio = workout.cardio.reduce((sum, item) => sum + num(item.durationMinutes), 0);
  return `
    <button class="recent-card" data-workout-id="${workout.id}" type="button">
      <div class="recent-icon">${workout.splitType.slice(0, 1)}</div>
      <div>
        <div class="workout-title">${escapeHtml(workout.title)}</div>
        <div class="exercise-meta">${fmtDateTime(workout.startedAt)} • ${workout.exercises.length} lifts ${workout.source === "imported" ? "• imported" : ""}</div>
      </div>
      <div class="right-metric">${volume} lb<br><span class="subtle">${Math.round(workout.durationSeconds / 60)}m${cardio ? ` +${cardio}m` : ""}</span></div>
    </button>
  `;
}

async function openWorkoutById(id) {
  const workout = state.allWorkouts.find((item) => item.id === id);
  if (workout) openWorkoutEditor(structuredClone(workout), false);
}

function createBlankWorkout(source = "imported") {
  const startedAt = new Date();
  startedAt.setHours(18, 0, 0, 0);
  const endedAt = new Date(startedAt.getTime() + 60 * 60000);
  return {
    id: uid("w"),
    title: source === "imported" ? "Imported Workout" : "Workout",
    splitType: state.selectedSplit || "Push",
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: 3600,
    status: "finished",
    notes: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source,
    exercises: [blankWorkoutExercise(0)],
    cardio: []
  };
}

function blankWorkoutExercise(orderIndex = 0) {
  return {
    id: uid("wel"),
    workoutSessionId: null,
    exerciseId: "custom",
    exerciseNameSnapshot: "Exercise",
    orderIndex,
    notes: "",
    sets: [
      { id: uid("set"), workoutExerciseLogId: null, setNumber: 1, weight: 0, reps: 10, completed: true, isWarmup: false, rir: null },
      { id: uid("set"), workoutExerciseLogId: null, setNumber: 2, weight: 0, reps: 10, completed: true, isWarmup: false, rir: null }
    ]
  };
}

function openWorkoutEditor(workout, isImport) {
  const root = $("#modal-root");
  const draft = workout;
  const renderEditor = () => {
    const startDate = localDateInput(draft.startedAt);
    const startTime = localTimeInput(draft.startedAt);
    const endDate = draft.endedAt ? localDateInput(draft.endedAt) : startDate;
    const endTime = draft.endedAt ? localTimeInput(draft.endedAt) : "";
    root.innerHTML = `
      <div class="modal-backdrop">
        <section class="modal">
          <div class="modal-head">
            <div>
              <span class="eyebrow">${isImport ? "Import Past Workout" : "Workout Detail"}</span>
              <h2>${isImport ? "Manual Entry" : "Edit Session"}</h2>
            </div>
            <button class="close-btn" data-close-modal type="button">×</button>
          </div>
          <div class="stack">
            <div class="form-grid">
              <div class="field"><label>Title</label><input data-edit-field="title" value="${escapeHtml(draft.title)}"></div>
              <div class="two-col">
                <div class="field"><label>Type</label><select data-edit-field="splitType">${SPLITS.map((s) => `<option ${draft.splitType === s ? "selected" : ""}>${s}</option>`).join("")}<option ${!SPLITS.includes(draft.splitType) ? "selected" : ""}>Custom</option></select></div>
                <div class="field"><label>Duration Min</label><input data-edit-field="durationMinutes" inputmode="numeric" type="number" min="0" value="${Math.round((draft.durationSeconds || 0) / 60)}"></div>
              </div>
              <div class="two-col">
                <div class="field"><label>Start Date</label><input data-edit-field="startDate" type="date" value="${startDate}"></div>
                <div class="field"><label>Start Time</label><input data-edit-field="startTime" type="time" value="${startTime}"></div>
              </div>
              <div class="two-col">
                <div class="field"><label>End Date</label><input data-edit-field="endDate" type="date" value="${endDate}"></div>
                <div class="field"><label>End Time</label><input data-edit-field="endTime" type="time" value="${endTime}"></div>
              </div>
              <div class="field"><label>Notes</label><textarea data-edit-field="notes">${escapeHtml(draft.notes || "")}</textarea></div>
            </div>
            <div class="section-head">
              <div>
                <h2>Exercises</h2>
                <p>Edit sets, order, notes, and completion.</p>
              </div>
              <button class="small-btn" data-editor-action="add-exercise" type="button">+ Lift</button>
            </div>
            <div class="stack">
              ${draft.exercises.map((exercise, exIndex) => editorExercise(exercise, exIndex)).join("")}
            </div>
            <div class="section-head">
              <div>
                <h2>Cardio</h2>
                <p>Finishers count toward progress.</p>
              </div>
              <button class="small-btn" data-editor-action="add-cardio" type="button">+ Cardio</button>
            </div>
            <div class="stack">
              ${draft.cardio.length ? draft.cardio.map((cardio, index) => editorCardio(cardio, index)).join("") : `<div class="empty-state">No cardio entries.</div>`}
            </div>
            <button class="primary-btn" data-editor-action="save" type="button">${isImport ? "SAVE IMPORT" : "SAVE CHANGES"}</button>
            ${!isImport ? `<button class="ghost-btn" data-editor-action="duplicate" type="button">DUPLICATE INTO ACTIVE</button>` : ""}
            ${!isImport ? `<button class="danger-btn" data-editor-action="delete-workout" type="button">DELETE FROM HISTORY</button>` : ""}
          </div>
        </section>
      </div>
    `;
    bindEditor(draft, renderEditor, isImport);
  };
  renderEditor();
}

function editorExercise(exercise, exIndex) {
  return `
    <article class="edit-exercise">
      <div class="two-col">
        <div class="field"><label>Name</label><input data-ex-field="exerciseNameSnapshot" data-ex-index="${exIndex}" value="${escapeHtml(exercise.exerciseNameSnapshot)}"></div>
        <div class="field"><label>Order</label><input data-ex-field="orderIndex" data-ex-index="${exIndex}" inputmode="numeric" type="number" value="${exIndex + 1}"></div>
      </div>
      <div class="set-grid">
        <div class="set-row header"><span>Set</span><span>Weight</span><span>Reps</span><span>Done</span><span></span></div>
        ${exercise.sets.map((set, setIndex) => `
          <div class="set-row">
            <div class="set-number">${setIndex + 1}</div>
            <input data-edit-set="weight" data-ex-index="${exIndex}" data-set-index="${setIndex}" inputmode="decimal" type="number" step="0.5" value="${escapeHtml(set.weight)}">
            <input data-edit-set="reps" data-ex-index="${exIndex}" data-set-index="${setIndex}" inputmode="numeric" type="number" value="${escapeHtml(set.reps)}">
            <button class="complete-btn ${set.completed ? "done" : ""}" data-editor-action="toggle-set" data-ex-index="${exIndex}" data-set-index="${setIndex}" type="button">✓</button>
            <button class="remove-set-btn" data-editor-action="remove-set" data-ex-index="${exIndex}" data-set-index="${setIndex}" type="button" aria-label="Delete set">−</button>
          </div>
        `).join("")}
      </div>
      <div class="button-row">
        <button class="small-btn" data-editor-action="add-set" data-ex-index="${exIndex}" type="button">+ Set</button>
        <button class="small-btn" data-editor-action="remove-exercise" data-ex-index="${exIndex}" type="button">Remove</button>
      </div>
      <div class="field"><label>Notes</label><input data-ex-field="notes" data-ex-index="${exIndex}" value="${escapeHtml(exercise.notes || "")}"></div>
    </article>
  `;
}

function editorCardio(cardio, index) {
  return `
    <article class="edit-exercise">
      <div class="field">
        <label>Type</label>
        <select data-cardio-edit="type" data-cardio-index="${index}">
          ${["treadmill", "stairmaster", "assault bike", "rower", "custom"].map((type) => `<option ${cardio.type === type ? "selected" : ""} value="${type}">${type}</option>`).join("")}
        </select>
      </div>
      <div class="two-col">
        <div class="field"><label>Minutes</label><input data-cardio-edit="durationMinutes" data-cardio-index="${index}" inputmode="decimal" type="number" value="${escapeHtml(cardio.durationMinutes || "")}"></div>
        <div class="field"><label>Distance</label><input data-cardio-edit="distance" data-cardio-index="${index}" inputmode="decimal" type="number" value="${escapeHtml(cardio.distance || "")}"></div>
      </div>
      <div class="two-col">
        <div class="field"><label>Unit</label><select data-cardio-edit="distanceUnit" data-cardio-index="${index}"><option ${cardio.distanceUnit === "mi" ? "selected" : ""}>mi</option><option ${cardio.distanceUnit === "km" ? "selected" : ""}>km</option></select></div>
        <div class="field"><label>Calories</label><input data-cardio-edit="calories" data-cardio-index="${index}" inputmode="numeric" type="number" value="${escapeHtml(cardio.calories || "")}"></div>
      </div>
      <div class="button-row">
        <div class="field"><label>Notes</label><input data-cardio-edit="notes" data-cardio-index="${index}" value="${escapeHtml(cardio.notes || "")}"></div>
        <button class="small-btn" data-editor-action="remove-cardio" data-cardio-index="${index}" type="button">Remove</button>
      </div>
    </article>
  `;
}

function bindEditor(draft, rerender, isImport) {
  $("[data-close-modal]").addEventListener("click", closeModal);
  $$(".modal-backdrop").forEach((el) => el.addEventListener("click", (event) => {
    if (event.target.classList.contains("modal-backdrop")) closeModal();
  }));
  $$("[data-edit-field]").forEach((input) => input.addEventListener("input", () => updateDraftTimes(draft)));
  $$("[data-ex-field]").forEach((input) => input.addEventListener("input", () => {
    const ex = draft.exercises[int(input.dataset.exIndex)];
    if (input.dataset.exField === "orderIndex") ex.orderIndex = int(input.value) - 1;
    else ex[input.dataset.exField] = input.value;
  }));
  $$("[data-edit-set]").forEach((input) => input.addEventListener("input", () => {
    const set = draft.exercises[int(input.dataset.exIndex)].sets[int(input.dataset.setIndex)];
    set[input.dataset.editSet] = input.dataset.editSet === "reps" ? int(input.value) : num(input.value);
  }));
  $$("[data-cardio-edit]").forEach((input) => input.addEventListener("input", () => {
    const item = draft.cardio[int(input.dataset.cardioIndex)];
    const field = input.dataset.cardioEdit;
    item[field] = ["durationMinutes", "distance"].includes(field) ? num(input.value) : field === "calories" ? int(input.value) : input.value;
  }));
  $$("[data-editor-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.editorAction;
    if (action === "add-exercise") {
      draft.exercises.push(blankWorkoutExercise(draft.exercises.length));
      rerender();
    }
    if (action === "remove-exercise") {
      draft.exercises.splice(int(button.dataset.exIndex), 1);
      rerender();
    }
    if (action === "add-set") {
      const ex = draft.exercises[int(button.dataset.exIndex)];
      ex.sets.push({ id: uid("set"), workoutExerciseLogId: ex.id, setNumber: ex.sets.length + 1, weight: 0, reps: 10, completed: true, isWarmup: false, rir: null });
      rerender();
    }
    if (action === "remove-set") {
      const ex = draft.exercises[int(button.dataset.exIndex)];
      ex.sets.splice(int(button.dataset.setIndex), 1);
      renumberSets(ex.sets);
      rerender();
    }
    if (action === "toggle-set") {
      const set = draft.exercises[int(button.dataset.exIndex)].sets[int(button.dataset.setIndex)];
      set.completed = !set.completed;
      rerender();
    }
    if (action === "add-cardio") {
      draft.cardio.push({ id: uid("cardio"), workoutSessionId: draft.id, type: "treadmill", durationMinutes: 10, distance: 0, distanceUnit: "mi", calories: 0, notes: "" });
      rerender();
    }
    if (action === "remove-cardio") {
      draft.cardio.splice(int(button.dataset.cardioIndex), 1);
      rerender();
    }
    if (action === "save") await saveWorkoutDraft(draft, isImport);
    if (action === "duplicate") await duplicateWorkoutToActive(draft);
    if (action === "delete-workout") await deleteWorkoutFromHistory(draft.id);
  }));
}

function updateDraftTimes(draft) {
  const root = $("#modal-root");
  draft.title = $("[data-edit-field='title']", root).value;
  draft.splitType = $("[data-edit-field='splitType']", root).value;
  draft.notes = $("[data-edit-field='notes']", root).value;
  const startDate = $("[data-edit-field='startDate']", root).value;
  const startTime = $("[data-edit-field='startTime']", root).value;
  const endDate = $("[data-edit-field='endDate']", root).value;
  const endTime = $("[data-edit-field='endTime']", root).value;
  draft.startedAt = fromDateTime(startDate, startTime);
  draft.endedAt = endTime ? fromDateTime(endDate || startDate, endTime) : null;
  const manualDuration = int($("[data-edit-field='durationMinutes']", root).value);
  draft.durationSeconds = draft.endedAt ? minutesBetween(draft.startedAt, draft.endedAt) * 60 : manualDuration * 60;
}

async function saveWorkoutDraft(draft, isImport) {
  updateDraftTimes(draft);
  draft.status = "finished";
  draft.updatedAt = nowIso();
  draft.source = isImport ? "imported" : draft.source || "normal";
  draft.exercises.sort((a, b) => int(a.orderIndex) - int(b.orderIndex)).forEach((ex, index) => {
    ex.orderIndex = index;
    ex.workoutSessionId = draft.id;
    ex.exerciseId = ex.exerciseId || "custom";
    ex.sets.forEach((set, setIndex) => {
      set.setNumber = setIndex + 1;
      set.workoutExerciseLogId = ex.id;
      set.weight = num(set.weight);
      set.reps = int(set.reps);
      set.completed = Boolean(set.completed);
    });
  });
  draft.cardio.forEach((item) => {
    item.workoutSessionId = draft.id;
    item.durationMinutes = num(item.durationMinutes);
    item.distance = num(item.distance);
    item.calories = int(item.calories);
  });

  const existingExercises = (await dbApi.getAll("workoutExercises")).filter((ex) => ex.workoutSessionId === draft.id);
  const existingSetIds = (await dbApi.getAll("setLogs")).filter((set) => existingExercises.some((ex) => ex.id === set.workoutExerciseLogId)).map((set) => set.id);
  const existingCardioIds = (await dbApi.getAll("cardioLogs")).filter((item) => item.workoutSessionId === draft.id).map((item) => item.id);
  await dbApi.bulkDelete("setLogs", existingSetIds);
  await dbApi.bulkDelete("workoutExercises", existingExercises.map((ex) => ex.id));
  await dbApi.bulkDelete("cardioLogs", existingCardioIds);
  const { exercises, cardio, ...workout } = draft;
  await dbApi.put("workouts", workout);
  await dbApi.bulkPut("workoutExercises", exercises.map(({ sets, ...ex }) => ex));
  await dbApi.bulkPut("setLogs", exercises.flatMap((ex) => ex.sets));
  if (cardio.length) await dbApi.bulkPut("cardioLogs", cardio);
  closeModal();
  await refreshAnalytics();
  render();
  toast(isImport ? "Workout imported." : "Workout updated.");
}

async function deleteWorkoutFromHistory(workoutId) {
  const workout = state.allWorkouts.find((item) => item.id === workoutId);
  const label = workout ? `${workout.title} from ${fmtDateTime(workout.startedAt)}` : "this workout";
  if (!confirm(`Delete ${label}? This cannot be undone.`)) return;

  const [workoutExercises, setLogs, cardioLogs] = await Promise.all([
    dbApi.getAll("workoutExercises"),
    dbApi.getAll("setLogs"),
    dbApi.getAll("cardioLogs")
  ]);
  const exerciseIds = workoutExercises
    .filter((exercise) => exercise.workoutSessionId === workoutId)
    .map((exercise) => exercise.id);

  await dbApi.bulkDelete("setLogs", setLogs.filter((set) => exerciseIds.includes(set.workoutExerciseLogId)).map((set) => set.id));
  await dbApi.bulkDelete("workoutExercises", exerciseIds);
  await dbApi.bulkDelete("cardioLogs", cardioLogs.filter((cardio) => cardio.workoutSessionId === workoutId).map((cardio) => cardio.id));
  await dbApi.delete("workouts", workoutId);

  closeModal();
  await refreshAnalytics();
  render();
  toast("Workout deleted.");
}

async function duplicateWorkoutToActive(workout) {
  if (state.active && !confirm("Replace the current active workout?")) return;
  state.active = {
    id: uid("active"),
    title: `${workout.title} Copy`,
    splitType: workout.splitType,
    startedAt: nowIso(),
    endedAt: null,
    durationSeconds: 0,
    status: "active",
    notes: workout.notes || "",
    source: "normal",
    exercises: workout.exercises.map((ex, index) => ({
      id: uid("active_ex"),
      exerciseId: ex.exerciseId,
      exerciseNameSnapshot: ex.exerciseNameSnapshot,
      orderIndex: index,
      notes: ex.notes || "",
      sets: ex.sets.map((set, setIndex) => ({ ...set, id: uid("active_set"), setNumber: setIndex + 1, completed: false }))
    })),
    cardio: workout.cardio[0] ? { ...workout.cardio[0], id: uid("active_cardio") } : { id: uid("active_cardio"), type: "treadmill", durationMinutes: "", distance: "", distanceUnit: "mi", calories: "", notes: "" }
  };
  state.activeStartedAt = state.active.startedAt;
  await persistActive();
  closeModal();
  state.tab = "active";
  render();
  toast("Duplicated into active.");
}

function closeModal() {
  $("#modal-root").innerHTML = "";
}

function openExerciseModal() {
  const root = $("#modal-root");
  root.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal">
        <div class="modal-head">
          <div><span class="eyebrow">${escapeHtml(state.selectedSplit)} Template</span><h2>Add Exercise</h2></div>
          <button class="close-btn" data-close-modal type="button">×</button>
        </div>
        <div class="stack">
          <div class="field"><label>Name</label><input id="new-ex-name" placeholder="Hack Squat"></div>
          <div class="two-col">
            <div class="field"><label>Category</label><input id="new-ex-cat" placeholder="Legs"></div>
            <div class="field"><label>Equipment</label><input id="new-ex-eq" placeholder="Machine"></div>
          </div>
          <div class="two-col">
            <div class="field"><label>Default Sets</label><input id="new-ex-sets" inputmode="numeric" type="number" value="3"></div>
            <div class="field"><label>Rep Range</label><input id="new-ex-reps" value="8-12"></div>
          </div>
          <button class="primary-btn" data-save-new-ex type="button">ADD TO TEMPLATE</button>
        </div>
      </section>
    </div>
  `;
  $("[data-close-modal]").addEventListener("click", closeModal);
  $("[data-save-new-ex]").addEventListener("click", saveNewExercise);
}

async function saveNewExercise() {
  const name = $("#new-ex-name").value.trim();
  if (!name) return toast("Name the exercise first.");
  const template = (await dbApi.getAll("templates")).find((item) => item.splitType === state.selectedSplit);
  const exercise = {
    id: uid("ex"),
    name,
    category: $("#new-ex-cat").value.trim() || state.selectedSplit,
    primaryMuscles: [$("#new-ex-cat").value.trim() || state.selectedSplit],
    secondaryMuscles: [],
    defaultRepRange: $("#new-ex-reps").value.trim() || "8-12",
    defaultSetCount: int($("#new-ex-sets").value) || 3,
    equipment: $("#new-ex-eq").value.trim() || "Custom",
    createdAt: nowIso()
  };
  const templateExercise = {
    id: uid("te"),
    templateId: template.id,
    exerciseId: exercise.id,
    orderIndex: state.templateRows.length,
    defaultSets: exercise.defaultSetCount,
    defaultRepRange: exercise.defaultRepRange,
    enabledByDefault: true
  };
  template.orderedExerciseIds = [...template.orderedExerciseIds, exercise.id];
  template.updatedAt = nowIso();
  await dbApi.put("exercises", exercise);
  await dbApi.put("templateExercises", templateExercise);
  await dbApi.put("templates", template);
  await loadTemplateRows();
  closeModal();
  render();
  toast("Exercise added.");
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.pplToast);
  window.pplToast = setTimeout(() => el.classList.remove("show"), 2200);
}

function bindShell() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => {
    state.tab = button.dataset.tab;
    render();
  }));
  window.addEventListener("beforeunload", (event) => {
    if (!state.active) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function init() {
  db = await dbApi.open();
  await seedIfNeeded();
  await removeLegacyDemoHistory();
  await hydrate();
  bindShell();
  render();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init().catch((error) => {
  console.error(error);
  $("#view").innerHTML = `<div class="empty-state">Could not start PPL ELITE. ${escapeHtml(error.message || error)}</div>`;
});
