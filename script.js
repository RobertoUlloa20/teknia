"use strict"

import { ARExperience } from "./ar-experience.js"

const APP_VERSION = "13"

const state = {
  menu: [],
  selectedDish: null,
  arSupported: false,
  toastTimer: null
}

const elements = {
  welcomeScreen: document.getElementById("welcome-screen"),
  appShell: document.getElementById("app-shell"),
  menuList: document.getElementById("menu-list"),
  drawerMenuList: document.getElementById("drawer-menu-list"),
  menuCount: document.getElementById("menu-count"),
  selectedName: document.getElementById("selected-name"),
  selectedDescription: document.getElementById("selected-description"),
  selectedDiameter: document.getElementById("selected-diameter"),
  selectedPrice: document.getElementById("selected-price"),
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

// Esta clase concentra toda la logica de Three js y WebXR
const arExperience = new ARExperience({
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

// Espera a que termine la animacion inicial
function startWelcome() {
  window.setTimeout(() => {
    elements.welcomeScreen.classList.add("is-closing")

    window.setTimeout(() => {
      elements.welcomeScreen.hidden = true
      elements.appShell.hidden = false
    }, 850)
  }, 3300)
}

// Carga el archivo que contiene los platos del menu
async function loadMenu() {
  const response = await fetch(`./menu.json?v=${APP_VERSION}`, {
    cache: "no-store"
  })

  if (!response.ok) {
    throw new Error("No se pudo cargar menu.json")
  }

  state.menu = await response.json()
  elements.menuCount.textContent = `${state.menu.length} platos`

  renderMenus()

  if (state.menu.length > 0) {
    await selectDish(state.menu[0].id)
  }
}

// Dibuja el menu principal y el menu que aparece dentro de AR
function renderMenus() {
  elements.menuList.replaceChildren()
  elements.drawerMenuList.replaceChildren()

  state.menu.forEach((dish) => {
    elements.menuList.append(createMenuCard(dish))
    elements.drawerMenuList.append(createMenuCard(dish, true))
  })
}

// Crea una tarjeta reutilizable para cada plato
function createMenuCard(dish, compact = false) {
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

  if (compact) {
    button.classList.add("is-compact")
  }

  button.addEventListener("click", async () => {
    await selectDish(dish.id)

    if (!elements.menuDrawer.hidden) {
      closeMenuDrawer()
    }
  })

  return button
}

// Selecciona un plato y prepara su modelo antes de abrir AR
async function selectDish(dishId) {
  const dish = state.menu.find((item) => item.id === dishId)

  if (!dish) {
    return
  }

  state.selectedDish = dish

  document.querySelectorAll(".menu-card").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.dishId === dish.id)
  })

  elements.selectedName.textContent = dish.name
  elements.selectedDescription.textContent = dish.description
  elements.selectedDiameter.textContent =
    `${Math.round(dish.diameterM * 100)} cm a escala real`
  elements.selectedPrice.textContent = dish.price
  elements.arDishName.textContent = dish.name

  elements.startArButton.disabled = true
  elements.startArButton.querySelector("span").textContent = "PREPARANDO MODELO"

  try {
    await arExperience.setDish(dish)
  } catch (error) {
    console.error(error)
    showToast("Se usara el modelo de respaldo")
  }

  elements.startArButton.disabled = false
  elements.startArButton.querySelector("span").textContent =
    state.arSupported ? "ESCANEAR AREA DE SERVICIO" : "ABRIR DEMO 3D"
}

// Comprueba si el navegador permite una sesion AR inmersiva
async function checkArSupport() {
  state.arSupported = await arExperience.checkSupport()

  if (state.arSupported) {
    elements.compatibilityNote.textContent =
      "AR real disponible en este dispositivo"

    elements.startArButton.querySelector("span").textContent =
      "ESCANEAR AREA DE SERVICIO"

    return
  }

  elements.compatibilityNote.textContent =
    "Este dispositivo usara el modo demo 3D porque no ofrece WebXR AR"

  elements.startArButton.querySelector("span").textContent =
    "ABRIR DEMO 3D"
}

// Inicia AR real o el modo demostracion segun el dispositivo
async function startSelectedExperience() {
  if (!state.selectedDish) {
    showToast("Selecciona un plato")
    return
  }

  elements.arScreen.hidden = false
  elements.appShell.hidden = true
  elements.menuDrawer.hidden = true

  try {
    if (state.arSupported) {
      await arExperience.startAR()
    } else {
      await arExperience.startDemo()
    }
  } catch (error) {
    console.error(error)
    showToast("No se pudo iniciar AR y se abrira el modo demo")
    await arExperience.startDemo()
  }
}

// Actualiza los mensajes pequenos que guian al usuario
function updateGuide(status) {
  elements.guideTitle.textContent = status.title
  elements.guideText.textContent = status.text
  elements.guideIcon.textContent = status.icon

  elements.guideCard.classList.toggle("is-ready", status.tone === "ready")
  elements.guideCard.classList.toggle("is-warning", status.tone === "warning")
}

// Indica si la vista conserva la escala real o usa ampliacion
function updateScaleIndicator(scale) {
  const isRealScale = Math.abs(scale - 1) < 0.02

  elements.scaleBadge.textContent =
    isRealScale ? "ESCALA 1:1" : `VISTA ${scale.toFixed(2)}X`

  elements.scaleBadge.classList.toggle("is-zoomed", !isRealScale)
  elements.resetScaleButton.hidden = isRealScale
}

// Cambia el texto segun AR real o modo demostracion
function updateMode(mode) {
  elements.arModeLabel.textContent =
    mode === "ar" ? "REALIDAD AUMENTADA" : "MODO DEMO 3D"
}

// Muestra controles de giro cuando el plato ya esta colocado
function updatePlacedState(placed) {
  elements.gestureHint.hidden = !placed
  elements.gestureLayer.classList.toggle("is-active", placed)
}

// Regresa al menu cuando termina la experiencia
function handleExperienceEnd() {
  elements.arScreen.hidden = true
  elements.appShell.hidden = false
  closeMenuDrawer()
}

// Abre la lista de platos dentro de la experiencia
function openMenuDrawer() {
  elements.menuDrawer.hidden = false
}

// Cierra la lista de platos
function closeMenuDrawer() {
  elements.menuDrawer.hidden = true
}

// Muestra mensajes temporales
function showToast(message) {
  elements.toast.textContent = message
  elements.toast.classList.add("is-visible")

  window.clearTimeout(state.toastTimer)

  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible")
  }, 2800)
}

// Conecta todos los botones del HTML
function wireEvents() {
  elements.startArButton.addEventListener("click", startSelectedExperience)
  elements.closeArButton.addEventListener("click", () => arExperience.end())
  elements.placeDishButton.addEventListener("click", () => {
    arExperience.placeDish()
  })
  elements.resetScaleButton.addEventListener("click", () => {
    arExperience.resetInspectionScale()
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

// Prepara la aplicacion completa
async function initializeApp() {
  wireEvents()
  startWelcome()

  await arExperience.initialize()
  await checkArSupport()

  try {
    await loadMenu()
  } catch (error) {
    console.error(error)
    showToast("No se pudo cargar el menu")
    elements.compatibilityNote.textContent =
      "Revisa que menu.json se encuentre junto a index.html"
  }
}

initializeApp()
