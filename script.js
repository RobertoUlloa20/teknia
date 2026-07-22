"use strict"

const APP_VERSION = "17"

const state = {
  menu: [],
  selectedDish: null,
  arSupported: false,
  surfaceConfirmed: false,
  toastTimer: null,
  arModulePromise: null,
  arExperience: null
}

const elements = {
  welcomeScreen: document.getElementById("welcome-screen"),
  appShell: document.getElementById("app-shell"),
  drawerMenuList: document.getElementById("drawer-menu-list"),
  startArButton: document.getElementById("start-ar-button"),
  compatibilityNote: document.getElementById("compatibility-note"),
  arScreen: document.getElementById("ar-screen"),
  arStage: document.getElementById("ar-stage"),
  arDishName: document.getElementById("ar-dish-name"),
  arModeLabel: document.getElementById("ar-mode-label"),
  closeArButton: document.getElementById("close-ar-button"),
  guideCard: document.getElementById("guide-card"),
  guideIcon: document.getElementById("guide-icon"),
  guideTitle: document.getElementById("guide-title"),
  guideText: document.getElementById("guide-text"),
  placeDishButton: document.getElementById("place-dish-button"),
  changeDishButton: document.getElementById("change-dish-button"),
  resetScaleButton: document.getElementById("reset-scale-button"),
  scaleBadge: document.getElementById("scale-badge"),
  gestureHint: document.getElementById("gesture-hint"),
  gestureLayer: document.getElementById("ar-gesture-layer"),
  menuDrawer: document.getElementById("menu-drawer"),
  drawerCloseButton: document.getElementById("drawer-close-button"),
  helpButton: document.getElementById("help-button"),
  helpDialog: document.getElementById("help-dialog"),
  helpCloseButton: document.getElementById("help-close-button"),
  toast: document.getElementById("toast")
}

// Oculta la bienvenida tambien desde JavaScript cuando este archivo carga
function startWelcome() {
  window.setTimeout(() => {
    elements.welcomeScreen?.classList.add("is-closing")
  }, 3000)
}

// Carga la informacion del menu sin cargar todavia Three js
async function loadMenu() {
  const response = await fetch(`./menu.json?v=${APP_VERSION}`, {
    cache: "no-store"
  })

  if (!response.ok) {
    throw new Error("No se pudo cargar menu.json")
  }

  state.menu = await response.json()
  renderDrawerMenu()
}

// Crea las tarjetas que apareceran despues de confirmar la mesa
function renderDrawerMenu() {
  elements.drawerMenuList.replaceChildren()

  state.menu.forEach((dish) => {
    elements.drawerMenuList.append(createMenuCard(dish))
  })
}

// Crea una tarjeta para cada plato
function createMenuCard(dish) {
  const button = document.createElement("button")

  button.type = "button"
  button.className = "menu-card"
  button.dataset.dishId = dish.id

  button.innerHTML = `
    <span class="menu-visual">${dish.icon}</span>
    <span>
      <strong>${dish.name}</strong>
      <p>${dish.shortDescription}</p>
      <footer>
        <span>${Math.round(dish.diameterM * 100)} cm</span>
        <span>${dish.price}</span>
      </footer>
    </span>
  `

  button.addEventListener("click", async () => {
    await selectDish(dish.id)
  })

  return button
}

// Carga el modulo AR solo cuando el usuario decide escanear
async function ensureARExperience() {
  if (state.arExperience) {
    return state.arExperience
  }

  if (!state.arModulePromise) {
    state.arModulePromise = import(`./ar-experience.js?v=${APP_VERSION}`)
  }

  const module = await state.arModulePromise

  state.arExperience = new module.ARExperience({
    stage: elements.arStage,
    gestureLayer: elements.gestureLayer,
    placeButton: elements.placeDishButton,
    onStatusChange: updateGuide,
    onScaleChange: updateScaleIndicator,
    onModeChange: updateMode,
    onPlacedChange: updatePlacedState,
    onSessionEnd: handleExperienceEnd,
    onMessage: showToast
  })

  await state.arExperience.initialize()

  return state.arExperience
}

// Selecciona un plato despues de confirmar el area
async function selectDish(dishId) {
  if (!state.surfaceConfirmed) {
    showToast("Primero confirma el area de la mesa")
    return
  }

  const dish = state.menu.find((item) => item.id === dishId)

  if (!dish) {
    return
  }

  const arExperience = await ensureARExperience()

  state.selectedDish = dish

  document.querySelectorAll(".menu-card").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.dishId === dish.id)
  })

  elements.arDishName.textContent = dish.name
  elements.scaleBadge.textContent = "CARGANDO"
  closeMenuDrawer()

  updateGuide({
    key: "loading-selected-dish",
    title: "Preparando el plato",
    text: "Estamos ajustando el modelo a sus dimensiones reales",
    icon: "◌",
    tone: "normal"
  })

  try {
    await arExperience.setDish(dish)

    elements.scaleBadge.textContent = "ESCALA 1:1"
    elements.changeDishButton.hidden = false
    updatePlacedState(true)

    updateGuide({
      key: "dish-ready",
      title: "Plato colocado a escala real",
      text: "Mueve el telefono para verlo desde arriba o desde los lados",
      icon: "✓",
      tone: "ready"
    })
  } catch (error) {
    console.error(error)
    elements.scaleBadge.textContent = "ERROR"
    showToast("No se pudo cargar el modelo")
  }
}

// Comprueba WebXR sin cargar Three js
async function checkArSupport() {
  if (!window.isSecureContext || !navigator.xr) {
    setUnsupportedDevice()
    return
  }

  try {
    state.arSupported =
      await navigator.xr.isSessionSupported("immersive-ar")
  } catch (error) {
    console.warn("No se pudo comprobar WebXR", error)
    state.arSupported = false
  }

  if (!state.arSupported) {
    setUnsupportedDevice()
    return
  }

  elements.compatibilityNote.textContent =
    "AR real disponible en este dispositivo"

  elements.startArButton.disabled = false
  elements.startArButton.querySelector("span").textContent =
    "ESCANEAR AREA DE SERVICIO"
}

// Configura la interfaz cuando el equipo no permite AR real
function setUnsupportedDevice() {
  state.arSupported = false

  elements.compatibilityNote.textContent =
    "Abre esta pagina en un telefono Android compatible con WebXR AR"

  elements.startArButton.disabled = true
  elements.startArButton.querySelector("span").textContent =
    "AR NO DISPONIBLE EN ESTE EQUIPO"

  elements.startArButton.querySelector("small").textContent =
    "En computadora no se mostrara un plato sin camara"
}

// Abre la camara AR sin seleccionar un plato primero
async function startScanningExperience() {
  if (!state.arSupported) {
    showToast("Usa un telefono compatible con WebXR AR")
    return
  }

  elements.startArButton.disabled = true
  elements.startArButton.querySelector("span").textContent =
    "CARGANDO CAMARA AR"

  try {
    const arExperience = await ensureARExperience()

    state.selectedDish = null
    state.surfaceConfirmed = false

    elements.arDishName.textContent = "Escaneando area de servicio"
    elements.scaleBadge.textContent = "SIN PLATO"
    elements.changeDishButton.hidden = true
    elements.gestureHint.hidden = true
    elements.gestureLayer.classList.remove("is-active")
    closeMenuDrawer()

    await arExperience.clearDish()

    elements.arScreen.hidden = false
    elements.appShell.hidden = true

    await arExperience.startAR()
  } catch (error) {
    console.error(error)

    elements.arScreen.hidden = true
    elements.appShell.hidden = false
    elements.startArButton.disabled = false
    elements.startArButton.querySelector("span").textContent =
      "ESCANEAR AREA DE SERVICIO"

    showToast("No se pudo cargar la camara AR")

    elements.compatibilityNote.textContent =
      "Error al cargar Three js o WebXR revisa la conexion"
  }
}

// Actualiza los mensajes de escaneo
function updateGuide(status) {
  elements.guideTitle.textContent = status.title
  elements.guideText.textContent = status.text
  elements.guideIcon.textContent = status.icon

  elements.guideCard.classList.toggle("is-ready", status.tone === "ready")
  elements.guideCard.classList.toggle("is-warning", status.tone === "warning")
}

// Actualiza la etiqueta de escala
function updateScaleIndicator(scale) {
  if (!state.selectedDish) {
    elements.scaleBadge.textContent = "SIN PLATO"
    elements.scaleBadge.classList.remove("is-zoomed")
    elements.resetScaleButton.hidden = true
    return
  }

  const isRealScale = Math.abs(scale - 1) < 0.02

  elements.scaleBadge.textContent =
    isRealScale ? "ESCALA 1:1" : `VISTA ${scale.toFixed(2)}X`

  elements.scaleBadge.classList.toggle("is-zoomed", !isRealScale)
  elements.resetScaleButton.hidden = isRealScale
}

// Mantiene la etiqueta de realidad aumentada
function updateMode() {
  elements.arModeLabel.textContent = "REALIDAD AUMENTADA"
}

// Abre el menu despues de confirmar la superficie
function updatePlacedState(placed) {
  if (!placed) {
    state.surfaceConfirmed = false
    elements.gestureHint.hidden = true
    elements.gestureLayer.classList.remove("is-active")
    return
  }

  state.surfaceConfirmed = true

  if (!state.selectedDish) {
    elements.arDishName.textContent = "Area lista"
    elements.scaleBadge.textContent = "ELIGE PLATO"
    openMenuDrawer()
    return
  }

  elements.gestureHint.hidden = false
  elements.gestureLayer.classList.add("is-active")
}

// Regresa a la pantalla inicial al cerrar AR
function handleExperienceEnd() {
  elements.arScreen.hidden = true
  elements.appShell.hidden = false
  elements.startArButton.disabled = false
  elements.startArButton.querySelector("span").textContent =
    "ESCANEAR AREA DE SERVICIO"

  state.surfaceConfirmed = false
  state.selectedDish = null
  closeMenuDrawer()
}

// Abre el menu dentro de la camara
function openMenuDrawer() {
  if (!state.surfaceConfirmed) {
    return
  }

  elements.menuDrawer.hidden = false
}

// Cierra el menu
function closeMenuDrawer() {
  elements.menuDrawer.hidden = true
}

// Muestra un mensaje temporal
function showToast(message) {
  elements.toast.textContent = message
  elements.toast.classList.add("is-visible")

  window.clearTimeout(state.toastTimer)

  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible")
  }, 2800)
}

// Conecta los botones de la interfaz
function wireEvents() {
  elements.startArButton.addEventListener("click", startScanningExperience)

  elements.closeArButton.addEventListener("click", async () => {
    await state.arExperience?.end()
  })

  elements.placeDishButton.addEventListener("click", () => {
    state.arExperience?.placeDish()
  })

  elements.resetScaleButton.addEventListener("click", () => {
    state.arExperience?.resetInspectionScale()
  })

  elements.changeDishButton.addEventListener("click", openMenuDrawer)
  elements.drawerCloseButton.addEventListener("click", closeMenuDrawer)

  elements.helpButton.addEventListener("click", () => {
    elements.helpDialog.showModal()
  })

  elements.helpCloseButton.addEventListener("click", () => {
    elements.helpDialog.close()
  })

  elements.helpDialog.addEventListener("click", (event) => {
    if (event.target === elements.helpDialog) {
      elements.helpDialog.close()
    }
  })
}

// Inicia la parte visual sin depender del modulo AR
async function initializeApp() {
  wireEvents()
  startWelcome()

  try {
    await loadMenu()
  } catch (error) {
    console.error(error)
    showToast("No se pudo cargar el menu")
  }

  await checkArSupport()
}

initializeApp()
console.info("TEKNIA VERSION 17 CARGADA")
