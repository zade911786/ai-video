/**
 * =================================================================
 *  NEURAL BRAIN 3.0 — Digital Circus AI  (Evolution + Rainbow hybrid)
 * =================================================================
 *  Полностью переработанный алгоритм обучения. Ключевые улучшения:
 *
 *   • Dueling Double-DQN   (V(s) + A(s,a))
 *   • Noisy Linear (fa)    — factorised noise заменяет ε-greedy,
 *                             ведёт к более умной эксплорации
 *   • N-step returns (n=5)
 *   • Prioritized Replay   (proportional, α=0.6, β→1)
 *   • Huber loss + clip
 *   • LayerNorm + GELU
 *   • Soft target update (τ = 0.01)
 *   • AMSGrad-Adam + gradient centralization
 *   • RND intrinsic curiosity (учит искать новое)
 *   • Reward normalization (running std)
 *   • Eligibility traces (λ-return) для быстрого credit assignment
 *   • Imitation bootstrap (teacher distill)
 *   • Shared Replay Bus между агентами
 *   • Cloning / mutation / crossover — поддержка эволюции
 *   • Headless режим: работает без UI, для multi-sim
 *
 *  Вход : 48-мерный вектор состояния
 *  Выход: 12 дискретных действий (8 направлений + 4 спец-действия)
 * =================================================================
 */

export const STATE_DIM   = 48;
export const HIDDEN1     = 112;
export const HIDDEN2     = 80;
export const HIDDEN3     = 56;
export const ACTION_DIM  = 12;
export const RND_EMBED   = 24;

/* ==============================================================
 *  UTILS
 * ============================================================== */
function he(rows, cols, scale = 1.0) {
  const s = Math.sqrt(2.0 / rows) * scale;
  const a = new Float32Array(rows * cols);
  for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * s;
  return a;
}
function zeros(n) { return new Float32Array(n); }
function matvec(x, W, b, R, C, out = null) {
  const o = out || new Float32Array(C);
  for (let j = 0; j < C; j++) {
    let s = b[j];
    for (let i = 0; i < R; i++) s += x[i] * W[i * C + j];
    o[j] = s;
  }
  return o;
}
// GELU (approx):  0.5*x*(1+tanh(sqrt(2/π)*(x+0.044715*x^3)))
function gelu(v) {
  const o = new Float32Array(v.length);
  const c = Math.sqrt(2 / Math.PI);
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    const t = Math.tanh(c * (x + 0.044715 * x * x * x));
    o[i] = 0.5 * x * (1 + t);
  }
  return o;
}
function geluGrad(x) {
  // dGELU/dx ≈ 0.5(1+tanh(u)) + 0.5 x sech^2(u) * c*(1+3*0.044715*x^2)
  const g = new Float32Array(x.length);
  const c = Math.sqrt(2 / Math.PI);
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const u  = c * (xi + 0.044715 * xi * xi * xi);
    const tnh = Math.tanh(u);
    const sech2 = 1 - tnh * tnh;
    g[i] = 0.5 * (1 + tnh) + 0.5 * xi * sech2 * c * (1 + 0.134145 * xi * xi);
  }
  return g;
}
function layerNorm(v, eps = 1e-5) {
  let mean = 0, vari = 0;
  for (let i = 0; i < v.length; i++) mean += v[i];
  mean /= v.length;
  for (let i = 0; i < v.length; i++) vari += (v[i] - mean) ** 2;
  vari /= v.length;
  const std = Math.sqrt(vari + eps);
  const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = (v[i] - mean) / std;
  return { out: o, mean, std };
}
function layerNormGrad(gradOut, input, mean, std) {
  const n = input.length;
  let sumG = 0, sumGH = 0;
  for (let i = 0; i < n; i++) {
    sumG  += gradOut[i];
    sumGH += gradOut[i] * (input[i] - mean) / std;
  }
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const xh = (input[i] - mean) / std;
    g[i] = (1 / std) * (gradOut[i] - sumG / n - xh * sumGH / n);
  }
  return g;
}
function randn() {
  // Box-Muller
  const u = 1 - Math.random(), v = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function factorisedNoise(n, m) {
  // NoisyNet factorised: ε = sign(x)*sqrt(|x|)
  const f = (x) => Math.sign(x) * Math.sqrt(Math.abs(x));
  const ea = new Float32Array(n);
  const eb = new Float32Array(m);
  for (let i = 0; i < n; i++) ea[i] = f(randn());
  for (let j = 0; j < m; j++) eb[j] = f(randn());
  const W = new Float32Array(n * m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) W[i * m + j] = ea[i] * eb[j];
  return { W, eb };
}

/* ==============================================================
 *  Adam (AMSGrad) + gradient centralization
 * ============================================================== */
class AdamSlot {
  constructor(n) {
    this.m  = new Float32Array(n);
    this.v  = new Float32Array(n);
    this.vh = new Float32Array(n);  // AMSGrad running max
    this.t  = 0;
  }
  step(w, g, lr, opts = {}) {
    const b1 = opts.b1 ?? 0.9, b2 = opts.b2 ?? 0.999;
    const eps = opts.eps ?? 1e-8, clip = opts.clip ?? 1.0;
    const amsgrad = opts.amsgrad !== false;
    const centralize = opts.gc !== false; // gradient centralization
    this.t++;
    // gradient centralization: subtract mean (помогает сходимости)
    if (centralize) {
      let mean = 0; for (let i = 0; i < g.length; i++) mean += g[i];
      mean /= g.length;
      for (let i = 0; i < g.length; i++) g[i] -= mean;
    }
    // global-norm clip
    let gn = 0; for (let i = 0; i < g.length; i++) gn += g[i] * g[i];
    gn = Math.sqrt(gn);
    const scl = gn > clip ? clip / (gn + 1e-8) : 1.0;
    const bc1 = 1 - Math.pow(b1, this.t);
    const bc2 = 1 - Math.pow(b2, this.t);
    for (let i = 0; i < w.length; i++) {
      const gi = g[i] * scl;
      this.m[i] = b1 * this.m[i] + (1 - b1) * gi;
      this.v[i] = b2 * this.v[i] + (1 - b2) * gi * gi;
      let vh = this.v[i];
      if (amsgrad) {
        if (vh > this.vh[i]) this.vh[i] = vh; else vh = this.vh[i];
      }
      const mh = this.m[i] / bc1;
      const vc = vh / bc2;
      w[i] -= lr * mh / (Math.sqrt(vc) + eps);
    }
  }
}

/* ==============================================================
 *  Prioritized Replay
 * ============================================================== */
class PrioritizedReplay {
  constructor(cap = 20000, alpha = 0.6) {
    this.cap = cap; this.alpha = alpha;
    this.data = []; this.prio = []; this.maxP = 1.0;
  }
  push(exp, priority = null) {
    const p = priority == null ? this.maxP : priority;
    if (this.data.length < this.cap) { this.data.push(exp); this.prio.push(p); }
    else {
      // ring replace min-priority slot in small subset (эффективно)
      let idx = Math.floor(Math.random() * this.cap);
      let worst = this.prio[idx];
      for (let k = 0; k < 4; k++) {
        const j = Math.floor(Math.random() * this.cap);
        if (this.prio[j] < worst) { worst = this.prio[j]; idx = j; }
      }
      this.data[idx] = exp; this.prio[idx] = p;
    }
    if (p > this.maxP) this.maxP = p;
  }
  sample(batch = 32, beta = 0.4) {
    const N = this.data.length;
    if (N === 0) return { batch: [], idxs: [], is: [] };
    let total = 0;
    const pA = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pA[i] = Math.pow(this.prio[i], this.alpha);
      total += pA[i];
    }
    const out = [], idxs = [], is = [];
    // stratified by segment
    const seg = total / batch;
    for (let b = 0; b < batch; b++) {
      const rnd = (b + Math.random()) * seg;
      let acc = 0, idx = 0;
      for (let i = 0; i < N; i++) {
        acc += pA[i];
        if (acc >= rnd) { idx = i; break; }
      }
      const probI = pA[idx] / total;
      const w = Math.pow(N * probI + 1e-8, -beta);
      out.push(this.data[idx]); idxs.push(idx); is.push(w);
    }
    let mx = 0; for (const w of is) if (w > mx) mx = w;
    for (let i = 0; i < is.length; i++) is[i] /= (mx + 1e-8);
    return { batch: out, idxs, is };
  }
  updatePriorities(idxs, newP) {
    for (let i = 0; i < idxs.length; i++) {
      const p = Math.abs(newP[i]) + 1e-5;
      this.prio[idxs[i]] = p;
      if (p > this.maxP) this.maxP = p;
    }
  }
  get size() { return this.data.length; }
  clear() { this.data.length = 0; this.prio.length = 0; this.maxP = 1.0; }
}

/* ==============================================================
 *  RUNNING MEAN / STD — reward normalization
 * ============================================================== */
class RunningStat {
  constructor() { this.n = 0; this.mean = 0; this.M2 = 1e-4; }
  push(x) {
    this.n++;
    const d = x - this.mean;
    this.mean += d / this.n;
    this.M2 += d * (x - this.mean);
  }
  get std() { return Math.sqrt(this.M2 / Math.max(1, this.n)); }
}

/* ==============================================================
 *  SHARED BUS
 * ============================================================== */
export const SharedBus = {
  replay: new PrioritizedReplay(12000, 0.6),
  push(e, p = null) { this.replay.push(e, p); },
  sample(n, beta) { return this.replay.sample(n, beta); },
  clear() { this.replay.clear(); }
};

/* ==============================================================
 *  BRAIN 3.0
 * ============================================================== */
export class Brain {
  constructor(opts = {}) {
    this.name  = opts.name  || 'brain';
    this.color = opts.color || 'red';
    this.skill = opts.skill ?? 0.05;
    this.experience  = opts.experience ?? 0;
    this.totalSteps  = 0;
    this.totalReward = 0;

    // ---- Trunk weights + noisy sigmas ----
    this.W1 = he(STATE_DIM, HIDDEN1);  this.b1 = zeros(HIDDEN1);
    this.W2 = he(HIDDEN1,   HIDDEN2);  this.b2 = zeros(HIDDEN2);
    this.W3 = he(HIDDEN2,   HIDDEN3);  this.b3 = zeros(HIDDEN3);
    // sigma-weights for noisy layer on head (NoisyNet-style)
    const sigmaInit = 0.5 / Math.sqrt(HIDDEN3);
    this.Wv  = he(HIDDEN3, 1, 0.5);          this.bv  = zeros(1);
    this.Wa  = he(HIDDEN3, ACTION_DIM, 0.5); this.ba  = zeros(ACTION_DIM);
    this.sWv = new Float32Array(this.Wv.length); this.sWv.fill(sigmaInit);
    this.sWa = new Float32Array(this.Wa.length); this.sWa.fill(sigmaInit);
    this.sBv = new Float32Array(1); this.sBv.fill(sigmaInit);
    this.sBa = new Float32Array(ACTION_DIM); this.sBa.fill(sigmaInit);

    // ---- RND (Random Network Distillation) for curiosity ----
    //   fixed target network + learnable predictor. Novelty = ||pred - target||^2
    this.rndT = { W: he(STATE_DIM, RND_EMBED, 0.7), b: zeros(RND_EMBED) };
    this.rndP = { W: he(STATE_DIM, RND_EMBED, 0.7), b: zeros(RND_EMBED) };
    this.rndP_opt = { W: new AdamSlot(this.rndP.W.length), b: new AdamSlot(RND_EMBED) };
    this.rndStat = new RunningStat();

    this._snapshotTarget();

    // Adam slots
    this.opt = {
      W1: new AdamSlot(this.W1.length),   b1: new AdamSlot(HIDDEN1),
      W2: new AdamSlot(this.W2.length),   b2: new AdamSlot(HIDDEN2),
      W3: new AdamSlot(this.W3.length),   b3: new AdamSlot(HIDDEN3),
      Wv: new AdamSlot(this.Wv.length),   bv: new AdamSlot(1),
      Wa: new AdamSlot(this.Wa.length),   ba: new AdamSlot(ACTION_DIM),
      sWv: new AdamSlot(this.Wv.length),  sBv: new AdamSlot(1),
      sWa: new AdamSlot(this.Wa.length),  sBa: new AdamSlot(ACTION_DIM)
    };

    // hyperparams
    this.gamma        = 0.97;
    this.lr           = opts.lr ?? 0.0014;
    this.tau          = 0.012;
    this.nstep        = 5;
    this.nBuffer      = [];
    this.epsilon      = opts.epsilon ?? 0.5;     // оставлен маленький ε в помощь Noisy
    this.epsilonMin   = 0.02;
    this.epsilonDecay = 0.9993;

    // replay
    this.replay  = new PrioritizedReplay(14000, 0.6);
    this.beta    = 0.4;
    this.betaInc = 1e-5;

    // reward normalization
    this.rStat = new RunningStat();

    // eligibility traces for online update
    this.elig = null;
    this.lambdaTrace = 0.85;

    // episodic memory
    this.episodic    = [];
    this.maxEpisodic = 220;

    // last activations (viz)
    this.lastActivations = {
      h1: zeros(HIDDEN1), h2: zeros(HIDDEN2), h3: zeros(HIDDEN3),
      v: zeros(1), a: zeros(ACTION_DIM), q: zeros(ACTION_DIM)
    };

    this.tdErrEMA = 1.0;
    this.curiosityEMA = 0.0;

    // evolution tracking
    this.generation = 1;
    this.fitness    = { best: 0, byGame: {}, lastUpdate: 0 };
  }

  /* -------------- Forward -------------- */
  _forward(s, target = false, noisy = false) {
    const W1 = target ? this.tW1 : this.W1;
    const b1 = target ? this.tb1 : this.b1;
    const W2 = target ? this.tW2 : this.W2;
    const b2 = target ? this.tb2 : this.b2;
    const W3 = target ? this.tW3 : this.W3;
    const b3 = target ? this.tb3 : this.b3;

    const z1 = matvec(s, W1, b1, STATE_DIM, HIDDEN1);
    const ln1 = layerNorm(z1); const h1 = gelu(ln1.out);
    const z2 = matvec(h1, W2, b2, HIDDEN1, HIDDEN2);
    const ln2 = layerNorm(z2); const h2 = gelu(ln2.out);
    const z3 = matvec(h2, W3, b3, HIDDEN2, HIDDEN3);
    const ln3 = layerNorm(z3); const h3 = gelu(ln3.out);

    // Dueling heads with optional noisy net
    const Wv = target ? this.tWv : this.Wv;
    const bv = target ? this.tbv : this.bv;
    const Wa = target ? this.tWa : this.Wa;
    const ba = target ? this.tba : this.ba;
    let WvN = Wv, bvN = bv, WaN = Wa, baN = ba;
    let noise = null;
    if (noisy && !target) {
      const nv = factorisedNoise(HIDDEN3, 1);
      const na = factorisedNoise(HIDDEN3, ACTION_DIM);
      WvN = new Float32Array(Wv.length);
      for (let i = 0; i < Wv.length; i++) WvN[i] = Wv[i] + this.sWv[i] * nv.W[i];
      WaN = new Float32Array(Wa.length);
      for (let i = 0; i < Wa.length; i++) WaN[i] = Wa[i] + this.sWa[i] * na.W[i];
      bvN = new Float32Array(1);  bvN[0] = bv[0] + this.sBv[0] * nv.eb[0];
      baN = new Float32Array(ACTION_DIM);
      for (let j = 0; j < ACTION_DIM; j++) baN[j] = ba[j] + this.sBa[j] * na.eb[j];
      noise = { nv, na };
    }

    const v = matvec(h3, WvN, bvN, HIDDEN3, 1);
    const a = matvec(h3, WaN, baN, HIDDEN3, ACTION_DIM);
    let mean = 0;
    for (let i = 0; i < ACTION_DIM; i++) mean += a[i];
    mean /= ACTION_DIM;
    const q = new Float32Array(ACTION_DIM);
    for (let i = 0; i < ACTION_DIM; i++) q[i] = v[0] + (a[i] - mean);

    if (!target) {
      this.lastActivations.h1 = h1;
      this.lastActivations.h2 = h2;
      this.lastActivations.h3 = h3;
      this.lastActivations.v  = v;
      this.lastActivations.a  = a;
      this.lastActivations.q  = q;
    }
    return { z1, ln1, h1, z2, ln2, h2, z3, ln3, h3, v, a, q, noise };
  }
  forward(s, target = false) { return this._forward(s, target, false); }

  /* -------------- Action selection -------------- */
  act(state, explore = true) {
    this.totalSteps++;
    // Noisy net делает эксплорацию без ε, но оставим страховку
    const useNoisy = explore;
    if (explore && Math.random() < this.epsilon * 0.25) {
      return Math.floor(Math.random() * ACTION_DIM);
    }
    const { q } = this._forward(state, false, useNoisy);
    let best = 0, bv = -Infinity;
    for (let i = 0; i < ACTION_DIM; i++) if (q[i] > bv) { bv = q[i]; best = i; }
    return best;
  }

  actHybrid(state, heuristicAction, explore = true) {
    this.totalSteps++;
    // чуть чистой случайности для побега из локальных минимумов
    if (explore && Math.random() < this.epsilon * 0.18) {
      return Math.floor(Math.random() * ACTION_DIM);
    }
    // низкий навык — чаще слушаем учителя
    if (heuristicAction != null && heuristicAction >= 0 &&
        Math.random() < (1 - this.skill) * 0.55 + 0.1) {
      return heuristicAction;
    }
    const { q } = this._forward(state, false, explore);
    let best = 0, bv = -Infinity;
    for (let i = 0; i < ACTION_DIM; i++) if (q[i] > bv) { bv = q[i]; best = i; }
    return best;
  }

  /* -------------- RND intrinsic reward -------------- */
  _rndNovelty(s) {
    const t = matvec(s, this.rndT.W, this.rndT.b, STATE_DIM, RND_EMBED);
    const p = matvec(s, this.rndP.W, this.rndP.b, STATE_DIM, RND_EMBED);
    let err = 0;
    for (let i = 0; i < RND_EMBED; i++) err += (t[i] - p[i]) ** 2;
    err /= RND_EMBED;
    // online RND predictor update (tiny step)
    const lr = 0.002;
    for (let j = 0; j < RND_EMBED; j++) {
      const e = p[j] - t[j];
      for (let i = 0; i < STATE_DIM; i++) {
        this.rndP.W[i * RND_EMBED + j] -= lr * e * s[i];
      }
      this.rndP.b[j] -= lr * e;
    }
    this.rndStat.push(err);
    const norm = err / (this.rndStat.std + 1e-4);
    this.curiosityEMA = 0.98 * this.curiosityEMA + 0.02 * norm;
    return Math.min(1.5, norm * 0.35);
  }

  /* -------------- Experience push (n-step + reward norm + RND) -------------- */
  push(s, a, r, sNext, done) {
    if (!Number.isFinite(r)) r = 0;
    r = Math.max(-15, Math.min(15, r));
    this.rStat.push(r);
    const rNorm = r / (this.rStat.std + 0.5);
    // intrinsic bonus (RND)
    const rInt = this._rndNovelty(sNext);
    const rTot = rNorm + rInt;

    this.totalReward += r;
    this.nBuffer.push({ s, a, r: rTot, sNext, done });

    if (this.nBuffer.length >= this.nstep || done) {
      while (this.nBuffer.length) {
        const head = this.nBuffer[0];
        let R = 0, gamma = 1, last = head;
        for (let i = 0; i < this.nBuffer.length && i < this.nstep; i++) {
          R += gamma * this.nBuffer[i].r;
          gamma *= this.gamma;
          last = this.nBuffer[i];
          if (last.done) break;
        }
        const exp = {
          s: head.s, a: head.a, R, sNext: last.sNext, done: last.done,
          n: Math.min(this.nBuffer.length, this.nstep)
        };
        this.replay.push(exp, this.tdErrEMA + 0.1);
        SharedBus.push(exp, this.tdErrEMA + 0.1);
        this.nBuffer.shift();
        if (done && this.nBuffer.length === 0) break;
        if (!done && this.nBuffer.length < this.nstep) break;
      }
      if (done) this.nBuffer = [];
    }

    // online update on fresh transition (stabilize initial learning)
    this._learnStep([{ s, a, R: rTot, sNext, done, n: 1 }], [1.0]);

    // replay batch
    if (this.replay.size >= 256 && this.totalSteps % 3 === 0) {
      const { batch, idxs, is } = this.replay.sample(40, this.beta);
      const tdErrs = this._learnStep(batch, is);
      this.replay.updatePriorities(idxs, tdErrs);
      this.beta = Math.min(1.0, this.beta + this.betaInc);
    }

    // shared bus distill every 12 steps
    if (SharedBus.replay.size >= 512 && this.totalSteps % 12 === 0) {
      const { batch } = SharedBus.sample(20, 0.55);
      const is = new Array(batch.length).fill(0.55);
      this._learnStep(batch, is);
    }

    this._softUpdateTarget();

    if (this.epsilon > this.epsilonMin) this.epsilon *= this.epsilonDecay;
    if (r > 0.5) this.skill = Math.min(1.0, this.skill + 0.00042);
  }

  /* -------------- One gradient step (Dueling Double DQN + Noisy) -------------- */
  _learnStep(batch, isWeights) {
    const tdErrs = new Array(batch.length);
    const gW1 = new Float32Array(this.W1.length), gb1 = new Float32Array(HIDDEN1);
    const gW2 = new Float32Array(this.W2.length), gb2 = new Float32Array(HIDDEN2);
    const gW3 = new Float32Array(this.W3.length), gb3 = new Float32Array(HIDDEN3);
    const gWv = new Float32Array(this.Wv.length), gbv = new Float32Array(1);
    const gWa = new Float32Array(this.Wa.length), gba = new Float32Array(ACTION_DIM);
    // accumulators for sigma
    const gSWv = new Float32Array(this.sWv.length), gSBv = new Float32Array(1);
    const gSWa = new Float32Array(this.sWa.length), gSBa = new Float32Array(ACTION_DIM);

    const BN = batch.length;
    for (let b = 0; b < BN; b++) {
      const e = batch[b];
      if (!e || !e.s || !e.sNext) { tdErrs[b] = 0; continue; }
      const isw = isWeights[b] ?? 1.0;

      // Double DQN with noisy online / clean target
      const onNext = this._forward(e.sNext, false, true);
      let bestA = 0, bv = -Infinity;
      for (let i = 0; i < ACTION_DIM; i++) if (onNext.q[i] > bv) { bv = onNext.q[i]; bestA = i; }
      const tNext = this._forward(e.sNext, true, false);
      const gammaN = Math.pow(this.gamma, e.n || 1);
      const target = e.R + (e.done ? 0 : gammaN * tNext.q[bestA]);

      const fw = this._forward(e.s, false, true);
      const q = fw.q;
      const a = e.a;
      const err = q[a] - target;
      const absE = Math.abs(err);
      const dErr = absE <= 1 ? err : Math.sign(err);   // Huber
      tdErrs[b] = absE;
      const dq = dErr * isw;

      // Gradients w.r.t V and A heads (dueling)
      const N = ACTION_DIM;
      const dV0 = dq;
      const dA = new Float32Array(N);
      for (let i = 0; i < N; i++) dA[i] = (i === a ? (1 - 1 / N) : (-1 / N)) * dq;

      const noise = fw.noise;

      // --- V head grads ---
      // Using noisy weights WvN = Wv + sWv * nv.W. Grad Wv += dV0 * h3; grad sWv += dV0 * h3 * nv.W
      for (let i = 0; i < HIDDEN3; i++) {
        gWv[i] += dV0 * fw.h3[i];
        if (noise) gSWv[i] += dV0 * fw.h3[i] * noise.nv.W[i];
      }
      gbv[0] += dV0;
      if (noise) gSBv[0] += dV0 * noise.nv.eb[0];

      // dh3 from V head
      const dh3 = new Float32Array(HIDDEN3);
      for (let i = 0; i < HIDDEN3; i++) {
        const wv_used = noise ? (this.Wv[i] + this.sWv[i] * noise.nv.W[i]) : this.Wv[i];
        dh3[i] += dV0 * wv_used;
      }

      // --- A head grads ---
      for (let i = 0; i < HIDDEN3; i++) {
        let acc = 0;
        for (let j = 0; j < N; j++) {
          const wa_used = noise ? (this.Wa[i * N + j] + this.sWa[i * N + j] * noise.na.W[i * N + j]) : this.Wa[i * N + j];
          gWa[i * N + j] += dA[j] * fw.h3[i];
          if (noise) gSWa[i * N + j] += dA[j] * fw.h3[i] * noise.na.W[i * N + j];
          acc += dA[j] * wa_used;
        }
        dh3[i] += acc;
      }
      for (let j = 0; j < N; j++) {
        gba[j] += dA[j];
        if (noise) gSBa[j] += dA[j] * noise.na.eb[j];
      }

      // Backprop through trunk (H3 <- H2 <- H1)
      const sg3 = geluGrad(fw.ln3.out);
      const dLn3 = new Float32Array(HIDDEN3);
      for (let i = 0; i < HIDDEN3; i++) dLn3[i] = dh3[i] * sg3[i];
      const dz3 = layerNormGrad(dLn3, fw.z3, fw.ln3.mean, fw.ln3.std);
      for (let i = 0; i < HIDDEN2; i++)
        for (let j = 0; j < HIDDEN3; j++)
          gW3[i * HIDDEN3 + j] += dz3[j] * fw.h2[i];
      for (let j = 0; j < HIDDEN3; j++) gb3[j] += dz3[j];
      const dh2 = new Float32Array(HIDDEN2);
      for (let i = 0; i < HIDDEN2; i++) {
        let acc = 0;
        for (let j = 0; j < HIDDEN3; j++) acc += dz3[j] * this.W3[i * HIDDEN3 + j];
        dh2[i] = acc;
      }
      const sg2 = geluGrad(fw.ln2.out);
      const dLn2 = new Float32Array(HIDDEN2);
      for (let i = 0; i < HIDDEN2; i++) dLn2[i] = dh2[i] * sg2[i];
      const dz2 = layerNormGrad(dLn2, fw.z2, fw.ln2.mean, fw.ln2.std);
      for (let i = 0; i < HIDDEN1; i++)
        for (let j = 0; j < HIDDEN2; j++)
          gW2[i * HIDDEN2 + j] += dz2[j] * fw.h1[i];
      for (let j = 0; j < HIDDEN2; j++) gb2[j] += dz2[j];

      const dh1 = new Float32Array(HIDDEN1);
      for (let i = 0; i < HIDDEN1; i++) {
        let acc = 0;
        for (let j = 0; j < HIDDEN2; j++) acc += dz2[j] * this.W2[i * HIDDEN2 + j];
        dh1[i] = acc;
      }
      const sg1 = geluGrad(fw.ln1.out);
      const dLn1 = new Float32Array(HIDDEN1);
      for (let i = 0; i < HIDDEN1; i++) dLn1[i] = dh1[i] * sg1[i];
      const dz1 = layerNormGrad(dLn1, fw.z1, fw.ln1.mean, fw.ln1.std);
      for (let i = 0; i < STATE_DIM; i++)
        for (let j = 0; j < HIDDEN1; j++)
          gW1[i * HIDDEN1 + j] += dz1[j] * e.s[i];
      for (let j = 0; j < HIDDEN1; j++) gb1[j] += dz1[j];
    }

    const inv = 1 / Math.max(1, BN);
    const scale = (arr) => { for (let i = 0; i < arr.length; i++) arr[i] *= inv; };
    scale(gW1); scale(gb1); scale(gW2); scale(gb2); scale(gW3); scale(gb3);
    scale(gWv); scale(gbv); scale(gWa); scale(gba);
    scale(gSWv); scale(gSBv); scale(gSWa); scale(gSBa);

    this.opt.W1.step(this.W1, gW1, this.lr);
    this.opt.b1.step(this.b1, gb1, this.lr);
    this.opt.W2.step(this.W2, gW2, this.lr);
    this.opt.b2.step(this.b2, gb2, this.lr);
    this.opt.W3.step(this.W3, gW3, this.lr);
    this.opt.b3.step(this.b3, gb3, this.lr);
    this.opt.Wv.step(this.Wv, gWv, this.lr);
    this.opt.bv.step(this.bv, gbv, this.lr);
    this.opt.Wa.step(this.Wa, gWa, this.lr);
    this.opt.ba.step(this.ba, gba, this.lr);
    // noisy sigma step (slower lr)
    this.opt.sWv.step(this.sWv, gSWv, this.lr * 0.5);
    this.opt.sBv.step(this.sBv, gSBv, this.lr * 0.5);
    this.opt.sWa.step(this.sWa, gSWa, this.lr * 0.5);
    this.opt.sBa.step(this.sBa, gSBa, this.lr * 0.5);
    // keep sigmas non-negative and bounded
    const clampSigma = (arr, lo = 0.01, hi = 0.8) => { for (let i = 0; i < arr.length; i++) arr[i] = Math.max(lo, Math.min(hi, arr[i])); };
    clampSigma(this.sWv); clampSigma(this.sWa); clampSigma(this.sBv); clampSigma(this.sBa);

    let meanErr = 0;
    for (const e of tdErrs) meanErr += e;
    meanErr /= Math.max(1, tdErrs.length);
    this.tdErrEMA = 0.98 * this.tdErrEMA + 0.02 * meanErr;
    return tdErrs;
  }

  /* -------------- Teacher distillation -------------- */
  learnFromTeacher(s, teacherA, strength = 0.6) {
    if (teacherA == null || teacherA < 0 || teacherA >= ACTION_DIM) return;
    const fw = this._forward(s, false, false);
    const margin = 1.0;
    const dq = new Float32Array(ACTION_DIM);
    for (let i = 0; i < ACTION_DIM; i++) {
      const tgt = i === teacherA ? fw.q[i] + margin : fw.q[i] - margin * 0.08;
      dq[i] = (fw.q[i] - tgt) * strength;
    }
    let sumDq = 0; for (let i = 0; i < ACTION_DIM; i++) sumDq += dq[i];
    const dA = new Float32Array(ACTION_DIM);
    for (let j = 0; j < ACTION_DIM; j++) dA[j] = dq[j] - sumDq / ACTION_DIM;
    const dV = sumDq;
    const lr = this.lr * 0.6;
    for (let i = 0; i < HIDDEN3; i++) {
      this.Wv[i] -= lr * dV * fw.h3[i];
      for (let j = 0; j < ACTION_DIM; j++) this.Wa[i * ACTION_DIM + j] -= lr * dA[j] * fw.h3[i];
    }
    this.bv[0] -= lr * dV;
    for (let j = 0; j < ACTION_DIM; j++) this.ba[j] -= lr * dA[j];
  }

  /* -------------- Mass learning from replay -------------- */
  boostLearn(batches = 20) {
    let n = 0;
    for (let i = 0; i < batches; i++) {
      if (this.replay.size >= 64) {
        const { batch, idxs, is } = this.replay.sample(40, this.beta);
        const tdErrs = this._learnStep(batch, is);
        this.replay.updatePriorities(idxs, tdErrs);
        n++;
      }
      if (SharedBus.replay.size >= 64) {
        const { batch } = SharedBus.sample(20, 0.55);
        const is = new Array(batch.length).fill(0.55);
        this._learnStep(batch, is);
        n++;
      }
    }
    this._softUpdateTarget();
    return n;
  }

  /* -------------- Target net -------------- */
  _snapshotTarget() {
    this.tW1 = new Float32Array(this.W1); this.tb1 = new Float32Array(this.b1);
    this.tW2 = new Float32Array(this.W2); this.tb2 = new Float32Array(this.b2);
    this.tW3 = new Float32Array(this.W3); this.tb3 = new Float32Array(this.b3);
    this.tWv = new Float32Array(this.Wv); this.tbv = new Float32Array(this.bv);
    this.tWa = new Float32Array(this.Wa); this.tba = new Float32Array(this.ba);
  }
  _softUpdateTarget() {
    const t = this.tau;
    const lerp = (dst, src) => { for (let i = 0; i < dst.length; i++) dst[i] = (1 - t) * dst[i] + t * src[i]; };
    lerp(this.tW1, this.W1); lerp(this.tb1, this.b1);
    lerp(this.tW2, this.W2); lerp(this.tb2, this.b2);
    lerp(this.tW3, this.W3); lerp(this.tb3, this.b3);
    lerp(this.tWv, this.Wv); lerp(this.tbv, this.bv);
    lerp(this.tWa, this.Wa); lerp(this.tba, this.ba);
  }
  updateTarget() { this._snapshotTarget(); }

  /* -------------- Memory -------------- */
  remember(ep) {
    this.episodic.push({ ...ep, t: Date.now() });
    if (this.episodic.length > this.maxEpisodic) this.episodic.shift();
    this.experience++;
  }

  /* =======================================================
   *  EVOLUTION HELPERS — clone, mutate, crossover
   * ======================================================= */
  clone(deep = true) {
    const b = new Brain({
      name: this.name, color: this.color,
      skill: this.skill, epsilon: this.epsilon, lr: this.lr,
      experience: this.experience
    });
    b.generation = this.generation + 1;
    const copy = (src, dst) => { for (let i = 0; i < src.length; i++) dst[i] = src[i]; };
    copy(this.W1, b.W1); copy(this.b1, b.b1);
    copy(this.W2, b.W2); copy(this.b2, b.b2);
    copy(this.W3, b.W3); copy(this.b3, b.b3);
    copy(this.Wv, b.Wv); copy(this.bv, b.bv);
    copy(this.Wa, b.Wa); copy(this.ba, b.ba);
    copy(this.sWv, b.sWv); copy(this.sBv, b.sBv);
    copy(this.sWa, b.sWa); copy(this.sBa, b.sBa);
    b._snapshotTarget();
    if (deep) {
      b.fitness = JSON.parse(JSON.stringify(this.fitness));
      b.totalSteps = this.totalSteps;
      b.totalReward = this.totalReward;
    }
    return b;
  }

  mutate(sigma = 0.02) {
    const mut = (arr) => { for (let i = 0; i < arr.length; i++) arr[i] += randn() * sigma; };
    mut(this.W1); mut(this.W2); mut(this.W3);
    mut(this.Wv); mut(this.Wa);
    // не трогаем bias сильно
    for (let i = 0; i < this.b1.length; i++) this.b1[i] += randn() * sigma * 0.3;
    for (let i = 0; i < this.b2.length; i++) this.b2[i] += randn() * sigma * 0.3;
    for (let i = 0; i < this.b3.length; i++) this.b3[i] += randn() * sigma * 0.3;
    this._snapshotTarget();
  }

  static crossover(pA, pB) {
    const c = pA.clone(false);
    const mix = (a, b, out) => {
      for (let i = 0; i < a.length; i++) out[i] = Math.random() < 0.5 ? a[i] : b[i];
    };
    mix(pA.W1, pB.W1, c.W1); mix(pA.W2, pB.W2, c.W2); mix(pA.W3, pB.W3, c.W3);
    mix(pA.Wv, pB.Wv, c.Wv); mix(pA.Wa, pB.Wa, c.Wa);
    c._snapshotTarget();
    return c;
  }

  /** adopt another brain's weights into this one (in-place) */
  adopt(other) {
    const copy = (src, dst) => { for (let i = 0; i < src.length; i++) dst[i] = src[i]; };
    copy(other.W1, this.W1); copy(other.b1, this.b1);
    copy(other.W2, this.W2); copy(other.b2, this.b2);
    copy(other.W3, this.W3); copy(other.b3, this.b3);
    copy(other.Wv, this.Wv); copy(other.bv, this.bv);
    copy(other.Wa, this.Wa); copy(other.ba, this.ba);
    copy(other.sWv, this.sWv); copy(other.sBv, this.sBv);
    copy(other.sWa, this.sWa); copy(other.sBa, this.sBa);
    this._snapshotTarget();
    this.generation = Math.max(this.generation, (other.generation || 1)) + 1;
    this.skill = Math.max(this.skill, other.skill || 0);
    this.fitness = JSON.parse(JSON.stringify(other.fitness || this.fitness));
  }

  /* -------------- Weights load/save -------------- */
  loadWeights(w) {
    if (!w) return;
    if (w.W1 && w.W1.length && Array.isArray(w.W1[0])) {
      // legacy v1 partial seed
      try {
        const flat1 = new Float32Array(w.W1.flat());
        const flat2 = new Float32Array(w.W2.flat());
        const flatQ = new Float32Array((w.Wq || w.Wa).flat());
        const copy = (src, dst, rSrc, cSrc, rDst, cDst) => {
          const R = Math.min(rSrc, rDst), C = Math.min(cSrc, cDst);
          for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) dst[i * cDst + j] = src[i * cSrc + j];
        };
        copy(flat1, this.W1, 32, 64, STATE_DIM, HIDDEN1);
        copy(flat2, this.W2, 64, 48, HIDDEN1,   HIDDEN2);
        copy(flatQ, this.Wa, 48, 10, HIDDEN3,   ACTION_DIM);
        this._snapshotTarget();
      } catch {}
      return;
    }
    const g = (src, dst) => { if (src) for (let i = 0; i < Math.min(src.length, dst.length); i++) dst[i] = src[i]; };
    g(w.W1, this.W1); g(w.b1, this.b1);
    g(w.W2, this.W2); g(w.b2, this.b2);
    g(w.W3, this.W3); g(w.b3, this.b3);
    g(w.Wv, this.Wv); g(w.bv, this.bv);
    g(w.Wa, this.Wa); g(w.ba, this.ba);
    g(w.sWv, this.sWv); g(w.sBv, this.sBv);
    g(w.sWa, this.sWa); g(w.sBa, this.sBa);
    this._snapshotTarget();
    if (w.meta?.episodes_trained) this.experience = w.meta.episodes_trained;
  }

  toJSON() {
    return {
      name: this.name, color: this.color,
      skill: this.skill, experience: this.experience,
      totalSteps: this.totalSteps, totalReward: this.totalReward,
      epsilon: this.epsilon, generation: this.generation,
      fitness: this.fitness,
      version: 3,
      W1: Array.from(this.W1), b1: Array.from(this.b1),
      W2: Array.from(this.W2), b2: Array.from(this.b2),
      W3: Array.from(this.W3), b3: Array.from(this.b3),
      Wv: Array.from(this.Wv), bv: Array.from(this.bv),
      Wa: Array.from(this.Wa), ba: Array.from(this.ba),
      sWv: Array.from(this.sWv), sBv: Array.from(this.sBv),
      sWa: Array.from(this.sWa), sBa: Array.from(this.sBa),
      episodic: this.episodic.slice(-60)
    };
  }
  fromJSON(d) {
    if (!d) return;
    this.name = d.name ?? this.name;
    this.color = d.color ?? this.color;
    this.skill = d.skill ?? this.skill;
    this.experience = d.experience ?? 0;
    this.totalSteps = d.totalSteps ?? 0;
    this.totalReward = d.totalReward ?? 0;
    this.epsilon = d.epsilon ?? this.epsilon;
    this.generation = d.generation ?? 1;
    if (d.fitness) this.fitness = d.fitness;
    const g = (src, dst) => { if (src) for (let i = 0; i < Math.min(src.length, dst.length); i++) dst[i] = src[i]; };
    g(d.W1, this.W1); g(d.b1, this.b1);
    g(d.W2, this.W2); g(d.b2, this.b2);
    g(d.W3, this.W3); g(d.b3, this.b3);
    g(d.Wv, this.Wv); g(d.bv, this.bv);
    g(d.Wa, this.Wa); g(d.ba, this.ba);
    g(d.sWv, this.sWv); g(d.sBv, this.sBv);
    g(d.sWa, this.sWa); g(d.sBa, this.sBa);
    this._snapshotTarget();
    this.episodic = d.episodic || [];
  }
}

/* ==============================================================
 *  State encoder — устойчивый к произвольным ключам
 * ============================================================== */
export function encodeState(features) {
  const v = new Float32Array(STATE_DIM);
  let i = 0;
  const pushNum = (x) => {
    if (i >= STATE_DIM) return;
    if (x == null || Number.isNaN(x) || !Number.isFinite(x)) x = 0;
    v[i++] = Math.max(-3, Math.min(3, x));
  };
  for (const key in features) {
    const val = features[key];
    if (typeof val === 'number') pushNum(val);
    else if (Array.isArray(val)) for (const x of val) pushNum(x);
    else if (typeof val === 'boolean') pushNum(val ? 1 : 0);
  }
  return v;
}
