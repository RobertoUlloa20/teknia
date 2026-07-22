"use strict"

import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"

// Un metro de Three js representa un metro del mundo real en WebXR
const SERVICE_MARGIN_M = 0.06

// El plato se eleva tres milimetros para evitar que atraviese la mesa
const MODEL_CLEARANCE_M = 0.003

// Se necesitan varios resultados parecidos para aceptar una superficie
const REQUIRED_STABLE_FRAMES = 18

// Esta distancia evita que el usuario acerque demasiado el telefono
const MIN_SCAN_DISTANCE_M = 0.38

// Esta distancia evita que la superficie quede demasiado lejos
const MAX_SCAN_DISTANCE_M = 1.45

// El modelo se oculta cuando la camara queda debajo de la mesa
const BELOW_TABLE_TOLERANCE_M = 0.025

// La ampliacion visual se limita para evitar escalas exageradas
const MIN_INSPECTION_SCALE = 0.7
const MAX_INSPECTION_SCALE = 1.8

export class ARExperience {
  constructor(options) {
    // Guarda los elementos y funciones que entrega la interfaz principal
    this.stage = options.stage
    this.gestureLayer = options.gestureLayer
    this.placeButton = options.placeButton
    this.onStatusChange = options.onStatusChange
    this.onScaleChange = options.onScaleChange
    this.onModeChange = options.onModeChange
    this.onPlacedChange = options.onPlacedChange
    this.onSessionEnd = options.onSessionEnd
    this.onMessage = options.onMessage

    // Guarda los objetos principales de Three js
    this.renderer = null
    this.scene = null
    this.camera = null
    this.loader = new GLTFLoader()

    // Guarda los objetos que forman la experiencia
    this.reticle = null
    this.placementGroup = null
    this.occlusionPlane = null
    this.inspectionGroup = null
    this.rotationGroup = null
    this.tableMesh = null

    // Guarda el modelo elegido por el usuario
    this.currentDish = null
    this.loadedDishModel = null
    this.modelLoadToken = 0

    // Guarda el estado de WebXR
    this.session = null
    this.referenceSpace = null
    this.viewerSpace = null
    this.hitTestSource = null
    this.lastHitResult = null
    this.lastHitMatrix = new THREE.Matrix4()
    this.lastHitPosition = new THREE.Vector3()
    this.previousHitPosition = new THREE.Vector3()
    this.hasPreviousHit = false
    this.stableFrames = 0
    this.anchor = null

    // Guarda el estado del plato colocado
    this.mode = "none"
    this.placed = false
    this.tableHeight = null
    this.inspectionScale = 1
    this.lastStatusKey = ""

    // Guarda los puntos tactiles usados para girar y ampliar
    this.activePointers = new Map()
    this.lastRotationX = null
    this.pinchStartDistance = null
    this.pinchStartScale = 1

    // Guarda funciones enlazadas para poder retirarlas despues
    this.boundRenderXR = this.renderXR.bind(this)
    this.boundSessionEnd = this.handleSessionEnd.bind(this)
    this.boundSelect = this.handleXRSelect.bind(this)
    this.boundResize = this.handleResize.bind(this)
    this.boundPointerDown = this.handlePointerDown.bind(this)
    this.boundPointerMove = this.handlePointerMove.bind(this)
    this.boundPointerUp = this.handlePointerUp.bind(this)
  }

  // Prepara Three js una sola vez al cargar la pagina
  async initialize() {
    if (this.renderer) {
      return
    }

    this.scene = new THREE.Scene()

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.01,
      20
    )

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false
    })

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setClearAlpha(0)
    this.renderer.xr.enabled = true
    this.renderer.xr.setReferenceSpaceType("local")
    this.renderer.domElement.className = "ar-canvas"

    this.stage.append(this.renderer.domElement)

    this.addLights()
    this.createReticle()
    this.createPlacementGroup()
    this.connectGestureEvents()

    window.addEventListener("resize", this.boundResize)
  }

  // Comprueba soporte sin solicitar permiso de camara
  async checkSupport() {
    if (!window.isSecureContext || !navigator.xr) {
      return false
    }

    try {
      return await navigator.xr.isSessionSupported("immersive-ar")
    } catch (error) {
      console.warn("No se pudo comprobar WebXR", error)
      return false
    }
  }

  // Guarda el plato seleccionado y carga su archivo GLB
  async setDish(dish) {
    this.currentDish = dish

    const token = ++this.modelLoadToken

    this.setStatus({
      key: "loading-model",
      title: "Preparando el plato",
      text: "Estamos ajustando el modelo a sus dimensiones reales",
      icon: "◌",
      tone: "normal"
    })

    let model

    try {
      const gltf = await this.loader.loadAsync(dish.model)
      model = gltf.scene
      this.prepareLoadedModel(model, dish.diameterM)
    } catch (error) {
      console.warn("No se pudo cargar el GLB y se usara un modelo generado", error)
      model = this.createFallbackDish(dish)
    }

    if (token !== this.modelLoadToken) {
      return
    }

    this.loadedDishModel = model
    this.rebuildPlacementContents()

    if (this.placed) {
      this.setStatus({
        key: "dish-changed",
        title: "Plato actualizado",
        text: "El nuevo plato conserva la posicion y su escala configurada",
        icon: "✓",
        tone: "ready"
      })
    }
  }

  // Retira el plato anterior antes de comenzar un nuevo escaneo
  async clearDish() {
    this.modelLoadToken += 1
    this.currentDish = null
    this.loadedDishModel = null

    if (this.rotationGroup) {
      while (this.rotationGroup.children.length > 0) {
        this.rotationGroup.remove(this.rotationGroup.children[0])
      }
    }

    if (this.occlusionPlane && this.placementGroup) {
      this.placementGroup.remove(this.occlusionPlane)
      this.occlusionPlane.geometry.dispose()
      this.occlusionPlane.material.dispose()
      this.occlusionPlane = null
    }

    this.resetInspectionScale()
  }

  // Solicita una sesion AR dentro del toque del usuario
  async startAR() {
    if (!this.renderer) {
      await this.initialize()
    }

    if (!navigator.xr) {
      throw new Error("WebXR no esta disponible")
    }

    this.resetRuntimeState()
    this.mode = "ar"
    this.onModeChange("ar")

    // Activa fondos transparentes antes de abrir la camara AR
    document.documentElement.classList.add("ar-active")
    document.body.classList.add("ar-active")

    // Hit test permite encontrar el punto real donde el usuario enfoca
    let session

    try {
      session = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["dom-overlay", "anchors", "local-floor"],
        domOverlay: {
          root: document.body
        }
      })
    } catch (error) {
      document.documentElement.classList.remove("ar-active")
      document.body.classList.remove("ar-active")
      throw error
    }

    this.session = session

    session.addEventListener("end", this.boundSessionEnd)
    session.addEventListener("select", this.boundSelect)

    await this.renderer.xr.setSession(session)

    this.referenceSpace = await session.requestReferenceSpace("local")
    this.viewerSpace = await session.requestReferenceSpace("viewer")

    this.hitTestSource = await session.requestHitTestSource({
      space: this.viewerSpace
    })

    this.scene.background = null
    this.tableMesh.visible = false
    this.renderer.setAnimationLoop(this.boundRenderXR)

    this.setStatus({
      key: "start-scan",
      title: "Enfoca el area de tu plato",
      text: "Manten el telefono a una altura moderada y mueve la camara lentamente",
      icon: "⌁",
      tone: "normal"
    })
  }

  // Termina la sesion AR y regresa a la pantalla inicial
  async end() {
    if (this.session) {
      await this.session.end()
      return
    }

    this.renderer.setAnimationLoop(null)
    this.finishExperience()
  }

  // Coloca el plato en la ultima superficie estable
  async placeDish() {
    if (this.mode === "demo" || this.placed) {
      return
    }

    if (!this.lastHitMatrix || this.stableFrames < REQUIRED_STABLE_FRAMES) {
      this.onMessage("Mantén el teléfono estable un momento")
      return
    }

    this.placementGroup.matrixAutoUpdate = false
    this.placementGroup.matrix.copy(this.lastHitMatrix)
    this.placementGroup.visible = true

    this.lastHitMatrix.decompose(
      this.lastHitPosition,
      new THREE.Quaternion(),
      new THREE.Vector3()
    )

    this.tableHeight = this.lastHitPosition.y
    this.placed = true
    this.reticle.visible = false
    this.placeButton.hidden = true
    this.onPlacedChange(true)

    this.resetInspectionScale()

    // El ancla mejora la estabilidad cuando el navegador la ofrece
    if (this.lastHitResult && typeof this.lastHitResult.createAnchor === "function") {
      try {
        this.anchor = await this.lastHitResult.createAnchor()
      } catch (error) {
        console.warn("El dispositivo no creo un ancla y se usara la matriz local", error)
      }
    }

    if (!this.currentDish) {
      this.setStatus({
        key: "surface-confirmed",
        title: "Area de servicio lista",
        text: "Ahora selecciona el plato que deseas visualizar",
        icon: "✓",
        tone: "ready"
      })

      return
    }

    const diameterCm = Math.round(this.currentDish.diameterM * 100)
    const zoneCm = Math.round(
      (this.currentDish.diameterM + SERVICE_MARGIN_M * 2) * 100
    )

    this.setStatus({
      key: "placed",
      title: "Plato colocado a escala real",
      text: `${diameterCm} cm dentro de una zona invisible de ${zoneCm} por ${zoneCm} cm`,
      icon: "✓",
      tone: "ready"
    })
  }

  // Regresa el plato a su escala real configurada
  resetInspectionScale() {
    this.inspectionScale = 1

    if (this.inspectionGroup) {
      this.inspectionGroup.scale.setScalar(1)
    }

    this.onScaleChange(1)
  }

  // Agrega iluminacion suave para los modelos GLB
  addLights() {
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x343447, 2.2)
    this.scene.add(hemisphere)

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4)
    keyLight.position.set(1.5, 2.5, 1)
    this.scene.add(keyLight)

    const fillLight = new THREE.DirectionalLight(0x8fdcff, 1.1)
    fillLight.position.set(-1.2, 1.2, -1)
    this.scene.add(fillLight)
  }

  // Crea el indicador 3D que aparece sobre la superficie encontrada
  createReticle() {
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    group.visible = false

    const ringGeometry = new THREE.RingGeometry(0.065, 0.075, 48)
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x00f2ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false
    })

    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = -Math.PI / 2
    group.add(ring)

    const crossMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      depthTest: false
    })

    const crossPoints = [
      new THREE.Vector3(-0.028, 0.001, 0),
      new THREE.Vector3(0.028, 0.001, 0),
      new THREE.Vector3(0, 0.001, -0.028),
      new THREE.Vector3(0, 0.001, 0.028)
    ]

    const crossGeometry = new THREE.BufferGeometry().setFromPoints(crossPoints)
    const cross = new THREE.LineSegments(crossGeometry, crossMaterial)
    group.add(cross)

    this.reticle = group
    this.scene.add(group)
  }

  // Crea el grupo que contiene la zona invisible y el plato
  createPlacementGroup() {
    this.placementGroup = new THREE.Group()
    this.placementGroup.matrixAutoUpdate = false
    this.placementGroup.visible = false
    this.scene.add(this.placementGroup)

    this.inspectionGroup = new THREE.Group()
    this.rotationGroup = new THREE.Group()

    this.inspectionGroup.add(this.rotationGroup)
    this.placementGroup.add(this.inspectionGroup)

    // Esta mesa solo se usa en el modo demostracion
    const tableGeometry = new THREE.PlaneGeometry(1.4, 1.4)
    const tableMaterial = new THREE.MeshStandardMaterial({
      color: 0x171b24,
      roughness: 0.85,
      metalness: 0.05
    })

    this.tableMesh = new THREE.Mesh(tableGeometry, tableMaterial)
    this.tableMesh.rotation.x = -Math.PI / 2
    this.tableMesh.position.y = -0.004
    this.tableMesh.visible = false
    this.scene.add(this.tableMesh)
  }

  // Reconstruye el contenido cuando cambia el plato
  rebuildPlacementContents() {
    if (!this.rotationGroup || !this.currentDish || !this.loadedDishModel) {
      return
    }

    while (this.rotationGroup.children.length > 0) {
      this.rotationGroup.remove(this.rotationGroup.children[0])
    }

    if (this.occlusionPlane) {
      this.placementGroup.remove(this.occlusionPlane)
      this.occlusionPlane.geometry.dispose()
      this.occlusionPlane.material.dispose()
      this.occlusionPlane = null
    }

    const zoneSize =
      this.currentDish.diameterM + SERVICE_MARGIN_M * 2

    // Este plano no tiene color y solo escribe profundidad
    // Desde abajo tapa el plato como lo haria la mesa
    const occlusionGeometry = new THREE.PlaneGeometry(zoneSize, zoneSize)
    const occlusionMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide
    })

    this.occlusionPlane = new THREE.Mesh(
      occlusionGeometry,
      occlusionMaterial
    )

    this.occlusionPlane.rotation.x = -Math.PI / 2
    this.occlusionPlane.position.y = 0
    this.occlusionPlane.renderOrder = -10
    this.placementGroup.add(this.occlusionPlane)

    const shadowGeometry = new THREE.CircleGeometry(
      this.currentDish.diameterM * 0.48,
      64
    )

    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide
    })

    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = MODEL_CLEARANCE_M + 0.0005
    this.rotationGroup.add(shadow)

    this.loadedDishModel.position.y += MODEL_CLEARANCE_M
    this.rotationGroup.add(this.loadedDishModel)

    this.resetInspectionScale()
  }

  // Ajusta cualquier GLB para que mida el diametro real indicado
  prepareLoadedModel(model, targetDiameterM) {
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
    let size = new THREE.Vector3()
    box.getSize(size)

    // Detecta modelos exportados con Z vertical y los convierte a Y vertical
    if (size.z < size.y * 0.45 && size.z < size.x * 0.45) {
      model.rotation.x = -Math.PI / 2
    }

    // Detecta modelos poco comunes exportados con X vertical
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

    const scaleFactor = targetDiameterM / measuredDiameter
    model.scale.multiplyScalar(scaleFactor)
    model.updateMatrixWorld(true)

    box = new THREE.Box3().setFromObject(model)

    const center = new THREE.Vector3()
    box.getCenter(center)

    model.position.x -= center.x
    model.position.z -= center.z
    model.position.y -= box.min.y

    model.updateMatrixWorld(true)
  }

  // Crea un plato sencillo cuando el archivo GLB no se puede cargar
  createFallbackDish(dish) {
    const group = new THREE.Group()
    const radius = dish.diameterM / 2

    const plateMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5f3ec,
      roughness: 0.42,
      metalness: 0.03
    })

    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.96, 0.012, 64),
      plateMaterial
    )

    plate.position.y = 0.006
    group.add(plate)

    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.78, radius * 0.8, 0.008, 64),
      new THREE.MeshStandardMaterial({
        color: 0xe9e6dd,
        roughness: 0.55
      })
    )

    inner.position.y = 0.014
    group.add(inner)

    const foodColor = new THREE.Color(dish.fallbackColor || "#d1844d")
    const foodMaterial = new THREE.MeshStandardMaterial({
      color: foodColor,
      roughness: 0.62
    })

    const food = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.42, 32, 18),
      foodMaterial
    )

    food.scale.y = 0.35
    food.position.y = 0.035
    group.add(food)

    return group
  }

  // Se ejecuta en cada cuadro entregado por WebXR
  renderXR(time, frame) {
    if (!frame || !this.session) {
      return
    }

    const viewerPose = frame.getViewerPose(this.referenceSpace)
    const hitResults = this.hitTestSource
      ? frame.getHitTestResults(this.hitTestSource)
      : []

    if (!this.placed) {
      this.updateScanning(frame, hitResults, viewerPose)
    } else {
      this.updatePlacedObject(frame, viewerPose)
    }

    this.renderer.render(this.scene, this.camera)
  }

  // Analiza la superficie que queda en el centro de la pantalla
  updateScanning(frame, hitResults, viewerPose) {
    if (hitResults.length === 0 || !viewerPose) {
      this.reticle.visible = false
      this.placeButton.hidden = true
      this.stableFrames = 0
      this.hasPreviousHit = false

      this.setStatus({
        key: "searching",
        title: "Busca una superficie libre",
        text: "Mueve el telefono lentamente hacia los lados",
        icon: "⌁",
        tone: "normal"
      })

      return
    }

    const hitResult = hitResults[0]
    const pose = hitResult.getPose(this.referenceSpace)

    if (!pose) {
      return
    }

    this.lastHitResult = hitResult
    this.lastHitMatrix.fromArray(pose.transform.matrix)
    this.reticle.matrix.copy(this.lastHitMatrix)
    this.reticle.visible = true

    const hitPosition = new THREE.Vector3()
    const hitQuaternion = new THREE.Quaternion()
    const hitScale = new THREE.Vector3()

    this.lastHitMatrix.decompose(
      hitPosition,
      hitQuaternion,
      hitScale
    )

    const normal = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(hitQuaternion)
      .normalize()

    const isHorizontal =
      Math.abs(normal.dot(new THREE.Vector3(0, 1, 0))) > 0.82

    const viewerPosition = new THREE.Vector3(
      viewerPose.transform.position.x,
      viewerPose.transform.position.y,
      viewerPose.transform.position.z
    )

    const distance = viewerPosition.distanceTo(hitPosition)

    if (!isHorizontal) {
      this.stableFrames = 0
      this.placeButton.hidden = true

      this.setStatus({
        key: "not-horizontal",
        title: "Busca una superficie plana",
        text: "Apunta al espacio horizontal donde quieres el plato",
        icon: "↔",
        tone: "warning"
      })

      return
    }

    if (distance < MIN_SCAN_DISTANCE_M) {
      this.stableFrames = 0
      this.placeButton.hidden = true

      this.setStatus({
        key: "too-close",
        title: "Alejate un poco",
        text: "Una altura moderada ayuda a reconocer mejor el area",
        icon: "↟",
        tone: "warning"
      })

      return
    }

    if (distance > MAX_SCAN_DISTANCE_M) {
      this.stableFrames = 0
      this.placeButton.hidden = true

      this.setStatus({
        key: "too-far",
        title: "Acercate un poco",
        text: "Enfoca el espacio que tienes directamente frente a ti",
        icon: "↡",
        tone: "warning"
      })

      return
    }

    if (this.hasPreviousHit) {
      const movement = hitPosition.distanceTo(this.previousHitPosition)

      if (movement < 0.025) {
        this.stableFrames += 1
      } else {
        this.stableFrames = Math.max(0, this.stableFrames - 3)
      }
    } else {
      this.hasPreviousHit = true
      this.stableFrames = 1
    }

    this.previousHitPosition.copy(hitPosition)
    this.lastHitPosition.copy(hitPosition)

    if (this.stableFrames >= REQUIRED_STABLE_FRAMES) {
      this.placeButton.hidden = false

      this.setStatus({
        key: "surface-ready",
        title: "Superficie detectada",
        text: "Toca colocar para crear el area invisible del plato",
        icon: "✓",
        tone: "ready"
      })

      return
    }

    this.placeButton.hidden = true

    this.setStatus({
      key: "stabilizing",
      title: "Manten el telefono estable",
      text: "Estamos calculando la posicion de la mesa",
      icon: "◌",
      tone: "normal"
    })
  }

  // Mantiene el ancla y oculta el modelo cuando la mesa debe taparlo
  updatePlacedObject(frame, viewerPose) {
    if (!viewerPose) {
      this.placementGroup.visible = false

      this.setStatus({
        key: "tracking-lost",
        title: "Seguimiento perdido",
        text: "Vuelve a enfocar el area donde colocaste el plato",
        icon: "!",
        tone: "warning"
      })

      return
    }

    if (this.anchor) {
      const anchorPose = frame.getPose(
        this.anchor.anchorSpace,
        this.referenceSpace
      )

      if (anchorPose) {
        this.placementGroup.matrix.fromArray(anchorPose.transform.matrix)
      }
    }

    const viewerY = viewerPose.transform.position.y
    const cameraBelowTable =
      this.tableHeight !== null &&
      viewerY < this.tableHeight - BELOW_TABLE_TOLERANCE_M

    if (cameraBelowTable) {
      this.placementGroup.visible = false

      this.setStatus({
        key: "below-table",
        title: "La mesa oculta el plato",
        text: "Sube el telefono para volver a observarlo",
        icon: "▰",
        tone: "warning"
      })

      return
    }

    this.placementGroup.visible = true

    if (!this.currentDish || !this.loadedDishModel) {
      this.setStatus({
        key: "surface-waiting-menu",
        title: "Area de servicio lista",
        text: "Selecciona un plato para colocarlo en esta posicion",
        icon: "✓",
        tone: "ready"
      })

      return
    }

    this.setStatus({
      key: "placed-active",
      title: "Plato colocado a escala real",
      text: "Mueve el telefono para verlo desde arriba o desde los lados",
      icon: "✓",
      tone: "ready"
    })
  }

  // Permite colocar el plato con un toque nativo de la sesion XR
  handleXRSelect() {
    if (!this.placed && this.stableFrames >= REQUIRED_STABLE_FRAMES) {
      this.placeDish()
    }
  }

  // Registra el primer punto de un giro o de una ampliacion
  handlePointerDown(event) {
    if (!this.placed) {
      return
    }

    this.gestureLayer.setPointerCapture?.(event.pointerId)

    this.activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    })

    if (this.activePointers.size === 1) {
      this.lastRotationX = event.clientX
    }

    if (this.activePointers.size === 2) {
      this.pinchStartDistance = this.getPointerDistance()
      this.pinchStartScale = this.inspectionScale
    }
  }

  // Gira con un dedo y amplia con dos dedos
  handlePointerMove(event) {
    if (!this.activePointers.has(event.pointerId) || !this.placed) {
      return
    }

    this.activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    })

    if (this.activePointers.size === 1 && this.lastRotationX !== null) {
      const deltaX = event.clientX - this.lastRotationX
      this.rotationGroup.rotation.y += deltaX * 0.009
      this.lastRotationX = event.clientX
      return
    }

    if (
      this.activePointers.size === 2 &&
      this.pinchStartDistance &&
      this.pinchStartDistance > 0
    ) {
      const currentDistance = this.getPointerDistance()
      const ratio = currentDistance / this.pinchStartDistance

      this.inspectionScale = THREE.MathUtils.clamp(
        this.pinchStartScale * ratio,
        MIN_INSPECTION_SCALE,
        MAX_INSPECTION_SCALE
      )

      this.inspectionGroup.scale.setScalar(this.inspectionScale)
      this.onScaleChange(this.inspectionScale)
    }
  }

  // Retira puntos tactiles cuando el usuario levanta los dedos
  handlePointerUp(event) {
    this.activePointers.delete(event.pointerId)

    if (this.activePointers.size === 0) {
      this.lastRotationX = null
      this.pinchStartDistance = null
      return
    }

    if (this.activePointers.size === 1) {
      const remaining = Array.from(this.activePointers.values())[0]
      this.lastRotationX = remaining.x
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

  // Conecta los gestos a una capa transparente sobre la experiencia
  connectGestureEvents() {
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

  // Ajusta el lienzo al cambiar la orientacion del dispositivo
  handleResize() {
    if (!this.renderer || !this.camera || this.session) {
      return
    }

    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  // Limpia el estado antes de comenzar una nueva experiencia
  resetRuntimeState() {
    this.placed = false
    this.tableHeight = null
    this.stableFrames = 0
    this.hasPreviousHit = false
    this.lastHitResult = null
    this.anchor = null
    this.reticle.visible = false
    this.placeButton.hidden = true
    this.placementGroup.visible = false
    this.placementGroup.matrixAutoUpdate = false
    this.rotationGroup.rotation.set(0, 0, 0)
    this.resetInspectionScale()
    this.activePointers.clear()
    this.onPlacedChange(false)
  }

  // Recibe el evento que envia el navegador al cerrar WebXR
  handleSessionEnd() {
    this.session?.removeEventListener("end", this.boundSessionEnd)
    this.session?.removeEventListener("select", this.boundSelect)

    this.hitTestSource?.cancel?.()
    this.anchor?.delete?.()

    this.session = null
    this.referenceSpace = null
    this.viewerSpace = null
    this.hitTestSource = null
    this.anchor = null

    this.renderer.setAnimationLoop(null)
    this.finishExperience()
  }

  // Restablece la escena y avisa a la interfaz principal
  finishExperience() {
    document.documentElement.classList.remove("ar-active")
    document.body.classList.remove("ar-active")

    this.mode = "none"
    this.placed = false
    this.reticle.visible = false
    this.placementGroup.visible = false
    this.tableMesh.visible = false
    this.scene.background = null
    this.placeButton.hidden = true
    this.activePointers.clear()
    this.onPlacedChange(false)
    this.onSessionEnd()
  }

  // Evita escribir el mismo mensaje en el DOM en cada cuadro
  setStatus(status) {
    if (status.key === this.lastStatusKey) {
      return
    }

    this.lastStatusKey = status.key
    this.onStatusChange(status)
  }
}
