/**
 * UI 3.0 — поддержка новой архитектуры Brain (48→112→80→56→24).
 *  Функции:
 *    drawNetwork(canvas, brain, colorPrimary)
 *    updateAICard(prefix, brain)
 *    showToast(msg, duration)
 *    openModal(id) / closeModal(id)
 *    renderEvoTable(evoManager, el)
 */
import { STATE_DIM, HIDDEN1, HIDDEN2, HIDDEN3, ACTION_DIM } from './ai/brain.js';

export function drawNetwork(canvas, brain, colorPrimary = '#4fd8ff') {
  if (!canvas || !brain) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  // background
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#110821');
  grad.addColorStop(1, '#050310');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 22) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 22) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  const layers = [
    Math.min(20, STATE_DIM),
    Math.min(20, HIDDEN1),
    Math.min(20, HIDDEN2),
    Math.min(20, HIDDEN3),
    ACTION_DIM
  ];
  const xs = layers.map((_, i) => 50 + i * ((w - 100) / (layers.length - 1)));

  const posY = (idx, total) => {
    const gap = (h - 60) / (Math.max(1, total - 1));
    return 30 + idx * gap;
  };

  // connections
  ctx.globalAlpha = 0.25;
  for (let li = 0; li < layers.length - 1; li++) {
    for (let i = 0; i < layers[li]; i++) {
      const yi = posY(i, layers[li]);
      for (let j = 0; j < layers[li + 1]; j++) {
        const yj = posY(j, layers[li + 1]);
        const hue = (Math.abs(i * 31 + j * 17 + li * 7) % 60) + 180;
        ctx.strokeStyle = `hsla(${hue}, 70%, 60%, 0.35)`;
        ctx.beginPath();
        ctx.moveTo(xs[li], yi);
        ctx.lineTo(xs[li + 1], yj);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;

  // neurons
  for (let li = 0; li < layers.length; li++) {
    for (let i = 0; i < layers[li]; i++) {
      const y = posY(i, layers[li]);
      const r = 5;
      ctx.beginPath();
      ctx.arc(xs[li], y, r + 2, 0, Math.PI * 2);
      ctx.fillStyle = li === 0 ? '#3d7cff' :
                       li === layers.length - 1 ? '#ffb24f' :
                       colorPrimary;
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(xs[li], y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  }

  // text — V(s) + max Q*
  try {
    const dummy = new Float32Array(STATE_DIM).map(() => Math.random() * 0.2);
    const out = brain.forward(dummy);
    let best = 0, bestI = 0;
    for (let i = 0; i < out.length; i++) if (out[i] > best) { best = out[i]; bestI = i; }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '12px monospace';
    ctx.fillText(`V(s)≈ ${(best * 0.5).toFixed(2)}`, 10, 14);
    ctx.fillText(`arg max Q* = a${bestI}`, 10, 28);
    ctx.fillText(`skill: ${(brain.skill * 100).toFixed(1)}%`, 10, 42);
    ctx.fillText(`ε: ${brain.epsilon.toFixed(3)}`, 10, 56);
    ctx.fillText(`gen: ${brain.generation || 1}`, 10, 70);
  } catch (e) { /* ignore */ }
}

export function showToast(msg, duration = 2500) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const div = document.createElement('div');
  div.className = 'toast-item';
  div.textContent = msg;
  host.appendChild(div);
  requestAnimationFrame(() => div.classList.add('in'));
  setTimeout(() => {
    div.classList.remove('in');
    div.classList.add('out');
    setTimeout(() => div.remove(), 400);
  }, duration);
}

export function updateAICard(prefix, brain) {
  if (!brain) return;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  const skillP = Math.min(100, Math.max(0, brain.skill * 100)).toFixed(1);
  set(`${prefix}-xp`,     `${brain.totalSteps ?? brain.steps ?? 0}`);
  set(`${prefix}-skill`,  `${skillP}%`);
  set(`${prefix}-eps`,    brain.epsilon.toFixed(3));
  set(`${prefix}-mem`,    `${brain.replay.size}/${brain.replay.cap}`);
  set(`${prefix}-gen`,    `g${brain.generation || 1}`);
  const bar = document.getElementById(`${prefix}-skill-bar`);
  if (bar) bar.style.width = `${skillP}%`;
}

export function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

export function renderEvoTable(evo, el) {
  if (!el) return;
  const rows = evo.snapshot();
  if (!rows.length) {
    el.innerHTML = `<div class="empty">пока нет рекордов — запустите тренировку</div>`;
    return;
  }
  const html = [
    `<table class="evo-table"><thead><tr>
       <th>Агент</th><th>Игра</th><th>Рекорд</th><th>Поколение</th><th>Отметка</th>
     </tr></thead><tbody>`,
    ...rows.map(r => `<tr>
       <td class="c-${r.color}">${r.color === 'red' ? 'КЕЙН' : 'ЭЙС'}</td>
       <td>${r.game}</td>
       <td><b>${r.score.toFixed(2)}</b></td>
       <td>g${r.gen}</td>
       <td>${new Date(r.ts).toLocaleTimeString()}</td>
     </tr>`),
    `</tbody></table>`
  ].join('');
  el.innerHTML = html;
}

export function renderRunReport(report, el, onAdopt) {
  if (!el) return;
  const parts = [];
  parts.push(`<h3>Отчёт мультитренинга</h3>`);
  for (const game in report.perGame) {
    const row = report.perGame[game];
    const beforeBest = row.before?.best ?? 0;
    const beforeAvg  = row.before?.avg  ?? 0;
    const afterBest  = row.after?.best  ?? 0;
    const afterAvg   = row.after?.avg   ?? 0;
    const delta = afterBest - beforeBest;
    const sign  = delta > 0 ? '▲' : (delta < 0 ? '▼' : '=');
    const evoScore = row.evoBest?.score ?? null;
    parts.push(`
      <div class="mega-row">
        <div class="mega-hdr">
          <b>🎮 ${game}</b>
          <span class="delta ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">${sign} ${delta.toFixed(2)}</span>
        </div>
        <div>До:   ср ${beforeAvg.toFixed(2)}, лучш ${beforeBest.toFixed(2)}</div>
        <div>После: ср ${afterAvg.toFixed(2)}, лучш ${afterBest.toFixed(2)}</div>
        <div>эпизодов: ${row.episodes || 0}, best-in-train: ${(row.best ?? 0).toFixed(2)}${evoScore !== null ? `, evo-champion score: <b>${evoScore.toFixed(2)}</b>` : ''}</div>
        <div class="mega-act">
          <button class="btn sm primary adopt-btn" data-game="${game}">✔ применить лучшего на ${game}</button>
        </div>
      </div>`);
  }
  el.innerHTML = parts.join('');
  el.querySelectorAll('.adopt-btn').forEach(b => {
    b.addEventListener('click', () => onAdopt?.(b.dataset.game));
  });
}
