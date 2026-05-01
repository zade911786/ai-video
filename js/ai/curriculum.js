/**
 * ============================================================
 *  CurriculumManager — ускоритель обучения
 * ============================================================
 *  Отслеживает прогресс агентов по задачам, авто-подстраивает:
 *   • скорость исследования (ε) под успех
 *   • множитель наград (reward shaping) под прогресс
 *   • частоту "учительских" подсказок эвристики
 *   • распределение тренировочного времени между задачами
 *
 *  Стратегия: если агент топчется на месте (низкий прирост награды)
 *  — включается bootstrap от эвристики и повышается ε.
 *  Если успехов много — эвристика отключается, ε снижается, и
 *  агент полагается на свою политику.
 */
export class CurriculumManager {
  constructor() {
    this.tasks = {};         // task -> {attempts, successes, rolling}
    this.globalSteps = 0;
  }
  _bucket(task) {
    if (!this.tasks[task]) {
      this.tasks[task] = {
        attempts: 0, successes: 0,
        rollingReward: 0, rollingCount: 0,
        lastSuccessStep: 0
      };
    }
    return this.tasks[task];
  }
  record(task, reward, success = false) {
    const b = this._bucket(task);
    this.globalSteps++;
    b.attempts++;
    if (success) b.successes++;
    b.rollingReward = b.rollingReward * 0.98 + reward * 0.02;
    b.rollingCount++;
    if (success) b.lastSuccessStep = this.globalSteps;
  }
  successRate(task) {
    const b = this._bucket(task);
    return b.attempts > 0 ? b.successes / b.attempts : 0;
  }
  /**
   * Коэффициент "использования эвристики" для агента на задаче.
   * Новичок → 0.75 (часто слушаем учителя)
   * Мастер  → 0.12
   */
  teacherWeight(task, agentSkill = 0) {
    const sr = this.successRate(task);
    // если агент мастер — почти не слушаем учителя
    const base = 0.85 - Math.min(0.7, sr * 1.2) - agentSkill * 0.35;
    return Math.max(0.08, Math.min(0.9, base));
  }
  /** Множитель reward shaping — стимулируем обучение в "отстающих" задачах */
  rewardScale(task) {
    const sr = this.successRate(task);
    // если плохо получается — больше дофамина за маленькие успехи
    return sr < 0.2 ? 1.6 : sr < 0.5 ? 1.25 : 1.0;
  }
  /** ε-boost: если задача застопорилась — подтолкнуть к исследованию */
  epsilonBoost(task) {
    const b = this._bucket(task);
    if (b.attempts < 20) return 0;
    const stale = this.globalSteps - b.lastSuccessStep;
    if (stale > 600) return 0.12;
    if (stale > 300) return 0.05;
    return 0;
  }
  snapshot() {
    const out = {};
    for (const k in this.tasks) {
      out[k] = {
        attempts: this.tasks[k].attempts,
        successes: this.tasks[k].successes,
        rate: this.successRate(k),
        rollingR: this.tasks[k].rollingReward
      };
    }
    return out;
  }
  toJSON() { return { tasks: this.tasks, globalSteps: this.globalSteps }; }
  fromJSON(d) {
    if (!d) return;
    this.tasks = d.tasks || {};
    this.globalSteps = d.globalSteps || 0;
  }
}

/* singleton, общий на обоих агентов */
export const curriculum = new CurriculumManager();
