# Change Plan: Multi-Exercise Editing, Skipped Exercise State, and Exercise Comments

Date: 2026-04-15

## Objective

Update the workout builder so that:

1. Multiple exercises in the current workout can be open and editable at the same time.
2. An exercise can be marked as planned-but-not-done with a strikethrough state.
3. Each exercise can store a text comment that appears below the set inputs and persists in the database.

## Current Behavior

The existing implementation only supports editing one exercise at a time because it uses a single shared set-entry panel and a single global editing state:

- `index.html`
  - The workout builder has one shared `#sets-entry` card for entering sets.
- `app.js`
  - `setsState` holds the active set-edit session for exactly one exercise.
  - `openSetsEntry()` opens that shared editor.
  - `commitSetsState()` writes the edited sets back into one workout entry.
  - `beginEditEntry()` routes a selected exercise back into the same shared editor.

That structure prevents multiple exercises from staying open for editing simultaneously.

## Proposed Direction

Replace the single shared set-entry workflow with per-exercise inline editors inside the workout plan. Each workout entry should become its own editable card, and the UI should allow several of those cards to remain expanded at once.

This avoids fighting the current global `setsState` model and better matches the user goal.

## Data Model Changes

Extend each workout entry object from:

```js
{
  key,
  exerciseId,
  sets: [{ weight, unit, reps }]
}
```

to:

```js
{
  key,
  exerciseId,
  skipped: false,
  comment: '',
  isExpanded: false, // UI-only; do not persist
  sets: [{ weight, unit, reps }]
}
```

### Persisted fields

Persist these fields into the `workouts.entries` JSON:

- `exerciseId`
- `sets`
- `skipped`
- `comment`

### Non-persisted field

Keep `isExpanded` as in-memory UI state only.

The strikethrough UI must be derived from the persisted `skipped` flag. In other words, the visual strikethrough is not just temporary display state; it should survive autosave, resume, reuse, final save, and past-workout viewing because `skipped` is stored in the database JSON.

## HTML Changes

Update the workout builder in `index.html`:

1. Remove or retire the shared `#sets-entry` card.
2. Keep the top-level exercise picker and set-count controls for adding new planned exercises.
3. Render editable controls inside each workout-plan card instead of in the shared modal-like section.

Each plan card should contain:

- Exercise title
- Expand/collapse toggle
- Skip / undo-skip toggle
- Remove button
- Reorder handle
- Inline set rows
- Add set / remove set controls
- Comment textarea below the set rows

## CSS Changes

Update `style.css` to support the new inline editor layout:

- Expanded/collapsed plan entry styling
- Strikethrough state for skipped exercises
- Muted styling for skipped entries
- Set-row grid layout for weight, unit, reps, and remove-set controls
- Comment textarea spacing below sets
- Visual separation between exercise cards so multiple open editors remain readable

Suggested classes:

- `.plan-entry.expanded`
- `.plan-entry.skipped`
- `.plan-entry-editor`
- `.set-row`
- `.exercise-comment`

## JavaScript Refactor Plan

## 1. Replace the single active editor model

In `app.js`, remove the dependency on:

- `setsState`
- `openSetsEntry()`
- `populateSetEntryFields()`
- `updateSetLabel()`
- `updateSetActionButton()`
- `renderSetsProgress()`
- `commitSetsState()`
- `#btn-next-set`
- `#btn-cancel-sets`

These functions are built around one global editor and should be replaced by entry-local editing.

## 2. Normalize and persist the new entry shape

Update:

- `normalizeEntry()`
- workout save payload generation in `scheduleWorkoutAutosave()`
- workout save payload generation in the `#btn-finish-workout` handler

So every normalized entry safely includes:

- `skipped: Boolean(entry.skipped)`
- `comment: typeof entry.comment === 'string' ? entry.comment : ''`

This is safe because the DB column is already `jsonb`, so no SQL schema change is required.

## 3. Change how exercises are added to a workout

Current behavior:

- User picks one exercise and set count.
- App opens a dedicated panel to enter the sets.
- Only after completion does the entry get added to the plan.

New behavior:

- Clicking `Add Sets for Exercise` should immediately add a new plan entry into `workoutDraft.entries`.
- The new entry should be created with the requested number of blank sets.
- The new entry should default to expanded so the user can begin editing inline.

Suggested inserted shape:

```js
{
  key: uid(),
  exerciseId,
  skipped: false,
  comment: '',
  isExpanded: true,
  sets: Array.from({ length: totalSets }, () => ({
    weight: null,
    unit: lastUnit,
    reps: 0,
  })),
}
```

## 4. Render each workout entry as a self-contained editor

Refactor `renderWorkoutPlan()` so each card includes:

- Header row with exercise name
- Summary text when collapsed
- Expand/collapse control
- Skip toggle
- Edit-in-place controls when expanded

Expanded state should render:

- One row per set
  - weight input
  - unit select
  - reps input
  - remove set button
- `Add Set` button
- Comment textarea

The existing summary line can still use `formatSetForDisplay()` for compact display when collapsed.

## 5. Support multiple open exercises

Do not keep expansion in a single global variable.

Each entry should track its own open/closed state in memory. Two straightforward options:

1. Store `isExpanded` directly on `workoutDraft.entries`.
2. Store expanded keys in a `Set`.

Recommendation:

- Store `isExpanded` directly on the draft entries because it is simpler for this codebase.
- Strip that field out before persistence.

## 6. Add skipped / not-done state

Introduce a per-entry boolean:

- `skipped: true` means the exercise was planned but not completed.

Behavior:

- Add a button like `Mark Skipped` / `Undo Skip`.
- Apply strikethrough to the exercise title and optionally the summary text.
- Keep the entry in the plan and in saved workout history.
- Allow comment entry even if skipped.
- Persist `skipped` in autosave and final save so the strikethrough state survives reloads and future sessions.

Display guidance:

- Skipped entries should remain visible in both current workout and past workout views.
- Past workout detail should clearly show that the exercise was skipped.

Recommended rendering:

- Header text with CSS `text-decoration: line-through;`
- A small metadata label such as `Skipped`

## 7. Add comment support

Each entry gets a freeform text comment.

Behavior:

- The comment field appears below the set rows.
- The value updates `entry.comment` on input.
- Autosave and final save include the comment in persisted JSON.

Views that should display the comment:

- Current workout plan
- Past workout detail
- Recent workout reuse/resume path

Optional later extension:

- Include comment in CSV export

## 8. Update click/input event handling

The current plan uses delegated click handling for edit/remove and pointer handling for reorder.

Expand that delegation to support:

- expand/collapse
- skip toggle
- add set
- remove set

Use delegated `input` or `change` handlers on `#workout-plan` for:

- set weight
- set unit
- set reps
- comment changes

This keeps the code consistent with the existing render-on-state-change pattern.

## 9. Preserve reorder support

The reorder implementation can stay mostly intact because it already uses `workoutDraft.entries` order and entry keys.

Needed checks:

- Ensure drag still works when cards are expanded.
- Ensure dragging a skipped or commented entry preserves all new fields.
- Ensure rerendering after reorder does not collapse every entry unexpectedly.

If `isExpanded` is stored on the entry object, reorder should preserve it automatically.

## 10. Update past-workout rendering

Modify `renderWorkoutDetail()` so it shows:

- Exercise name
- Skipped badge or strikethrough when applicable
- Set summary
- Comment below the set summary when present

Suggested display rules:

- If skipped and no sets were done, show `Skipped`.
- If skipped but sets exist, still show the recorded sets and note the skipped flag as-is.

## 11. Update recent workout clone/resume behavior

`loadWorkoutIntoDraft()` and `handleResumeWorkout()` should preserve:

- `skipped`
- `comment`

They should also initialize:

- `isExpanded: false` by default when loading historical data, unless a different UX is preferred

Recommendation:

- For reused old workouts, start collapsed for readability.
- For a newly added exercise in the current session, start expanded.

## 12. Validation decisions

Current code requires reps to be a positive number before saving a set through the shared editor.

With inline editing, decide whether to allow partially completed rows.

Recommendation:

- Allow temporary incomplete input in the UI while editing.
- Normalize on autosave/final save.
- Treat blank reps as `0` in-memory until finished, or filter obviously empty set rows before persistence.

Practical rule:

- Persist a set row only if at least reps is a valid positive number.
- If the team prefers strictness, show validation when finishing the workout rather than blocking every keystroke.

## 13. Save-payload normalization

Before autosave and final save:

1. Remove UI-only fields such as `key` and `isExpanded`.
2. Normalize each set.
3. Normalize `skipped` to boolean.
4. Trim `comment`.

Suggested helper:

```js
function serializeWorkoutEntry(entry) {
  return {
    exerciseId: entry.exerciseId,
    skipped: Boolean(entry.skipped),
    comment: (entry.comment || '').trim(),
    sets: (entry.sets || [])
      .map(normalizeSet)
      .filter((set) => Number.isFinite(set.reps) && set.reps > 0),
  };
}
```

Then use that helper in both autosave and finish-save paths.

## 14. Backward compatibility

Older saved workouts may not contain:

- `skipped`
- `comment`
- object-based sets in every case

`normalizeEntry()` and `normalizeSet()` should continue handling:

- numeric old-style sets
- missing comment
- missing skipped flag

This avoids breaking existing stored workouts.

## 15. Testing Plan

Manual test cases:

1. Start a brand-new workout and add two exercises.
2. Expand both exercises at once and edit them simultaneously.
3. Add and remove sets inside one expanded exercise.
4. Enter comments on multiple exercises.
5. Mark one exercise as skipped and confirm strikethrough appears.
6. Leave the page/view and return to confirm autosaved data reloads.
7. Resume the most recent workout and confirm skipped/comment data survives.
8. Finish the workout and verify past-workout detail shows comments and skipped state.
9. Start a workout from a prior workout template and confirm comments/skipped flags carry over as intended.
10. Reorder expanded entries and verify data is not lost.

Regression checks:

- Exercise adding still works.
- Finish workout still saves correctly.
- Past workout delete still works.
- Progress chart still works with the updated entry shape.

## Recommended Implementation Order

1. Add entry-shape normalization and serialization helpers.
2. Refactor add-exercise flow to create inline editable entries immediately.
3. Rewrite `renderWorkoutPlan()` to render expanded inline editors.
4. Add delegated handlers for inline edits, skip toggles, and comment updates.
5. Remove the old shared set-entry UI and dead code.
6. Update past-workout detail rendering.
7. Run manual regression testing on new-workout, resume, reuse, and past-workout views.

## Risk Notes

- The biggest structural change is removing the shared `setsState` editor. That is the correct fix for multi-open editing, but it touches several connected handlers.
- Autosave must not persist UI-only fields like `key` or `isExpanded`.
- The past-workout list currently attaches click listeners inside `renderWorkoutsList()`, which can stack across repeated renders. That issue is separate, but worth fixing while touching workout UI logic.

## Final Recommendation

Implement this as an inline-card editor refactor rather than trying to extend the current single `setsState` panel. The current design is inherently single-edit-session. Supporting multiple simultaneously open exercises is much simpler, cleaner, and more maintainable if each workout entry owns its own editable UI.
