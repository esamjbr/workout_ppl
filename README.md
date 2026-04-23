# PPL ELITE

Production-style mobile-first Push / Pull / Legs workout tracker built with plain HTML, CSS, and JavaScript.

## Run Locally

Open `index.html` directly in a browser, or serve the folder for PWA/service worker behavior:

```sh
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Local Data

Workout data is stored in IndexedDB under database `pplEliteDB`.

Stores:
- `exercises`
- `templates`
- `templateExercises`
- `workouts`
- `workoutExercises`
- `setLogs`
- `cardioLogs`
- `activeSession`
- `meta`

Small UI state is stored in `localStorage` under `pplElite.ui`.

## Reset Demo Data

In the browser console run:

```js
indexedDB.deleteDatabase("pplEliteDB");
localStorage.removeItem("pplElite.ui");
location.reload();
```

The app will reseed starter templates and exercises on reload. It does not seed dummy workout history.

## Import Flow

Go to `History`, tap `Import Past Workout`, fill in date/time, workout type, exercises, set rows, optional cardio, and notes. Imported sessions are saved with `source: "imported"` and behave like normal workouts: they are editable, searchable, and included in volume, PR, cardio, and streak analytics.

## Extending Templates

Use the Home tab to add custom exercises to the selected split and reorder template cards by dragging the handle. The data is persisted in IndexedDB and used when starting new workouts.

## Sets

During an active workout, tap `+ Set` to add a set or the red minus button on a set row to delete it. The same controls are available when editing historical or imported workouts.
