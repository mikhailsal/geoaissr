export interface GlobalKeyHandlers {
  onEnter?: () => void;
  onSpace?: () => void;
  onToggleMap?: () => void;
  onEscape?: () => void;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return target.isContentEditable || target.closest('[contenteditable="true"]') !== null;
}

export function isInteractiveClickTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.closest(
      'button, a[href], summary, [role="button"], [role="radio"], [role="menuitem"], input, select, textarea',
    ) !== null
  );
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function attachGlobalKeys(getHandlers: () => GlobalKeyHandlers): () => void {
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const handlers = getHandlers();
    if (event.code === 'Escape' && handlers.onEscape) {
      event.preventDefault();
      handlers.onEscape();
      return;
    }
    if (isEditableTarget(event.target)) {
      return;
    }
    if (event.code === 'KeyM' && handlers.onToggleMap) {
      event.preventDefault();
      handlers.onToggleMap();
      return;
    }
    if (isInteractiveClickTarget(event.target)) {
      return;
    }
    if (event.code === 'Space' && handlers.onSpace) {
      event.preventDefault();
      handlers.onSpace();
      return;
    }
    if (event.code === 'Enter' && handlers.onEnter) {
      event.preventDefault();
      handlers.onEnter();
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
  };
}
