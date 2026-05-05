const UPDATE_PROMPT_ID = 'hm-update-prompt';
const TOAST_HOST_ID = 'hm-toast-host';

export function canRegisterServiceWorker({
  navigatorRef = globalThis.navigator,
  locationRef = globalThis.location,
} = {}) {
  if (!navigatorRef || !('serviceWorker' in navigatorRef)) return false;
  if (!locationRef) return false;
  return (
    locationRef.protocol === 'https:' ||
    locationRef.hostname === 'localhost' ||
    locationRef.hostname === '127.0.0.1'
  );
}

export function createUpdatePrompt({
  documentRef = globalThis.document,
  onReload = () => {},
  onDismiss = () => {},
} = {}) {
  if (!documentRef) return null;

  let prompt = documentRef.getElementById(UPDATE_PROMPT_ID);
  const created = !prompt;
  if (!prompt) {
    prompt = documentRef.createElement('section');
    prompt.id = UPDATE_PROMPT_ID;
    prompt.className = 'hm-toast hm-toast--info hm-update-prompt';
    prompt.setAttribute('role', 'status');
    prompt.setAttribute('aria-live', 'polite');
    prompt.setAttribute('aria-label', 'Update available');
    prompt.innerHTML = `
      <div class="hm-update-copy">
        <strong>Update available</strong>
        <span>Reload to use the latest map shell and offline cache.</span>
      </div>
      <div class="hm-update-actions">
        <button class="text-btn hm-update-reload" type="button">Reload</button>
        <button class="icon-btn hm-update-dismiss" type="button" aria-label="Dismiss update prompt">×</button>
      </div>`;
    prompt.hidden = true;
  }

  const host = getToastHost(documentRef);
  if (!prompt.parentElement) host.appendChild(prompt);

  prompt.querySelector('.hm-update-reload')?.addEventListener('click', onReload);
  prompt.querySelector('.hm-update-dismiss')?.addEventListener('click', () => {
    hide();
    onDismiss();
  });

  function show() {
    if (!prompt.parentElement) host.appendChild(prompt);
    prompt.hidden = false;
    requestAnimationFrame(() => prompt.classList.add('is-visible'));
  }

  function hide() {
    prompt.classList.remove('is-visible');
    prompt.hidden = true;
  }

  if (created) hide();
  return { element: prompt, show, hide };
}

export function initServiceWorkerUpdates({
  windowRef = globalThis.window,
  navigatorRef = globalThis.navigator,
  documentRef = globalThis.document,
  locationRef = globalThis.location,
  swPath = './sw.js',
} = {}) {
  if (!canRegisterServiceWorker({ navigatorRef, locationRef }) || !windowRef || !documentRef) {
    return;
  }

  const serviceWorker = navigatorRef.serviceWorker;
  let waitingWorker = null;
  let reloadRequested = false;

  const prompt = createUpdatePrompt({
    documentRef,
    onReload: () => {
      reloadRequested = true;
      if (waitingWorker) {
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      } else if (typeof locationRef.reload === 'function') {
        locationRef.reload();
      }
    },
  });

  serviceWorker.addEventListener?.('controllerchange', () => {
    if (reloadRequested && typeof locationRef.reload === 'function') {
      locationRef.reload();
    }
  });

  windowRef.addEventListener('load', () => {
    serviceWorker.register(swPath)
      .then((registration) => {
        if (registration.waiting && serviceWorker.controller) {
          waitingWorker = registration.waiting;
          prompt?.show();
        }

        registration.addEventListener?.('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener?.('statechange', () => {
            if (installing.state !== 'installed' || !serviceWorker.controller) return;
            waitingWorker = installing;
            prompt?.show();
          });
        });
      })
      .catch(() => { /* service-worker registration is non-fatal */ });
  });
}

function getToastHost(documentRef) {
  let host = documentRef.getElementById(TOAST_HOST_ID);
  if (!host) {
    host = documentRef.createElement('div');
    host.id = TOAST_HOST_ID;
    host.className = 'hm-toast-host';
    documentRef.body.appendChild(host);
  }
  return host;
}
