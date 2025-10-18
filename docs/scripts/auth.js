import { EVENT_STORAGE_KEYS } from './constants.js';
import { verifyEventCredentials } from './events/index.js';
import { normalizeBaseUrl } from './utils/url.js';
import { safeReadStorage, safeWriteStorage } from './utils/storage.js';

function setFeedback(feedbackElement, tone, message) {
  if (!feedbackElement) {
    return;
  }
  if (message) {
    feedbackElement.textContent = message;
    feedbackElement.dataset.tone = tone || 'info';
    feedbackElement.classList.remove('hidden');
  } else {
    feedbackElement.textContent = '';
    delete feedbackElement.dataset.tone;
    feedbackElement.classList.add('hidden');
  }
}

function applyCredentials(url, secret, { sourceField, secretField }) {
  if (sourceField) {
    sourceField.value = url;
    sourceField.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (secretField) {
    secretField.value = secret;
    secretField.dispatchEvent(new Event('input', { bubbles: true }));
    secretField.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

export function initAuth() {
  const overlay = document.querySelector('[data-auth-overlay]');
  if (!overlay) {
    return;
  }

  const form = overlay.querySelector('[data-auth-form]');
  const urlInput = overlay.querySelector('[data-auth-url]');
  const secretInput = overlay.querySelector('[data-auth-secret]');
  const feedbackElement = overlay.querySelector('[data-auth-feedback]');
  const submitButton = form?.querySelector('[type="submit"]');
  const sourceField = document.getElementById('event-source-url');
  const secretField = document.getElementById('event-secret');

  if (!form || !(urlInput instanceof HTMLInputElement) || !(secretInput instanceof HTMLInputElement)) {
    overlay.classList.add('hidden');
    document.body.dataset.authenticated = 'true';
    return;
  }

  const savedUrl = safeReadStorage(EVENT_STORAGE_KEYS.source);
  if (savedUrl) {
    urlInput.value = savedUrl;
  }

  const savedSecret = safeReadStorage(EVENT_STORAGE_KEYS.secret);
  if (savedSecret) {
    secretInput.value = savedSecret;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.dataset.busy === 'true') {
      return;
    }

    const rawUrl = urlInput.value ? urlInput.value.trim() : '';
    const rawSecret = secretInput.value ? secretInput.value.trim() : '';

    if (!rawUrl) {
      setFeedback(feedbackElement, 'error', 'Enter your Apps Script web app URL.');
      urlInput.focus();
      return;
    }

    let normalizedUrl = rawUrl;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:') {
        setFeedback(feedbackElement, 'error', 'Use the HTTPS Apps Script deployment URL.');
        urlInput.focus();
        return;
      }
      normalizedUrl = normalizeBaseUrl(rawUrl);
    } catch {
      setFeedback(feedbackElement, 'error', 'Enter a valid deployment URL.');
      urlInput.focus();
      return;
    }

    if (!rawSecret) {
      setFeedback(feedbackElement, 'error', 'Enter the shared secret token.');
      secretInput.focus();
      return;
    }

    form.dataset.busy = 'true';
    setFeedback(feedbackElement, 'info', 'Verifying credentials...');

    const typedUrlValue = urlInput.value;
    const typedSecretValue = secretInput.value;

    if (submitButton) {
      submitButton.disabled = true;
    }

    let verified = false;
    let focusTarget = null;
    try {
      const result = await verifyEventCredentials({
        baseUrl: normalizedUrl,
        secret: rawSecret,
        statusMessage: 'Verifying credentials with Apps Script...'
      });
      if (!result || !result.ok) {
        const message = result && result.error ? result.error : 'Could not connect with those credentials.';
        setFeedback(feedbackElement, 'error', message);
        if (result?.code === 'unauthorized') {
          focusTarget = 'secret';
        } else if (result?.code === 'not_found') {
          focusTarget = 'url';
        }
        if (!focusTarget) {
          focusTarget = 'secret';
        }
        urlInput.value = typedUrlValue;
        secretInput.value = typedSecretValue;
        return;
      }

      normalizedUrl = result.normalizedUrl || normalizedUrl;
      applyCredentials(normalizedUrl, rawSecret, { sourceField, secretField });
      setFeedback(feedbackElement, 'success', 'Connected! Loading your dashboard...');
      safeWriteStorage(EVENT_STORAGE_KEYS.source, normalizedUrl);
      safeWriteStorage(EVENT_STORAGE_KEYS.secret, rawSecret);
      urlInput.value = normalizedUrl;
      secretInput.value = rawSecret;

      if (submitButton) {
        submitButton.disabled = false;
      }
      delete form.dataset.busy;

      document.body.dataset.authenticated = 'true';
      overlay.classList.add('hidden');
      verified = true;

      window.setTimeout(() => {
        document.getElementById('event-load-button')?.focus();
      }, 120);
    } catch (error) {
      console.error('Credential verification failed', error);
      setFeedback(feedbackElement, 'error', `Verification failed: ${error.message || 'Unknown error.'}`);
      focusTarget = 'secret';
    } finally {
      if (!verified) {
        delete form.dataset.busy;
        if (submitButton) {
          submitButton.disabled = false;
        }
        urlInput.value = typedUrlValue;
        secretInput.value = typedSecretValue;
        const target = focusTarget || 'secret';
        const element = target === 'url' ? urlInput : secretInput;
        if (element) {
          element.focus();
          if (element === secretInput && typeof element.setSelectionRange === 'function') {
            try {
              const length = element.value ? element.value.length : 0;
              element.setSelectionRange(length, length);
            } catch {
              // ignore selection errors (e.g., password field restrictions)
            }
          } else if (typeof element.select === 'function') {
            try {
              element.select();
            } catch {
              // ignore selection errors
            }
          }
        }
      }
    }
  });

  window.setTimeout(() => {
    if (!urlInput.value) {
      urlInput.focus();
    } else if (!secretInput.value) {
      secretInput.focus();
    } else {
      secretInput.select();
    }
  }, 0);
}
