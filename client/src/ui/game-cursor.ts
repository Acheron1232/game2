// Pointer lock keeps the physical mouse away from browser chrome. A virtual cursor
// supplies normal game/HUD events, including hover and inventory pointer capture.
export class GameCursor {
  private readonly cursor = document.createElement('div');
  private x = 0;
  private y = 0;
  private hover: Element | null = null;
  private pressed: Element | null = null;
  private button = -1;
  private active = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly alert: (text: string) => void,
  ) {
    this.cursor.className = 'game-cursor';
    this.cursor.hidden = true;
    this.cursor.setAttribute('aria-hidden', 'true');
    document.body.append(this.cursor);
    document.addEventListener('pointerlockchange', () => this.changed());
    document.addEventListener('pointerlockerror', () => {
      if (!this.locked) alert('Mouse capture was blocked. Click Capture mouse to try again.');
    });
    document.addEventListener(
      'mousemove',
      (event) => {
        if (!this.locked || !event.isTrusted) return;
        this.consume(event);
        this.x = Math.max(0, Math.min(innerWidth - 1, this.x + event.movementX));
        this.y = Math.max(0, Math.min(innerHeight - 1, this.y + event.movementY));
        this.draw();
        const target = this.hit();
        this.setHover(target);
        this.send(this.pressed ?? target, 'pointermove', event);
      },
      true,
    );
    for (const name of [
      'pointermove',
      'pointerover',
      'pointerout',
      'pointerenter',
      'pointerleave',
      'mouseover',
      'mouseout',
      'mouseenter',
      'mouseleave',
      'mousedown',
      'mouseup',
      'click',
      'dblclick',
      'auxclick',
      'contextmenu',
    ]) {
      document.addEventListener(
        name,
        (event) => {
          if (this.locked && event.isTrusted) this.consume(event);
        },
        true,
      );
    }
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.locked || !event.isTrusted) return;
        this.consume(event);
        const target = this.hit();
        // Text editing needs the native cursor, selection and browser IME.
        const field = target.closest<HTMLElement>('input, textarea, select, [contenteditable="true"]');
        if (field) {
          this.release();
          field.focus();
          return;
        }
        this.pressed = target;
        this.button = event.button;
        target.closest<HTMLElement>('button, [tabindex]')?.focus({ preventScroll: true });
        this.send(target, 'pointerdown', event);
      },
      true,
    );
    document.addEventListener(
      'pointerup',
      (event) => {
        if (!this.locked || !event.isTrusted) return;
        this.consume(event);
        const down = this.pressed;
        const button = this.button;
        const under = this.hit();
        this.pressed = null;
        this.button = -1;
        this.send(down ?? under, 'pointerup', event);
        if (!down || button !== event.button || !this.locked) return;
        // Browser clicks target the common ancestor of the down/up targets.
        let target: Element | null = down;
        while (target && !target.contains(under)) target = target.parentElement;
        if (target?.closest('button:disabled, [aria-disabled="true"]')) return;
        if (target && (button === 0 || button === 2)) {
          target.dispatchEvent(new MouseEvent(button === 0 ? 'click' : 'contextmenu', this.options(event)));
        }
      },
      true,
    );
    document.addEventListener(
      'wheel',
      (event) => {
        if (!this.locked || !event.isTrusted) return;
        this.consume(event);
        this.hit().dispatchEvent(
          new WheelEvent('wheel', {
            ...this.options(event),
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaZ: event.deltaZ,
            deltaMode: event.deltaMode,
          }),
        );
      },
      { capture: true, passive: false },
    );
    window.addEventListener('blur', () => this.release());
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') this.release();
      },
      true,
    );
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.release();
    });
    document.addEventListener('focusin', (event) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) this.release();
    });
    document.addEventListener('fullscreenchange', () => {
      // Releasing fullscreen must never leave the user confined to the page.
      if (!document.fullscreenElement) this.release();
    });
    window.addEventListener('resize', () => {
      this.x = Math.min(this.x, innerWidth - 1);
      this.y = Math.min(this.y, innerHeight - 1);
      if (this.locked) this.draw();
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.release();
  }

  toggle(): void {
    if (this.locked) return this.release();
    if (!this.active) return;
    if (!this.canvas.requestPointerLock) return this.alert('Mouse capture is not supported here. Use arrow keys or middle-mouse drag.');
    this.x = innerWidth / 2;
    this.y = innerHeight / 2;
    try {
      // No raw-input requirement: keep browsers without unadjustedMovement support working.
      const request = this.canvas.requestPointerLock();
      void request?.catch((error: unknown) => {
        // pointerlockerror supplies the player message in both promise and legacy APIs.
        if (import.meta.env.DEV) console.info('Mouse capture unavailable:', error);
      });
    } catch {
      this.alert('Mouse capture was blocked. Use arrow keys or middle-mouse drag.');
    }
  }

  release(): void {
    if (this.locked) document.exitPointerLock();
  }

  private changed(): void {
    if (this.locked && !this.active) return this.release();
    document.body.classList.toggle('mouse-captured', this.locked);
    this.cursor.hidden = !this.locked;
    const button = document.querySelector<HTMLButtonElement>('.capture-mouse');
    if (button) {
      button.textContent = this.locked ? 'Release mouse' : 'Capture mouse';
      button.setAttribute('aria-pressed', String(this.locked));
    }
    if (this.locked) {
      this.draw();
      this.setHover(this.hit());
    } else {
      this.pressed?.dispatchEvent(
        new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }),
      );
      this.pressed = null;
      this.button = -1;
      this.setHover(null);
      window.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null }));
    }
  }

  private hit(): Element {
    return document.elementFromPoint(this.x, this.y) ?? this.canvas;
  }
  private draw(): void {
    this.cursor.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
  }
  private consume(event: Event): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  private options(event: MouseEvent): MouseEventInit {
    return {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: this.x,
      clientY: this.y,
      button: event.button,
      buttons: event.buttons,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      movementX: event.movementX,
      movementY: event.movementY,
    };
  }

  private send(target: Element, type: string, event: MouseEvent): void {
    target.dispatchEvent(new PointerEvent(type, { ...this.options(event), pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  }

  private setHover(target: Element | null): void {
    if (target === this.hover) return;
    const previous = this.hover;
    // Mouse enter/leave do not bubble. Notify each changed ancestor so nested icons
    // still trigger the ability/item tooltip and button hover state.
    for (let node = previous; node && !node.contains(target); node = node.parentElement) {
      node.classList.remove('game-cursor-hover');
      node.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: target }));
    }
    this.hover = target;
    for (let node = target; node && !node.contains(previous); node = node.parentElement) {
      node.classList.add('game-cursor-hover');
      node.dispatchEvent(new MouseEvent('mouseenter', { relatedTarget: previous }));
    }
  }
}
