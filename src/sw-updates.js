import { t } from './i18n.js';

const UPDATE_PROMPT_ID = 'hm-update-prompt';
const TOAST_HOST_ID = 'hm-toast-host';
let lastRegistrationOptions = null;
let serviceWorkerDiagnostics = Object.freeze({
  supported: false,
  registration: 'not-checked',
  controller: 'uncontrolled',
  scope: null,
  scriptUrl: null,
  offlineIntegrity: 'unverified',
  offlineIntegrityError: null,
  offlineIntegrityCheckedAt: null,
  lastError: null,
});

function publishDiagnostics(patch, documentRef = globalThis.document) {
  serviceWorkerDiagnostics = Object.freeze({ ...serviceWorkerDiagnostics, ...patch });
  const CustomEventCtor = documentRef?.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  if (documentRef?.dispatchEvent && typeof CustomEventCtor === 'function') {
    documentRef.dispatchEvent(new CustomEventCtor('hm-service-worker:change', {
      detail: serviceWorkerDiagnostics,
    }));
  }
  return serviceWorkerDiagnostics;
}

export function getServiceWorkerDiagnostics() {
  return { ...serviceWorkerDiagnostics };
}

export async function retryServiceWorkerRegistration(options = lastRegistrationOptions || {}) {
  const {
    navigatorRef = globalThis.navigator,
    documentRef = globalThis.document,
    locationRef = globalThis.location,
    swPath = './sw.js',
  } = options;
  const supported = canRegisterServiceWorker({ navigatorRef, locationRef });
  const serviceWorker = navigatorRef?.serviceWorker;
  publishDiagnostics({
    supported,
    registration: supported ? 'registering' : 'unsupported',
    controller: serviceWorker?.controller ? 'controlled' : 'uncontrolled',
    lastError: null,
  }, documentRef);
  if (!supported) return null;
  try {
    const registration = await serviceWorker.register(swPath, {
      type: 'module',
      updateViaCache: 'none',
    });
    publishDiagnostics({
      supported: true,
      registration: 'registered',
      controller: serviceWorker.controller ? 'controlled' : 'uncontrolled',
      scope: registration?.scope || null,
      scriptUrl: registration?.active?.scriptURL || registration?.waiting?.scriptURL || null,
      lastError: null,
    }, documentRef);
    return registration;
  } catch (error) {
    publishDiagnostics({
      supported: true,
      registration: 'error',
      controller: navigatorRef?.serviceWorker?.controller ? 'controlled' : 'uncontrolled',
      lastError: {
        name: String(error?.name || 'Error').slice(0, 80),
        message: String(error?.message || 'Service worker registration failed').slice(0, 240),
      },
    }, documentRef);
    return null;
  }
}

export async function requestOfflineDataRepair({
  navigatorRef = globalThis.navigator,
  timeoutMs = 20_000,
} = {}) {
  const serviceWorker = navigatorRef?.serviceWorker;
  if (!serviceWorker) return { ok: false, error: 'service-worker-unavailable' };
  const worker = await resolveActiveWorker(serviceWorker, timeoutMs);
  if (!worker?.postMessage) return { ok: false, error: 'service-worker-not-controlled' };
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      serviceWorker.removeEventListener?.('message', onMessage);
      resolve(result);
    };
    const onMessage = event => {
      if (event.data?.type !== 'OFFLINE_REPAIR_RESULT') return;
      finish({
        ok: Boolean(event.data.ok),
        error: event.data.error ? String(event.data.error).slice(0, 240) : null,
      });
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'offline-repair-timeout' }), timeoutMs);
    serviceWorker.addEventListener?.('message', onMessage);
    try {
      worker.postMessage({ type: 'REPAIR_OFFLINE_DATA' });
    } catch (error) {
      finish({ ok: false, error: String(error?.message || error).slice(0, 240) });
    }
  });
}

export async function requestOfflineIntegrityCheck({
  navigatorRef = globalThis.navigator,
  documentRef = globalThis.document,
  timeoutMs = 10_000,
} = {}) {
  const serviceWorker = navigatorRef?.serviceWorker;
  if (!serviceWorker) return publishIntegrity({ state: 'unverified', error: 'service-worker-unavailable' }, documentRef);
  const worker = await resolveActiveWorker(serviceWorker, timeoutMs);
  if (!worker?.postMessage) return publishIntegrity({ state: 'unverified', error: 'service-worker-not-controlled' }, documentRef);
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      serviceWorker.removeEventListener?.('message', onMessage);
      resolve(publishIntegrity(result, documentRef));
    };
    const onMessage = event => {
      if (event.data?.type !== 'OFFLINE_INTEGRITY_RESULT') return;
      finish({
        state: ['intact', 'evicted', 'stale-but-valid', 'invalid'].includes(event.data.state)
          ? event.data.state
          : 'invalid',
        error: event.data.error ? String(event.data.error).slice(0, 240) : null,
        checkedAt: typeof event.data.checked_at_utc === 'string' ? event.data.checked_at_utc : null,
      });
    };
    const timer = setTimeout(() => finish({ state: 'unverified', error: 'offline-integrity-timeout' }), timeoutMs);
    serviceWorker.addEventListener?.('message', onMessage);
    try {
      worker.postMessage({ type: 'CHECK_OFFLINE_INTEGRITY' });
    } catch (error) {
      finish({ state: 'unverified', error: String(error?.message || error).slice(0, 240) });
    }
  });
}

function publishIntegrity({ state = 'unverified', error = null, checkedAt = null } = {}, documentRef) {
  publishDiagnostics({
    offlineIntegrity: state,
    offlineIntegrityError: error ? String(error).slice(0, 240) : null,
    offlineIntegrityCheckedAt: checkedAt,
  }, documentRef);
  return { state, error: error ? String(error).slice(0, 240) : null, checkedAt };
}

async function resolveActiveWorker(serviceWorker, timeoutMs) {
  let worker = serviceWorker.controller;
  if (!worker) {
    try {
      const ready = await Promise.race([
        serviceWorker.ready,
        new Promise(resolve => setTimeout(() => resolve(null), Math.min(Math.max(timeoutMs, 0), 2_000))),
      ]);
      worker = ready?.active || null;
    } catch {
      worker = null;
    }
  }
  return worker;
}

export function canRegisterServiceWorker({
  navigatorRef = globalThis.navigator,
  locationRef = globalThis.location,
} = {}) {
  const serviceWorker = navigatorRef?.serviceWorker;
  if (!serviceWorker || typeof serviceWorker.register !== 'function') return false;
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
    prompt.setAttribute('aria-label', t('sw.updateTitle'));
    prompt.innerHTML = `
      <div class="hm-update-copy">
        <strong>${t('sw.updateTitle')}</strong>
        <span>${t('sw.updateBody')}</span>
      </div>
      <div class="hm-update-actions">
        <button class="text-btn hm-update-reload" type="button">${t('sw.updateRefresh')}</button>
        <button class="icon-btn hm-update-dismiss" type="button" aria-label="${t('sw.updateDismiss')}">×</button>
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
  lastRegistrationOptions = { windowRef, navigatorRef, documentRef, locationRef, swPath };
  if (!canRegisterServiceWorker({ navigatorRef, locationRef }) || !windowRef || !documentRef) {
    publishDiagnostics({
      supported: false,
      registration: 'unsupported',
      controller: 'uncontrolled',
    }, documentRef);
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
    publishDiagnostics({ controller: serviceWorker.controller ? 'controlled' : 'uncontrolled' }, documentRef);
    if (reloadRequested && typeof locationRef.reload === 'function') {
      locationRef.reload();
    }
  });

  windowRef.addEventListener('load', () => {
    retryServiceWorkerRegistration({ navigatorRef, documentRef, locationRef, swPath })
      .then(async (registration) => {
        if (!registration) return;
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
        await requestOfflineIntegrityCheck({ navigatorRef, documentRef });
      });
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
