"use strict";

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MIN_SCALE = 0.72;
const MAX_SCALE = 2.4;
const ROTATION_SPEED = 0.009;

export class CompatibleAR {
  constructor(options) {
    // Guarda los elementos de la interfaz
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

    // Guarda el estado de los gestos
    this.scale = 1;
    this.activePointers = new Map();
    this.lastPointerX = null;
    this.lastPointerY = null;
    this.pinchStartDistance = null;
    this.pinchStartScale = 1;

    // Guarda objetos reutilizables para rotar
    this.worldUpAxis = new THREE.Vector3(0, 1, 0);
    this.localPitchAxis = new THREE.Vector3(1, 0, 0);
    this.yawQuaternion = new THREE.Quaternion();
    this.pitchQuaternion = new THREE.Quaternion();

    // Guarda funciones enlazadas
    this.boundResize = this.handleResize.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundRender = this.render.bind(this);
  }

  // Prepara una escena transparente sobre la camara
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

    // Este grupo controla la posicion y el zoom general
    this.modelGroup = new THREE.Group();
    this.modelGroup.position.set(0, -0.1, 0);
    this.modelGroup.visible = false;

    this.scene.add(this.modelGroup);

    this.addLights();
    this.connectEvents();

    window.addEventListener("resize", this.boundResize);

    this.renderer.setAnimationLoop(this.boundRender);
  }

  // Carga el plato y crea un centro de rotacion independiente
  async setDish(dish) {
    if (!this.renderer) {
      await this.initialize();
    }

    const gltf = await this.loader.loadAsync(dish.model);
    const model = gltf.scene;

    // Corrige los ejes y elimina parte del fondo capturado
    if (dish.cleanup?.enabled) {
      this.cleanupScannedModel(model, dish.cleanup);
    }

    // Orienta escala y centra el modelo
    this.prepareModel(
      model,
      dish.diameterM,
      Boolean(dish.cleanup?.enabled),
      dish.displayScale ?? 1,
      dish.rotationOffsetDeg ?? null,
    );

    // Este grupo sera el eje real de rotacion
    const rotationGroup = new THREE.Group();

    rotationGroup.position.set(0, 0, 0);
    rotationGroup.rotation.set(0, 0, 0);
    rotationGroup.quaternion.identity();
    rotationGroup.add(model);

    // Elimina el modelo anterior
    while (this.modelGroup.children.length > 0) {
      this.modelGroup.remove(this.modelGroup.children[0]);
    }

    this.currentModel = rotationGroup;
    this.modelGroup.add(rotationGroup);

    // Reinicia la posicion sin permitir movimiento con un dedo
    this.modelGroup.position.set(0, -0.1, 0);
    this.modelGroup.rotation.set(0, 0, 0);
    this.modelGroup.quaternion.identity();
    this.modelGroup.visible = true;

    this.resetScale();
  }

  // Elimina el entorno que quedo alrededor del plato
  cleanupScannedModel(model, cleanup) {
    const origin = new THREE.Vector3(...cleanup.origin);

    const axisX = new THREE.Vector3(...cleanup.axisX).normalize();

    const axisDepth = new THREE.Vector3(...cleanup.axisDepth).normalize();

    const axisUp = new THREE.Vector3(...cleanup.axisUp).normalize();

    const cropCenterX = cleanup.cropCenter[0];
    const cropCenterDepth = cleanup.cropCenter[1];
    const radiusX = cleanup.cropRadius[0];
    const radiusDepth = cleanup.cropRadius[1];

    // Esta matriz deja el plato en ejes corregidos
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

      // Calcula las coordenadas corregidas de cada vertice
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

      // Conserva las caras cercanas al plato y la comida
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

      if (keptIndices.length === 0) {
        throw new Error("El recorte elimino toda la geometria");
      }

      const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;

      geometry.setIndex(
        new THREE.BufferAttribute(new IndexArray(keptIndices), 1),
      );

      geometry.clearGroups();

      geometry.addGroup(0, keptIndices.length, 0);

      geometry.applyMatrix4(correctionMatrix);

      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];

      materials.forEach((material) => {
        if (!material) {
          return;
        }

        material.side = THREE.DoubleSide;

        material.needsUpdate = true;
      });
    });

    // Guarda el centro del plato para evitar que rote desde el borde
    model.userData.pivotCenter = new THREE.Vector3(
      cropCenterX,
      0,
      cropCenterDepth,
    );

    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.set(1, 1, 1);
    model.updateMatrixWorld(true);
  }

  // Mide orienta escala y centra el modelo
  prepareModel(
    model,
    targetDiameterM,
    orientationIsCorrected = false,
    displayScale = 1,
    rotationOffsetDeg = null,
  ) {
    model.traverse((object) => {
      if (!object.isMesh) {
        return;
      }

      object.castShadow = false;
      object.receiveShadow = false;

      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];

      materials.forEach((material) => {
        if (!material) {
          return;
        }

        material.side = THREE.DoubleSide;

        material.needsUpdate = true;
      });
    });

    model.updateMatrixWorld(true);

    let box = new THREE.Box3().setFromObject(model);

    const size = new THREE.Vector3();

    box.getSize(size);

    // Solo intenta corregir ejes cuando no existe limpieza
    if (!orientationIsCorrected) {
      if (size.z < size.y * 0.45 && size.z < size.x * 0.45) {
        model.rotation.x = -Math.PI / 2;
      }

      if (size.x < size.y * 0.45 && size.x < size.z * 0.45) {
        model.rotation.z = Math.PI / 2;
      }
    }

    // Aplica la orientacion inicial configurada
    if (rotationOffsetDeg) {
      model.rotation.x += THREE.MathUtils.degToRad(rotationOffsetDeg.x ?? 0);

      model.rotation.y += THREE.MathUtils.degToRad(rotationOffsetDeg.y ?? 0);

      model.rotation.z += THREE.MathUtils.degToRad(rotationOffsetDeg.z ?? 0);
    }

    model.updateMatrixWorld(true);

    box = new THREE.Box3().setFromObject(model);

    box.getSize(size);

    const measuredDiameter = Math.max(size.x, size.z);

    if (!Number.isFinite(measuredDiameter) || measuredDiameter <= 0) {
      throw new Error("El modelo no tiene dimensiones validas");
    }

    // Calcula el tamaño inicial mostrado
    const visualDiameter = THREE.MathUtils.clamp(targetDiameterM, 0.2, 0.34);

    const finalDiameter = visualDiameter * displayScale;

    model.scale.multiplyScalar(finalDiameter / measuredDiameter);

    model.updateMatrixWorld(true);

    box = new THREE.Box3().setFromObject(model);

    const boxCenter = new THREE.Vector3();

    box.getCenter(boxCenter);

    // Usa el centro real del plato cuando existe limpieza
    if (orientationIsCorrected && model.userData.pivotCenter) {
      const pivotPoint = model.userData.pivotCenter.clone();

      pivotPoint.applyMatrix4(model.matrix);

      model.position.x -= pivotPoint.x;

      model.position.z -= pivotPoint.z;

      model.position.y -= boxCenter.y;
    } else {
      model.position.sub(boxCenter);
    }

    model.updateMatrixWorld(true);
  }

  // Agrega iluminacion suave
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

  // Regresa el zoom a su valor inicial
  resetScale() {
    this.scale = 1;

    if (this.modelGroup) {
      this.modelGroup.scale.setScalar(1);
    }

    this.onScaleChange(1);
  }

  // Registra el primer punto de una rotacion o ampliacion
  handlePointerDown(event) {
    if (!this.currentModel) {
      return;
    }

    event.preventDefault();

    this.gestureLayer.setPointerCapture?.(event.pointerId);

    this.activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (this.activePointers.size === 1) {
      this.lastPointerX = event.clientX;

      this.lastPointerY = event.clientY;
    }

    if (this.activePointers.size === 2) {
      this.pinchStartDistance = this.getPointerDistance();

      this.pinchStartScale = this.scale;
    }
  }

  // Gira el plato como una esfera y amplia con dos dedos
  handlePointerMove(event) {
    if (!this.activePointers.has(event.pointerId)) {
      return;
    }

    event.preventDefault();

    this.activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (
      this.activePointers.size === 1 &&
      this.lastPointerX !== null &&
      this.lastPointerY !== null
    ) {
      const deltaX = event.clientX - this.lastPointerX;

      const deltaY = event.clientY - this.lastPointerY;

      // Crea la rotacion horizontal
      this.yawQuaternion.setFromAxisAngle(
        this.worldUpAxis,
        deltaX * ROTATION_SPEED,
      );

      // Crea la rotacion vertical
      this.pitchQuaternion.setFromAxisAngle(
        this.localPitchAxis,
        deltaY * ROTATION_SPEED,
      );

      // Aplica las rotaciones sobre el mismo centro
      this.currentModel.quaternion.premultiply(this.yawQuaternion);

      this.currentModel.quaternion.multiply(this.pitchQuaternion);

      this.currentModel.quaternion.normalize();

      this.lastPointerX = event.clientX;

      this.lastPointerY = event.clientY;

      return;
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

  // Retira los puntos tactiles
  handlePointerUp(event) {
    event.preventDefault();

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
    const options = {
      passive: false,
    };

    this.gestureLayer.addEventListener(
      "pointerdown",
      this.boundPointerDown,
      options,
    );

    this.gestureLayer.addEventListener(
      "pointermove",
      this.boundPointerMove,
      options,
    );

    this.gestureLayer.addEventListener(
      "pointerup",
      this.boundPointerUp,
      options,
    );

    this.gestureLayer.addEventListener(
      "pointercancel",
      this.boundPointerUp,
      options,
    );
  }

  // Ajusta la escena al cambiar la orientacion
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
