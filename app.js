pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Served same-origin via the edge function in netlify/edge-functions/anuario-pdf.js
// (GitHub release downloads don't allow cross-origin fetches).
const PDF_URL = '/anuario.pdf';

const SOUND_URL = 'assets/page-flip.mp3';
const RENDER_SCALE = 2.2;
const PAGE_OFFSET = 2;

const MIN_ZOOM = 1;
const MAX_ZOOM = 2.8;
const ZOOM_STEP = 0.3;
const PAGE_TURN_VOLUME = 0.45;

const stageEl = document.getElementById('stage');
const zoomWrapperEl = document.getElementById('zoom-wrapper');
const flipbookEl = document.getElementById('flipbook');
const loaderEl = document.getElementById('loader');
const loaderTextEl = document.getElementById('loader-text');

const pageInputEl = document.getElementById('page-input');
const totalPagesEl = document.getElementById('total-pages');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');

const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomReset = document.getElementById('btn-zoom-reset');
const zoomIndicatorEl = document.getElementById('zoom-indicator');

let currentZoom = MIN_ZOOM;
let panX = 0;
let panY = 0;

let pageFlip = null;
let bookDimensions = null;
let resizeTimer = null;

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

let audioContext = null;
let pageTurnBuffer = null;
let soundLoadingPromise = null;
let lastPlayedIndex = null;
let currentAudioSource = null;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

async function loadPageTurnSound() {
  if (pageTurnBuffer) {
    return pageTurnBuffer;
  }

  if (soundLoadingPromise) {
    return soundLoadingPromise;
  }

  soundLoadingPromise = (async () => {
    const response = await fetch(SOUND_URL);

    if (!response.ok) {
      throw new Error(
        `No se pudo cargar el sonido: ${response.status}`
      );
    }

    const encodedAudio =
      await response.arrayBuffer();

    const AudioContext =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContext) {
      throw new Error(
        'Este navegador no admite Web Audio.'
      );
    }

    if (!audioContext) {
      audioContext = new AudioContext();
    }

    pageTurnBuffer =
      await audioContext.decodeAudioData(
        encodedAudio
      );

    return pageTurnBuffer;
  })();

  try {
    return await soundLoadingPromise;
  } catch (error) {
    soundLoadingPromise = null;
    throw error;
  }
}

async function unlockPageTurnSound() {
  try {
    if (!audioContext) {
      const AudioContext =
        window.AudioContext ||
        window.webkitAudioContext;

      if (!AudioContext) {
        return;
      }

      audioContext = new AudioContext();
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    await loadPageTurnSound();
  } catch (error) {
    console.warn(
      'No se pudo preparar el sonido:',
      error
    );
  }
}

async function playPageTurnSound() {
  try {
    if (!audioContext) {
      await unlockPageTurnSound();
    }

    if (
      !audioContext ||
      audioContext.state === 'suspended'
    ) {
      await unlockPageTurnSound();
    }

    if (!pageTurnBuffer) {
      await loadPageTurnSound();
    }

    if (!pageTurnBuffer) {
      return;
    }

    if (currentAudioSource) {
      try {
        currentAudioSource.stop();
      } catch (error) {
        // La reproducción anterior ya terminó.
      }
    }

    const source =
      audioContext.createBufferSource();

    const gain =
      audioContext.createGain();

    source.buffer = pageTurnBuffer;
    gain.gain.value = PAGE_TURN_VOLUME;

    source.connect(gain);
    gain.connect(
      audioContext.destination
    );

    currentAudioSource = source;

    source.onended = () => {
      if (currentAudioSource === source) {
        currentAudioSource = null;
      }
    };

    source.start(0);
  } catch (error) {
    console.warn(
      'No se pudo reproducir el sonido:',
      error
    );
  }
}

document.addEventListener(
  'pointerdown',
  unlockPageTurnSound,
  { once: true }
);

document.addEventListener(
  'keydown',
  unlockPageTurnSound,
  { once: true }
);

loadPageTurnSound().catch(error => {
  console.warn(
    'El sonido se cargará al iniciar la interacción:',
    error
  );
});

function constrainPan() {
  if (
    !bookDimensions ||
    currentZoom <= MIN_ZOOM
  ) {
    panX = 0;
    panY = 0;
    return;
  }

  const stageRect =
    stageEl.getBoundingClientRect();

  const extraWidth =
    (
      bookDimensions.width *
      currentZoom -
      stageRect.width
    ) / 2;

  const extraHeight =
    (
      bookDimensions.height *
      currentZoom -
      stageRect.height
    ) / 2;

  panX = clamp(
    panX,
    -Math.max(0, extraWidth),
    Math.max(0, extraWidth)
  );

  panY = clamp(
    panY,
    -Math.max(0, extraHeight),
    Math.max(0, extraHeight)
  );
}

function applyZoomTransform() {
  zoomWrapperEl.classList.toggle(
    'zoomed',
    currentZoom > MIN_ZOOM
  );

  zoomWrapperEl.style.transform =
    `translate3d(${panX}px, ${panY}px, 0) scale(${currentZoom})`;

  zoomIndicatorEl.textContent =
    `${Math.round(currentZoom * 100)}%`;

  btnZoomOut.disabled =
    currentZoom <= MIN_ZOOM;

  btnZoomIn.disabled =
    currentZoom >= MAX_ZOOM;
}

function setZoom(newZoom) {
  currentZoom = clamp(
    Number(newZoom.toFixed(2)),
    MIN_ZOOM,
    MAX_ZOOM
  );

  if (currentZoom === MIN_ZOOM) {
    panX = 0;
    panY = 0;
  }

  constrainPan();
  applyZoomTransform();
}

async function renderPdfPage(
  pdf,
  pageNumber
) {
  const page =
    await pdf.getPage(pageNumber);

  const viewport =
    page.getViewport({
      scale: RENDER_SCALE
    });

  const pageDiv =
    document.createElement('div');

  pageDiv.className = 'page';

  if (pageNumber === 1) {
    pageDiv.dataset.density = 'hard';
    pageDiv.classList.add(
      'cover-front'
    );
  } else if (
    pageNumber === pdf.numPages
  ) {
    pageDiv.dataset.density = 'hard';
    pageDiv.classList.add(
      'cover-back'
    );
  }

  const canvas =
    document.createElement('canvas');

  const context =
    canvas.getContext(
      '2d',
      { alpha: false }
    );

  canvas.width =
    viewport.width;

  canvas.height =
    viewport.height;

  canvas.setAttribute(
    'role',
    'img'
  );

  canvas.setAttribute(
    'aria-label',
    `Página ${pageNumber}`
  );

  await page.render({
    canvasContext: context,
    viewport
  }).promise;

  pageDiv.appendChild(canvas);

  return {
    pageDiv,
    viewport
  };
}

function calculateBookDimensions(
  pageWidth,
  pageHeight
) {
  const stageRect =
    stageEl.getBoundingClientRect();

  const aspectRatio =
    pageWidth / pageHeight;

  const availableHeight =
    Math.max(
      180,
      stageRect.height - 32
    );

  const availablePageWidth =
    Math.max(
      140,
      (stageRect.width - 40) / 2
    );

  let height =
    availableHeight;

  let width =
    height * aspectRatio;

  if (
    width >
    availablePageWidth
  ) {
    width =
      availablePageWidth;

    height =
      width / aspectRatio;
  }

  return {
    width: Math.floor(width),
    height: Math.floor(height)
  };
}

function updateNavigationIndicator() {
  if (!pageFlip) {
    return;
  }

  const currentPdfIndex =
    pageFlip.getCurrentPageIndex();

  const currentPdfPage =
    currentPdfIndex + 1;

  const editorialPage =
    currentPdfPage - PAGE_OFFSET;

  pageInputEl.value =
    editorialPage >= 1
      ? String(editorialPage)
      : '-';

  btnPrev.disabled =
    currentPdfIndex <= 0;

  btnNext.disabled =
    currentPdfIndex >=
    pageFlip.getPageCount() - 1;
}

function handlePageChange() {
  if (!pageFlip) {
    return;
  }

  const currentIndex =
    pageFlip.getCurrentPageIndex();

  if (
    currentIndex !==
    lastPlayedIndex
  ) {
    lastPlayedIndex =
      currentIndex;

    playPageTurnSound();
  }

  updateNavigationIndicator();
}

function goToEditorialPage() {
  if (!pageFlip) {
    return;
  }

  const requestedPage =
    Number.parseInt(
      pageInputEl.value.trim(),
      10
    );

  if (
    !Number.isInteger(
      requestedPage
    )
  ) {
    updateNavigationIndicator();
    return;
  }

  const totalBookPages =
    Math.max(
      1,
      pageFlip.getPageCount() -
      PAGE_OFFSET
    );

  const editorialPage =
    clamp(
      requestedPage,
      1,
      totalBookPages
    );

  const targetPdfIndex =
    editorialPage +
    PAGE_OFFSET -
    1;

  setZoom(MIN_ZOOM);

  pageFlip.turnToPage(
    targetPdfIndex
  );

  pageInputEl.value =
    String(editorialPage);
}

function bindControls() {
  pageInputEl.addEventListener(
    'focus',
    () => {
      pageInputEl.select();
    }
  );

  pageInputEl.addEventListener(
    'keydown',
    event => {
      if (
        event.key === 'Enter'
      ) {
        goToEditorialPage();
        pageInputEl.blur();
      }
    }
  );

  pageInputEl.addEventListener(
    'change',
    goToEditorialPage
  );

  btnPrev.addEventListener(
    'click',
    () => {
      if (
        btnPrev.disabled
      ) {
        return;
      }

      setZoom(MIN_ZOOM);
      pageFlip.flipPrev();
    }
  );

  btnNext.addEventListener(
    'click',
    () => {
      if (
        btnNext.disabled
      ) {
        return;
      }

      setZoom(MIN_ZOOM);
      pageFlip.flipNext();
    }
  );

  btnZoomIn.addEventListener(
    'click',
    () => {
      setZoom(
        currentZoom +
        ZOOM_STEP
      );
    }
  );

  btnZoomOut.addEventListener(
    'click',
    () => {
      setZoom(
        currentZoom -
        ZOOM_STEP
      );
    }
  );

  btnZoomReset.addEventListener(
    'click',
    () => {
      setZoom(MIN_ZOOM);
    }
  );

  document.addEventListener(
    'keydown',
    event => {
      if (
        document.activeElement ===
        pageInputEl
      ) {
        return;
      }

      if (
        event.key === 'ArrowLeft' &&
        !btnPrev.disabled
      ) {
        setZoom(MIN_ZOOM);
        pageFlip.flipPrev();
      } else if (
        event.key === 'ArrowRight' &&
        !btnNext.disabled
      ) {
        setZoom(MIN_ZOOM);
        pageFlip.flipNext();
      } else if (
        event.key === '+' ||
        event.key === '='
      ) {
        setZoom(
          currentZoom +
          ZOOM_STEP
        );
      } else if (
        event.key === '-'
      ) {
        setZoom(
          currentZoom -
          ZOOM_STEP
        );
      } else if (
        event.key === '0' ||
        event.key === 'Escape'
      ) {
        setZoom(MIN_ZOOM);
      }
    }
  );

  stageEl.addEventListener(
    'wheel',
    event => {
      event.preventDefault();

      const direction =
        event.deltaY < 0
          ? 1
          : -1;

      setZoom(
        currentZoom +
        direction *
        ZOOM_STEP
      );
    },
    { passive: false }
  );

  stageEl.addEventListener(
    'pointerdown',
    event => {
      if (
        currentZoom <=
        MIN_ZOOM
      ) {
        return;
      }

      isDragging = true;

      dragStartX =
        event.clientX -
        panX;

      dragStartY =
        event.clientY -
        panY;

      zoomWrapperEl.classList.add(
        'dragging'
      );

      if (
        stageEl.setPointerCapture
      ) {
        stageEl.setPointerCapture(
          event.pointerId
        );
      }
    }
  );

  stageEl.addEventListener(
    'pointermove',
    event => {
      if (!isDragging) {
        return;
      }

      panX =
        event.clientX -
        dragStartX;

      panY =
        event.clientY -
        dragStartY;

      constrainPan();
      applyZoomTransform();
    }
  );

  function stopDragging(
    event
  ) {
    if (!isDragging) {
      return;
    }

    isDragging = false;

    zoomWrapperEl.classList.remove(
      'dragging'
    );

    if (
      stageEl.releasePointerCapture &&
      stageEl.hasPointerCapture &&
      stageEl.hasPointerCapture(
        event.pointerId
      )
    ) {
      stageEl.releasePointerCapture(
        event.pointerId
      );
    }
  }

  stageEl.addEventListener(
    'pointerup',
    stopDragging
  );

  stageEl.addEventListener(
    'pointercancel',
    stopDragging
  );
}

async function initFlipbook() {
  try {
    loaderTextEl.textContent =
      'Descargando anuario...';

    const pdf =
      await pdfjsLib.getDocument({
        url: PDF_URL,
        cMapUrl:
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
        cMapPacked: true,
        disableAutoFetch: false,
        disableStream: false,
        disableRange: false
      }).promise;

    const totalPdfPages =
      pdf.numPages;

    if (
      totalPdfPages === 0
    ) {
      throw new Error(
        'El PDF no contiene páginas.'
      );
    }

    const totalBookPages =
      Math.max(
        1,
        totalPdfPages -
        PAGE_OFFSET
      );

    totalPagesEl.textContent =
      `de ${totalBookPages}`;

    let pageWidth =
      400;

    let pageHeight =
      560;

    for (
      let pageNumber = 1;
      pageNumber <=
      totalPdfPages;
      pageNumber++
    ) {
      const result =
        await renderPdfPage(
          pdf,
          pageNumber
        );

      if (
        pageNumber === 1
      ) {
        pageWidth =
          result.viewport.width /
          RENDER_SCALE;

        pageHeight =
          result.viewport.height /
          RENDER_SCALE;
      }

      flipbookEl.appendChild(
        result.pageDiv
      );

      const percent =
        Math.round(
          (
            pageNumber /
            totalPdfPages
          ) * 100
        );

      loaderTextEl.textContent =
        `Cargando anuario... ${percent}%`;
    }

    bookDimensions =
      calculateBookDimensions(
        pageWidth,
        pageHeight
      );

    pageFlip =
      new St.PageFlip(
        flipbookEl,
        {
          width:
            bookDimensions.width,
          height:
            bookDimensions.height,
          size: 'fixed',
          minWidth: 280,
          minHeight: 400,
          maxWidth: 1600,
          maxHeight: 2200,
          maxShadowOpacity: 0.5,
          showCover: true,
          mobileScrollSupport: false,
          useMouseEvents: true,
          startZIndex: 10
        }
      );

    pageFlip.loadFromHTML(
      document.querySelectorAll(
        '.page'
      )
    );

    lastPlayedIndex =
      pageFlip.getCurrentPageIndex();

    pageFlip.on(
      'flip',
      handlePageChange
    );

    pageFlip.on(
      'changeState',
      updateNavigationIndicator
    );

    updateNavigationIndicator();
    bindControls();

    window.addEventListener(
      'resize',
      () => {
        clearTimeout(
          resizeTimer
        );

        resizeTimer =
          setTimeout(() => {
            constrainPan();
            applyZoomTransform();
          }, 180);
      }
    );

    applyZoomTransform();

    loaderEl.classList.add(
      'hidden'
    );

  } catch (error) {
    console.error(
      'Error al cargar el PDF:',
      error
    );

    loaderTextEl.textContent =
      'No se pudo cargar el anuario. Comprueba tu conexión e inténtalo de nuevo.';
  }
}

initFlipbook();