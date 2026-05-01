/**
 * Agent 3.0 — воплощение ИИ.
 *
 *  Возможности:
 *   • Кинематический режим (kine) — скриптовая ходьба (для world/maze/flappy/sandbox).
 *   • Ragdoll-режим — управляемое физическое тело из 6 сочленений.
 *     Используется в арк��де "Побег" и в песочнице (чтобы реально
 *     поднимать и швырять кубики).
 *   • Визуальная моделька (мультяшный меш) + "bird"-модель для Flappy.
 *   • Валидация опыта pushExperience().
 *   • Методы для evolution (brain.clone / mutate / adopt уже в Brain).
 */
import * as THREE from 'three';
import { ACTION_DIM } from './brain.js';
import { Ragdoll } from '../physics/physics.js';

export class Agent {
  constructor(opts) {
    this.id = opts.id;
    this.name = opts.name;
    this.color = opts.color; // 'red' | 'blue'
    this.brain = opts.brain;

    this.position = new THREE.Vector3(
      opts.position?.x || opts.x || 0, 0, opts.position?.z || opts.z || 0
    );
    this.velocity = new THREE.Vector3();
    this.targetPosition = this.position.clone();
    this.rotation = 0;
    this.sleeping = false;
    this.mood = 'happy';
    this.currentTask = 'idle';
    this.thought = '';
    this.thoughtT = 0;
    this.lastActionT = 0;
    this.celebrateT = 0;
    this.surpriseT = 0;

    this._lastState = null;
    this._lastAction = null;
    this._lastTask = null;

    this._carriedBlock = null;

    // mesh
    this.mesh = this.buildCartoonMesh();
    this.mesh.userData.agent = this;

    // bird mesh (prebuilt but hidden) — swapped in Flappy
    this.birdGroup = this._buildBirdMesh();
    this.birdGroup.visible = false;
    this.mesh.add(this.birdGroup);

    // Ragdoll (создаётся по запросу)
    this.ragdoll = null;
    this.ragdollVisuals = null; // group с частями для отрисовки
  }

  /* ================= MESH ================= */
  buildCartoonMesh() {
    const g = new THREE.Group();
    const baseColor = this.color === 'red' ? 0xff3b5c : 0x3d7cff;
    const emissive  = this.color === 'red' ? 0xff0033 : 0x0055ff;
    const accent    = this.color === 'red' ? 0xffcc55 : 0x55e0ff;

    const body = new THREE.Mesh(
      (() => { const g = new THREE.SphereGeometry(0.45, 24, 18); g.scale(1, 1.25, 1); return g; })(),
      new THREE.MeshToonMaterial({ color: baseColor, emissive, emissiveIntensity: 0.12 })
    );
    body.position.y = 0.5;
    body.castShadow = body.receiveShadow = true;
    g.add(body); this.body = body;

    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.06, 10, 24),
      new THREE.MeshToonMaterial({ color: accent })
    );
    collar.rotation.x = Math.PI / 2; collar.position.y = 0.92; g.add(collar);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.46, 28, 22),
      new THREE.MeshToonMaterial({ color: baseColor, emissive, emissiveIntensity: 0.12 })
    );
    head.position.y = 1.17; head.castShadow = true; g.add(head); this.head = head;

    const hat = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.55, 16),
      new THREE.MeshToonMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.3 })
    );
    hat.position.y = 1.75; hat.castShadow = true; g.add(hat); this.hat = hat;
    const hatTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 10),
      new THREE.MeshToonMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 })
    );
    hatTip.position.y = 2.03; g.add(hatTip);

    const cheekMat = new THREE.MeshBasicMaterial({
      color: this.color === 'red' ? 0xff99bb : 0xa8d8ff,
      transparent: true, opacity: 0.7
    });
    const cheekGeom = new THREE.SphereGeometry(0.1, 12, 10);
    const chL = new THREE.Mesh(cheekGeom, cheekMat); chL.position.set(-0.3, 1.10, 0.37); g.add(chL);
    const chR = new THREE.Mesh(cheekGeom, cheekMat); chR.position.set( 0.3, 1.10, 0.37); g.add(chR);

    const eyeWMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyeGeom = new THREE.SphereGeometry(0.15, 18, 14);
    const eyeL = new THREE.Mesh(eyeGeom, eyeWMat); eyeL.position.set(-0.17, 1.25, 0.39); eyeL.scale.set(1, 1.2, 0.6); g.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeom, eyeWMat); eyeR.position.set( 0.17, 1.25, 0.39); eyeR.scale.set(1, 1.2, 0.6); g.add(eyeR);
    this.eyes = [eyeL, eyeR];

    const pupilGeom = new THREE.SphereGeometry(0.07, 14, 12);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x0b0d22 });
    const pL = new THREE.Mesh(pupilGeom, pupilMat); pL.position.set(-0.17, 1.25, 0.50); g.add(pL);
    const pR = new THREE.Mesh(pupilGeom, pupilMat); pR.position.set( 0.17, 1.25, 0.50); g.add(pR);
    this.pupils = [pL, pR];

    const glGeom = new THREE.SphereGeometry(0.025, 10, 8);
    const glMat  = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const glL = new THREE.Mesh(glGeom, glMat); glL.position.set(-0.15, 1.28, 0.55); g.add(glL);
    const glR = new THREE.Mesh(glGeom, glMat); glR.position.set( 0.19, 1.28, 0.55); g.add(glR);
    this.glints = [glL, glR];

    this.mouthHappy = new THREE.Mesh(
      new THREE.TorusGeometry(0.09, 0.025, 10, 14, Math.PI),
      new THREE.MeshBasicMaterial({ color: 0x2a1530 })
    );
    this.mouthHappy.position.set(0, 1.02, 0.44);
    this.mouthHappy.rotation.z = Math.PI;
    g.add(this.mouthHappy);

    this.mouthSad = new THREE.Mesh(
      new THREE.TorusGeometry(0.08, 0.022, 10, 14, Math.PI),
      new THREE.MeshBasicMaterial({ color: 0x2a1530 })
    );
    this.mouthSad.position.set(0, 0.98, 0.44);
    this.mouthSad.visible = false;
    g.add(this.mouthSad);

    const armGeom = new THREE.CapsuleGeometry(0.075, 0.38, 4, 8);
    const armMat  = new THREE.MeshToonMaterial({ color: baseColor, emissive, emissiveIntensity: 0.1 });
    const armL = new THREE.Mesh(armGeom, armMat); armL.position.set(-0.52, 0.55, 0); armL.rotation.z =  Math.PI / 6; armL.castShadow = true; g.add(armL);
    const armR = new THREE.Mesh(armGeom, armMat); armR.position.set( 0.52, 0.55, 0); armR.rotation.z = -Math.PI / 6; armR.castShadow = true; g.add(armR);
    this.arms = [armL, armR];

    const handMat = new THREE.MeshToonMaterial({ color: 0xffffff });
    const handL = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), handMat); handL.position.set(-0.68, 0.34, 0); g.add(handL);
    const handR = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), handMat); handR.position.set( 0.68, 0.34, 0); g.add(handR);
    this.hands = [handL, handR];

    const legGeom = new THREE.CapsuleGeometry(0.1, 0.22, 4, 8);
    const legMat  = new THREE.MeshToonMaterial({ color: 0x1a1a2e });
    const legL = new THREE.Mesh(legGeom, legMat); legL.position.set(-0.19, 0.05, 0); legL.castShadow = true; g.add(legL);
    const legR = new THREE.Mesh(legGeom, legMat); legR.position.set( 0.19, 0.05, 0); legR.castShadow = true; g.add(legR);
    this.legs = [legL, legR];

    const glow = new THREE.PointLight(baseColor, 0.55, 5);
    glow.position.y = 1; g.add(glow); this.glow = glow;

    // sleep / emotion sprites
    const zc = document.createElement('canvas');
    zc.width = zc.height = 64;
    const zx = zc.getContext('2d');
    zx.fillStyle = '#fff'; zx.font = 'bold 48px sans-serif';
    zx.textAlign = 'center'; zx.fillText('Z', 32, 48);
    const zTex = new THREE.CanvasTexture(zc);
    const zSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, opacity: 0 }));
    zSp.position.y = 1.9; zSp.scale.set(0.42, 0.42, 0.42); g.add(zSp); this.sleepSprite = zSp;

    const ec = document.createElement('canvas');
    ec.width = ec.height = 96;
    const ex = ec.getContext('2d'); ex.clearRect(0, 0, 96, 96);
    this.emotionCanvas = ec; this.emotionCtx = ex;
    this.emotionTex = new THREE.CanvasTexture(ec);
    this.emotionSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.emotionTex, transparent: true, opacity: 0 }));
    this.emotionSprite.position.y = 2.1; this.emotionSprite.scale.set(0.5, 0.5, 0.5);
    g.add(this.emotionSprite);

    this.cartoonGroup = g;
    g.position.copy(this.position);
    return g;
  }

  /* ================= BIRD MESH ================= */
  _buildBirdMesh() {
    const bg = new THREE.Group();
    const baseColor = this.color === 'red' ? 0xff6677 : 0x4fb8ff;
    const beakColor = 0xffaa22;
    // тело
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 22, 16),
      new THREE.MeshToonMaterial({ color: baseColor })
    );
    body.scale.set(1.1, 0.95, 1.3);
    bg.add(body);
    // голова
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 18, 14),
      new THREE.MeshToonMaterial({ color: baseColor })
    );
    head.position.set(0, 0.2, 0.55); bg.add(head);
    // клюв
    const beak = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.35, 10),
      new THREE.MeshToonMaterial({ color: beakColor, emissive: beakColor, emissiveIntensity: 0.2 })
    );
    beak.position.set(0, 0.17, 0.9); beak.rotation.x = Math.PI / 2; bg.add(beak);
    // глаз
    const eyeW = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    eyeW.position.set(0.14, 0.28, 0.72); bg.add(eyeW);
    const pup = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x0b0d22 })
    );
    pup.position.set(0.17, 0.28, 0.78); bg.add(pup);
    // крылья
    const wingGeom = new THREE.BoxGeometry(0.55, 0.1, 0.25);
    const wingMat  = new THREE.MeshToonMaterial({ color: baseColor });
    const wL = new THREE.Mesh(wingGeom, wingMat); wL.position.set(-0.45, 0.02, 0.0); bg.add(wL);
    const wR = new THREE.Mesh(wingGeom, wingMat); wR.position.set( 0.45, 0.02, 0.0); bg.add(wR);
    this.bird = { group: bg, wingL: wL, wingR: wR, body };
    return bg;
  }

  showBird(on) {
    this.birdGroup.visible = !!on;
    // прячем все "человеческие" части
    const hide = [this.body, this.head, this.hat, this.mouthHappy, this.mouthSad,
                  ...(this.arms || []), ...(this.hands || []), ...(this.legs || []),
                  ...(this.eyes || []), ...(this.pupils || []), ...(this.glints || [])];
    for (const m of hide) if (m) m.visible = !on;
  }

  /* ================= RAGDOLL MODE ================= */
  enterRagdoll(physicsWorld, scene, origin = this.position) {
    if (this.ragdoll) this.exitRagdoll();
    this.ragdoll = new Ragdoll(physicsWorld, origin, this.color);
    // визуализация частей (по одному мешу на часть)
    const vg = new THREE.Group();
    vg.userData.gameObj = true;
    const baseColor = this.color === 'red' ? 0xff3b5c : 0x3d7cff;
    const matBody = new THREE.MeshToonMaterial({ color: baseColor, emissive: baseColor, emissiveIntensity: 0.2 });
    const matAcc  = new THREE.MeshToonMaterial({ color: 0xfff0c0 });
    const meshes = {};
    const mkSph = (r, mat) => new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
    meshes.torso = mkSph(0.32, matBody);
    meshes.head  = mkSph(0.28, matBody);
    meshes.handL = mkSph(0.13, matAcc);
    meshes.handR = mkSph(0.13, matAcc);
    meshes.footL = mkSph(0.15, matAcc);
    meshes.footR = mkSph(0.15, matAcc);
    for (const k in meshes) {
      meshes[k].castShadow = meshes[k].receiveShadow = true;
      vg.add(meshes[k]);
      this.ragdoll.parts[k].mesh = meshes[k];
    }
    // connectors (линии между джойнтами)
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 });
    const connectors = [];
    const pairs = [['torso','head'], ['torso','handL'], ['torso','handR'], ['torso','footL'], ['torso','footR']];
    for (const [a, b] of pairs) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(g, lineMat);
      vg.add(line); connectors.push({ line, a, b });
    }
    scene.add(vg);
    this.ragdollVisuals = { group: vg, meshes, connectors };
    // прячем мультяшный меш
    this.cartoonGroup.visible = false;
  }

  updateRagdollVisuals() {
    if (!this.ragdoll || !this.ragdollVisuals) return;
    const rv = this.ragdollVisuals;
    // части (mesh sync делает world.step → syncMeshes)
    for (const { line, a, b } of rv.connectors) {
      const pa = this.ragdoll.parts[a].pos, pb = this.ragdoll.parts[b].pos;
      const geom = line.geometry;
      const arr = geom.attributes.position.array;
      arr[0] = pa.x; arr[1] = pa.y; arr[2] = pa.z;
      arr[3] = pb.x; arr[4] = pb.y; arr[5] = pb.z;
      geom.attributes.position.needsUpdate = true;
      geom.computeBoundingSphere();
    }
  }

  exitRagdoll() {
    if (!this.ragdoll) return;
    this.ragdoll.destroy();
    if (this.ragdollVisuals) {
      this.ragdollVisuals.group.parent?.remove(this.ragdollVisuals.group);
    }
    this.ragdoll = null;
    this.ragdollVisuals = null;
    this.cartoonGroup.visible = true;
  }

  /* ================= UPDATE LOOP (kinematic) ================= */
  update(dt) {
    const t = performance.now() * 0.001;

    if (this.ragdoll) {
      // визуал ragdoll обновляется физикой снаружи; тут только эмоции/глаза
      this.updateRagdollVisuals();
      return;
    }

    if (this.sleeping) {
      this.mesh.position.y = this.position.y + Math.sin(t * 2) * 0.02;
      this.sleepSprite.material.opacity = 0.55 + Math.sin(t * 3) * 0.3;
      this.sleepSprite.position.y = 1.9 + Math.sin(t) * 0.12;
      return;
    }
    this.sleepSprite.material.opacity = 0;

    // bird animation
    if (this.birdGroup.visible) {
      const flap = Math.sin(t * 18) * 0.5;
      this.bird.wingL.rotation.z =  flap;
      this.bird.wingR.rotation.z = -flap;
      return; // bird управляется Flappy game полностью
    }

    // моргание
    const blink = (Math.sin(t * 2 + this.id * 13) > 0.995) || (Math.sin(t * 1.7 + this.id * 7) > 0.994);
    for (const e of this.eyes) e.scale.y = blink ? 0.08 : 1.2;

    const dir = this.targetPosition.clone().sub(this.position);
    dir.y = 0;
    const dist = dir.length();
    if (dist > 0.06) {
      dir.normalize();
      this.velocity.lerp(dir.multiplyScalar(3.4), Math.min(1, dt * 4.8));
      const targetRot = Math.atan2(dir.x, dir.z);
      const rotDiff = THREE.MathUtils.euclideanModulo(targetRot - this.rotation + Math.PI, Math.PI * 2) - Math.PI;
      this.rotation += rotDiff * Math.min(1, dt * 9);
    } else {
      this.velocity.multiplyScalar(0.78);
    }
    this.position.addScaledVector(this.velocity, dt);

    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.rotation;

    const speed = Math.min(1, this.velocity.length());
    const walk = Math.sin(t * 10 * speed) * 0.12 * speed;
    this.body.rotation.z = walk * 0.28;
    this.arms[0].rotation.x = -walk * 1.8;
    this.arms[1].rotation.x =  walk * 1.8;
    this.legs[0].rotation.x =  walk * 1.7;
    this.legs[1].rotation.x = -walk * 1.7;
    this.mesh.position.y = this.position.y + Math.abs(Math.sin(t * 18 * speed)) * 0.04 * speed;

    if (this.celebrateT > 0) {
      this.celebrateT -= dt;
      const c = Math.abs(Math.sin(t * 15));
      this.mesh.position.y += c * 0.35;
      this.arms[0].rotation.z =  Math.PI / 4 + c * 0.7;
      this.arms[1].rotation.z = -Math.PI / 4 - c * 0.7;
    }
    if (this.surpriseT > 0) {
      this.surpriseT -= dt;
      for (const e of this.eyes) e.scale.set(1.4, 1.5, 0.6);
    }

    const happy = this.mood === 'happy' || this.mood === 'excited';
    this.mouthHappy.visible =  happy;
    this.mouthSad.visible   = !happy;

    this.glow.intensity = THREE.MathUtils.lerp(this.glow.intensity, 0.55 + (this.celebrateT > 0 ? 1 : 0), dt * 3);

    if (this.thoughtT > 0) {
      this.thoughtT -= dt;
      this.emotionSprite.material.opacity = THREE.MathUtils.lerp(this.emotionSprite.material.opacity, 0.95, dt * 4);
      this.emotionSprite.position.y = 2.1 + Math.sin(t * 4) * 0.05;
    } else {
      this.emotionSprite.material.opacity = THREE.MathUtils.lerp(this.emotionSprite.material.opacity, 0, dt * 2);
    }
  }

  /* ================= API ================= */
  setThought(text, emoji = null) {
    this.thought = text;
    this.thoughtT = 2.4;
    if (emoji) this._drawEmotion(emoji);
  }
  _drawEmotion(ch) {
    const ctx = this.emotionCtx;
    ctx.clearRect(0, 0, 96, 96);
    ctx.font = 'bold 70px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(ch, 48, 70);
    this.emotionTex.needsUpdate = true;
  }
  moveTo(x, z)       { this.targetPosition.set(x, this.targetPosition.y, z); }
  moveTo3(x, y, z)   { this.targetPosition.set(x, y, z); this.position.y = y; }
  goSleep()          { this.sleeping = true; this.setThought('zzz…', '💤'); }
  wakeUp()           { this.sleeping = false; this.setThought('бодр!', '✨'); }
  celebrate(msg)     { this.celebrateT = 1.2; this.mood = 'excited'; this.setThought(msg || 'ура!', '⭐'); }
  surprise(msg)      { this.surpriseT  = 0.7; this.setThought(msg || '!', '❗'); }
  setMood(m)         { this.mood = m; }

  remember(ep)                 { this.brain.remember(ep); }

  pushExperience(s, a, r, sNext, done) {
    if (!s || !sNext || a == null || a < 0 || a >= ACTION_DIM) return;
    if (!Number.isFinite(r)) r = 0;
    r = Math.max(-15, Math.min(15, r));
    this.brain.push(s, a, r, sNext, !!done);
  }
}
