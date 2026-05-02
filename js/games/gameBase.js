/**
 * Game 3.0 — базовый класс для всех мини-игр.
 *
 *  Общие возможности:
 *   • хранение ссылок на world / agents
 *   • добавление объектов в активную сцену (обычную или split-scene)
 *   • корректное teardown() с очисткой геометрии и материалов
 *   • вспомогательные методы для split-screen
 */
export class Game {
  constructor(world, agents) {
    this.world = world;
    this.agents = agents;
    this.objects = [];
    this.sideObjects = { left: [], right: [] };
    this.active = false;
    this.name = 'base';
  }

  /** Добавить объект в обычную (центральную) сцену. */
  add(obj, side = null) {
    obj.userData.gameObj = true;
    if (side === 'left' && this.world.split?.leftScene) {
      this.world.split.leftScene.add(obj);
      this.sideObjects.left.push(obj);
    } else if (side === 'right' && this.world.split?.rightScene) {
      this.world.split.rightScene.add(obj);
      this.sideObjects.right.push(obj);
    } else {
      this.world.scene.add(obj);
      this.objects.push(obj);
    }
    return obj;
  }

  _disposeObj(obj) {
    obj.traverse(o => {
      if (o.geometry?.dispose) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
        else o.material.dispose?.();
      }
    });
  }

  teardown() {
    for (const o of this.objects) {
      o.parent?.remove(o);
      this._disposeObj(o);
    }
    for (const o of this.sideObjects.left)  { o.parent?.remove(o); this._disposeObj(o); }
    for (const o of this.sideObjects.right) { o.parent?.remove(o); this._disposeObj(o); }
    this.objects.length = 0;
    this.sideObjects.left.length = 0;
    this.sideObjects.right.length = 0;

    // если было split — выключаем
    if (this.world.split?.on) this.world.setSplit(false);
    this.active = false;
  }

  setup()    {}
  step(dt)   {}
  getHUD()   { return ''; }
}
