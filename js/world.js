/**
 * World 3.0 — fixed Vercel/browser version
 */

import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js?module";

console.log("🌍 world.js loaded");

export class World {

  constructor(container) {

    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, 2)
    );

    const w0 =
      container.clientWidth ||
      window.innerWidth;

    const h0 =
      container.clientHeight ||
      window.innerHeight;

    this.renderer.setSize(w0, h0);

    this.renderer.shadowMap.enabled = true;

    this.renderer.shadowMap.type =
      THREE.PCFSoftShadowMap;

    this.renderer.outputColorSpace =
      THREE.SRGBColorSpace;

    this.renderer.autoClear = false;

    this.renderer.setScissorTest(true);

    container.appendChild(
      this.renderer.domElement
    );

    this.scene = new THREE.Scene();

    this.scene.background =
      new THREE.Color(0x12091f);

    this.camera =
      new THREE.PerspectiveCamera(
        50,
        w0 / h0,
        0.1,
        800
      );

    this.camera.position.set(
      12,
      9,
      14
    );

    this.camera.lookAt(0, 0, 0);

    // fake controls replacement
    this.controls = {
      enabled: false,
      update() {}
    };

    this.setupLights();

    this.buildGround();

    this.cameraMode = "free";

    this.followTarget = null;

    this.cinematicAngle = 0;

    this.split = {
      on: false,
      leftScene: null,
      rightScene: null,
      leftCam: null,
      rightCam: null
    };

    window.addEventListener(
      "resize",
      () => this.onResize()
    );

    this.onResize();
  }

  setupLights() {

    const amb =
      new THREE.AmbientLight(
        0xffffff,
        0.7
      );

    this.scene.add(amb);

    const sun =
      new THREE.DirectionalLight(
        0xffffff,
        1.4
      );

    sun.position.set(10, 20, 10);

    sun.castShadow = true;

    this.scene.add(sun);

    this.sun = sun;
  }

  buildGround() {

    const ground =
      new THREE.Mesh(

        new THREE.CircleGeometry(
          22,
          64
        ),

        new THREE.MeshStandardMaterial({
          color: 0xf0d4e8
        })
      );

    ground.rotation.x =
      -Math.PI / 2;

    ground.receiveShadow = true;

    this.scene.add(ground);

    this.ground = ground;
  }

  setSplit(
    on,
    leftBuild = null,
    rightBuild = null
  ) {

    if (!on) {

      this.split.on = false;

      return;
    }

    this.split.leftScene =
      new THREE.Scene();

    this.split.rightScene =
      new THREE.Scene();

    this.split.leftCam =
      new THREE.PerspectiveCamera(
        50,
        1,
        0.1,
        500
      );

    this.split.rightCam =
      new THREE.PerspectiveCamera(
        50,
        1,
        0.1,
        500
      );

    this.split.leftCam.position.set(
      0,
      6,
      14
    );

    this.split.rightCam.position.set(
      0,
      6,
      14
    );

    this.split.leftCam.lookAt(
      0,
      0,
      0
    );

    this.split.rightCam.lookAt(
      0,
      0,
      0
    );

    if (leftBuild) {
      leftBuild(this.split.leftScene);
    }

    if (rightBuild) {
      rightBuild(this.split.rightScene);
    }

    this.split.on = true;
  }

  setCameraMode(mode, agents) {

    this.cameraMode = mode;

    switch (mode) {

      case "red":

        this.followTarget =
          agents.red;

        break;

      case "blue":

        this.followTarget =
          agents.blue;

        break;

      default:

        this.followTarget = null;
    }
  }

  updateCamera(dt) {

    if (
      (
        this.cameraMode === "red" ||
        this.cameraMode === "blue"
      ) &&
      this.followTarget
    ) {

      const tp =
        this.followTarget.mesh.position;

      const offset =
        new THREE.Vector3(
          0,
          5,
          -6
        );

      this.camera.position.lerp(
        tp.clone().add(offset),
        Math.min(1, dt * 3)
      );

      this.camera.lookAt(tp);

    } else {

      this.controls.update();
    }
  }

  updateFloaters(dt) {

    // placeholder
  }

  onResize() {

    const w =
      this.container.clientWidth ||
      window.innerWidth;

    const h =
      this.container.clientHeight ||
      window.innerHeight;

    if (!w || !h) return;

    this.camera.aspect = w / h;

    this.camera.updateProjectionMatrix();

    this.renderer.setSize(
      w,
      h,
      false
    );
  }

  render() {

    const w =
      this.container.clientWidth ||
      window.innerWidth;

    const h =
      this.container.clientHeight ||
      window.innerHeight;

    this.renderer.clear();

    if (this.split.on) {

      this.renderer.setViewport(
        0,
        0,
        w / 2,
        h
      );

      this.renderer.setScissor(
        0,
        0,
        w / 2,
        h
      );

      this.renderer.render(
        this.split.leftScene,
        this.split.leftCam
      );

      this.renderer.setViewport(
        w / 2,
        0,
        w / 2,
        h
      );

      this.renderer.setScissor(
        w / 2,
        0,
        w / 2,
        h
      );

      this.renderer.render(
        this.split.rightScene,
        this.split.rightCam
      );

    } else {

      this.renderer.setViewport(
        0,
        0,
        w,
        h
      );

      this.renderer.setScissor(
        0,
        0,
        w,
        h
      );

      this.renderer.render(
        this.scene,
        this.camera
      );
    }
  }

  addAgent(agent) {

    this.scene.add(agent.mesh);

  }

  removeAgent(agent) {

    this.scene.remove(agent.mesh);

  }

  clear() {

    const toRemove = [];

    this.scene.traverse(obj => {

      if (obj.userData.gameObj) {

        toRemove.push(obj);

      }

    });

    for (const obj of toRemove) {

      this.scene.remove(obj);

    }
  }
}
