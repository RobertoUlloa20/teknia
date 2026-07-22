"use strict";

const APP_VERSION = "20";

const state = {
  stream: null,
  menu: [],
  selectedDish: null,
  surfaceReady: false,
  scanTimer: null,
  toastTimer: null,
  rendererPromise: null,
  renderer: null,
  orientationAvailable: false,
  lastOrientation: null,
  stableScore: 0,
};

const elements = {
  welcomeScreen: document.getElementById("welcome-screen"),
  cameraFeed: document.getElementById("camera-feed"),
  cameraError: document.getElementById("camera-error"),
  cameraErrorText: document.getElementById("camera-error-text"),
  retryCameraButton: document.getElementById("retry-camera-button"),
  restartCameraButton: document.getElementById("restart-camera-button"),
  cameraTitle: document.getElementById("camera-title"),
  guideCard: document.getElementById("guide-card"),
  guideIcon: document.getElementById("guide-icon"),
  guideTitle: document.getElementById("guide-title"),
  guideText: document.getElementById("guide-text"),
  serviceZone: document.getElementById("service-zone"),
  serviceZoneLabel: document.getElementById("service-zone-label"),
  openMenuButton: document.getElementById("open-menu-button"),
  rescanButton: document.getElementById("rescan-button"),
  resetScaleButton: document.getElementById("reset-scale-button"),
  scaleBadge: document.getElementById("scale-badge"),
  gestureHint: document.getElementById("gesture-hint"),
  gestureLayer: document.getElementById("gesture-layer"),
  menuDrawer: document.getElementById("menu-drawer"),
  closeMenuButton: document.getElementById("close-menu-button"),
  drawerMenuList: document.getElementById("drawer-menu-list"),
  modelStage: document.getElementById("model-stage"),
  toast: document.getElementById("toast"),
};

// Muestra la camara directamente despues de la bienvenida
async function startApplication() {
  wireEvents();
  await loadMenu();

  window.setTimeout(() => {
    elements.welcomeScreen.classList.add("is-closing");
  }, 2900);

  window.setTimeout(() => {
    startCamera();
  }, 1300);
}

// Solicita la camara trasera mediante la API disponible en mas navegadores
async function startCamera() {
  stopCamera();

  elements.cameraError.hidden = true;
  setGuide(
    "Abriendo la camara",
    "Acepta el permiso para enfocar el area de tu plato",
    "◌",
    "normal",
  );

  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraError(
      "Este navegador no permite utilizar la camara abre la pagina en Chrome Safari o Samsung Internet",
    );
    return;
  }

  const constraints = [
    {
      video: {
        facingMode: {
          ideal: "environment",
        },
        width: {
          ideal: 1280,
        },
        height: {
          ideal: 720,
        },
      },
      audio: false,
    },
    {
      video: {
        facingMode: {
          ideal: "environment",
        },
      },
      audio: false,
    },
    {
      video: true,
      audio: false,
    },
  ];

  let mediaStream = null;
  let lastError = null;

  for (const option of constraints) {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia(option);
      break;
    } catch (error) {
      lastError = error;

      if (
        error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError"
      ) {
        break;
      }
    }
  }

  if (!mediaStream) {
    showCameraError(getCameraErrorMessage(lastError));
    return;
  }

  state.stream = mediaStream;
  elements.cameraFeed.srcObject = mediaStream;
  elements.cameraFeed.muted = true;
  elements.cameraFeed.playsInline = true;

  try {
    await elements.cameraFeed.play();
  } catch (error) {
    console.error(error);
    showCameraError(
      "La camara recibio permiso pero el navegador no pudo reproducirla toca Activar camara",
    );
    return;
  }

  beginSurfaceScan();
}

// Detiene las pistas antes de volver a abrir la camara
function stopCamera() {
  window.clearTimeout(state.scanTimer);

  if (state.stream) {
    state.stream.getTracks().forEach((track) => {
      track.stop();
    });

    state.stream = null;
  }

  elements.cameraFeed.srcObject = null;
}

// Convierte errores tecnicos en mensajes faciles de entender
function getCameraErrorMessage(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "El permiso de camara esta bloqueado habilitalo en la configuracion del navegador";

    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No se encontro una camara disponible";

    case "NotReadableError":
    case "TrackStartError":
      return "Otra aplicacion esta utilizando la camara cierra otras aplicaciones y vuelve a intentar";

    default:
      return "No se pudo iniciar la camara recarga la pagina y vuelve a intentar";
  }
}

// Muestra una pantalla de recuperacion cuando la camara falla
function showCameraError(message) {
  elements.cameraErrorText.textContent = message;
  elements.cameraError.hidden = false;

  setGuide(
    "Camara no disponible",
    "Revisa el permiso y vuelve a intentarlo",
    "!",
    "warning",
  );
}

// Inicia la verificacion de estabilidad sobre la zona central
function beginSurfaceScan() {
  state.surfaceReady = false;
  state.stableScore = 0;
  state.lastOrientation = null;

  elements.openMenuButton.hidden = true;
  elements.rescanButton.hidden = true;
  elements.serviceZone.classList.remove("is-ready");
  elements.serviceZone.classList.remove("has-dish");
  elements.serviceZoneLabel.textContent = "BUSCANDO MESA";
  elements.cameraTitle.textContent = "Escaneando area de servicio";
  elements.scaleBadge.textContent = "SIN PLATO";

  setGuide(
    "Enfoca el lugar de tu plato",
    "Apunta al espacio libre y manten el telefono estable",
    "⌁",
    "normal",
  );

  window.clearTimeout(state.scanTimer);

  state.scanTimer = window.setTimeout(() => {
    markSurfaceReady();
  }, 2800);
}

// Marca la zona central como area lista
function markSurfaceReady() {
  if (!state.stream) {
    return;
  }

  state.surfaceReady = true;
  elements.openMenuButton.hidden = false;
  elements.rescanButton.hidden = false;
  elements.serviceZone.classList.add("is-ready");
  elements.serviceZoneLabel.textContent = "AREA DE MESA LISTA";
  elements.cameraTitle.textContent = "Area de servicio lista";
  elements.scaleBadge.textContent = state.selectedDish
    ? "ESCALA 1:1"
    : "ELIGE PLATO";

  setGuide(
    "Area de mesa lista",
    "Toca Menu para seleccionar el plato que deseas visualizar",
    "✓",
    "ready",
  );
}

// Carga menu json sin cargar todavia Three js
async function loadMenu() {
  const response = await fetch(`./menu.json?v=${APP_VERSION}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("No se pudo cargar menu.json");
  }

  state.menu = await response.json();
  renderMenu();
}

// Dibuja todas las tarjetas del menu
function renderMenu() {
  elements.drawerMenuList.replaceChildren();

  state.menu.forEach((dish) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "menu-card";
    button.dataset.dishId = dish.id;

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
    `;

    button.addEventListener("click", async () => {
      await selectDish(dish.id);
    });

    elements.drawerMenuList.append(button);
  });
}

// Abre el menu solo despues de preparar el area
function openMenu() {
  if (!state.surfaceReady) {
    showToast("Primero manten el telefono estable sobre la mesa");
    return;
  }

  elements.menuDrawer.hidden = false;
}

// Cierra el menu
function closeMenu() {
  elements.menuDrawer.hidden = true;
}

// Carga el modelo sobre la imagen de la camara
async function selectDish(dishId) {
  const dish = state.menu.find((item) => item.id === dishId);

  if (!dish || !state.surfaceReady) {
    return;
  }

  state.selectedDish = dish;
  closeMenu();

  document.querySelectorAll(".menu-card").forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.dishId === dish.id);
  });

  elements.cameraTitle.textContent = dish.name;
  elements.scaleBadge.textContent = "CARGANDO";

  setGuide(
    "Preparando el plato",
    "Estamos ajustando el modelo al area enfocada",
    "◌",
    "normal",
  );

  try {
    const renderer = await ensureRenderer();
    await renderer.setDish(dish);

    elements.scaleBadge.textContent = "ESCALA 1:1";
    elements.resetScaleButton.hidden = true;
    elements.gestureHint.hidden = false;
    elements.gestureLayer.classList.add("is-active");
    elements.serviceZone.classList.add("has-dish");

    setGuide(
      "Plato listo",
      "Desliza horizontalmente para girarlo y mueve el telefono para observar la escena",
      "✓",
      "ready",
    );
  } catch (error) {
    console.error(error);
    elements.scaleBadge.textContent = "ERROR";

    setGuide(
      "No se pudo cargar el plato",
      "Revisa la conexion y vuelve a seleccionar el modelo",
      "!",
      "warning",
    );
  }
}

// Carga Three js unicamente cuando se selecciona un plato
async function ensureRenderer() {
  if (state.renderer) {
    return state.renderer;
  }

  if (!state.rendererPromise) {
    state.rendererPromise = import(`./compatible-ar.js?v=${APP_VERSION}`);
  }

  const module = await state.rendererPromise;

  state.renderer = new module.CompatibleAR({
    stage: elements.modelStage,
    gestureLayer: elements.gestureLayer,
    onScaleChange: updateScale,
  });

  await state.renderer.initialize();

  return state.renderer;
}

// Actualiza la etiqueta cuando el usuario amplia la vista
function updateScale(scale) {
  const isRealScale = Math.abs(scale - 1) < 0.02;

  elements.scaleBadge.textContent = isRealScale
    ? "ESCALA 1:1"
    : `VISTA ${scale.toFixed(2)}X`;

  elements.scaleBadge.classList.toggle("is-zoomed", !isRealScale);
  elements.resetScaleButton.hidden = isRealScale;
}

// Actualiza los mensajes pequenos de la interfaz
function setGuide(title, text, icon, tone) {
  elements.guideTitle.textContent = title;
  elements.guideText.textContent = text;
  elements.guideIcon.textContent = icon;

  elements.guideCard.classList.toggle("is-ready", tone === "ready");
  elements.guideCard.classList.toggle("is-warning", tone === "warning");
}

// Muestra mensajes temporales
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");

  window.clearTimeout(state.toastTimer);

  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2800);
}

// Conecta todos los controles
function wireEvents() {
  elements.retryCameraButton.addEventListener("click", startCamera);
  elements.restartCameraButton.addEventListener("click", startCamera);
  elements.openMenuButton.addEventListener("click", openMenu);
  elements.closeMenuButton.addEventListener("click", closeMenu);
  elements.rescanButton.addEventListener("click", beginSurfaceScan);

  elements.resetScaleButton.addEventListener("click", () => {
    state.renderer?.resetScale();
  });

  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      state.stream &&
      elements.cameraFeed.paused
    ) {
      elements.cameraFeed.play().catch(() => {});
    }
  });

  window.addEventListener("pagehide", stopCamera);
  window.addEventListener("beforeunload", stopCamera);
}

// Inicia la aplicacion y captura errores de carga
startApplication().catch((error) => {
  console.error(error);

  window.setTimeout(() => {
    elements.welcomeScreen.classList.add("is-closing");
  }, 1000);

  showCameraError(
    "No se pudo preparar la aplicacion revisa los archivos del proyecto",
  );
});

console.info("TEKNIA VERSION 20 CARGADA");
