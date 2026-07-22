"use strict"

import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"

const MIN_SCALE = 0.72
const MAX_SCALE = 1.8

export class CompatibleAR {
  constructor(options) {
    // Guarda los elementos entregados por la interfaz principal
    this.stage = options.stage
    this.gestureLayer = options.gestureLayer
    this.onScaleChange = options.onScaleChange

    // Guarda los objetos principales de Three js
    this.scene = null
    this.camera = null
    this.renderer = null
    this.loader = new GLTFLoader()
    this.modelGroup = null
    this.currentModel = null

    // Guarda el estado de giro y ampliacion
    this.scale = 1
    this.activePointers = new Map()
    this.lastPointerX = null
    this.pinchStartDistance = null
    this.pinchStartScale = 1

    // Guarda funciones enlazadas para retirar eventos despues
    this.boundResize = this.handleResize.bind(this)
    this.boundPointerDown = this.handlePointerDown.bind(this)
    this.boundPointerMove = this.handlePointerMove.bind(this)
    this.boundPointerUp = this.handlePointerUp.bind(this)
    this.boundRender = this.render.bind(this)
  }

  // Prepara una escena transparente sobre el video de la camara
  async initialize() {
    if (this.renderer) {
      return
    }

    this.scene = new THREE.Scene()

    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.01,
      20
    )

    this.camera.position.set(0, 0.34, 0.82)
    this.camera.lookAt(0, 0.02, 0)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false
    })

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setClearAlpha(0)
    this.renderer.domElement.className = "compatible-ar-canvas"

    this.stage.append(this.renderer.domElement)

    this.modelGroup = new THREE.Group()
    this.modelGroup.position.set(0, -0.10, 0)
    this.modelGroup.visible = false
    this.scene.add(this.modelGroup)

    this.addLights()
    this.connectEvents()

    window.addEventListener("resize", this.boundResize)
    this.renderer.setAnimationLoop(this.boundRender)
  }

  // Carga el archivo GLB y lo ajusta al diametro configurado
  async setDish(dish) {
    if (!this.renderer) {
      await this.initialize()
    }

    const gltf = await this.loader.loadAsync(dish.model)
    const model = gltf.scene

    this.prepareModel(model, dish.diameterM)

    while (this.modelGroup.children.length > 0) {
      this.modelGroup.remove(this.modelGroup.children[0])
    }

    this.currentModel = model
    this.modelGroup.add(model)
    this.modelGroup.rotation.set(0, 0, 0)
    this.modelGroup.visible = true

    this.resetScale()
  }

  // Mide el GLB y lo centra sobre la zona de servicio
  prepareModel(model, targetDiameterM) {
    model.traverse((object) => {
      if (!object.isMesh) {
        return
      }

      object.castShadow = false
      object.receiveShadow = false

      if (object.material) {
        object.material.needsUpdate = true
      }
    })

    model.updateMatrixWorld(true)

    let box = new THREE.Box3().setFromObject(model)
    const size = new THREE.Vector3()

    box.getSize(size)

    if (size.z < size.y * 0.45 && size.z < size.x * 0.45) {
      model.rotation.x = -Math.PI / 2
    }

    if (size.x < size.y * 0.45 && size.x < size.z * 0.45) {
      model.rotation.z = Math.PI / 2
    }

    model.updateMatrixWorld(true)
    box = new THREE.Box3().setFromObject(model)
    box.getSize(size)

    const measuredDiameter = Math.max(size.x, size.z)

    if (measuredDiameter <= 0) {
      throw new Error("El modelo no tiene dimensiones validas")
    }

    // La escena compatible usa una distancia visual fija equivalente a una mesa cercana
    const visualDiameter = THREE.MathUtils.clamp(
      targetDiameterM,
      0.20,
      0.34
    )

    model.scale.multiplyScalar(visualDiameter / measuredDiameter)
    model.updateMatrixWorld(true)

    box = new THREE.Box3().setFromObject(model)

    const center = new THREE.Vector3()
    box.getCenter(center)

    model.position.x -= center.x
    model.position.z -= center.z
    model.position.y -= box.min.y
    model.position.y += 0.004
  }

  // Agrega iluminacion suave al modelo
  addLights() {
    const hemisphere = new THREE.HemisphereLight(
      0xffffff,
      0x343447,
      2.4
    )

    this.scene.add(hemisphere)

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6)
    keyLight.position.set(1.5, 2.5, 1)
    this.scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight(0x8fdcff, 1.2)
    fillLight.position.set(-1.3, 1.3, -1)
    this.scene.add(fillLight)
  }

  // Regresa la ampliacion a su valor inicial
  resetScale() {
    this.scale = 1

    if (this.modelGroup) {
      this.modelGroup.scale.setScalar(1)
    }

    this.onScaleChange(1)
  }

  // Registra el primer punto de un giro o ampliacion
  handlePointerDown(event) {
    if (!this.currentModel) {
      return
    }

    this.gestureLayer.setPointerCapture?.(event.pointerId)

    this.activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    })

    if (this.activePointers.size === 1) {
      this.lastPointerX = event.clientX
    }

    if (this.activePointers.size === 2) {
      this.pinchStartDistance = this.getPointerDistance()
      this.pinchStartScale = this.scale
    }
  }

  // Gira con un dedo y amplia con dos dedos
  handlePointerMove(event) {
    if (!this.activePointers.has(event.pointerId)) {
      return
    }

    this.activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    })

    if (
      this.activePointers.size === 1 &&
      this.lastPointerX !== null
    ) {
      const deltaX = event.clientX - this.lastPointerX
      this.modelGroup.rotation.y += deltaX * 0.009
      this.lastPointerX = event.clientX
      return
    }

    if (
      this.activePointers.size === 2 &&
      this.pinchStartDistance
    ) {
      const distance = this.getPointerDistance()
      const ratio = distance / this.pinchStartDistance

      this.scale = THREE.MathUtils.clamp(
        this.pinchStartScale * ratio,
        MIN_SCALE,
        MAX_SCALE
      )

      this.modelGroup.scale.setScalar(this.scale)
      this.onScaleChange(this.scale)
    }
  }

  // Retira los puntos tactiles cuando el usuario levanta los dedos
  handlePointerUp(event) {
    this.activePointers.delete(event.pointerId)

    if (this.activePointers.size === 0) {
      this.lastPointerX = null
      this.pinchStartDistance = null
      return
    }

    if (this.activePointers.size === 1) {
      const point = Array.from(this.activePointers.values())[0]
      this.lastPointerX = point.x
      this.pinchStartDistance = null
    }
  }

  // Calcula la distancia entre dos dedos
  getPointerDistance() {
    const points = Array.from(this.activePointers.values())

    if (points.length < 2) {
      return 0
    }

    return Math.hypot(
      points[0].x - points[1].x,
      points[0].y - points[1].y
    )
  }

  // Conecta los gestos sobre la capa transparente
  connectEvents() {
    this.gestureLayer.addEventListener(
      "pointerdown",
      this.boundPointerDown
    )

    this.gestureLayer.addEventListener(
      "pointermove",
      this.boundPointerMove
    )

    this.gestureLayer.addEventListener(
      "pointerup",
      this.boundPointerUp
    )

    this.gestureLayer.addEventListener(
      "pointercancel",
      this.boundPointerUp
    )
  }

  // Ajusta la escena al cambiar la orientacion del telefono
  handleResize() {
    if (!this.renderer) {
      return
    }

    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  // Dibuja el modelo encima de la camara
  render() {
    this.renderer.render(this.scene, this.camera)
  }
}
