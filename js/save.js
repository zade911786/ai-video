/**
 * save.js 3.0 — localStorage с автосохранением состояния мозгов и эволюции.
 *  Версионный ключ — v3, чтобы не конфликтовать со старыми сохранениями.
 */
const SAVE_KEY = 'digital_circus_ai_v3';

export function saveState(state) {
  try {
    state.timestamp = Date.now();
    const json = JSON.stringify(state);
    localStorage.setItem(SAVE_KEY, json);
    return true;
  } catch (e) { console.warn('[save]', e); return false; }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { console.warn('[load]', e); return null; }
}

export function clearState() {
  try { localStorage.removeItem(SAVE_KEY); return true; }
  catch { return false; }
}

export function getSaveInfo() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return {
      size: raw.length,
      time: obj.timestamp || null,
      epoch: obj.epoch || 1,
      champions: Object.keys(obj.champions || {}).length
    };
  } catch { return null; }
}
