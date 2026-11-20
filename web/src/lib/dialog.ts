/** Dismiss a modal on a backdrop tap. Drags starting inside the dialog keep it open. */
export function dismissOnBackdrop(dialog: HTMLDialogElement) {
  dialog.setAttribute('closedby', 'any');
  if ('closedBy' in HTMLDialogElement.prototype) return;
  let pointer: number | null = null;
  function outside(event: PointerEvent): boolean {
    const bounds = dialog.getBoundingClientRect();
    return (
      event.target === dialog &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    );
  }
  function start(event: PointerEvent): void {
    pointer = event.button === 0 && outside(event) ? event.pointerId : null;
  }
  function finish(event: PointerEvent): void {
    if (pointer === event.pointerId && outside(event)) dialog.close();
    pointer = null;
  }
  dialog.addEventListener('pointerdown', start);
  dialog.addEventListener('pointerup', finish);
  return {
    destroy() {
      dialog.removeEventListener('pointerdown', start);
      dialog.removeEventListener('pointerup', finish);
    },
  };
}
