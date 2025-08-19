export function initializeSectionToggles() {
  const STORAGE_KEY_PREFIX = 'aichart:sections:v2:';
  const mainContent = document.getElementById('main-content');

  function getStorageKey() {
    const mainTitle = document.querySelector('h2')?.textContent.trim() || 'default-page';
    const pageKey = mainTitle.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    return `${STORAGE_KEY_PREFIX}${pageKey}`;
  }

  function getStoredStates() {
    try {
      return JSON.parse(localStorage.getItem(getStorageKey()) || '{}');
    } catch {
      return {};
    }
  }

  function setStoredStates(states) {
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify(states));
    } catch {}
  }

  function setupSection(section) {
    const header = section.querySelector('.section-header');
    const content = section.querySelector('.section-content');
    const sectionId = section.dataset.sectionId;

    if (!header || !content || !sectionId) return;

    let btn = header.querySelector('.section-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'section-toggle';
      const chev = document.createElement('span');
      chev.className = 'chev';
      btn.appendChild(chev);
      header.appendChild(btn);
    }
    
    const headingEl = header.querySelector('h2, h3, h4');
    const headingText = headingEl ? headingEl.textContent.trim() : `Section ${sectionId}`;

    // Restore state
    const storedStates = getStoredStates();
    const isCollapsed = storedStates[sectionId] === true;
    section.classList.toggle('is-collapsed', isCollapsed);

    // Set initial ARIA attributes
    btn.setAttribute('aria-expanded', !isCollapsed);
    btn.setAttribute('aria-controls', content.id);
    content.setAttribute('aria-hidden', isCollapsed);
    btn.setAttribute('aria-label', `${isCollapsed ? 'Show' : 'Hide'} ${headingText}`);
  }

  function toggleSection(section) {
    const header = section.querySelector('.section-header');
    const content = section.querySelector('.section-content');
    const btn = header.querySelector('.section-toggle');
    const sectionId = section.dataset.sectionId;
    const headingEl = header.querySelector('h2, h3, h4');
    const headingText = headingEl ? headingEl.textContent.trim() : `Section ${sectionId}`;

    const isCollapsed = section.classList.toggle('is-collapsed');
    
    // Update storage
    const storedStates = getStoredStates();
    storedStates[sectionId] = isCollapsed;
    setStoredStates(storedStates);

    // Update ARIA
    btn.setAttribute('aria-expanded', !isCollapsed);
    content.setAttribute('aria-hidden', isCollapsed);
    btn.setAttribute('aria-label', `${isCollapsed ? 'Show' : 'Hide'} ${headingText}`);
    
    // Re-apply masonry layout after animation if available
    if (typeof window.applyMasonryLayout === 'function') {
      setTimeout(window.applyMasonryLayout, 550);
    }
  }

  // Event Delegation
  mainContent.addEventListener('click', (event) => {
    const header = event.target.closest('.section-header');
    if (!header) return;

    // Allow clicks on interactive elements within the header
    if (event.target.closest('button, a, input, select') && !event.target.closest('.section-toggle')) {
      return;
    }
    
    const section = header.closest('.section');
    if (section) {
      toggleSection(section);
    }
  });

  // Initial setup
  document.querySelectorAll('.section').forEach(setupSection);
}