const $ = s => document.querySelector(s);

export function showToast(message, type = 'info', duration = 3000, toastId = null) {
  const container = $('#toast-container');
  if (!container) return;

  let toast;
  if (toastId) {
    toast = container.querySelector(`[data-toast-id="${toastId}"]`);
  }

  if (toast) {
    // Update existing toast
    toast.className = `toast ${type} show`;
    toast.querySelector('.toast-message').textContent = message;
  } else {
    // Create new toast
    toast = document.createElement('div');
    toast.className = `toast ${type}`;
    if (toastId) {
      toast.setAttribute('data-toast-id', toastId);
    }

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    if (type === 'success') icon.textContent = '✓';
    else if (type === 'error') icon.textContent = '✗';
    else icon.textContent = 'ℹ';

    const msg = document.createElement('span');
    msg.className = 'toast-message';
    msg.textContent = message;

    toast.append(icon, msg);
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
  }

  // Clear any existing timeout
  const existingTimeout = toast.dataset.timeoutId;
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  // Set new timeout to remove
  if (duration > 0) {
    const timeoutId = setTimeout(() => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      toast.addEventListener('transitionend', () => {
        try {
          container.removeChild(toast);
        } catch {}
      }, { once: true });
    }, duration);
    toast.dataset.timeoutId = timeoutId;
  }
}