/**
 * ============================================================
 *  Multi-Simulation Engine — эволюция через параллельные прогоны
 * ============================================================
 *  По нажатию кнопки:
 *   1. Клонируем текущий мозг N раз.
 *   2. Каждый клон случайно мутируем (gaussian noise).
 *   3. Запускаем каждому клону K эпизодов headless.
 *   4. Накапливаем fitness = best score across episodes.
 *   5. Возвращаем ОТЧЁТ {before, after, rows}.
 *   6. При принятии — лучший клон adopt() в текущий мозг.
 *
 *  Работает асинхронно, разнося работу по setTimeout chunk'ам,
 *  чтобы не блокировать UI. Прогресс через callback onProgress.
 * ============================================================
 */
import { Brain } from '../ai/brain.js';
import { GAMES, runEpisode, evaluate } from './headlessSims.js';

export class MultiSim {
  constructor() {
    this.running = false;
  }

  /**
   * opts:
   *  - brain: исходный мозг
   *  - game: 'maze' | 'flappy' | ...
   *  - population: число клонов (5..32)
   *  - episodesPerClone: эпизодов на клона (1..5)
   *  - mutationSigma: 0..0.2
   *  - maxStepsPerEp: предел шагов
   *  - onProgress(pct, msg)
   */
  async run(opts) {
    const {
      brain, game, population = 12, episodesPerClone = 2,
      mutationSigma = 0.04, maxStepsPerEp = 700,
      onProgress = () => {}
    } = opts;
    const simCtor = GAMES[game];
    if (!simCtor) throw new Error('Неизвестная игра: ' + game);
    this.running = true;

    const before = evaluate(brain, simCtor, 2);

    const clones = [];
    for (let i = 0; i < population; i++) {
      const c = brain.clone(true);
      c.epsilon = Math.max(0.08, brain.epsilon * 0.9);
      c.mutate(mutationSigma * (0.5 + Math.random()));
      clones.push({ id: i, brain: c, score: 0, bestScore: 0, totalR: 0 });
    }

    const totalRuns = population * episodesPerClone;
    let doneRuns = 0;

    // chunked loop for UI responsiveness
    for (let ep = 0; ep < episodesPerClone; ep++) {
      for (let i = 0; i < population; i++) {
        if (!this.running) break;
        const clone = clones[i];
        const { score, totalReward } = runEpisode(clone.brain, simCtor, { maxSteps: maxStepsPerEp, learn: true });
        clone.score = score;
        clone.totalR += totalReward;
        if (score > clone.bestScore) clone.bestScore = score;
        doneRuns++;
        const pct = doneRuns / totalRuns;
        onProgress(pct, `Прогон ${doneRuns}/${totalRuns} · клон ${i + 1} · score ${score}`);
        // yield to UI every iteration
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // отсортировать
    clones.sort((a, b) => b.bestScore - a.bestScore);
    const winner = clones[0];
    const after = evaluate(winner.brain, simCtor, 2);

    this.running = false;
    return {
      game, population, episodesPerClone,
      before, after, winner,
      rows: clones.map(c => ({ id: c.id, best: c.bestScore, avgR: c.totalR / episodesPerClone })),
    };
  }

  stop() { this.running = false; }
}
