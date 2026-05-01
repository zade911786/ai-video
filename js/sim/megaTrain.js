/**
 * ============================================================
 *  Megatrain — пошаговое мультиобучение на всех играх
 * ============================================================
 *  Логика:
 *   - Пользователь выбирает общее время (например, 10 реальных минут).
 *   - Оно делится на 5 игр: maze, flappy, escape, sandbox, world.
 *   - На каждую игру тратим window/5 минут реального времени.
 *   - Агент внутри каждой игры работает в ускоренном режиме — мы
 *     прогоняем его эпизод за эпизодом как можно быстрее (headless).
 *     Поэтому «для ИИ» идёт примерно x4..x8 по сравнению с real-time.
 *   - По итогу — отчёт: до/после по каждой дисциплине + вопрос
 *     «Применить лучшего?» для каждой.
 *
 *  Дополнительно на каждой игре запускаем MultiSim (параллельную
 *  эволюцию), чтобы кроме обычного обучения появилось evolution-звено.
 * ============================================================
 */
import { GAMES, runEpisode, evaluate } from './headlessSims.js';
import { MultiSim } from './multiSim.js';

const GAME_ORDER = ['maze', 'flappy', 'escape', 'sandbox', 'world'];

export class Megatrain {
  constructor() { this.running = false; }

  /**
   * opts:
   *  - brain
   *  - totalMinutes (real minutes user budget; default 10)
   *  - onProgress(pct, msg, partial)
   */
  async run(opts) {
    const {
      brain, totalMinutes = 10,
      multiSimEach = true,
      onProgress = () => {}
    } = opts;
    this.running = true;
    const startAll = Date.now();
    const endAll = startAll + totalMinutes * 60 * 1000;
    const perGameMs = (totalMinutes * 60 * 1000) / GAME_ORDER.length;

    const report = { perGame: {}, totalStart: startAll, totalEnd: null };

    for (let gi = 0; gi < GAME_ORDER.length; gi++) {
      if (!this.running) break;
      const game = GAME_ORDER[gi];
      const simCtor = GAMES[game];
      const before = evaluate(brain, simCtor, 3);

      const gameEnd = Math.min(endAll, Date.now() + perGameMs);
      let episodes = 0, lastScore = 0, best = 0;

      while (Date.now() < gameEnd && this.running) {
        const { score } = runEpisode(brain, simCtor, { maxSteps: 600, learn: true });
        episodes++;
        lastScore = score;
        if (score > best) best = score;
        const pct = (gi + Math.min(1, (Date.now() - (gameEnd - perGameMs)) / perGameMs)) / GAME_ORDER.length;
        onProgress(pct, `🎯 ${game}: эпизод ${episodes}, best ${best}`, { game, episodes, best });
        // yield each episode
        await new Promise(r => setTimeout(r, 0));
      }

      // после обучения — короткий multisim для эволюционного звена
      let evoBest = null;
      if (multiSimEach) {
        try {
          const ms = new MultiSim();
          const msRes = await ms.run({
            brain, game, population: 6, episodesPerClone: 1,
            mutationSigma: 0.03, maxStepsPerEp: 400,
            onProgress: (p, msg) => onProgress(
              (gi + 0.95) / GAME_ORDER.length,
              `🧬 ${game} evo: ${msg}`
            )
          });
          evoBest = msRes.winner;
        } catch (e) { console.warn('[megatrain evo fail]', e); }
      }

      const after = evaluate(brain, simCtor, 3);
      report.perGame[game] = { before, after, episodes, best, evoBest: evoBest ? {
        score: evoBest.bestScore, brainJSON: evoBest.brain.toJSON()
      } : null };
    }

    this.running = false;
    report.totalEnd = Date.now();
    return report;
  }

  stop() { this.running = false; }
}
