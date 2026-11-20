/** The rig eases toward this target with its neck and eyes. Positive Y looks up. */
export function trackPointerGaze(
  canvas: HTMLCanvasElement,
  look: (x: number, y: number) => void,
): () => void {
  let frame = 0;
  let x = 0;
  let y = 0;

  function reset(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    look(0, 0);
  }

  function update(event: PointerEvent): void {
    if (event.pointerType === 'touch' || !(event.target instanceof Element)) return;
    if (event.target.closest('dialog') !== canvas.closest('dialog')) {
      reset();
      return;
    }
    x = event.clientX;
    y = event.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const bounds = canvas.getBoundingClientRect();
      look(
        Math.tanh((x - bounds.left - bounds.width * 0.5) / Math.max(90, bounds.width * 0.8)),
        Math.tanh((bounds.top + bounds.height * 0.35 - y) / Math.max(90, bounds.height * 0.5)),
      );
    });
  }

  function leave(event: PointerEvent): void {
    if (event.relatedTarget === null) reset();
  }

  window.addEventListener('pointermove', update, { passive: true });
  window.addEventListener('pointerout', leave);
  window.addEventListener('blur', reset);
  return () => {
    window.removeEventListener('pointermove', update);
    window.removeEventListener('pointerout', leave);
    window.removeEventListener('blur', reset);
    reset();
  };
}
