/**
 * Agent 3.0 — fixed browser/Vercel version
 */

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js?module";

import { ACTION_DIM } from "./brain.js";

console.log("🤖 agent.js loaded");

export class Agent {

  constructor(opts = {}) {

    this.id = opts.id || 0;

    this.name = opts.name || "AI";

    this.color = opts.color || "red";

    this.brain = opts.brain;

    this.position = new THREE.Vector3(
      opts.position?.x || 0,
      0,
      opts.position?.z || 0
    );

    this.velocity =
      new THREE.Vector3();

    this.targetPosition =
      this.position.clone();

    this.rotation = 0;

    this.sleeping = false;

    this.mood = "happy";

    this.thought = "";

    this.thoughtT = 0;

    this.celebrateT = 0;

    this.surpriseT = 0;

    this.mesh =
      this.buildCartoonMesh();

    this.mesh.userData.agent = this;

    this.ragdoll = null;
  }

  buildCartoonMesh() {

    const group =
      new THREE.Group();

    const baseColor =
      this.color === "red"
        ? 0xff3b5c
        : 0x3d7cff;

    const body =
      new THREE.Mesh(

        new THREE.SphereGeometry(
          0.45,
          24,
          18
        ),

        new THREE.MeshToonMaterial({
          color: baseColor
        })
      );

    body.position.y = 0.5;

    body.castShadow = true;

    group.add(body);

    this.body = body;

    const head =
      new THREE.Mesh(

        new THREE.SphereGeometry(
          0.4,
          24,
          18
        ),

        new THREE.MeshToonMaterial({
          color: baseColor
        })
      );

    head.position.y = 1.1;

    head.castShadow = true;

    group.add(head);

    this.head = head;

    const eyeMat =
      new THREE.MeshBasicMaterial({
        color: 0xffffff
      });

    const eyeL =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          0.08,
          12,
          10
        ),
        eyeMat
      );

    eyeL.position.set(
      -0.12,
      1.15,
      0.35
    );

    group.add(eyeL);

    const eyeR =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          0.08,
          12,
          10
        ),
        eyeMat
      );

    eyeR.position.set(
      0.12,
      1.15,
      0.35
    );

    group.add(eyeR);

    this.eyes = [eyeL, eyeR];

    const pupilMat =
      new THREE.MeshBasicMaterial({
        color: 0x000000
      });

    const pupilL =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          0.03,
          10,
          8
        ),
        pupilMat
      );

    pupilL.position.set(
      -0.12,
      1.15,
      0.42
    );

    group.add(pupilL);

    const pupilR =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          0.03,
          10,
          8
        ),
        pupilMat
      );

    pupilR.position.set(
      0.12,
      1.15,
      0.42
    );

    group.add(pupilR);

    this.pupils = [
      pupilL,
      pupilR
    ];

    const armMat =
      new THREE.MeshToonMaterial({
        color: baseColor
      });

    const armL =
      new THREE.Mesh(

        new THREE.CapsuleGeometry(
          0.06,
          0.35,
          4,
          8
        ),

        armMat
      );

    armL.position.set(
      -0.5,
      0.55,
      0
    );

    armL.rotation.z =
      Math.PI / 6;

    group.add(armL);

    const armR =
      new THREE.Mesh(

        new THREE.CapsuleGeometry(
          0.06,
          0.35,
          4,
          8
        ),

        armMat
      );

    armR.position.set(
      0.5,
      0.55,
      0
    );

    armR.rotation.z =
      -Math.PI / 6;

    group.add(armR);

    this.arms = [
      armL,
      armR
    ];

    const legMat =
      new THREE.MeshToonMaterial({
        color: 0x1a1a2e
      });

    const legL =
      new THREE.Mesh(

        new THREE.CapsuleGeometry(
          0.08,
          0.25,
          4,
          8
        ),

        legMat
      );

    legL.position.set(
      -0.18,
      0,
      0
    );

    group.add(legL);

    const legR =
      new THREE.Mesh(

        new THREE.CapsuleGeometry(
          0.08,
          0.25,
          4,
          8
        ),

        legMat
      );

    legR.position.set(
      0.18,
      0,
      0
    );

    group.add(legR);

    this.legs = [
      legL,
      legR
    ];

    const glow =
      new THREE.PointLight(
        baseColor,
        0.5,
        5
      );

    glow.position.y = 1;

    group.add(glow);

    this.glow = glow;

    group.position.copy(
      this.position
    );

    return group;
  }

  update(dt) {

    const t =
      performance.now() * 0.001;

    if (this.sleeping) {

      this.mesh.position.y =
        this.position.y +
        Math.sin(t * 2) * 0.02;

      return;
    }

    const dir =
      this.targetPosition
        .clone()
        .sub(this.position);

    dir.y = 0;

    const dist = dir.length();

    if (dist > 0.06) {

      dir.normalize();

      this.velocity.lerp(
        dir.multiplyScalar(3.4),
        Math.min(1, dt * 4.8)
      );

      const targetRot =
        Math.atan2(
          dir.x,
          dir.z
        );

      const rotDiff =
        THREE.MathUtils.euclideanModulo(
          targetRot -
          this.rotation +
          Math.PI,
          Math.PI * 2
        ) - Math.PI;

      this.rotation +=
        rotDiff *
        Math.min(1, dt * 9);

    } else {

      this.velocity.multiplyScalar(
        0.78
      );
    }

    this.position.addScaledVector(
      this.velocity,
      dt
    );

    this.mesh.position.copy(
      this.position
    );

    this.mesh.rotation.y =
      this.rotation;

    const speed =
      Math.min(
        1,
        this.velocity.length()
      );

    const walk =
      Math.sin(
        t * 10 * speed
      ) *
      0.12 *
      speed;

    this.arms[0].rotation.x =
      -walk * 1.8;

    this.arms[1].rotation.x =
      walk * 1.8;

    this.legs[0].rotation.x =
      walk * 1.7;

    this.legs[1].rotation.x =
      -walk * 1.7;

    for (const eye of this.eyes) {

      eye.scale.y =
        Math.sin(
          t * 2 +
          this.id * 5
        ) > 0.995
          ? 0.1
          : 1;
    }
  }

  moveTo(x, z) {

    this.targetPosition.set(
      x,
      this.targetPosition.y,
      z
    );
  }

  moveTo3(x, y, z) {

    this.targetPosition.set(
      x,
      y,
      z
    );

    this.position.y = y;
  }

  goSleep() {

    this.sleeping = true;

  }

  wakeUp() {

    this.sleeping = false;

  }

  celebrate(msg) {

    this.celebrateT = 1.2;

    console.log(
      this.name,
      "celebrates:",
      msg
    );
  }

  surprise(msg) {

    this.surpriseT = 0.7;

    console.log(
      this.name,
      "surprised:",
      msg
    );
  }

  setMood(m) {

    this.mood = m;

  }

  remember(ep) {

    this.brain?.remember?.(ep);

  }

  pushExperience(
    s,
    a,
    r,
    sNext,
    done
  ) {

    if (
      !s ||
      !sNext ||
      a == null ||
      a < 0 ||
      a >= ACTION_DIM
    ) return;

    if (!Number.isFinite(r)) {
      r = 0;
    }

    r = Math.max(
      -15,
      Math.min(15, r)
    );

    this.brain?.push?.(
      s,
      a,
      r,
      sNext,
      !!done
    );
  }
}
