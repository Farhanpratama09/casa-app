/**
 * Verification tests for empty initial To-Do state, corrupted JSON fallback,
 * persistent CRUD across simulated app reloads, and timer focusedTaskId startup reconciliation.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve('package.json'));
const ts = require('typescript');

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

function loadTsModule(relPath) {
  const fullPath = path.resolve(relPath);
  const src = fs.readFileSync(fullPath, 'utf8');
  const compiled = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

  const mod = { exports: {} };
  const fn = new Function('exports', 'require', 'module', compiled);
  fn(
    mod.exports,
    () => {
      throw new Error('Unexpected external import in pure module');
    },
    mod
  );
  return mod.exports;
}

const persistence = loadTsModule('src/features/todo/todoPersistence.ts');

console.log('\n[CASA To-Do Persistence & Startup Hydration Verification]\n');

let passed = 0;
function check(cond, label) {
  assert.ok(cond, label);
  passed++;
  console.log(`  [PASS] ${label}`);
}

// 1. Fresh boot without stored data starts cleanly with [] (zero dummy tasks)
const storage = createMemoryStorage();
globalThis.localStorage = storage;

const freshBootTodos = persistence.loadPersistedTodos(storage);
check(Array.isArray(freshBootTodos) && freshBootTodos.length === 0, 'Fresh boot without storage initializes [] (no dummy tasks)');

// Verify source todoSkill.tsx does NOT contain hardcoded dummy tasks
const todoSkillSrc = fs.readFileSync(path.resolve('src/skills/builtin/todoSkill.tsx'), 'utf8');
check(
  !todoSkillSrc.includes('Review CASA Top-Bezel Notch styling') &&
    todoSkillSrc.includes('loadPersistedTodos()'),
  'todoSkill.tsx removes hardcoded sample tasks and hydrates via loadPersistedTodos()'
);

// 2. Corrupted JSON falls back cleanly to []
storage.setItem(persistence.TODO_STORAGE_KEY, '{not-valid-json');
const corruptFallback = persistence.loadPersistedTodos(storage);
check(Array.isArray(corruptFallback) && corruptFallback.length === 0, 'Corrupted storage JSON falls back safely to []');

// Non-array JSON payload falls back cleanly to []
storage.setItem(persistence.TODO_STORAGE_KEY, JSON.stringify({ oops: true }));
check(persistence.loadPersistedTodos(storage).length === 0, 'Non-array storage JSON falls back cleanly to []');

// 3. Add, check completed, delete & simulated app reload persistence
storage.removeItem(persistence.TODO_STORAGE_KEY);
let sessionTodos = persistence.loadPersistedTodos(storage);
sessionTodos = persistence.savePersistedTodos(
  [
    ...sessionTodos,
    { id: 't-101', text: 'Audit CASA v2.0.4 updater', completed: false, isPinned: true, scheduledTime: '10:30' },
    { id: 't-102', text: 'Publish NSIS bundle', completed: false, isPinned: false },
  ],
  storage
);
persistence.savePersistedFocusedTaskId('t-101', storage);

// Simulate reload #1 (re-hydrating from persistent storage cleanly)
let reloadedTodos = persistence.loadPersistedTodos(storage);
let reloadedFocus = persistence.loadPersistedFocusedTaskId(reloadedTodos, storage);
check(
  reloadedTodos.length === 2 &&
    reloadedTodos[0].text === 'Audit CASA v2.0.4 updater' &&
    reloadedTodos[0].isPinned === true &&
    reloadedFocus === 't-101',
  'Added items and valid focusedTaskId survive simulated reload #1'
);

// Toggle completed on t-101 & verify focus reference clears cleanly across reload #2
const afterToggle = reloadedTodos.map((t) =>
  t.id === 't-101' ? { ...t, completed: true, isPinned: false } : t
);
persistence.savePersistedTodos(afterToggle, storage);

reloadedTodos = persistence.loadPersistedTodos(storage);
reloadedFocus = persistence.loadPersistedFocusedTaskId(reloadedTodos, storage);
check(
  reloadedTodos.length === 2 &&
    reloadedTodos[0].completed === true &&
    reloadedTodos[0].isPinned === false &&
    reloadedFocus === null,
  'Completed status persists and clears stale focusedTaskId on reload #2'
);

// Delete t-102 while focusedTaskId pointed to t-102 -> startup validation drops deleted reference
persistence.savePersistedFocusedTaskId('t-102', storage);
const afterDelete = reloadedTodos.filter((t) => t.id !== 't-102');
persistence.savePersistedTodos(afterDelete, storage);

reloadedTodos = persistence.loadPersistedTodos(storage);
reloadedFocus = persistence.loadPersistedFocusedTaskId(reloadedTodos, storage);
check(
  reloadedTodos.length === 1 &&
    reloadedTodos[0].id === 't-101' &&
    reloadedFocus === null &&
    persistence.reconcileTimerFocusedTaskId('deleted-id', reloadedTodos) === null,
  'Deleted task stays removed and startup reconciliation removes deleted focusedTaskId'
);

// Delete remaining item -> stays [] after reload #3 (never respawns dummy tasks)
persistence.savePersistedTodos([], storage);
const finalReload = persistence.loadPersistedTodos(storage);
check(Array.isArray(finalReload) && finalReload.length === 0, 'Deleting all tasks persists [] across reload (never re-seeds defaults)');

console.log(`\n  TODO PERSISTENCE VERIFICATION: ${passed} passed, 0 failed\n`);
