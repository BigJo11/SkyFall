// Keyboard + mouse. Uses Pointer Lock when available and falls back to raw
// mousemove deltas (some embedded/iframe contexts deny pointer lock).

const CODE_WEAPON = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.justPressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = new Set();
    this.buttonsPressed = new Set();
    this.buttonsReleased = new Set();
    this.wheel = 0;
    this.locked = false;
    this.fallback = false;
    this.enabled = false;
    this.onLockChange = () => {};
    this.onLockError = () => {};

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || this.fallback) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.buttons.has(e.button)) this.buttonsPressed.add(e.button);
      this.buttons.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      if (this.buttons.has(e.button)) this.buttonsReleased.add(e.button);
      this.buttons.delete(e.button);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.fallback = false;
      this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.onLockError();
    });
  }

  async requestLock() {
    if (this.locked) return true;
    try {
      const maybe = this.canvas.requestPointerLock({ unadjustedMovement: false });
      if (maybe && typeof maybe.then === 'function') await maybe;
      return document.pointerLockElement === this.canvas;
    } catch (err) {
      try {
        this.canvas.requestPointerLock();
      } catch (e) {
        this.fallback = true;
      }
      return document.pointerLockElement === this.canvas;
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this.justPressed.has(code); }
  mouseDown(b = 0) { return this.buttons.has(b); }
  mousePressed(b = 0) { return this.buttonsPressed.has(b); }
  mouseReleased(b = 0) { return this.buttonsReleased.has(b); }
  weaponSlotPressed() {
    for (let i = 0; i < CODE_WEAPON.length; i++) if (this.justPressed.has(CODE_WEAPON[i])) return i;
    return -1;
  }

  // movement axes in local space (x = right, y = forward)
  axes() {
    let f = 0;
    let r = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) f += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) f -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) r += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) r -= 1;
    const len = Math.hypot(f, r);
    if (len > 1) { f /= len; r /= len; }
    return { forward: f, right: r, sprint: this.down('ShiftLeft') || this.down('ShiftRight') };
  }

  takeLook() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  endFrame() {
    this.justPressed.clear();
    this.buttonsPressed.clear();
    this.buttonsReleased.clear();
    this.wheel = 0;
  }
}
