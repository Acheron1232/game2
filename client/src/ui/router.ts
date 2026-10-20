// Shows one screen at a time. The 3D canvas stays behind all screens.

export type ScreenName = 'menu' | 'lobby' | 'game' | 'end' | 'settings';

export interface Screen {
  root: HTMLElement;
  onShow?(): void;
}

export class Router {
  private current: ScreenName | null = null;
  private readonly screens = new Map<ScreenName, Screen>();
  private readonly listeners = new Set<(name: ScreenName) => void>();

  constructor(private readonly host: HTMLElement) {}

  add(name: ScreenName, screen: Screen): void {
    screen.root.hidden = true;
    screen.root.dataset['screen'] = name;
    this.screens.set(name, screen);
    this.host.append(screen.root);
  }

  onChange(fn: (name: ScreenName) => void): void {
    this.listeners.add(fn);
  }

  get screen(): ScreenName | null {
    return this.current;
  }

  show(name: ScreenName): void {
    if (this.current) this.screens.get(this.current)!.root.hidden = true;
    const next = this.screens.get(name);
    if (!next) throw new Error(`No screen ${name}`);
    next.root.hidden = false;
    this.current = name;
    next.onShow?.();
    for (const fn of this.listeners) fn(name);
  }
}
