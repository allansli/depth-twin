export type AirId = 'material' | 'paint' | 'split' | 'hold' | 'capture' | 'rehearse';
export type StageSource = 'camera' | 'synthetic' | 'look';

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

const GESTURE_LABEL: Record<string, string> = {
  open: 'palm',
  point: 'point',
  fist: 'fist',
  victory: 'victory',
  thumb_up: 'thumb',
  pinch: 'pinch',
};

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
  readonly holdButton = must<HTMLButtonElement>('#btn-hold');
  readonly paintButton = must<HTMLButtonElement>('#btn-paint');
  readonly splitButton = must<HTMLButtonElement>('#btn-split');
  readonly materialName = must<HTMLElement>('#material-name');
  readonly materialButton = must<HTMLButtonElement>('#btn-material');
  readonly rehearseButton = must<HTMLButtonElement>('#btn-rehearse');
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

  setDev(on: boolean) {
    this.rehearseButton.hidden = !on;
    this.telemetry.hidden = !on;
  }

  showStage(source: StageSource, dev: boolean) {
    this.intro.hidden = true;
    this.dock.hidden = false;
    document.body.classList.add('is-mirroring');
    const keys = dev ? 'Keys M, P, S, H, C, G.' : 'Keys M, P, S, H, C.';
    const line =
      source === 'synthetic'
        ? `Synthetic preview — not your camera. Point and rest on a control. ${keys}`
        : source === 'look'
          ? `A depth-field preview — not your camera. ${keys}`
          : `Point and rest to choose. Palm moves. Fist holds. Victory changes material. Thumb up captures. ${keys}`;
    this.coach.textContent = line;
  }

  markSculpted() {
    document.body.classList.add('is-sculpted');
  }

  showDesktopNote() {
    must<HTMLElement>('#mobile-note').hidden = false;
  }

  setCursor(x: number, y: number, gesture: string, visible: boolean, dwell = 0) {
    this.cursor.hidden = !visible;
    this.cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    this.cursor.style.setProperty('--dwell', dwell.toFixed(3));
    this.cursor.classList.toggle('is-point', gesture === 'point');
    this.cursor.classList.toggle('is-pinch', gesture === 'pinch');
    this.cursor.classList.toggle('is-fist', gesture === 'fist');
    this.cursor.classList.toggle('is-open', gesture === 'open');
    this.cursor.classList.toggle('is-victory', gesture === 'victory');
    this.cursor.classList.toggle('is-thumb', gesture === 'thumb_up');
    const label = GESTURE_LABEL[gesture] ?? '';
    if (this.cursorLabel.textContent !== label) this.cursorLabel.textContent = label;
  }

  setFocus(id: string | null, dwell = 0) {
    for (const button of this.dock.querySelectorAll<HTMLButtonElement>('[data-air]')) {
      const on = button.dataset.air === id;
      button.classList.toggle('is-focus', on);
      button.style.setProperty('--dwell', on ? dwell.toFixed(3) : '0');
    }
  }

  setMaterial(label: string) {
    this.materialName.textContent = label;
    this.materialButton.setAttribute('aria-label', `Material, ${label}`);
  }

  setPaint(on: boolean) {
    this.paintButton.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  setSplit(on: boolean) {
    this.splitButton.setAttribute('aria-pressed', on ? 'true' : 'false');
    document.body.classList.toggle('is-split', on);
  }

  setFrozen(frozen: boolean) {
    this.holdButton.setAttribute('aria-pressed', frozen ? 'true' : 'false');
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
    return [...this.dock.querySelectorAll<HTMLButtonElement>('[data-air]')]
      .filter((button) => !button.hidden)
      .map((button) => {
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
    if (!button || button.hidden) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
}
