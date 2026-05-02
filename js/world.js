import * as THREE from 'three';

export class World {

  constructor(container){

    this.container = container;

    this.scene = new THREE.Scene();

    this.scene.background = new THREE.Color(0x090011);

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth/window.innerHeight,
      0.1,
      1000
    );

    this.camera.position.set(0,5,10);

    this.renderer = new THREE.WebGLRenderer({
      antialias:false,
      powerPreference:"low-power"
    });

    this.renderer.setSize(
      window.innerWidth,
      window.innerHeight
    );

    this.renderer.setPixelRatio(1);

    container.appendChild(
      this.renderer.domElement
    );

    // LIGHT

    const light = new THREE.DirectionalLight(
      0xffffff,
      1
    );

    light.position.set(5,10,5);

    this.scene.add(light);

    const amb = new THREE.AmbientLight(
      0xffffff,
      0.6
    );

    this.scene.add(amb);

    // FLOOR

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30,30),
      new THREE.MeshBasicMaterial({
        color:0x221133
      })
    );

    floor.rotation.x = -Math.PI/2;

    this.scene.add(floor);

    // SIMPLE BOX

    this.box = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshNormalMaterial()
    );

    this.box.position.y = 1;

    this.scene.add(this.box);

    window.addEventListener(
      "resize",
      ()=>this.onResize()
    );

  }

  onResize(){

    this.camera.aspect =
      window.innerWidth/window.innerHeight;

    this.camera.updateProjectionMatrix();

    this.renderer.setSize(
      window.innerWidth,
      window.innerHeight
    );

  }

  updateFloaters(dt){

    this.box.rotation.x += dt;
    this.box.rotation.y += dt;

  }

  render(){

    this.renderer.render(
      this.scene,
      this.camera
    );

  }

}
