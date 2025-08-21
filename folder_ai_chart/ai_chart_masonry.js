/**
 * Masonry layout for variable-height .card elements inside a grid container.
 * Uses ResizeObserver to recalc spans whenever a card resizes.
 */
let __masonryRO = null;

export function applyMasonryLayout() {
  // Defer to ensure DOM and async content (charts) have a chance to render
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const grid = document.querySelector('#results.grid');
      if (!grid) return;

      // Disconnect previous observer to avoid duplicate callbacks
      if (__masonryRO) {
        try { __masonryRO.disconnect(); } catch {}
        __masonryRO = null;
      }

      const computed = window.getComputedStyle(grid);
      const autoRows = parseFloat(computed.getPropertyValue('grid-auto-rows')) || 10;
      const rowGap = parseFloat(computed.getPropertyValue('row-gap') || computed.getPropertyValue('grid-row-gap') || '0') || 0;

      // Helper to set a card's span based on its current rendered height
      const setSpan = (card) => {
        if (!card || !card.isConnected) return;
        // Clear previous span for accurate measurement
        card.style.gridRowEnd = '';
        const rect = card.getBoundingClientRect();
        const height = Math.max(0, Math.ceil(rect.height));
        // Avoid zero division; include gap in the denominator for accuracy
        const denom = Math.max(1, autoRows + rowGap);
        let span = Math.ceil((height + rowGap) / denom);
        // Ensure minimum span so collapsed cards don't disappear
        if (!Number.isFinite(span) || span < 2) span = 2;
        card.style.gridRowEnd = `span ${span}`;
      };

      const cards = Array.from(document.querySelectorAll('#results .card'));
      if (!cards.length) return;

      // Initial pass
      cards.forEach(setSpan);

      // Observe future size changes (e.g., charts finishing render, fonts loading, window resizes)
      __masonryRO = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const el = entry.target;
          // Only handle cards inside our grid
          if (el && el.classList && el.classList.contains('card')) {
            setSpan(el);
          }
        }
      });

      cards.forEach(card => __masonryRO.observe(card));
    });
  });
}

// Make applyMasonryLayout globally available for modules that might need it
window.applyMasonryLayout = applyMasonryLayout;

// Re-apply layout on window resize
window.addEventListener('resize', () => {
    // Debounce resize event to avoid performance issues
    let timeout;
    clearTimeout(timeout);
    timeout = setTimeout(applyMasonryLayout, 200);
});