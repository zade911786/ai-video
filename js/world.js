/**
 * World 3.0 — сцена + поддержка split-screen рендеринга.
 *
 *  Главные новинки:
 *   • setSplit(on, left, right): рендерить две независимые камеры в
 *     половинах экрана (для Flappy / Maze / Escape).
 *   • scenes.left / scenes.right: при split-screen каждая половина
 *     имеет СВОЮ сцену с собственной геометрией мини-игры.
 *     Это нужно, чтобы смерть одного агента не рестартила другого.
 *   • Сохранена обычная одиночная камера + свободная/кинематическая.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class World {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const w0 = container.clientWidth  || window.innerWidth;
    const h0 = container.clientHeight || (window.innerHeight - 54);
    this.renderer.setSize(w0, h0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.setScissorTest(true);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.setupSky(this.scene);

    this.camera = new THREE.PerspectiveCamera(50, w0 / h0, 0.1, 800);
    this.camera.position.set(12, 9, 14);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 120;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.setupLights(this.scene);
    this.buildGround(this.scene);
    this.buildDecorations(this.scene);

    this.cameraMode = 'free';
    this.followTarget = null;
    this.cinematicAngle = 0;

    // split screen
    this.split = { on: false, leftScene: null, rightScene: null, leftCam: null, rightCam: null, leftLabel: null, rightLabel: null };

    window.addEventListener('resize', () => this.onResize());
    setTimeout(() => this.onResize(), 100);
    setTimeout(() => this.onResize(), 500);
  }

  /* ============ SKY ============ */
  setupSky(scene) {
    const vertex = `
      varying vec3 vWorldPos;
      void main(){ vWorldPos = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
    const fragment = `
      varying vec3 vWorldPos;
      uniform float uTime;
      void main(){
        float h = normalize(vWorldPos).y;
        vec3 top = vec3(0.25, 0.45, 0.85);
        vec3 mid = vec3(0.85, 0.55, 0.95);
        vec3 bot = vec3(1.00, 0.80, 0.75);
        vec3 col = mix(bot, mid, smoothstep(-0.1, 0.3, h));
        col = mix(col, top, smoothstep(0.3, 0.9, h));
        float stars = step(0.996, fract(sin(dot(floor(normalize(vWorldPos).xz*120.0), vec2(12.9898,78.233)))*43758.5453));
        col += stars * smoothstep(0.6, 0.95, h) * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }`;
    this.skyUniforms = { uTime: { value: 0 } };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(300, 32, 20),
      new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, side: THREE.BackSide, uniforms: this.skyUniforms })
    );
    this.sky = sky; scene.add(sky);
    scene.fog = new THREE.Fog(0xd8bcd8, 45, 180);
  }

  setupLights(scene) {
    const amb = new THREE.AmbientLight(0xbbd0ff, 0.5); scene.add(amb);
    const sun = new THREE.DirectionalLight(0xffeecc, 1.25);
    sun.position.set(18, 28, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
    sun.shadow.camera.top  =  30; sun.shadow.camera.bottom = -30;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0005;
    scene.add(sun); this.sun = sun;
    const rim = new THREE.DirectionalLight(0xff99cc, 0.4); rim.position.set(-12, 10, -10); scene.add(rim);
    const bounce = new THREE.DirectionalLight(0x66ddff, 0.25); bounce.position.set(0, -5, 0); scene.add(bounce);

    this.pointLights = [];
    for (let i = 0; i < 3; i++) {
      const pl = new THREE.PointLight(i === 0 ? 0xff66aa : i === 1 ? 0x66ccff : 0xffcc66, 0.8, 12);
      pl.position.set(Math.cos(i * 2) * 10, 4, Math.sin(i * 2) * 10);
      scene.add(pl); this.pointLights.push(pl);
    }
  }

  buildGround(scene) {
    const arenaGeom = new THREE.CircleGeometry(22, 64);
    const pos = arenaGeom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const r = Math.hypot(x, y);
      if (r > 4) pos.setZ(i, Math.sin(r * 0.4) * 0.2 + Math.cos(x * 0.3) * 0.1);
    }
    arenaGeom.computeVertexNormals();
    const ground = new THREE.Mesh(arenaGeom, new THREE.MeshToonMaterial({ color: 0xf0d4e8 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground); this.ground = ground;

    for (let x = -9; x <= 9; x++) {
      for (let z = -9; z <= 9; z++) {
        if ((x + z) & 1) continue;
        const d2 = x * x + z * z; if (d2 > 90) continue;
        const tile = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshToonMaterial({ color: 0xd890c0, transparent: true, opacity: 0.5 })
        );
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(x, 0.02, z); tile.receiveShadow = true;
        scene.add(tile);
      }
    }
  }

  buildDecorations(scene) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i & 1 ? '#ff5577' : '#ffdd77';
      ctx.fillRect(i * 32, 0, 32, 256);
    }
    const tentTex = new THREE.CanvasTexture(canvas);
    tentTex.wrapS = tentTex.wrapT = THREE.RepeatWrapping;
    tentTex.repeat.set(2, 1);
    const tent = new THREE.Mesh(
      new THREE.ConeGeometry(24, 16, 32, 1, true),
      new THREE.MeshToonMaterial({ map: tentTex, side: THREE.DoubleSide, transparent: true, opacity: 0.18 })
    );
    tent.position.y = 22; scene.add(tent);

    this.mushrooms = [];
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      const rad = 15 + (i & 1) * 1.5;
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.45, 2.0 + (i & 1) * 0.4, 18),
        new THREE.MeshToonMaterial({ color: 0xfff0dd })
      );
      stem.position.set(Math.cos(ang) * rad, 1.0, Math.sin(ang) * rad);
      stem.castShadow = stem.receiveShadow = true;
      scene.add(stem);
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(1.0, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshToonMaterial({
          color: i % 3 === 0 ? 0xff5599 : i % 3 === 1 ? 0x9966ff : 0x66e0c0
        })
      );
      cap.position.set(stem.position.x, 2.0 + (i & 1) * 0.4, stem.position.z);
      cap.castShadow = true; scene.add(cap);
      this.mushrooms.push(cap);
    }

    this.clouds = [];
    const cc = document.createElement('canvas');
    cc.width = cc.height = 128;
    const cx = cc.getContext('2d');
    cx.fillStyle = 'rgba(255,255,255,0.92)';
    for (let i = 0; i < 8; i++) {
      cx.beginPath();
      cx.arc(40 + i * 6, 64 + Math.sin(i) * 10, 30 - i * 1.5, 0, Math.PI * 2);
      cx.fill();
    }
    const cloudTex = new THREE.CanvasTexture(cc);
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.65 }));
      sp.scale.set(6, 3, 1);
      const ang = Math.random() * Math.PI * 2;
      const rad = 20 + Math.random() * 40;
      sp.position.set(Math.cos(ang) * rad, 16 + Math.random() * 8, Math.sin(ang) * rad);
      sp.userData.origX = sp.position.x;
      sp.userData.speed = 0.2 + Math.random() * 0.3;
      scene.add(sp); this.clouds.push(sp);
    }

    this.floaters = [];
    const shapes = [
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.TetrahedronGeometry(0.6),
      new THREE.OctahedronGeometry(0.7),
      new THREE.TorusKnotGeometry(0.3, 0.1, 20, 10),
      new THREE.IcosahedronGeometry(0.5, 0)
    ];
    const colors = [0xff88aa, 0x88ffdd, 0xffee88, 0xaa88ff, 0x88ccff, 0xff99cc];
    for (let i = 0; i < 22; i++) {
      const s = shapes[Math.floor(Math.random() * shapes.length)];
      const c = colors[Math.floor(Math.random() * colors.length)];
      const m = new THREE.Mesh(s, new THREE.MeshToonMaterial({ color: c, emissive: c, emissiveIntensity: 0.3 }));
      const ang = Math.random() * Math.PI * 2;
      const rad = 11 + Math.random() * 16;
      m.position.set(Math.cos(ang) * rad, 3 + Math.random() * 9, Math.sin(ang) * rad);
      m.userData.origY = m.position.y;
      m.userData.phase = Math.random() * Math.PI * 2;
      m.userData.spin = new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize();
      m.castShadow = true;
      scene.add(m); this.floaters.push(m);
    }

    for (let i = 0; i < 70; i++) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 10, 8),
        new THREE.MeshBasicMaterial({
          color: [0xff88cc, 0xffee55, 0x88ffdd, 0xaa88ff][i & 3],
          transparent: true, opacity: 0.85
        })
      );
      const ang = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 16;
      dot.position.set(Math.cos(ang) * r, 0.12, Math.sin(ang) * r);
      scene.add(dot);
    }

    this.carousel = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 3, 16),
      new THREE.MeshToonMaterial({ color: 0xff6688, emissive: 0xff3344, emissiveIntensity: 0.3 })
    );
    pole.position.y = 1.5; this.carousel.add(pole);
    const ringTop = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.08, 10, 32),
      new THREE.MeshToonMaterial({ color: 0xffee88 })
    );
    ringTop.position.y = 3; ringTop.rotation.x = Math.PI / 2;
    this.carousel.add(ringTop);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const str = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 1.5, 4),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
      );
      str.position.set(Math.cos(ang) * 1.2, 2.2, Math.sin(ang) * 1.2);
      this.carousel.add(str);
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 14, 12),
        new THREE.MeshToonMaterial({
          color: i & 1 ? 0x66ccff : 0xff99cc,
          emissive: i & 1 ? 0x66ccff : 0xff99cc, emissiveIntensity: 0.6
        })
      );
      orb.position.set(Math.cos(ang) * 1.2, 1.4, Math.sin(ang) * 1.2);
      this.carousel.add(orb);
    }
    scene.add(this.carousel);
  }

  /* ============ SPLIT SCREEN ============ */
  /**
   * Включает split-mode. Каждая сторона получает собственную сцену.
   * buildFn(scene, sideKey) — колбэк для заполнения сцены.
   */
  setSplit(on, leftBuild = null, rightBuild = null, labels = { left: 'КЕЙН', right: 'ЭЙС' }) {
    if (!on) {
      // dispose scenes
      if (this.split.leftScene)  { this._disposeScene(this.split.leftScene); this.split.leftScene = null; }
      if (this.split.rightScene) { this._disposeScene(this.split.rightScene); this.split.rightScene = null; }
      this.split.on = false;
      this.split.leftLabel = this.split.rightLabel = null;
      return;
    }

    this.split.leftScene  = new THREE.Scene();  this.setupSky(this.split.leftScene);  this.setupLights(this.split.leftScene);
    this.split.rightScene = new THREE.Scene();  this.setupSky(this.split.rightScene); this.setupLights(this.split.rightScene);

    const aspect = this.container.clientWidth / 2 / (this.container.clientHeight || 1);
    this.split.leftCam  = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);
    this.split.rightCam = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);
    this.split.leftCam.position.set(0, 6, 14);
    this.split.rightCam.position.set(0, 6, 14);
    this.split.leftCam.lookAt(0, 0, 0);
    this.split.rightCam.lookAt(0, 0, 0);

    if (leftBuild)  leftBuild(this.split.leftScene,  'left');
    if (rightBuild) rightBuild(this.split.rightScene, 'right');

    this.split.leftLabel  = labels.left || 'L';
    this.split.rightLabel = labels.right || 'R';
    this.split.on = true;
  }

  _disposeScene(scene) {
    scene.traverse(o => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
        else o.material.dispose?.();
      }
    });
  }

  /* ============ CAMERA ============ */
  setCameraMode(mode, agents) {
    this.cameraMode = mode;
    switch (mode) {
      case 'free':      this.controls.enabled = true; break;
      case 'red':       this.followTarget = agents.red;  this.controls.enabled = false; break;
      case 'blue':      this.followTarget = agents.blue; this.controls.enabled = false; break;
      case 'top':
        this.camera.position.set(0, 30, 0.01);
        this.camera.lookAt(0, 0, 0);
        this.controls.target.set(0, 0, 0);
        this.controls.enabled = true; break;
      case 'cinematic':
        this.cinematicAngle = 0;
        this.controls.enabled = false; break;
      case 'iso':
        this.camera.position.set(16, 14, 16);
        this.camera.lookAt(0, 1, 0);
        this.controls.target.set(0, 0, 0);
        this.controls.enabled = true; break;
    }
  }

  updateCamera(dt, agents) {
    if ((this.cameraMode === 'red' || this.cameraMode === 'blue') && this.followTarget) {
      const tp = this.followTarget.mesh.position;
      const offset = new THREE.Vector3(
        Math.sin(this.followTarget.rotation) * -5 - 2,
        5,
        Math.cos(this.followTarget.rotation) * -5 - 2
      );
      this.camera.position.lerp(tp.clone().add(offset), Math.min(1, dt * 3));
      this.camera.lookAt(tp.x, tp.y + 1, tp.z);
    } else if (this.cameraMode === 'cinematic') {
      this.cinematicAngle += dt * 0.13;
      const r = 15;
      this.camera.position.set(
        Math.cos(this.cinematicAngle) * r,
        6 + Math.sin(this.cinematicAngle * 0.5) * 3,
        Math.sin(this.cinematicAngle) * r
      );
      if (agents?.red && agents?.blue) {
        const mid = agents.red.mesh.position.clone().add(agents.blue.mesh.position).multiplyScalar(0.5);
        this.camera.lookAt(mid);
      } else this.camera.lookAt(0, 1, 0);
    } else if (this.controls.enabled) {
      this.controls.update();
    }
  }

  updateFloaters(dt) {
    const t = performance.now() * 0.001;
    if (this.skyUniforms) this.skyUniforms.uTime.value = t;
    for (const m of (this.floaters || [])) {
      m.position.y = m.userData.origY + Math.sin(t + m.userData.phase) * 0.45;
      m.rotation.x += m.userData.spin.x * dt * 0.5;
      m.rotation.y += m.userData.spin.y * dt * 0.5;
      m.rotation.z += m.userData.spin.z * dt * 0.5;
    }
    for (const c of (this.clouds || [])) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 60) c.position.x = -60;
    }
    if (this.carousel) this.carousel.rotation.y += dt * 0.2;
    for (let i = 0; i < (this.pointLights || []).length; i++) {
      this.pointLights[i].intensity = 0.7 + Math.sin(t * 2 + i) * 0.3;
    }
  }

  onResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || (window.innerHeight - 54);
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.split.leftCam)  { this.split.leftCam.aspect  = (w/2) / h; this.split.leftCam.updateProjectionMatrix(); }
    if (this.split.rightCam) { this.split.rightCam.aspect = (w/2) / h; this.split.rightCam.updateProjectionMatrix(); }
    this.renderer.setSize(w, h, false);
  }

  render() {
    const w = this.container.clientWidth || this.renderer.domElement.width;
    const h = this.container.clientHeight || this.renderer.domElement.height;
    this.renderer.setClearColor(0x0a0612, 1);
    this.renderer.clear();

    if (this.split.on) {
      // LEFT
      this.renderer.setViewport(0, 0, w / 2, h);
      this.renderer.setScissor(0, 0, w / 2, h);
      this.renderer.render(this.split.leftScene, this.split.leftCam);
      // RIGHT
      this.renderer.setViewport(w / 2, 0, w / 2, h);
      this.renderer.setScissor(w / 2, 0, w / 2, h);
      this.renderer.render(this.split.rightScene, this.split.rightCam);
      // restore
      this.renderer.setViewport(0, 0, w, h);
      this.renderer.setScissor(0, 0, w, h);
    } else {
      this.renderer.setViewport(0, 0, w, h);
      this.renderer.setScissor(0, 0, w, h);
      this.renderer.render(this.scene, this.camera);
    }
  }

  addAgent(a)     { this.scene.add(a.mesh); }
  removeAgent(a)  { this.scene.remove(a.mesh); }

  clear() {
    const toRemove = [];
    this.scene.traverse(o => { if (o.userData.gameObj) toRemove.push(o); });
    for (const o of toRemove) this.scene.remove(o);
  }
}
