/**
 * =============================================================
 *  Мини-физика 1.0  — лёгкий движок для Digital Circus AI 3.0
 * =============================================================
 *  Возможности:
 *   • Динамические тела: сфера и AABB (куб)
 *   • Статические тела: земля, стены
 *   • Гравитация, трение, ограничение скорости
 *   • Импульсы (applyImpulse)
 *   • Парные коллизии (sphere-sphere, box-box, sphere-box)
 *   • Ограничения (constraint): расстояние, угловое (pendulum-like)
 *   • Ragdoll-сочленения: composite тела, связанные distance constraints
 *   • Stable Verlet-интеграция + substeps
 *   • Захват/удержание (pick/drop) блоков агентами
 *
 *  Предназначен для:
 *   • песочницы с реальными кубиками
 *   • ragdoll-агентов (побег)
 *   • столкновения с опасностями (лазер)
 * =============================================================
 */

import * as THREE from 'three';

const EPS = 1e-6;

export class Body {
  constructor(opts = {}) {
    this.type     = opts.type || 'box';   // 'sphere' | 'box'
    this.pos      = (opts.pos  && opts.pos.clone())  || new THREE.Vector3();
    this.vel      = (opts.vel  && opts.vel.clone())  || new THREE.Vector3();
    this.prevPos  = this.pos.clone();
    this.size     = (opts.size && opts.size.clone()) || new THREE.Vector3(1, 1, 1); // box half-extents*2
    this.radius   = opts.radius ?? 0.5;
    this.mass     = opts.mass ?? 1.0;
    this.invMass  = this.mass > 0 ? 1 / this.mass : 0;
    this.restitution = opts.restitution ?? 0.25;
    this.friction = opts.friction ?? 0.5;
    this.isStatic = opts.isStatic || false;
    this.isSensor = opts.isSensor || false;
    this.kinematic = opts.kinematic || false; // moves by script
    this.mesh     = opts.mesh || null;
    this.tag      = opts.tag  || '';
    this.carriedBy = null;
    this.onGround  = false;
    this.angularY  = 0;
    this.angVelY   = 0;
    // Bounding helpers (for box)
    this._halfExt = new THREE.Vector3(this.size.x * 0.5, this.size.y * 0.5, this.size.z * 0.5);
  }
  applyImpulse(v) {
    if (this.isStatic || this.invMass === 0) return;
    this.vel.addScaledVector(v, this.invMass);
  }
  setPosition(v) {
    this.pos.copy(v); this.prevPos.copy(v);
  }
  getAABB() {
    if (this.type === 'box') {
      return {
        min: new THREE.Vector3(this.pos.x - this._halfExt.x, this.pos.y - this._halfExt.y, this.pos.z - this._halfExt.z),
        max: new THREE.Vector3(this.pos.x + this._halfExt.x, this.pos.y + this._halfExt.y, this.pos.z + this._halfExt.z)
      };
    } else {
      return {
        min: new THREE.Vector3(this.pos.x - this.radius, this.pos.y - this.radius, this.pos.z - this.radius),
        max: new THREE.Vector3(this.pos.x + this.radius, this.pos.y + this.radius, this.pos.z + this.radius)
      };
    }
  }
}

/** Distance constraint (spring-like but hard). */
export class DistanceConstraint {
  constructor(a, b, rest, stiffness = 0.9) {
    this.a = a; this.b = b; this.rest = rest; this.stiffness = stiffness;
  }
  solve() {
    const a = this.a, b = this.b;
    const delta = b.pos.clone().sub(a.pos);
    const d = delta.length();
    if (d < EPS) return;
    const diff = (d - this.rest) / d;
    const wSum = a.invMass + b.invMass;
    if (wSum < EPS) return;
    const corr = delta.multiplyScalar(diff * this.stiffness);
    if (!a.isStatic) a.pos.addScaledVector(corr,  a.invMass / wSum);
    if (!b.isStatic) b.pos.addScaledVector(corr, -b.invMass / wSum);
  }
}

/** Limit Y-position above ground with bounce */
function resolveGround(b, groundY = 0) {
  if (b.type === 'sphere') {
    const miny = b.pos.y - b.radius;
    if (miny < groundY) {
      b.pos.y = groundY + b.radius;
      if (b.vel.y < 0) b.vel.y = -b.vel.y * b.restitution;
      b.vel.x *= (1 - b.friction);
      b.vel.z *= (1 - b.friction);
      b.onGround = true;
    } else b.onGround = false;
  } else {
    const miny = b.pos.y - b._halfExt.y;
    if (miny < groundY) {
      b.pos.y = groundY + b._halfExt.y;
      if (b.vel.y < 0) b.vel.y = -b.vel.y * b.restitution;
      b.vel.x *= (1 - b.friction);
      b.vel.z *= (1 - b.friction);
      b.onGround = true;
    } else b.onGround = false;
  }
}

function resolveBoxBox(a, b) {
  // AABB vs AABB
  const ax = a._halfExt, bx = b._halfExt;
  const dx = b.pos.x - a.pos.x;
  const dy = b.pos.y - a.pos.y;
  const dz = b.pos.z - a.pos.z;
  const ox = ax.x + bx.x - Math.abs(dx);
  const oy = ax.y + bx.y - Math.abs(dy);
  const oz = ax.z + bx.z - Math.abs(dz);
  if (ox < 0 || oy < 0 || oz < 0) return false;
  // выбираем ось минимального перекрытия
  let axis = 'x', overlap = ox;
  if (oy < overlap) { overlap = oy; axis = 'y'; }
  if (oz < overlap) { overlap = oz; axis = 'z'; }
  const wSum = a.invMass + b.invMass;
  if (wSum < EPS) return false;
  const push = overlap / wSum;
  if (axis === 'x') {
    const s = Math.sign(dx) || 1;
    if (!a.isStatic) a.pos.x -= s * push * a.invMass;
    if (!b.isStatic) b.pos.x += s * push * b.invMass;
    // bounce
    const rv = b.vel.x - a.vel.x;
    if (rv * s < 0) {
      const j = -(1 + Math.min(a.restitution, b.restitution)) * rv / wSum;
      if (!a.isStatic) a.vel.x -= j * a.invMass;
      if (!b.isStatic) b.vel.x += j * b.invMass;
    }
  } else if (axis === 'y') {
    const s = Math.sign(dy) || 1;
    if (!a.isStatic) a.pos.y -= s * push * a.invMass;
    if (!b.isStatic) b.pos.y += s * push * b.invMass;
    const rv = b.vel.y - a.vel.y;
    if (rv * s < 0) {
      const j = -(1 + Math.min(a.restitution, b.restitution)) * rv / wSum;
      if (!a.isStatic) a.vel.y -= j * a.invMass;
      if (!b.isStatic) b.vel.y += j * b.invMass;
    }
    // штабелирование: трение по x,z на верхнем теле
    if (s > 0) {
      a.vel.x *= (1 - 0.08); a.vel.z *= (1 - 0.08);
    } else {
      b.vel.x *= (1 - 0.08); b.vel.z *= (1 - 0.08);
    }
  } else {
    const s = Math.sign(dz) || 1;
    if (!a.isStatic) a.pos.z -= s * push * a.invMass;
    if (!b.isStatic) b.pos.z += s * push * b.invMass;
    const rv = b.vel.z - a.vel.z;
    if (rv * s < 0) {
      const j = -(1 + Math.min(a.restitution, b.restitution)) * rv / wSum;
      if (!a.isStatic) a.vel.z -= j * a.invMass;
      if (!b.isStatic) b.vel.z += j * b.invMass;
    }
  }
  return true;
}

function resolveSphereSphere(a, b) {
  const delta = b.pos.clone().sub(a.pos);
  const d = delta.length();
  const minD = a.radius + b.radius;
  if (d < minD && d > EPS) {
    const n = delta.clone().multiplyScalar(1 / d);
    const push = (minD - d);
    const wSum = a.invMass + b.invMass;
    if (wSum < EPS) return false;
    if (!a.isStatic) a.pos.addScaledVector(n, -push * a.invMass / wSum);
    if (!b.isStatic) b.pos.addScaledVector(n,  push * b.invMass / wSum);
    const rv = b.vel.clone().sub(a.vel).dot(n);
    if (rv < 0) {
      const j = -(1 + Math.min(a.restitution, b.restitution)) * rv / wSum;
      if (!a.isStatic) a.vel.addScaledVector(n, -j * a.invMass);
      if (!b.isStatic) b.vel.addScaledVector(n,  j * b.invMass);
    }
    return true;
  }
  return false;
}

function resolveSphereBox(s, b) {
  // find closest point on b to s.pos
  const min = new THREE.Vector3(b.pos.x - b._halfExt.x, b.pos.y - b._halfExt.y, b.pos.z - b._halfExt.z);
  const max = new THREE.Vector3(b.pos.x + b._halfExt.x, b.pos.y + b._halfExt.y, b.pos.z + b._halfExt.z);
  const p = new THREE.Vector3(
    Math.max(min.x, Math.min(s.pos.x, max.x)),
    Math.max(min.y, Math.min(s.pos.y, max.y)),
    Math.max(min.z, Math.min(s.pos.z, max.z))
  );
  const delta = s.pos.clone().sub(p);
  const d = delta.length();
  if (d < s.radius) {
    const n = d > EPS ? delta.clone().multiplyScalar(1 / d) : new THREE.Vector3(0, 1, 0);
    const push = s.radius - d;
    const wSum = s.invMass + b.invMass;
    if (wSum < EPS) return false;
    if (!s.isStatic) s.pos.addScaledVector(n,  push * s.invMass / wSum);
    if (!b.isStatic) b.pos.addScaledVector(n, -push * b.invMass / wSum);
    const rv = s.vel.clone().sub(b.vel).dot(n);
    if (rv < 0) {
      const j = -(1 + Math.min(s.restitution, b.restitution)) * rv / wSum;
      if (!s.isStatic) s.vel.addScaledVector(n,  j * s.invMass);
      if (!b.isStatic) b.vel.addScaledVector(n, -j * b.invMass);
    }
    return true;
  }
  return false;
}

export class World {
  constructor(opts = {}) {
    this.bodies = [];
    this.constraints = [];
    this.gravity = new THREE.Vector3(0, opts.gravity ?? -18, 0);
    this.groundY = opts.groundY ?? 0;
    this.substeps = opts.substeps ?? 4;
    this.maxSpeed = 28;
    this.damping  = opts.damping ?? 0.02;
    this.collisionCallbacks = []; // (a,b) => void
  }
  add(b)       { this.bodies.push(b); return b; }
  remove(b)    { this.bodies = this.bodies.filter(x => x !== b); }
  addConstraint(c) { this.constraints.push(c); return c; }
  removeConstraint(c) { this.constraints = this.constraints.filter(x => x !== c); }
  onCollision(fn) { this.collisionCallbacks.push(fn); }

  step(dt) {
    const h = dt / this.substeps;
    for (let s = 0; s < this.substeps; s++) this._integrate(h);
  }

  _integrate(h) {
    // 1. integrate free velocity + gravity
    for (const b of this.bodies) {
      if (b.isStatic || b.kinematic) continue;
      if (b.carriedBy) continue;
      b.vel.addScaledVector(this.gravity, h);
      // damping
      b.vel.multiplyScalar(1 - this.damping * h);
      // clamp speed
      const sp = b.vel.length();
      if (sp > this.maxSpeed) b.vel.multiplyScalar(this.maxSpeed / sp);
      b.prevPos.copy(b.pos);
      b.pos.addScaledVector(b.vel, h);
      // angular trivial
      b.angularY += b.angVelY * h;
      b.angVelY *= (1 - this.damping * h);
    }
    // 2. ground
    for (const b of this.bodies) {
      if (b.isStatic) continue;
      resolveGround(b, this.groundY);
    }
    // 3. pair collisions (brute force but with early-out via AABB overlap)
    const N = this.bodies.length;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const A = this.bodies[i], B = this.bodies[j];
        if (A.isStatic && B.isStatic) continue;
        if (A.isSensor || B.isSensor) {
          if (this._aabbOverlap(A, B)) {
            for (const fn of this.collisionCallbacks) fn(A, B);
          }
          continue;
        }
        if (!this._aabbOverlap(A, B)) continue;
        let hit = false;
        if (A.type === 'box'    && B.type === 'box')    hit = resolveBoxBox(A, B);
        else if (A.type === 'sphere' && B.type === 'sphere') hit = resolveSphereSphere(A, B);
        else if (A.type === 'sphere' && B.type === 'box')    hit = resolveSphereBox(A, B);
        else if (A.type === 'box'    && B.type === 'sphere') hit = resolveSphereBox(B, A);
        if (hit) for (const fn of this.collisionCallbacks) fn(A, B);
      }
    }
    // 4. constraints (iterative)
    for (let it = 0; it < 4; it++) {
      for (const c of this.constraints) c.solve();
    }
    // 5. re-derive velocity from position change (Verlet-style) for constraint stability
    for (const b of this.bodies) {
      if (b.isStatic || b.kinematic) continue;
      // smoothly correct
      const dv = b.pos.clone().sub(b.prevPos).multiplyScalar(1 / h);
      // blend with current vel to avoid oscillation
      b.vel.lerp(dv, 0.3);
    }
  }

  _aabbOverlap(A, B) {
    const a = A.getAABB(), b = B.getAABB();
    if (a.max.x < b.min.x || a.min.x > b.max.x) return false;
    if (a.max.y < b.min.y || a.min.y > b.max.y) return false;
    if (a.max.z < b.min.z || a.min.z > b.max.z) return false;
    return true;
  }

  /** Синхронизация позиций с three.js мешами. */
  syncMeshes() {
    for (const b of this.bodies) {
      if (!b.mesh) continue;
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.y = b.angularY;
    }
  }
}

/* =============================================================
 *  Ragdoll — многоэлементное тело с джойнтами
 *  Для «побега» — агент учится управлять конечностями
 * =============================================================
 */
export class Ragdoll {
  constructor(world, origin, color = 'red') {
    this.world = world;
    this.color = color;
    this.parts = {};
    this.constraints = [];

    const mk = (opts) => {
      const b = new Body(opts);
      world.add(b);
      this.parts[opts.tag] = b;
      return b;
    };
    const ox = origin.x, oy = origin.y, oz = origin.z;

    // Шарики-сочленения
    this.parts.torso = mk({ type: 'sphere', radius: 0.32, mass: 2.5, pos: new THREE.Vector3(ox, oy + 0.9, oz), tag: 'torso', friction: 0.3, restitution: 0.1 });
    this.parts.head  = mk({ type: 'sphere', radius: 0.28, mass: 0.8, pos: new THREE.Vector3(ox, oy + 1.4, oz), tag: 'head' });
    this.parts.handL = mk({ type: 'sphere', radius: 0.13, mass: 0.35, pos: new THREE.Vector3(ox - 0.45, oy + 0.8, oz), tag: 'handL' });
    this.parts.handR = mk({ type: 'sphere', radius: 0.13, mass: 0.35, pos: new THREE.Vector3(ox + 0.45, oy + 0.8, oz), tag: 'handR' });
    this.parts.footL = mk({ type: 'sphere', radius: 0.15, mass: 0.6, pos: new THREE.Vector3(ox - 0.18, oy + 0.15, oz), tag: 'footL', friction: 0.85, restitution: 0.03 });
    this.parts.footR = mk({ type: 'sphere', radius: 0.15, mass: 0.6, pos: new THREE.Vector3(ox + 0.18, oy + 0.15, oz), tag: 'footR', friction: 0.85, restitution: 0.03 });

    // Джойнты (distance constraints)
    const link = (a, b, stiff = 0.95) => {
      const rest = a.pos.distanceTo(b.pos);
      const c = new DistanceConstraint(a, b, rest, stiff);
      world.addConstraint(c);
      this.constraints.push(c);
    };
    link(this.parts.torso, this.parts.head, 0.95);
    link(this.parts.torso, this.parts.handL, 0.85);
    link(this.parts.torso, this.parts.handR, 0.85);
    link(this.parts.torso, this.parts.footL, 0.8);
    link(this.parts.torso, this.parts.footR, 0.8);
    // second-tier stabilizers (torso-foot cross)
    link(this.parts.head, this.parts.handL, 0.4);
    link(this.parts.head, this.parts.handR, 0.4);
    link(this.parts.footL, this.parts.footR, 0.35);
  }

  get position() { return this.parts.torso.pos; }

  /** Даём импульсы ногам согласно действию (обучаемая локомоция). */
  actuate(action, strength = 1.0) {
    const p = this.parts;
    // 12 действий: 0..7 — направление (+нога), 8..11 — спец-жесты
    const dirs = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [-1, 1], [1, -1], [1, 1]
    ];
    if (action < 8) {
      const [dx, dz] = dirs[action];
      // асимметричные импульсы на ноги и руки для «ходьбы»
      const stepF = new THREE.Vector3(dx * 3.5 * strength, 4.6 * strength, dz * 3.5 * strength);
      const useLeft = (this._step = (this._step || 0) + 1) & 1;
      const foot = useLeft ? p.footL : p.footR;
      const hand = useLeft ? p.handR : p.handL;
      foot.applyImpulse(stepF);
      hand.applyImpulse(new THREE.Vector3(dx * 1.4, 0.6, dz * 1.4).multiplyScalar(strength));
      // корпус чуть-чуть в направлении
      p.torso.applyImpulse(new THREE.Vector3(dx * 0.8, 0.4, dz * 0.8).multiplyScalar(strength));
    } else if (action === 8) {
      // «присесть»
      p.torso.applyImpulse(new THREE.Vector3(0, -1.0, 0));
    } else if (action === 9) {
      // «прыжок»
      p.torso.applyImpulse(new THREE.Vector3(0, 6.5 * strength, 0));
      p.footL.applyImpulse(new THREE.Vector3(0, 4.5 * strength, 0));
      p.footR.applyImpulse(new THREE.Vector3(0, 4.5 * strength, 0));
    } else if (action === 10) {
      // «руки вверх»
      p.handL.applyImpulse(new THREE.Vector3(0, 3.2 * strength, 0));
      p.handR.applyImpulse(new THREE.Vector3(0, 3.2 * strength, 0));
    } else if (action === 11) {
      // noop/стабилизация — мягкая
      p.torso.vel.multiplyScalar(0.85);
    }
  }

  /** Удалить ragdoll из мира. */
  destroy() {
    for (const key in this.parts) this.world.remove(this.parts[key]);
    for (const c of this.constraints) this.world.removeConstraint(c);
  }

  /** Проверка «упал ли» — корпус слишком низко и не стоит */
  isFallen() {
    return this.parts.torso.pos.y < 0.55 &&
           Math.abs(this.parts.head.pos.y - this.parts.torso.pos.y) < 0.3;
  }
}
