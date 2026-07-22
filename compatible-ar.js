"use strict";

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MIN_SCALE = 0.72;
const MAX_SCALE = 1.8;

const MOVE_SPEED = 0.0015
const MIN_POSITION_Y = -0.35
const MAX_POSITION_Y = 0.25

export class CompatibleAR {
  constructor(options) {
    // Guarda los elementos entregados por la interfaz principal
    this.stage = options.stage;
    this.gestureLayer = options.gestureLayer;
    this.onScaleChange = options.onScaleChange;

    // Guarda los objetos principales de Three js
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.loader = new GLTFLoader();
    this.modelGroup = null;
    this.currentModel = null;

    // Guarda el estado de giro y ampliacion
    this.scale = 1;
    this.activePointers = new Map();
    this.lastPointerX = null;
    this.lastPointerY = null
    this.pinchStartDistance = null;
    this.pinchStartScale = 1;

    // Guarda funciones enlazadas para retirar eventos despues
    this.boundResize = this.handleResize.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundRender = this.render.bind(this);
  }

  // Prepara una escena transparente sobre el video de la camara
  async initialize() {
    if (this.renderer) {
      return;
    }

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.01,
      20,
    );

    this.camera.position.set(0, 0.34, 0.82);
    this.camera.lookAt(0, 0.02, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false,
    });

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setClearAlpha(0);
    this.renderer.domElement.className = "compatible-ar-canvas";

    this.stage.append(this.renderer.domElement);

    this.modelGroup = new THREE.Group();
    this.modelGroup.position.set(0, -0.1, 0);
    this.modelGroup.visible = false;
    this.scene.add(this.modelGroup);

    this.addLights();
    this.connectEvents();

    window.addEventListener("resize", this.boundResize);
    this.renderer.setAnimationLoop(this.boundRender);
  }

  // Carga el archivo GLB y lo ajusta al diametro configurado
  async setDish(dish) {
    if (!this.renderer) {
      await this.initialize();
    }

    const gltf = await this.loader.loadAsync(dish.model);
    const model = gltf.scene;

    // Limpia el entorno capturado y corrige la orientacion del escaneo
    if (dish.cleanup?.enabled) {
      this.cleanupScannedModel(model, dish.cleanup);
    }

    this.prepareModel(model, dish.diameterM, Boolean(dish.cleanup?.enabled));

    while (this.modelGroup.children.length > 0) {
      this.modelGroup.remove(this.modelGroup.children[0]);
    }

    this.currentModel = model;
    this.modelGroup.add(model);
    this.modelGroup.rotation.set(0, 0, 0);
    this.modelGroup.position.set(0, -0.10, 0)
    this.modelGroup.visible = true;

    this.resetScale();
  }

  // Elimina la servilleta y el entorno que quedaron dentro del escaneo
  cleanupScannedModel(model, cleanup) {
    const origin = new THREE.Vector3(...cleanup.origin);
    const axisX = new THREE.Vector3(...cleanup.axisX).normalize();
    const axisDepth = new THREE.Vector3(...cleanup.axisDepth).normalize();
    const axisUp = new THREE.Vector3(...cleanup.axisUp).normalize();

    const cropCenterX = cleanup.cropCenter[0];
    const cropCenterDepth = cleanup.cropCenter[1];
    const radiusX = cleanup.cropRadius[0];
    const radiusDepth = cleanup.cropRadius[1];

    const correctionMatrix = new THREE.Matrix4().set(
      axisX.x,
      axisX.y,
      axisX.z,
      -axisX.dot(origin),

      axisUp.x,
      axisUp.y,
      axisUp.z,
      -axisUp.dot(origin),

      axisDepth.x,
      axisDepth.y,
      axisDepth.z,
      -axisDepth.dot(origin),

      0,
      0,
      0,
      1,
    );

    model.traverse((object) => {
      if (!object.isMesh || !object.geometry) {
        return;
      }

      const geometry = object.geometry;
      const position = geometry.getAttribute("position");

      if (!position) {
        return;
      }

      const vertexCount = position.count;
      const correctedX = new Float32Array(vertexCount);
      const correctedY = new Float32Array(vertexCount);
      const correctedZ = new Float32Array(vertexCount);

      const point = new THREE.Vector3();
      const relative = new THREE.Vector3();

      // Calcula una sola vez la posicion corregida de cada vertice
      for (let index = 0; index < vertexCount; index += 1) {
        point.fromBufferAttribute(position, index);
        relative.copy(point).sub(origin);

        correctedX[index] = relative.dot(axisX);
        correctedY[index] = relative.dot(axisUp);
        correctedZ[index] = relative.dot(axisDepth);
      }

      const originalIndex = geometry.getIndex();

      const triangleCount = originalIndex
        ? originalIndex.count / 3
        : vertexCount / 3;

      const keptIndices = [];

      // Conserva solo las caras que pertenecen al plato y la comida
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        const a = originalIndex
          ? originalIndex.getX(triangle * 3)
          : triangle * 3;

        const b = originalIndex
          ? originalIndex.getX(triangle * 3 + 1)
          : triangle * 3 + 1;

        const c = originalIndex
          ? originalIndex.getX(triangle * 3 + 2)
          : triangle * 3 + 2;

        const centerX = (correctedX[a] + correctedX[b] + correctedX[c]) / 3;

        const centerY = (correctedY[a] + correctedY[b] + correctedY[c]) / 3;

        const centerDepth = (correctedZ[a] + correctedZ[b] + correctedZ[c]) / 3;

        const ellipse =
          ((centerX - cropCenterX) / radiusX) ** 2 +
          ((centerDepth - cropCenterDepth) / radiusDepth) ** 2;

        const isInside =
          ellipse < 1 &&
          centerY > cleanup.heightMin &&
          centerY < cleanup.heightMax;

        if (isInside) {
          keptIndices.push(a, b, c);
        }
      }

      const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;

      geometry.setIndex(
        new THREE.BufferAttribute(new IndexArray(keptIndices), 1),
      );

      geometry.clearGroups();
      geometry.addGroup(0, keptIndices.length, 0);

      geometry.applyMatrix4(correctionMatrix);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];

      materials.forEach((material) => {
        if (!material) {
          return;
        }

        material.side = THREE.FrontSide;
        material.needsUpdate = true;
      });
    });

    model.rotation.set(0, 0, 0);
    model.updateMatrixWorld(true);
  }

  // Mide el GLB y lo centra sobre la zona de servicio
  prepareModel(model, targetDiameterM, orientationIsCorrected = false) {
    model.traverse((object) => {
      if (!object.isMesh) {
        return;
      }

      object.castShadow = false;
      object.receiveShadow = false;

      if (object.material) {
        object.material.needsUpdate = true;
      }
    });

    model.updateMatrixWorld(true);

    let box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();

    box.getSize(size);

    // Solo intenta adivinar los ejes cuando el modelo no tiene correccion
    if (!orientationIsCorrected) {
      if (size.z < size.y * 0.45 && size.z < size.x * 0.45) {
        model.rotation.x = -Math.PI / 2;
      }

      if (size.x < size.y * 0.45 && size.x < size.z * 0.45) {
        model.rotation.z = Math.PI / 2;
      }
    }

    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    box.getSize(size);

    const measuredDiameter = Math.max(size.x, size.z);

    if (measuredDiameter <= 0) {
      throw new Error("El modelo no tiene dimensiones validas");
    }

    // La escena compatible usa una distancia visual fija equivalente a una mesa cercana
    const visualDiameter = THREE.MathUtils.clamp(targetDiameterM, 0.2, 0.34);

    model.scale.multiplyScalar(visualDiameter / measuredDiameter);
    model.updateMatrixWorld(true);

    box = new THREE.Box3().setFromObject(model);

    const center = new THREE.Vector3();
    box.getCenter(center);

    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
    model.position.y += 0.004;
  }

  // Agrega iluminacion suave al modelo
  addLights() {
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x343447, 2.4);

    this.scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(1.5, 2.5, 1);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8fdcff, 1.2);
    fillLight.position.set(-1.3, 1.3, -1);
    this.scene.add(fillLight);
  }

  // Regresa la ampliacion a su valor inicial
  resetScale() {
    this.scale = 1;

    if (this.modelGroup) {
      this.modelGroup.scale.setScalar(1);
    }

    this.onScaleChange(1);
  }

  // Registra el primer punto de un giro o ampliacion
  handlePointerDown(event) {
    if (!this.currentModel) {
      return;
    }

    this.gestureLayer.setPointerCapture?.(event.pointerId);

    this.activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (this.activePointers.size === 1) {
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY
    }

    if (this.activePointers.size === 2) {
      this.pinchStartDistance = this.getPointerDistance();
      this.pinchStartScale = this.scale;
    }
  }

  // Gira con un dedo y amplia con dos dedos
  handlePointerMove(event) {
    if (!this.activePointers.has(event.pointerId)) {
      return;
    }

    this.activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (
  this.activePointers.size === 1 &&
  this.lastPointerX !== null &&
  this.lastPointerY !== null
) {
  const deltaX = event.clientX - this.lastPointerX
  const deltaY = event.clientY - this.lastPointerY

  // El movimiento horizontal gira el plato
  this.modelGroup.rotation.y += deltaX * 0.009

  // El movimiento vertical sube o baja el plato
  this.modelGroup.position.y = THREE.MathUtils.clamp(
    this.modelGroup.position.y - deltaY * MOVE_SPEED,
    MIN_POSITION_Y,
    MAX_POSITION_Y
  )

  this.lastPointerX = event.clientX
  this.lastPointerY = event.clientY

  return
}

    if (this.activePointers.size === 2 && this.pinchStartDistance) {
      const distance = this.getPointerDistance();
      const ratio = distance / this.pinchStartDistance;

      this.scale = THREE.MathUtils.clamp(
        this.pinchStartScale * ratio,
        MIN_SCALE,
        MAX_SCALE,
      );

      this.modelGroup.scale.setScalar(this.scale);
      this.onScaleChange(this.scale);
    }
  }

  // Retira los puntos tactiles cuando el usuario levanta los dedos
  handlePointerUp(event) {
    this.activePointers.delete(event.pointerId);

    if (this.activePointers.size === 0) {
      this.lastPointerX = null;
      this.lastPointerY = null;
      this.pinchStartDistance = null;
      return;
    }

    if (this.activePointers.size === 1) {
      const point = Array.from(this.activePointers.values())[0];
      this.lastPointerX = point.x;
      this.lastPointerY = point.y;
      this.pinchStartDistance = null;
    }
  }

  // Calcula la distancia entre dos dedos
  getPointerDistance() {
    const points = Array.from(this.activePointers.values());

    if (points.length < 2) {
      return 0;
    }

    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  // Conecta los gestos sobre la capa transparente
  connectEvents() {
    this.gestureLayer.addEventListener("pointerdown", this.boundPointerDown);

    this.gestureLayer.addEventListener("pointermove", this.boundPointerMove);

    this.gestureLayer.addEventListener("pointerup", this.boundPointerUp);

    this.gestureLayer.addEventListener("pointercancel", this.boundPointerUp);
  }

  // Ajusta la escena al cambiar la orientacion del telefono
  handleResize() {
    if (!this.renderer) {
      return;
    }

    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Dibuja el modelo encima de la camara
  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
