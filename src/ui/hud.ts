export type AirId = 'freeze' | 'mode' | 'parallax' | 'save' | 'rehearse';

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

export class Hud {
  readonly intro = must<HTMLElement>('#intro');
  readonly dock = must<HTMLElement>('#dock');
  readonly cursor = must<HTMLElement>('#cursor');
  readonly cursorLabel = must<HTMLElement>('#cursor-label');
  readonly telemetry = must<HTMLElement>('#telemetry');
  readonly introStatus = must<HTMLElement>('#intro-status');
  readonly introError = must<HTMLElement>('#intro-error');
  readonly toast = must<HTMLElement>('#toast');
  readonly coach = must<HTMLElement>('#coach');
  readonly freezeButton = must<HTMLButtonElement>('#btn-freeze');
  readonly modeButton = must<HTMLButtonElement>('#btn-mode');
  readonly parallaxButton = must<HTMLButtonElement>('#btn-parallax');
  readonly begin = must<HTMLButtonElement>('#begin');
  readonly preview = must<HTMLButtonElement>('#preview');
  private toastTimer = 0;

  bind(handlers: {
    begin: () => void;
    preview: () => void;
    air: (id: AirId) => void;
  }) {
    this.begin.addEventListener('click', handlers.begin);
    this.preview.addEventListener('click', handlers.preview);
    for (const button of this.dock.querySelectorAll<HTMLButtonElement>('[data-air]')) {
      button.addEventListener('click', () => {
        const id = button.dataset.air as AirId;
        handlers.air(id);
      });
    }
  }

  setIntroStatus(text: string) {
    if (this.introStatus.textContent !== text) this.introStatus.textContent = text;
  }

  showIntroError(text: string) {
    this.introError.hidden = false;
    this.introError.textContent = text;
    this.begin.disabled = false;
    this.preview.disabled = false;
  }

  clearIntroError() {
    this.introError.hidden = true;
    this.introError.textContent = '';
  }

  setBusy(busy: boolean) {
    this.begin.disabled = busy;
    this.preview.disabled = busy;
  }

  showStage(sourceLabel: string) {
    this.intro.hidden = true;
    this.dock.hidden = false;
    document.body.classList.add('is-mirroring');
    this.coach.textContent =
      sourceLabel === 'synthetic'
        ? 'Synthetic preview — not your camera. Palm, pinch, and fist still work if you rehearse, or use F, V, H, S.'
        : 'Palm or point moves the cursor. Pinch confirms. Fist holds the twin. Keys: F, V, H, S.';
  }

  markSculpted() {
    document.body.classList.add('is-sculpted');
  }

  showDesktopNote() {
    must<HTMLElement>('#mobile-note').hidden = false;
  }

  setCursor(x: number, y: number, gesture: string, visible: boolean) {
    this.cursor.hidden = !visible;
    this.cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    this.cursor.classList.toggle('is-pinch', gesture === 'pinch');
    this.cursor.classList.toggle('is-fist', gesture === 'fist');
    this.cursor.classList.toggle('is-open', gesture === 'open');
    const label = gesture === 'none' ? '' : gesture === 'open' ? 'palm' : gesture;
    if (this.cursorLabel.textContent !== label) this.cursorLabel.textContent = label;
  }

  setFocus(id: string | null) {
    for (const button of this.dock.querySelectorAll<HTMLButtonElement>('[data-air]')) {
      button.classList.toggle('is-focus', button.dataset.air === id);
    }
  }

  setFrozen(frozen: boolean) {
    this.freezeButton.textContent = frozen ? 'Release twin' : 'Hold twin';
    this.freezeButton.setAttribute('aria-pressed', frozen ? 'true' : 'false');
  }

  setMode(mode: 'particles' | 'veil') {
    this.modeButton.textContent = mode === 'particles' ? 'Form · Particles' : 'Form · Veil';
    this.modeButton.setAttribute('aria-pressed', mode === 'veil' ? 'true' : 'false');
  }

  setParallax(on: boolean) {
    this.parallaxButton.textContent = on ? 'Head · On' : 'Head · Off';
    this.parallaxButton.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  setTelemetry(text: string) {
    if (this.telemetry.textContent !== text) this.telemetry.textContent = text;
  }

  flash() {
    const flash = must<HTMLElement>('#flash');
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
  }

  showToast(text: string) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 1600);
  }

  airTargets(): Array<{ id: string; left: number; top: number; right: number; bottom: number }> {
    return [...this.dock.querySelectorAll<HTMLButtonElement>('[data-air]')].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        id: button.dataset.air ?? '',
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    });
  }

  buttonCenter(id: string): { x: number; y: number } | null {
    const button = this.dock.querySelector<HTMLButtonElement>(`[data-air="${id}"]`);
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
}
