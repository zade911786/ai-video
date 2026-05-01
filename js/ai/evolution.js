/**
 * ============================================================
 *  Evolution & Champion Manager
 * ============================================================
 *  Реализует требование: «лучший становится основой для следующих
 *  поколений, но только если кто-то побил его рекорд».
 *
 *  - recordRun(color, game, score): записать попытку, возможно обновить чемпиона.
 *  - setLiveBrain(color, brainProvider): провайдер текущего мозга
 *  - promoteChampion(color, game): сделать действующим основой-чемпионом в данной игре.
 *  - bestOf(color, game): возвращает лучший счёт
 *  - saveChampionSnapshot(color, game, brain): сохраняем веса (клон) если score превышает
 *
 *  Чемпион — это объект {score, brainJSON, gen, ts}. Обновляется только если
 *  newScore > champion.score (строго!) — иначе остаётся старый.
 * ============================================================
 */

import { Brain } from './brain.js';

export class EvolutionManager {
  constructor() {
    this.champions = {}; // key = `${color}:${game}` -> {score, brainJSON, gen, ts, name}
    this.history   = []; // список попыток
    this.totalRuns = 0;
    this.genGlobal = 1;
  }

  key(color, game) { return `${color}:${game}`; }

  bestOf(color, game) {
    const c = this.champions[this.key(color, game)];
    return c ? c.score : 0;
  }

  champion(color, game) {
    return this.champions[this.key(color, game)] || null;
  }

  /**
   * Регистрируем забег. Если счёт строго больше предыдущего чемпиона —
   * СОХРАНЯЕМ текущие веса как нового чемпиона. Возвращает флаг "улучшено".
   */
  recordRun(color, game, score, brain) {
    this.totalRuns++;
    const k = this.key(color, game);
    const prev = this.champions[k];
    const entry = { color, game, score, ts: Date.now() };
    this.history.push(entry);
    if (this.history.length > 500) this.history.shift();
    if (!prev || score > prev.score) {
      this.champions[k] = {
        score,
        gen: (brain?.generation || 1),
        ts: Date.now(),
        name: brain?.name || color,
        brainJSON: brain ? brain.toJSON() : null
      };
      return { improved: true, prevScore: prev ? prev.score : null };
    }
    return { improved: false, prevScore: prev ? prev.score : null };
  }

  /** Применяет вес��-чемпиона к заданному мозгу (make current brain = champion). */
  applyChampion(brain, color, game) {
    const c = this.champions[this.key(color, game)];
    if (!c || !c.brainJSON) return false;
    brain.fromJSON(c.brainJSON);
    brain.generation = (c.gen || 1) + 1;
    return true;
  }

  /** Сводка для UI */
  snapshot() {
    const rows = [];
    for (const k in this.champions) {
      const c = this.champions[k];
      const [color, game] = k.split(':');
      rows.push({ color, game, score: c.score, gen: c.gen, ts: c.ts });
    }
    rows.sort((a, b) => a.game.localeCompare(b.game) || a.color.localeCompare(b.color));
    return rows;
  }

  toJSON() {
    return {
      champions: this.champions,
      history: this.history.slice(-150),
      totalRuns: this.totalRuns,
      genGlobal: this.genGlobal
    };
  }
  fromJSON(d) {
    if (!d) return;
    this.champions = d.champions || {};
    this.history = d.history || [];
    this.totalRuns = d.totalRuns || 0;
    this.genGlobal = d.genGlobal || 1;
  }

  /**
   * Клонирует чемпиона в новый мозг (используется в multi-sim).
   */
  spawnChampionBrain(color, game, nameSuffix = 'clone') {
    const c = this.champions[this.key(color, game)];
    if (!c || !c.brainJSON) return null;
    const b = new Brain({ name: `${color}-${nameSuffix}`, color });
    b.fromJSON(c.brainJSON);
    return b;
  }
}

export const evolution = new EvolutionManager();
