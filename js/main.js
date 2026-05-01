/**
 * Digital Circus AI 3.0 — главный контроллер.
 *
 *  Архитектура:
 *   • World — сцена (поддерживает split-screen).
 *   • Agent red (КЕЙН) и blue (ЭЙС) — у каждого Brain (Rainbow-like DQN).
 *   • Пять мини-игр: world, flappy, maze, sandbox, escape (минигры chess/hide/
 *     minecraft удалены по требованию).
 *   • EvolutionManager — хранит чемпионов, обновляемых только при строго
 *     лучшем результате.
 *   • MultiSim — запускает N параллельных headless-симуляций одной и той же
 *     игры с разными мутациями мозга.
 *   • Megatrain — проходится по всем играм, обучая мозг по очереди.
 *
 *  Основные кнопки UI:
 *   • навигация по играм;
 *   • скорость (1× / 2× / 4× / 8×);
 *   • «Параллельные симуляции (×4)» — MultiSim + отчёт;
 *   • «Мегатренинг» — шаговое обучение по всем играм;
 *   • «Применить чемпиона» — заменяет текущий мозг чемпионом на этой игре.
 */
import * as THREE from 'three';
import { World } from './world.js';
import { Agent } from './ai/agent.js';
import { Brain } from './ai/brain.js';
import { curriculum } from './ai/curriculum.js';
import { EvolutionManager } from './ai/evolution.js';
import { MultiSim } from './sim/multiSim.js';
import { Megatrain } from './sim/megaTrain.js';
import { GAMES as SIM_GAMES, evaluate } from './sim/headlessSims.js';
import { SharedBus } from './ai/brain.js';

import { WorldGame }   from './games/worldGame.js';
import { FlappyGame }  from './games/flappyGame.js';
import { MazeGame }    from './games/mazeGame.js';
import { SandboxGame } from './games/sandboxGame.js';
import { EscapeGame }  from './games/escapeGame.js';

import { drawNetwork, updateAICard, showToast, openModal, closeModal, renderEvoTable, renderRunReport } from './ui.js';
import { saveState, loadState, clearState, getSaveInfo } from './save.js';

class Controller {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.world = new World(this.container);

    // Создаём агентов
    this.agents = {
      red: new Agent({
        id: 0, name: 'КЕЙН', color: 'red',
        brain: new Brain({ skill: 0.05, epsilon: 0.9,  lr: 0.0018, name: 'КЕЙН' }),
        position: { x: -3, z: 0 }
      }),
      blue: new Agent({
        id: 1, name: 'ЭЙС', color: 'blue',
        brain: new Brain({ skill: 0.92, epsilon: 0.05, lr: 0.0006, name: 'ЭЙС' }),
        position: { x:  3, z: 0 }
      })
    };
    this.world.addAgent(this.agents.red);
    this.world.addAgent(this.agents.blue);

    // Эволюция
    this.evo = new EvolutionManager();

    // Игры
    this.games = {
      world:   new WorldGame(this.world, this.agents),
      flappy:  new FlappyGame(this.world, this.agents),
      maze:    new MazeGame(this.world, this.agents),
      sandbox: new SandboxGame(this.world, this.agents),
      escape:  new EscapeGame(this.world, this.agents)
    };
    this.currentGame = null;
    this.currentGameKey = null;

    // Параметры цикла
    this.speed = 1;
    this.lastT = performance.now();
    this.fps = 60; this.fpsCount = 0; this.fpsAccum = 0;
    this.frame = 0;
    this.epoch = 1;
    this.loss = 0;

    // Multi-sim / megatrain
    this.multiSim = new MultiSim();
    this.megatrain = new Megatrain();
    this.lastReport = null;

    // last best-score registration timestamp per game (для анти-спама)
    this._lastScoreLog = {};
  }

  async init() {
    // Load blue weights (teacher priors) если доступно
    try {
      const resp = await fetch('./js/ai/blue_weights.json');
      if (resp.ok) {
        const w = await resp.json();
        this.agents.blue.brain.loadWeights(w);
        showToast('💙 загружены веса ЭЙСа (учитель)');
      }
    } catch { /* optional */ }

    // Try load previous state
    const prev = loadState();
    if (prev) {
      try {
        if (prev.brains?.red)  this.agents.red.brain.fromJSON(prev.brains.red);
        if (prev.brains?.blue) this.agents.blue.brain.fromJSON(prev.brains.blue);
        if (prev.champions)    this.evo.champions = prev.champions;
        if (prev.epoch)        this.epoch = prev.epoch;
        showToast('🎯 загружено сохранение');
      } catch (e) { console.warn('restore fail', e); }
    }

    this._bindUI();
    this.switchView('world');
    requestAnimationFrame(() => this._animate());

    // Автосохранение каждые 45 сек.
    setInterval(() => this._saveAll(), 45000);

    // скрыть лоадер
    setTimeout(() => {
      const loading = document.getElementById('loading-screen');
      if (loading) loading.classList.add('hidden');
    }, 600);
  }

  switchView(gameKey) {
    if (!this.games[gameKey]) return;
    if (this.currentGame) this.currentGame.teardown();
    this.world.clear();
    this.currentGameKey = gameKey;
    this.currentGame = this.games[gameKey];
    this.currentGame.setup();

    document.querySelectorAll('[data-nav]').forEach(b => {
      b.classList.toggle('active', b.dataset.nav === gameKey);
    });
  }

  _bindUI() {
    // Navigation
    document.querySelectorAll('[data-nav]').forEach(b => {
      b.addEventListener('click', () => this.switchView(b.dataset.nav));
    });

    // Camera
    document.querySelectorAll('[data-cam]').forEach(b => {
      b.addEventListener('click', () => {
        this.world.setCameraMode(b.dataset.cam, this.agents);
        document.querySelectorAll('[data-cam]').forEach(x => x.classList.toggle('active', x === b));
      });
    });

    // Speed
    document.querySelectorAll('[data-speed]').forEach(b => {
      b.addEventListener('click', () => {
        this.speed = parseFloat(b.dataset.speed);
        document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('active', x === b));
      });
    });

    // Agent controls
    document.getElementById('red-sleep')?.addEventListener('click', () => this.agents.red.goSleep());
    document.getElementById('red-wake')?.addEventListener('click',  () => this.agents.red.wakeUp());
    document.getElementById('blue-sleep')?.addEventListener('click', () => this.agents.blue.goSleep());
    document.getElementById('blue-wake')?.addEventListener('click',  () => this.agents.blue.wakeUp());

    document.getElementById('teach-btn')?.addEventListener('click', () => this._teachRedFromBlue());
    document.getElementById('boost-btn')?.addEventListener('click', () => this._boost());

    // Save/load/reset
    document.getElementById('save-btn')?.addEventListener('click',  () => { this._saveAll(); showToast('💾 сохранено'); });
    document.getElementById('load-btn')?.addEventListener('click',  () => {
      const p = loadState();
      if (!p) return showToast('нет сохранений');
      try {
        if (p.brains?.red)  this.agents.red.brain.fromJSON(p.brains.red);
        if (p.brains?.blue) this.agents.blue.brain.fromJSON(p.brains.blue);
        if (p.champions)    this.evo.champions = p.champions;
        showToast('📥 загружено');
      } catch (e) { showToast('ошибка загрузки'); }
    });
    document.getElementById('reset-btn')?.addEventListener('click', () => {
      if (!confirm('Сбросить мозги и чемпионов?')) return;
      this.agents.red.brain  = new Brain({ skill: 0.05, epsilon: 0.9,  lr: 0.0018, name: 'КЕЙН' });
      this.agents.blue.brain = new Brain({ skill: 0.92, epsilon: 0.05, lr: 0.0006, name: 'ЭЙС' });
      this.evo = new EvolutionManager();
      clearState();
      showToast('🧼 полный reset');
    });

    // Stats modal
    document.getElementById('stats-btn')?.addEventListener('click', () => {
      this._refreshStatsModal();
      openModal('stats-modal');
    });
    document.getElementById('stats-close')?.addEventListener('click', () => closeModal('stats-modal'));

    // Multi-sim modal
    document.getElementById('multisim-btn')?.addEventListener('click', () => this._openMultiSim());
    document.getElementById('multisim-close')?.addEventListener('click', () => closeModal('multisim-modal'));
    document.getElementById('multisim-run')?.addEventListener('click', () => this._runMultiSim());

    // Megatrain modal
    document.getElementById('megatrain-btn')?.addEventListener('click', () => openModal('megatrain-modal'));
    document.getElementById('megatrain-close')?.addEventListener('click', () => closeModal('megatrain-modal'));
    document.getElementById('megatrain-run')?.addEventListener('click', () => this._runMegatrain());

    // Evolution modal
    document.getElementById('evo-btn')?.addEventListener('click', () => {
      renderEvoTable(this.evo, document.getElementById('evo-table-host'));
      openModal('evo-modal');
    });
    document.getElementById('evo-close')?.addEventListener('click', () => closeModal('evo-modal'));
    document.getElementById('evo-apply-red')?.addEventListener('click', () => this._applyChampion('red'));
    document.getElementById('evo-apply-blue')?.addEventListener('click', () => this._applyChampion('blue'));
  }

  _applyChampion(color) {
    if (!this.currentGameKey) return showToast('сначала выберите игру');
    const ok = this.evo.applyChampion(this.agents[color].brain, color, this.currentGameKey);
    showToast(ok ? `✨ ${color} → чемпион ${this.currentGameKey}` : 'нет чемпиона');
  }

  _teachRedFromBlue() {
    const batches = 20;
    const blue = this.agents.blue.brain;
    const red  = this.agents.red.brain;
    let lossSum = 0, cnt = 0;
    for (let i = 0; i < batches; i++) {
      // блю генерирует «учителя» — случайные состояния, в которых выбирает действия
      const STATE_DIM = 48;
      const dummy = new Float32Array(STATE_DIM);
      for (let k = 0; k < STATE_DIM; k++) dummy[k] = (Math.random() * 2 - 1) * 0.35;
      const teacherA = blue.act(dummy, false);
      const loss = red.learnFromTeacher(dummy, teacherA, 0.7);
      if (Number.isFinite(loss)) { lossSum += loss; cnt++; }
    }
    showToast(`📚 красный учился (${cnt} батчей, loss ${(lossSum / Math.max(1, cnt)).toFixed(3)})`);
  }

  _boost() {
    const rd = this.agents.red.brain.boostLearn(28);
    const bu = this.agents.blue.brain.boostLearn(14);
    showToast(`⚡ boost red ${rd.toFixed(3)}, blue ${bu.toFixed(3)}`);
  }

  _saveAll() {
    saveState({
      epoch: this.epoch,
      timestamp: Date.now(),
      champions: this.evo.champions,
      brains: {
        red:  this.agents.red.brain.toJSON(),
        blue: this.agents.blue.brain.toJSON()
      }
    });
  }

  _openMultiSim() {
    // заполнить селектор игр
    const sel = document.getElementById('multisim-game');
    if (sel && sel.options.length === 0) {
      ['maze','flappy','escape','sandbox','world'].forEach(g => {
        const o = document.createElement('option'); o.value = g; o.textContent = g; sel.appendChild(o);
      });
    }
    const colorSel = document.getElementById('multisim-color');
    if (colorSel && colorSel.options.length === 0) {
      ['red','blue'].forEach(c => {
        const o = document.createElement('option'); o.value = c; o.textContent = c === 'red' ? 'КЕЙН (красный)' : 'ЭЙС (синий)'; colorSel.appendChild(o);
      });
    }
    openModal('multisim-modal');
  }

  async _runMultiSim() {
    const game = document.getElementById('multisim-game').value;
    const color = document.getElementById('multisim-color').value;
    const pop = parseInt(document.getElementById('multisim-pop').value, 10) || 8;
    const eps = parseInt(document.getElementById('multisim-eps').value, 10) || 2;
    const host = document.getElementById('multisim-progress');
    host.textContent = 'запуск…';

    const brain = this.agents[color].brain;
    const before = evaluate(brain, SIM_GAMES[game], 3);

    const result = await this.multiSim.run({
      brain, game, population: pop, episodesPerClone: eps, mutationSigma: 0.03,
      maxStepsPerEp: 600,
      onProgress: (p, msg) => host.textContent = `[${(p * 100).toFixed(0)}%] ${msg}`
    });

    const winnerBrain = result.winner.brain;
    const winnerScore = result.winner.bestScore;
    const after = evaluate(winnerBrain, SIM_GAMES[game], 3);

    // регистрируем в Evolution
    const rec = this.evo.recordRun(color, game, winnerScore, winnerBrain);

    host.innerHTML = `
      <div>Завершено — популяция ${pop}, эпизодов/клон ${eps}</div>
      <div>До: лучш ${before.best.toFixed(2)}, ср ${before.avg.toFixed(2)}</div>
      <div>После: лучш ${after.best.toFixed(2)}, ср ${after.avg.toFixed(2)}</div>
      <div>Чемпион: <b>${winnerScore.toFixed(2)}</b> (gen ${winnerBrain.generation || 1})</div>
      <div class="${rec.improved ? 'pos' : 'neu'}">${rec.improved ? '✔ побит рекорд!' : 'рекорд не побит — оставляем прежнего чемпиона'}</div>
      <div class="topN">${(result.rows || []).slice(0, 5).map((t, i) => `${i + 1}. id ${t.id}, best ${t.best?.toFixed(2) ?? '—'}, avgR ${t.avgR?.toFixed(2) ?? '—'}`).join('<br>')}</div>
      <div class="mega-act">
        <button class="btn sm primary" id="multisim-adopt">✔ Заменить текущего ${color} на чемпиона</button>
      </div>
    `;

    document.getElementById('multisim-adopt')?.addEventListener('click', () => {
      this.agents[color].brain.adopt(winnerBrain);
      showToast(`🏆 ${color} → чемпион ${game}`);
    });
  }

  async _runMegatrain() {
    const mins = parseFloat(document.getElementById('megatrain-mins').value) || 3;
    const host = document.getElementById('megatrain-progress');
    const report = document.getElementById('megatrain-report');
    host.textContent = 'запуск мегатренинга…';
    report.innerHTML = '';

    const useRed = document.getElementById('megatrain-who').value === 'red';
    const color = useRed ? 'red' : 'blue';
    const brain = this.agents[color].brain;

    const res = await this.megatrain.run({
      brain,
      totalMinutes: mins,
      multiSimEach: true,
      onProgress: (p, msg) => host.textContent = `[${(p * 100).toFixed(0)}%] ${msg}`
    });
    this.lastReport = res;

    renderRunReport(res, report, (game) => {
      // принять лучшего по конкретной игре
      const row = res.perGame[game];
      if (row?.evoBest?.brainJSON) {
        this.agents[color].brain.fromJSON(row.evoBest.brainJSON);
        // регистрируем чемпиона
        this.evo.recordRun(color, game, row.evoBest.score, this.agents[color].brain);
        showToast(`✔ применён лучший агент на ${game} (${row.evoBest.score.toFixed(2)})`);
      } else {
        // без evo — просто оставляем обученный
        showToast(`обучение на ${game} принято (без evo-чемпиона)`);
      }
    });
    host.textContent = 'готово.';
  }

  _refreshStatsModal() {
    const canvasR = document.getElementById('brain-canvas-red');
    const canvasB = document.getElementById('brain-canvas-blue');
    drawNetwork(canvasR, this.agents.red.brain,  '#ff6080');
    drawNetwork(canvasB, this.agents.blue.brain, '#4fd8ff');

    const memR = document.getElementById('mem-red');
    const memB = document.getElementById('mem-blue');
    const fmt = (m) => {
      if (!m?.length) return '<li class="empty">пусто</li>';
      return m.slice(-8).map(e => `<li>${e.title || 'event'} · r=${(e.reward || 0).toFixed(2)}</li>`).join('');
    };
    if (memR) memR.innerHTML = fmt(this.agents.red.brain.episodic || []);
    if (memB) memB.innerHTML = fmt(this.agents.blue.brain.episodic || []);

    const info = getSaveInfo();
    const si = document.getElementById('save-info');
    if (si) si.textContent = info ? `сохр. ${(info.size / 1024).toFixed(1)} КБ, чемп: ${info.champions}` : 'нет сохранения';
  }

  _animate() {
    const now = performance.now();
    const rawDt = (now - this.lastT) / 1000;
    this.lastT = now;
    const dt = Math.min(0.1, rawDt) * this.speed;
    this.frame++;
    this.fpsAccum += rawDt;
    this.fpsCount++;
    if (this.fpsAccum > 0.5) {
      this.fps = this.fpsCount / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsCount = 0;
    }

    // Update agents (kinematic side)
    if (!this.agents.red.ragdoll)  this.agents.red.update(dt);
    if (!this.agents.blue.ragdoll) this.agents.blue.update(dt);

    // Step active game
    if (this.currentGame?.active) {
      this.currentGame.step(dt);
      // Регистрируем рекорды (для Evo)
      this._autoRegisterScores();
    }

    // Floaters / camera
    this.world.updateFloaters(dt);
    this.world.updateCamera(dt, this.agents);
    this.world.render();

    // HUD
    this._updateHUD();

    if (this.frame % 60 === 0) this.epoch += 1;
    requestAnimationFrame(() => this._animate());
  }

  _autoRegisterScores() {
    const g = this.currentGameKey;
    if (!g || !this.currentGame) return;
    // Раз в ~300 кадров регистрируем лучший счёт каждого агента
    if (this.frame % 300 !== 0) return;

    const cg = this.currentGame;
    const scores = { red: 0, blue: 0 };
    if (g === 'flappy') {
      scores.red  = cg.best?.red  ?? 0;
      scores.blue = cg.best?.blue ?? 0;
    } else if (g === 'maze') {
      scores.red  = cg.left?.wins  ?? 0;
      scores.blue = cg.right?.wins ?? 0;
    } else if (g === 'escape') {
      scores.red  = cg.left?.score  ?? 0;
      scores.blue = cg.right?.score ?? 0;
    } else if (g === 'sandbox') {
      scores.red  = cg.placed?.red  ?? 0;
      scores.blue = cg.placed?.blue ?? 0;
    } else if (g === 'world') {
      scores.red  = cg.totalCollected?.red  ?? 0;
      scores.blue = cg.totalCollected?.blue ?? 0;
    }
    for (const color of ['red', 'blue']) {
      const s = scores[color];
      if (s <= 0) continue;
      const rec = this.evo.recordRun(color, g, s, this.agents[color].brain);
      if (rec.improved) showToast(`🏆 новый рекорд ${color} на ${g}: ${s}`);
    }
  }

  _updateHUD() {
    updateAICard('red',  this.agents.red.brain);
    updateAICard('blue', this.agents.blue.brain);

    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('fps', this.fps.toFixed(0));
    set('frame', this.frame.toString());
    set('epoch', this.epoch.toString());
    set('loss',  (this.agents.red.brain.tdErrEMA || 0).toFixed(4));
    set('speed-ind', `${this.speed}×`);

    const busSize = SharedBus?.replay?.size || 0;
    set('bus', busSize.toString());
    const epochF = document.getElementById('epoch-f');
    if (epochF) epochF.textContent = this.epoch.toString();

    const hudEl = document.getElementById('game-hud');
    if (hudEl && this.currentGame) hudEl.innerHTML = this.currentGame.getHUD();
  }
}

// start
const ctrl = new Controller();
window.__DC_CTRL = ctrl;
ctrl.init();
