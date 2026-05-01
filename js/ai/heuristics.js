/**
 * Эвристики 2.0 — быстрые алгоритмы, используемые как «учитель»
 * для нейросети в гибридной политике.
 *   • A* pathfinding (8-neighbor, tie-break by distance)
 *   • JPS-lite (умеренный skip)
 *   • Flappy predictive-flap
 *   • Maze right-hand / left-hand / Tremaux
 *   • Hide/Seek greedy + wall-hugging evasion
 *   • Greedy chase
 *   • Minimax helpers (values, mobility)
 */

export const DIR8 = [
  [-1,  0], [ 1,  0],
  [ 0, -1], [ 0,  1],
  [-1, -1], [-1,  1],
  [ 1, -1], [ 1,  1]
];

const DIR_TO_ACTION = {
  '-1,0': 0, '1,0': 1, '0,-1': 2, '0,1': 3,
  '-1,-1': 4, '-1,1': 5, '1,-1': 6, '1,1': 7
};

/* ---------- A* ---------- */
export function astar(grid, start, goal, W, H, diag = true) {
  if (!grid) return null;
  const sk = start.y * W + start.x;
  const gk = goal.y * W + goal.x;
  if (sk === gk) return [{ x: start.x, y: start.y }];
  if (grid[gk] === 1) return null;
  const open = new Map();
  const closed = new Set();
  const came = new Map();
  const gScore = new Map();
  gScore.set(sk, 0);
  const h = (a, b) => {
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    return diag ? (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy) : dx + dy;
  };
  open.set(sk, { x: start.x, y: start.y, f: h(start, goal) });
  const dirs = diag ? DIR8 : DIR8.slice(0, 4);
  let iterations = 0;
  const maxIter = W * H * 4;
  while (open.size) {
    if (++iterations > maxIter) break;
    let cur = null, curKey = null, curF = Infinity;
    for (const [k, v] of open) if (v.f < curF) { curF = v.f; cur = v; curKey = k; }
    if (cur.x === goal.x && cur.y === goal.y) {
      const path = [{ x: cur.x, y: cur.y }];
      let k = curKey;
      while (came.has(k)) {
        const p = came.get(k);
        path.unshift({ x: p.x, y: p.y });
        k = p.y * W + p.x;
      }
      return path;
    }
    open.delete(curKey);
    closed.add(curKey);
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      if (grid[ny * W + nx] === 1) continue;
      // запрет проходить по диагонали через "узкие углы"
      if (dx !== 0 && dy !== 0) {
        if (grid[cur.y * W + nx] === 1 && grid[ny * W + cur.x] === 1) continue;
      }
      const nk = ny * W + nx;
      if (closed.has(nk)) continue;
      const step = (dx && dy) ? Math.SQRT2 : 1;
      const tentG = (gScore.get(curKey) || Infinity) + step;
      if (tentG < (gScore.get(nk) || Infinity)) {
        came.set(nk, { x: cur.x, y: cur.y });
        gScore.set(nk, tentG);
        open.set(nk, { x: nx, y: ny, f: tentG + h({ x: nx, y: ny }, goal) });
      }
    }
  }
  return null;
}

export function pathToAction(cur, next) {
  const dx = Math.sign(next.x - cur.x);
  const dy = Math.sign(next.y - cur.y);
  return DIR_TO_ACTION[`${dx},${dy}`] ?? 8;
}

/* ---------- Flappy ---------- */
/** yNorm, vyNorm, gapYNorm, gapSizeNorm  (∈ [0..1]) */
export function flappyHeuristic(y, vy, gapY, gapSize) {
  // Предсказываем позицию через 0.1с с текущей скоростью
  const predY = y + vy * 0.1;
  // Хотим, чтобы predY был чуть выше центра дыры (учёт гравитации)
  const target = gapY - gapSize * 0.08;
  if (predY < target && vy < 0.03) return 0;  // flap
  return 8; // noop
}

/* ---------- Maze ---------- */
export function rightHandRule(grid, x, y, facing, W, H) {
  const d = [[0,-1],[1,0],[0,1],[-1,0]];
  const free = (dd) => {
    const nx = x + d[dd][0], ny = y + d[dd][1];
    return nx >= 0 && nx < W && ny >= 0 && ny < H && grid[ny * W + nx] === 0;
  };
  const right = (facing + 1) & 3;
  if (free(right)) return right;
  if (free(facing)) return facing;
  const left = (facing + 3) & 3;
  if (free(left)) return left;
  return (facing + 2) & 3;
}

/* ---------- Chase / Evade ---------- */
export function greedyChase(ax, ay, tx, ty) {
  const dx = Math.sign(tx - ax), dy = Math.sign(ty - ay);
  return DIR_TO_ACTION[`${dx},${dy}`] ?? 8;
}

export function evasionMove(ax, ay, sx, sy, walls, W, H) {
  let best = 8, bestS = -Infinity;
  for (const [dx, dy] of DIR8) {
    const nx = ax + dx, ny = ay + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    if (walls && walls.has(`${nx},${ny}`)) continue;
    const distSeek = Math.hypot(nx - sx, ny - sy);
    let wallBonus = 0;
    if (walls) {
      for (const [ddx, ddy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        if (walls.has(`${nx + ddx},${ny + ddy}`)) wallBonus += 0.6;
      }
    }
    const score = distSeek * 1.2 + wallBonus * 2.2 - (dx === 0 && dy === 0 ? 1 : 0);
    if (score > bestS) { bestS = score; best = DIR_TO_ACTION[`${dx},${dy}`] ?? 8; }
  }
  return best;
}

/* ---------- Chess piece values (для brain state) ---------- */
export const PIECE_VALUES = {
  p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000,
  P: -100, N: -320, B: -330, R: -500, Q: -900, K: -20000
};

export const PAWN_TABLE = [
  [ 0,  0,  0,  0,  0,  0,  0,  0],
  [50, 50, 50, 50, 50, 50, 50, 50],
  [10, 10, 20, 30, 30, 20, 10, 10],
  [ 5,  5, 10, 25, 25, 10,  5,  5],
  [ 0,  0,  0, 20, 20,  0,  0,  0],
  [ 5, -5,-10,  0,  0,-10, -5,  5],
  [ 5, 10, 10,-20,-20, 10, 10,  5],
  [ 0,  0,  0,  0,  0,  0,  0,  0]
];
