import { el } from './dom';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

let pending: InstallPrompt | null = null;
const buttons = new Set<HTMLButtonElement>();
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  pending = event as InstallPrompt;
  for (const button of buttons) button.disabled = false;
});
window.addEventListener('appinstalled', () => {
  pending = null;
  for (const button of buttons) {
    button.disabled = true;
    button.textContent = 'App installed';
  }
});

export function createInstallControls(): HTMLElement {
  const button = el('button', { class: 'btn small' }, 'Install Temple Wars');
  button.disabled = !pending;
  buttons.add(button);
  button.addEventListener('click', () => {
    const prompt = pending;
    if (!prompt) return;
    pending = null;
    button.disabled = true;
    void prompt.prompt().catch(() => undefined);
  });
  return el(
    'div',
    { class: 'install-controls' },
    button,
    el(
      'p',
      {},
      'Open in its own window: Safari on Mac → Share → Add to Dock. Chrome / Edge → Install app in the browser menu. Online play still needs a connection.',
    ),
  );
}
