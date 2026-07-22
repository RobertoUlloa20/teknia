 "use strict";

/*
 * ================================================================
 * TEKNIA - LOGICA PRINCIPAL DE LA INTERFAZ
 * ================================================================
 *
 * Este archivo controla:
 * 1. El reloj que aparece en la pantalla de la camara.
 * 2. La navegacion entre Login, Seleccion de rol y Camara.
 * 3. La simulacion de inicio de sesion.
 * 4. La seleccion del rol Cliente o Mesero.
 * 5. El acceso a la camara del dispositivo.
 * 6. El cambio entre camara frontal y trasera.
 * 7. La captura y descarga de una fotografia.
 * 8. Los mensajes temporales llamados "toast".
 *
 * El HTML ya no contiene instrucciones onclick. Todos los eventos se
 * conectan desde este archivo mediante addEventListener().
 */

/* ----------------------------------------------------------------
 * VARIABLES GLOBALES DE ESTADO
 * ---------------------------------------------------------------- */

// Guarda el identificador de la pantalla que esta visible actualmente.
// Al cargar la pagina, la pantalla activa es la de inicio de sesion.
let activeScreen = "s-cam";

// Guarda el objeto MediaStream entregado por el navegador al abrir la camara.
// Su valor es null mientras no exista una camara activa.
let stream = null;

// Indica que camara se quiere usar.
// "environment" normalmente representa la camara trasera.
// "user" normalmente representa la camara frontal.
let facingMode = "environment";

// Guarda el temporizador utilizado para ocultar el mensaje toast.
// Se conserva aqui para poder cancelar el temporizador anterior cuando
// aparece un nuevo mensaje antes de que termine el anterior.
let toastTimer = null;

// Numero que identifica cada intento de apertura de camara.
// Sirve para evitar que dos solicitudes simultaneas se mezclen.
let cameraRequestId = 0;

// Indica si la pantalla de bienvenida todavía está sobre la cámara.
// Se utiliza para evitar que visibilitychange intente abrir la cámara antes.
let welcomeIsActive = true;

// Guarda los temporizadores de la bienvenida para poder cancelarlos al salir.
let welcomeHideTimer = null;
let welcomeRemoveTimer = null;



/* ----------------------------------------------------------------
 * FUNCIONES AUXILIARES PARA BUSCAR ELEMENTOS
 * ---------------------------------------------------------------- */

/**
 * Busca un elemento por su id.
 *
 * Se usa esta funcion para evitar repetir document.getElementById()
 * muchas veces y para mantener el codigo mas facil de leer.
 *
 * @param {string} id Identificador del elemento HTML.
 * @returns {HTMLElement|null} Elemento encontrado o null si no existe.
 */
function getElement(id) {
  return document.getElementById(id);
}

/* ----------------------------------------------------------------
 * RELOJ DE LA PANTALLA DE CAMARA
 * ---------------------------------------------------------------- */

/**
 * Obtiene la hora actual del dispositivo y la muestra con formato HH:MM.
 */
function updateClock() {
  // Crea un objeto Date con la fecha y hora actuales del dispositivo.
  const now = new Date();

  // Obtiene la hora y agrega un cero a la izquierda cuando es necesario.
  // Ejemplo: 8 se transforma en "08".
  const hours = String(now.getHours()).padStart(2, "0");

  // Obtiene los minutos con el mismo formato de dos digitos.
  const minutes = String(now.getMinutes()).padStart(2, "0");

  // Busca el elemento donde debe mostrarse la hora.
  const clockElement = getElement("cam-time");

  // Solo modifica el texto si el elemento realmente existe.
  if (clockElement) {
    clockElement.textContent = `${hours}:${minutes}`;
  }
}

/* ----------------------------------------------------------------
 * NAVEGACION ENTRE PANTALLAS
 * ---------------------------------------------------------------- */

/**
 * Cambia la pantalla visible de la aplicacion.
 *
 * @param {string} screenId Id de la pantalla que se quiere mostrar.
 * @param {number} tabNumber Numero de la pestana superior correspondiente.
 */
function goTo(screenId, tabNumber) {
  // Si ya estamos en esa pantalla, no ejecutamos el cambio nuevamente.
  if (activeScreen === screenId) {
    return;
  }

  // Si se abandona la pantalla de camara, se detienen sus pistas.
  // Esto evita que la camara continue encendida sin necesidad.
  if (activeScreen === "s-cam" && screenId !== "s-cam") {
    stopCamera();
  }

  // Quita la clase active de todas las pantallas para ocultarlas.
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.remove("active");
  });

  // Quita la clase on de todas las pestanas superiores.
  document.querySelectorAll(".ntab").forEach((tab) => {
    tab.classList.remove("on");
  });

  // Busca la nueva pantalla y la pestana que deben activarse.
  const targetScreen = getElement(screenId);
  const targetTab = getElement(`t${tabNumber}`);

  // Si alguno no existe, se informa el problema en la consola y se detiene.
  if (!targetScreen || !targetTab) {
    console.error("No se encontro la pantalla o pestana solicitada.", {
      screenId,
      tabNumber,
    });
    return;
  }

  // Muestra la pantalla seleccionada.
  targetScreen.classList.add("active");

  // Marca visualmente la pestana seleccionada.
  targetTab.classList.add("on");

  // Actualiza la variable que recuerda la pantalla actual.
  activeScreen = screenId;

  // Los circulos de luz decorativos se muestran en Login y Rol,
  // pero se ocultan en la pantalla de camara.
  const shouldShowOrbs = screenId !== "s-cam";
  const cyanOrb = getElement("orb-c");
  const violetOrb = getElement("orb-v");

  if (cyanOrb) {
    cyanOrb.style.display = shouldShowOrbs ? "block" : "none";
  }

  if (violetOrb) {
    violetOrb.style.display = shouldShowOrbs ? "block" : "none";
  }

  // Cuando se entra a la pantalla de camara se solicita acceso al dispositivo.
  if (screenId === "s-cam") {
    startCamera();
  }
}

/* ----------------------------------------------------------------
 * INICIO DE SESION Y CAMPO TELEFONICO
 * ---------------------------------------------------------------- */

/**
 * Simula el inicio de sesion mediante un proveedor determinado.
 *
 * Por ahora no se conecta con Gmail, Instagram ni un servidor real.
 * Solamente muestra un mensaje y luego abre la pantalla de roles.
 *
 * @param {string} method Metodo elegido por el usuario.
 */
function loginWith(method) {
  // Informa visualmente que se esta procesando el acceso.
  showToast(`Conectando con ${method} ✦`);

  // Espera 1.3 segundos para simular el proceso de conexion.
  window.setTimeout(() => {
    // Abre la pantalla de seleccion de rol.
    goTo("s-role", 2);
  }, 1300);
}

/**
 * Abre o cierra el bloque donde se escribe el numero telefonico.
 */
function togglePhone() {
  // Busca el contenedor desplegable del formulario telefonico.
  const phoneContainer = getElement("pexp");

  // Si el contenedor no existe, no hay nada que modificar.
  if (!phoneContainer) {
    return;
  }

  // Alterna la clase open: si existe la elimina y si no existe la agrega.
  phoneContainer.classList.toggle("open");

  // Cuando el formulario acaba de abrirse, se espera a que termine parte
  // de la animacion y luego se coloca el cursor en el campo telefonico.
  if (phoneContainer.classList.contains("open")) {
    window.setTimeout(() => {
      const phoneInput = getElement("pin");

      if (phoneInput) {
        phoneInput.focus();
      }
    }, 320);
  }
}

/* ----------------------------------------------------------------
 * SELECCION DE ROL
 * ---------------------------------------------------------------- */

/**
 * Marca visualmente una tarjeta de rol y ejecuta su accion.
 *
 * @param {HTMLElement} selectedCard Tarjeta que fue seleccionada.
 * @param {string} role Nombre del rol elegido.
 */
function chooseRole(selectedCard, role) {
  // Elimina la seleccion anterior de todas las tarjetas.
  document.querySelectorAll(".rcard").forEach((card) => {
    card.classList.remove("sel");
  });

  // Marca la tarjeta que el usuario acaba de seleccionar.
  selectedCard.classList.add("sel");

  // El rol Cliente abre inmediatamente la pantalla de camara.
  //
  // Antes existia una espera de 1.4 segundos. En algunos celulares esa
  // espera hacia que la solicitud de camara dejara de considerarse parte
  // directa del toque del usuario y el navegador podia bloquear el video.
  if (role === "Cliente") {
    showToast("🍽️ ¡Bienvenido! Iniciando cámara AR...");

    // La apertura ocurre dentro del mismo evento de toque.
    goTo("s-cam", 3);
    return;
  }

  // El panel del Mesero aun no esta implementado.
  showToast("📋 Panel de trabajo — próximamente");
}

/* ----------------------------------------------------------------
 * CONTROL DE LA CAMARA
 * ---------------------------------------------------------------- */

/**
 * Solicita acceso a la camara e intenta varias configuraciones.
 *
 * La funcion es async porque getUserMedia() devuelve una Promise y puede
 * tardar mientras el usuario acepta o rechaza el permiso.
 */
async function startCamera() {
  // Guarda un numero exclusivo para este intento.
  // Si comienza otro intento, este numero deja de ser el actual.
  const currentRequestId = ++cameraRequestId;

  // Elementos utilizados por la pantalla de camara.
  const video = getElement("video-feed");
  const errorContainer = getElement("cam-error");
  const errorMessage = getElement("error-msg");
  const statusText = getElement("cam-status-txt");
  const scanFrame = getElement("scan-frame");
  const scanLine = getElement("scan-line");
  const scanLabel = getElement("scan-label");

  // El video y los elementos de estado son indispensables.
  if (
    !video ||
    !errorContainer ||
    !errorMessage ||
    !statusText ||
    !scanFrame ||
    !scanLine ||
    !scanLabel
  ) {
    console.error("Faltan elementos HTML necesarios para iniciar la camara.");
    return;
  }

  // Libera una transmision anterior sin cancelar este nuevo intento.
  stopCamera(false);

  // Prepara la interfaz mientras se solicita el permiso.
  statusText.textContent = "INICIANDO";
  scanFrame.style.opacity = "0.4";
  scanLine.style.display = "none";
  scanLabel.textContent = "Preparando cámara...";
  errorContainer.classList.remove("show");

  // La camara web solo funciona en navegadores compatibles y en HTTPS.
  if (!navigator.mediaDevices?.getUserMedia) {
    errorContainer.classList.add("show");
    errorMessage.textContent =
      "Tu navegador no permite utilizar la cámara.\n" +
      "Abre la página con Chrome o Safari mediante HTTPS.";
    statusText.textContent = "NO COMPATIBLE";
    return;
  }

  /*
   * Se prueban configuraciones progresivamente mas sencillas.
   *
   * No se empieza con facingMode exact porque algunos celulares anuncian
   * una camara trasera, pero rechazan la restriccion exacta y dejan la
   * reproduccion en un estado inconsistente.
   */
  const constraintsList = [
    {
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    },
    {
      video: {
        facingMode: { ideal: facingMode },
      },
      audio: false,
    },
    {
      video: true,
      audio: false,
    },
  ];

  let obtainedStream = null;
  let lastError = null;

  // Intenta cada configuracion hasta conseguir una transmision valida.
  for (const constraints of constraintsList) {
    try {
      obtainedStream =
        await navigator.mediaDevices.getUserMedia(constraints);
      break;
    } catch (error) {
      lastError = error;

      // Si el usuario rechazo el permiso, no tiene sentido seguir probando.
      if (
        error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError"
      ) {
        break;
      }

      console.warn(
        "La configuracion de camara no funciono:",
        constraints,
        error,
      );
    }
  }

  /*
   * Si durante la espera se inicio otra solicitud o el usuario abandono
   * la pantalla, se detiene el flujo obtenido para no dejar la camara activa.
   */
  if (
    currentRequestId !== cameraRequestId ||
    activeScreen !== "s-cam"
  ) {
    obtainedStream?.getTracks().forEach((track) => track.stop());
    return;
  }

  // Si no se obtuvo una transmision, muestra un mensaje segun el error.
  if (!obtainedStream) {
    errorContainer.classList.add("show");
    statusText.textContent = "SIN CÁMARA";

    switch (lastError?.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        errorMessage.textContent =
          "El permiso de cámara está bloqueado.\n" +
          "Actívalo en los permisos del navegador y toca «Activar Cámara».";
        break;

      case "NotFoundError":
      case "DevicesNotFoundError":
        errorMessage.textContent =
          "No se encontró una cámara disponible en este dispositivo.";
        break;

      case "NotReadableError":
      case "TrackStartError":
        errorMessage.textContent =
          "La cámara está siendo utilizada por otra aplicación.\n" +
          "Cierra otras aplicaciones y vuelve a intentarlo.";
        break;

      default:
        errorMessage.textContent =
          "No se pudo iniciar la cámara.\n" +
          "Recarga la página y vuelve a intentarlo.";
        break;
    }

    console.error("Error al abrir la camara:", lastError);
    return;
  }

  // Desde este punto la transmision pasa a ser la camara activa de la app.
  stream = obtainedStream;

  /*
   * Estos valores son esenciales en celulares:
   *
   * muted:
   * evita que el navegador bloquee la reproduccion automatica.
   *
   * playsInline:
   * mantiene el video dentro de la interfaz, especialmente en iPhone.
   *
   * autoplay:
   * solicita que la imagen comience sin un segundo toque.
   */
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;

  // Tambien se colocan como atributos para mejorar compatibilidad con Safari.
  video.setAttribute("muted", "");
  video.setAttribute("autoplay", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");

  // Asegura que el CSS no deje el video oculto.
  video.style.display = "block";
  video.style.visibility = "visible";
  video.style.opacity = "1";

  // Conecta la transmision con la etiqueta <video>.
  video.srcObject = stream;

  try {
    /*
     * Si el navegador aun no conoce las dimensiones del video, espera a que
     * cargue los metadatos. El listener se registra antes de depender de él.
     */
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await waitForVideoEvent(video, "loadedmetadata", 8000);
    }

    // Inicia realmente la reproducción y espera su confirmacion.
    await video.play();

    /*
     * En algunos Android play() se resuelve antes de recibir el primer cuadro.
     * Esperamos loadeddata si todavía no hay datos de imagen.
     */
    if (
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      await waitForVideoEvent(video, "loadeddata", 8000);
    }
  } catch (error) {
    console.error("La camara se abrio pero el video no pudo reproducirse:", error);

    // Libera la camara para que el boton de reintento pueda solicitarla otra vez.
    stopCamera();

    errorContainer.classList.add("show");
    errorMessage.textContent =
      "La cámara recibió permiso, pero el navegador no mostró la imagen.\n" +
      "Toca «Activar Cámara» para volver a intentarlo.";
    statusText.textContent = "TOCA ACTIVAR";
    return;
  }

  // Verifica nuevamente que el intento siga siendo el actual.
  if (
    currentRequestId !== cameraRequestId ||
    activeScreen !== "s-cam"
  ) {
    stopCamera();
    return;
  }

  // La imagen ya esta lista: actualiza toda la interfaz.
  errorContainer.classList.remove("show");
  statusText.textContent = "AR ACTIVO";
  scanFrame.style.opacity = "1";
  scanLine.style.display = "block";
  scanLabel.textContent = "Enfoca tu mesa";

  // Informa cual camara se solicito.
  const flipLabel = getElement("flip-label");

  if (flipLabel) {
    flipLabel.textContent =
      facingMode === "environment"
        ? "📷 Cámara trasera"
        : "🤳 Cámara frontal";

    flipLabel.style.opacity = "1";

    window.setTimeout(() => {
      flipLabel.style.opacity = "0";
    }, 2500);
  }

  showToast(
    facingMode === "environment"
      ? "📷 Cámara trasera activa"
      : "🤳 Cámara frontal activa",
  );
}

/**
 * Espera un evento concreto del elemento de video.
 *
 * @param {HTMLVideoElement} video Elemento que muestra la camara.
 * @param {string} eventName Evento esperado, por ejemplo loadedmetadata.
 * @param {number} timeoutMilliseconds Tiempo maximo de espera.
 * @returns {Promise<void>}
 */
function waitForVideoEvent(video, eventName, timeoutMilliseconds) {
  return new Promise((resolve, reject) => {
    // Cancela la espera si el celular no entrega imagen dentro del limite.
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `La cámara no produjo el evento ${eventName} dentro del tiempo esperado.`,
        ),
      );
    }, timeoutMilliseconds);

    // Finaliza correctamente cuando llega el evento esperado.
    const handleSuccess = () => {
      cleanup();
      resolve();
    };

    // También captura un error nativo del elemento de video.
    const handleError = () => {
      cleanup();
      reject(video.error || new Error("El elemento de video produjo un error."));
    };

    // Elimina listeners y temporizador para evitar acumulaciones.
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener(eventName, handleSuccess);
      video.removeEventListener("error", handleError);
    };

    video.addEventListener(eventName, handleSuccess, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

/**
 * Detiene la camara y libera los recursos del dispositivo.
 */
function stopCamera(invalidatePendingRequest = true) {
  /*
   * Cuando se detiene por navegación o por error, invalida cualquier
   * getUserMedia que todavía esté esperando respuesta.
   *
   * startCamera usa false al limpiar un flujo anterior, porque en ese caso
   * no quiere cancelar su propia solicitud nueva.
   */
  if (invalidatePendingRequest) {
    cameraRequestId += 1;
  }

  // Detiene todas las pistas del MediaStream activo.
  if (stream) {
    stream.getTracks().forEach((track) => {
      track.stop();
    });

    stream = null;
  }

  const video = getElement("video-feed");

  if (video) {
    // Pausa antes de retirar srcObject para limpiar correctamente el reproductor.
    try {
      video.pause();
    } catch (error) {
      console.warn("No fue necesario pausar el video:", error);
    }

    video.srcObject = null;
  }

  const statusText = getElement("cam-status-txt");

  if (statusText) {
    statusText.textContent = "APAGADO";
  }
}

/**
 * Alterna entre la camara frontal y la camara trasera.
 */
async function flipCamera() {
  // Si se usaba la trasera, cambia a la frontal; en caso contrario,
  // vuelve a solicitar la trasera.
  facingMode = facingMode === "environment" ? "user" : "environment";

  // Reinicia la camara usando la nueva orientacion.
  await startCamera();
}

/* ----------------------------------------------------------------
 * CAPTURA DE FOTOGRAFIAS
 * ---------------------------------------------------------------- */

/**
 * Copia el fotograma actual del video a un canvas y lo descarga como JPG.
 */
function capturePhoto() {
  // Busca el video que contiene la imagen de la camara.
  const video = getElement("video-feed");

  // Si la camara no esta activa, no existe una imagen que capturar.
  if (!stream || !video || !video.srcObject) {
    showToast("⚠️ Activa la cámara primero");
    return;
  }

  // Crea un elemento div temporal para simular el destello de una camara.
  const flash = document.createElement("div");

  // Los estilos se asignan directamente porque el elemento solo existe
  // durante una fraccion de segundo y no forma parte permanente del diseño.
  flash.style.cssText =
    "position:fixed;" +
    "inset:0;" +
    "background:#fff;" +
    "z-index:998;" +
    "opacity:.85;" +
    "pointer-events:none;" +
    "transition:opacity .4s;";

  // Agrega el destello al documento.
  document.body.appendChild(flash);

  // Comienza a volver transparente el destello despues de 120 milisegundos.
  window.setTimeout(() => {
    flash.style.opacity = "0";

    // Elimina el elemento cuando termina su transicion visual.
    window.setTimeout(() => {
      flash.remove();
    }, 400);
  }, 120);

  // Crea un canvas invisible donde se dibujara el fotograma actual.
  const canvas = document.createElement("canvas");

  // Usa las dimensiones reales del video. Si aun no estan disponibles,
  // emplea una resolucion de respaldo de 1280 x 720.
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;

  // Solicita el contexto 2D, que permite dibujar imagenes sobre el canvas.
  const context = canvas.getContext("2d");

  // Si el navegador no entrega el contexto, se informa el fallo.
  if (!context) {
    showToast("⚠️ No se pudo crear la captura");
    return;
  }

  // Copia el fotograma visible del video dentro del canvas.
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  try {
    // Convierte el contenido del canvas en un archivo JPEG.
    // El tercer parametro, 0.92, representa una calidad del 92 %.
    canvas.toBlob(
      (blob) => {
        // Si el navegador no genero el archivo, se muestra un mensaje generico.
        if (!blob) {
          showToast("📸 ¡Captura realizada!");
          return;
        }

        // Crea una URL temporal que representa al archivo generado en memoria.
        const imageUrl = URL.createObjectURL(blob);

        // Crea un enlace temporal para iniciar la descarga.
        const downloadLink = document.createElement("a");
        downloadLink.href = imageUrl;

        // Date.now() agrega la fecha en milisegundos y evita nombres repetidos.
        downloadLink.download = `TEKNIA_AR_${Date.now()}.jpg`;

        // Ejecuta el clic del enlace de forma programatica.
        downloadLink.click();

        // Libera la URL temporal despues de iniciar la descarga.
        window.setTimeout(() => {
          URL.revokeObjectURL(imageUrl);
        }, 1000);

        // Confirma la accion al usuario.
        showToast("📸 ¡Foto guardada!");
      },
      "image/jpeg",
      0.92,
    );
  } catch (error) {
    // Algunos navegadores pueden bloquear la descarga automatica.
    // El error se registra para poder revisarlo durante el desarrollo.
    console.error("No se pudo descargar la captura:", error);

    // Aun asi se informa que el fotograma fue procesado.
    showToast("📸 ¡Captura realizada!");
  }
}

/* ----------------------------------------------------------------
 * MENSAJES TOAST
 * ---------------------------------------------------------------- */

/**
 * Muestra un mensaje temporal en la parte inferior de la interfaz.
 *
 * @param {string} message Texto que se quiere mostrar.
 */
function showToast(message) {
  // Busca el contenedor del mensaje.
  const toastElement = getElement("toast-el");

  // Si no existe, se evita producir un error.
  if (!toastElement) {
    return;
  }

  // Coloca el mensaje recibido dentro del contenedor.
  toastElement.textContent = message;

  // Agrega la clase que activa la animacion de entrada.
  toastElement.classList.add("show");

  // Cancela el temporizador anterior si habia otro mensaje visible.
  window.clearTimeout(toastTimer);

  // Programa la desaparicion del mensaje despues de 2.8 segundos.
  toastTimer = window.setTimeout(() => {
    toastElement.classList.remove("show");
  }, 2800);
}

/* ----------------------------------------------------------------
 * CONEXION DE EVENTOS DEL HTML CON LAS FUNCIONES
 * ---------------------------------------------------------------- */

/**
 * Conecta todos los botones y elementos interactivos cuando el HTML ya
 * esta disponible. Gracias al atributo defer del script, esta funcion se
 * ejecuta despues de que el navegador haya interpretado el documento.
 */
function initializeEventListeners() {
  // Conecta las pestanas superiores y el boton Volver.
  // Cada elemento incluye data-screen-target y data-tab-number en el HTML.
  document.querySelectorAll("[data-screen-target]").forEach((element) => {
    element.addEventListener("click", () => {
      // Lee el id de la pantalla desde el atributo data-screen-target.
      const screenId = element.dataset.screenTarget;

      // Convierte el numero de pestana, que llega como texto, a Number.
      const tabNumber = Number(element.dataset.tabNumber);

      // Solo navega si ambos datos son validos.
      if (screenId && Number.isFinite(tabNumber)) {
        goTo(screenId, tabNumber);
      }
    });
  });

  // Conecta Gmail, Instagram, Telefono y Accede aqui.
  document.querySelectorAll("[data-login-method]").forEach((element) => {
    element.addEventListener("click", () => {
      // Lee el metodo indicado en el atributo data-login-method.
      const method = element.dataset.loginMethod;

      if (method) {
        loginWith(method);
      }
    });
  });

  // Conecta el boton que abre o cierra el campo telefonico.
  const togglePhoneButton = getElement("toggle-phone-button");

  if (togglePhoneButton) {
    togglePhoneButton.addEventListener("click", togglePhone);
  }

  // Conecta todas las tarjetas de rol.
  document.querySelectorAll("[data-role]").forEach((card) => {
    card.addEventListener("click", () => {
      // Obtiene Cliente o Mesero desde el HTML.
      const role = card.dataset.role;

      if (role) {
        chooseRole(card, role);
      }
    });
  });

  // Conecta los elementos que solamente deben mostrar un toast.
  document.querySelectorAll("[data-toast-message]").forEach((element) => {
    element.addEventListener("click", () => {
      // Lee el mensaje configurado en el atributo data-toast-message.
      const message = element.dataset.toastMessage;

      if (message) {
        showToast(message);
      }
    });
  });

  // Conecta el boton para volver a solicitar el permiso de camara.
  const retryCameraButton = getElement("retry-camera-button");

  if (retryCameraButton) {
    retryCameraButton.addEventListener("click", startCamera);
  }

  // Conecta el boton central que captura una fotografia.
  const capturePhotoButton = getElement("capture-photo-button");

  if (capturePhotoButton) {
    capturePhotoButton.addEventListener("click", capturePhoto);
  }

  // Conecta el boton que cambia entre camara frontal y trasera.
  const flipCameraButton = getElement("flip-camera-button");

  if (flipCameraButton) {
    flipCameraButton.addEventListener("click", flipCamera);
  }
}


/* ----------------------------------------------------------------
 * PANTALLA DE BIENVENIDA
 * ---------------------------------------------------------------- */

/**
 * Muestra la bienvenida durante unos segundos, la desvanece y después
 * solicita acceso a la cámara.
 *
 * La cámara se inicia al terminar la bienvenida para que el usuario primero
 * vea el logotipo y la animación completa.
 */
function startWelcomeExperience() {
  const welcomeScreen = getElement("welcome-screen");

  // Si el HTML no contiene la bienvenida, abre la cámara directamente.
  if (!welcomeScreen) {
    welcomeIsActive = false;
    startCamera();
    return;
  }

  // Mantiene visible la animación durante 4 segundos.
  welcomeHideTimer = window.setTimeout(() => {
    // Esta clase activa la transición de salida definida en styles.css.
    welcomeScreen.classList.add("is-closing");

    // Espera a que termine la transición antes de retirar la capa.
    welcomeRemoveTimer = window.setTimeout(() => {
      welcomeScreen.hidden = true;
      welcomeIsActive = false;

      // Abre la cámara después de finalizar la presentación.
      startCamera();
    }, 900);
  }, 4000);
}

/**
 * Cancela los temporizadores pendientes de la bienvenida.
 */
function clearWelcomeTimers() {
  window.clearTimeout(welcomeHideTimer);
  window.clearTimeout(welcomeRemoveTimer);
}

/* ----------------------------------------------------------------
 * EVENTOS GENERALES DEL NAVEGADOR
 * ---------------------------------------------------------------- */

// Conecta todos los controles de la interfaz.
initializeEventListeners();

// Muestra la hora inmediatamente al cargar la pagina.
updateClock();

// Actualiza el reloj cada 30 segundos para mantenerlo sincronizado.
window.setInterval(updateClock, 30000);

// Muestra la presentación inicial y luego abre la cámara.
startWelcomeExperience();
/*
 * No se detiene la cámara simplemente cuando document.hidden cambia.
 *
 * En algunos celulares el cuadro de permiso puede ocultar temporalmente la
 * página. La versión anterior interpretaba eso como una salida y apagaba la
 * cámara justo después de que el usuario la autorizaba.
 *
 * Al regresar a la página solo comprobamos si la pista sigue viva. Si el
 * sistema operativo la terminó, la solicitamos otra vez.
 */
document.addEventListener("visibilitychange", () => {
  if (document.hidden || activeScreen !== "s-cam") {
    return;
  }

  const hasLiveVideoTrack =
    stream?.getVideoTracks().some((track) => track.readyState === "live") ??
    false;

  if (!hasLiveVideoTrack) {
    startCamera();
    return;
  }

  // Si la pista sigue activa, intenta reanudar el elemento de video.
  const video = getElement("video-feed");

  if (video?.paused) {
    video.play().catch((error) => {
      console.warn("No se pudo reanudar el video:", error);
    });
  }
});

// pagehide sí representa una salida real de la página en navegadores móviles.
window.addEventListener("pagehide", stopCamera);

// También libera la cámara al cerrar o recargar completamente la página.
window.addEventListener("beforeunload", stopCamera);
