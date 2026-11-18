import type { TodoItem } from '../../types/island';

export const TODO_STORAGE_KEY = 'casa_todo_items_v1';
export const TIMER_FOCUSED_TASK_STORAGE_KEY = 'casa_timer_focused_task_v1';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultStorage(): StorageAdapter | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

/**
 * Validates and normalizes persisted To-Do arrays without ever injecting dummy/sample fallback items.
 */
export function sanitizeTodoItems(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const sanitized: TodoItem[] = [];
  const seenIds = new Set<string>();
  let pinnedSeen = false;

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<TodoItem>;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
    if (!id || !text || seenIds.has(id)) continue;

    seenIds.add(id);
    const completed = Boolean(candidate.completed);
    const rawPinned = !completed && Boolean(candidate.isPinned);
    const isPinned = rawPinned && !pinnedSeen;
    if (isPinned) {
      pinnedSeen = true;
    }

    const scheduledTime =
      typeof candidate.scheduledTime === 'string' &&
      /^\d{1,2}:\d{2}$/.test(candidate.scheduledTime.trim())
        ? candidate.scheduledTime.trim()
        : undefined;

    sanitized.push({
      id,
      text,
      completed,
      isPinned,
      ...(scheduledTime ? { scheduledTime } : {}),
    });
  }

  return sanitized;
}

/**
 * Loads user To-Do items safely from persistent storage.
 * Returns `[]` when missing or if stored JSON is corrupted.
 */
export function loadPersistedTodos(storage: StorageAdapter | null = getDefaultStorage()): TodoItem[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(TODO_STORAGE_KEY);
    if (!raw || !raw.trim()) return [];
    const parsed: unknown = JSON.parse(raw);
    return sanitizeTodoItems(parsed);
  } catch (err) {
    console.warn('[TodoPersistence] Failed to load persisted todos, falling back to []:', err);
    return [];
  }
}

/**
 * Persists To-Do items synchronously on explicit state updates.
 */
export function savePersistedTodos(
  todos: TodoItem[],
  storage: StorageAdapter | null = getDefaultStorage()
): TodoItem[] {
  const clean = sanitizeTodoItems(todos);
  if (!storage) return clean;
  try {
    storage.setItem(TODO_STORAGE_KEY, JSON.stringify(clean));
  } catch (err) {
    console.warn('[TodoPersistence] Failed to save persisted todos:', err);
  }
  return clean;
}

/**
 * Validates `focusedTaskId` against hydrated To-Do items so deleted or completed tasks cannot linger.
 */
export function reconcileTimerFocusedTaskId(
  focusedTaskId: string | null | undefined,
  hydratedTodos: TodoItem[]
): string | null {
  const candidateId = typeof focusedTaskId === 'string' ? focusedTaskId.trim() : '';
  if (!candidateId || !Array.isArray(hydratedTodos) || hydratedTodos.length === 0) {
    return null;
  }
  return hydratedTodos.some((t) => !t.completed && t.id === candidateId) ? candidateId : null;
}

export function loadPersistedFocusedTaskId(
  hydratedTodos: TodoItem[],
  storage: StorageAdapter | null = getDefaultStorage()
): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(TIMER_FOCUSED_TASK_STORAGE_KEY);
    if (!raw) return null;
    const valid = reconcileTimerFocusedTaskId(raw, hydratedTodos);
    if (!valid) {
      storage.removeItem(TIMER_FOCUSED_TASK_STORAGE_KEY);
    }
    return valid;
  } catch {
    return null;
  }
}

export function savePersistedFocusedTaskId(
  focusedTaskId: string | null | undefined,
  storage: StorageAdapter | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    const clean = typeof focusedTaskId === 'string' ? focusedTaskId.trim() : '';
    if (clean) {
      storage.setItem(TIMER_FOCUSED_TASK_STORAGE_KEY, clean);
    } else {
      storage.removeItem(TIMER_FOCUSED_TASK_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('[TodoPersistence] Failed to save focusedTaskId:', err);
  }
}
