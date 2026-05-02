/**
 * Digital Circus AI 3.0 — главный контроллер.
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

import { World } from './world.js';
import { Agent } from './ai/agent.js';
import { Brain, SharedBus } from './ai/brain.js';
import { curriculum } from './ai/curriculum.js';
import { EvolutionManager } from './ai/evolution.js';

import { MultiSim } from './sim/multiSim.js';
import { Megatrain } from './sim/megaTrain.js';
import { GAMES as SIM_GAMES, evaluate } from './sim/headlessSims.js';

import { WorldGame } from './games/worldGame.js';
import { FlappyGame } from './games/flappyGame.js';
import { MazeGame } from './games/mazeGame.js';
import { SandboxGame } from './games/sandboxGame.js';
import { EscapeGame } from './games/escapeGame.js';

import {
  drawNetwork,
  updateAICard,
  showToast,
  openModal,
  closeModal,
  renderEvoTable,
  renderRunReport
} from './ui.js';

import {
  saveState,
  loadState,
  clearState,
  getSaveInfo
} from './save.js';

console.log("✅ MAIN.JS STARTED");

class Controller {
  constructor() {

    this.container = document.getElementById('canvas-container');

    this.world = new World(this.container);

    this.agents = {

      red: new Agent({
        id: 0,
        name: 'КЕЙН',
        color: 'red',

        brain: new Brain({
          skill: 0.05,
          epsilon: 0.9,
          lr: 0.0018,
          name: 'КЕЙН'
        }),

        position: { x: -3, z: 0 }
      }),

      blue: new Agent({
        id: 1,
        name: 'ЭЙС',
        color: 'blue',

        brain: new Brain({
          skill: 0.92,
          epsilon: 0.05,
          lr: 0.0006,
          name: 'ЭЙС'
        }),

        position: { x: 3, z: 0 }
      })
    };

    this.world.addAgent(this.agents.red);
    this.world.addAgent(this.agents.blue);

    this.evo = new EvolutionManager();

    this.games = {
      world: new WorldGame(this.world, this.agents),
      flappy: new FlappyGame(this.world, this.agents),
      maze: new MazeGame(this.world, this.agents),
      sandbox: new SandboxGame(this.world, this.agents),
      escape: new EscapeGame(this.world, this.agents)
    };

    this.currentGame = null;
    this.currentGameKey = null;

    this.speed = 1;

    this.lastT = performance.now();

    this.fps = 60;
    this.frame = 0;
    this.epoch = 1;

    this.multiSim = new MultiSim();
    this.megatrain = new Megatrain();

    this._lastScoreLog = {};
  }

  async init() {

    try {

      const resp = await fetch('./js/ai/blue_weights.json');

      if (resp.ok) {

        const w = await resp.json();

        this.agents.blue.brain.loadWeights(w);

        showToast('💙 weights loaded');
      }

    } catch (e) {

      console.warn("weights not loaded", e);

    }

    try {

      const prev = loadState();

      if (prev) {

        if (prev.brains?.red) {
          this.agents.red.brain.fromJSON(prev.brains.red);
        }

        if (prev.brains?.blue) {
          this.agents.blue.brain.fromJSON(prev.brains.blue);
        }

        if (prev.champions) {
          this.evo.champions = prev.champions;
        }

        showToast('🎯 save restored');
      }

    } catch (e) {

      console.warn("restore failed", e);

    }

    this._bindUI();

    this.switchView('world');

    requestAnimationFrame(() => this._animate());

    setInterval(() => this._saveAll(), 45000);

    setTimeout(() => {

      const loading = document.getElementById('loading-screen');

      if (loading) {
        loading.classList.add('hidden');
      }

    }, 600);
  }

  switchView(gameKey) {

    if (!this.games[gameKey]) return;

    if (this.currentGame) {
      this.currentGame.teardown();
    }

    this.world.clear();

    this.currentGameKey = gameKey;

    this.currentGame = this.games[gameKey];

    this.currentGame.setup();

    document.querySelectorAll('[data-nav]').forEach(btn => {

      btn.classList.toggle(
        'active',
        btn.dataset.nav === gameKey
      );

    });
  }

  _bindUI() {

    document.querySelectorAll('[data-nav]').forEach(btn => {

      btn.addEventListener('click', () => {

        this.switchView(btn.dataset.nav);

      });

    });

    document.querySelectorAll('[data-speed]').forEach(btn => {

      btn.addEventListener('click', () => {

        this.speed = parseFloat(btn.dataset.speed);

      });

    });

    document.getElementById('save-btn')
      ?.addEventListener('click', () => {

        this._saveAll();

        showToast('💾 saved');

      });

    document.getElementById('load-btn')
      ?.addEventListener('click', () => {

        location.reload();

      });

    document.getElementById('reset-btn')
      ?.addEventListener('click', () => {

        clearState();

        location.reload();

      });
  }

  _saveAll() {

    saveState({

      epoch: this.epoch,

      timestamp: Date.now(),

      champions: this.evo.champions,

      brains: {

        red: this.agents.red.brain.toJSON(),

        blue: this.agents.blue.brain.toJSON()
      }

    });
  }

  _animate() {

    try {

      const now = performance.now();

      const rawDt = (now - this.lastT) / 1000;

      this.lastT = now;

      const dt = Math.min(0.1, rawDt) * this.speed;

      this.frame++;

      if (!this.agents.red.ragdoll) {
        this.agents.red.update(dt);
      }

      if (!this.agents.blue.ragdoll) {
        this.agents.blue.update(dt);
      }

      if (this.currentGame?.active) {
        this.currentGame.step(dt);
      }

      this.world.updateFloaters(dt);

      this.world.updateCamera(dt, this.agents);

      this.world.render();

      this._updateHUD();

    } catch (err) {

      console.error("ANIMATE ERROR", err);

      const loading = document.getElementById('loading-screen');

      if (loading) {

        loading.innerHTML = `
          <div style="
            color:red;
            background:black;
            padding:20px;
            font-family:monospace;
            overflow:auto;
            height:100vh;
          ">
            <h1>❌ Runtime Error</h1>
            <pre>${err.stack}</pre>
          </div>
        `;
      }
    }

    requestAnimationFrame(() => this._animate());
  }

  _updateHUD() {

    try {

      updateAICard('red', this.agents.red.brain);

      updateAICard('blue', this.agents.blue.brain);

      const set = (id, value) => {

        const el = document.getElementById(id);

        if (el) {
          el.textContent = value;
        }
      };

      set('frame', this.frame.toString());

      set('epoch', this.epoch.toString());

      set('speed-ind', `${this.speed}×`);

      const busSize = SharedBus?.replay?.size || 0;

      set('bus', busSize.toString());

    } catch (e) {

      console.warn("HUD ERROR", e);

    }
  }
}

// start
const ctrl = new Controller();

window.__DC_CTRL = ctrl;

ctrl.init();
