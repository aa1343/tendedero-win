// Preload for the invisible full-screen window that exists only while a native
// menu is open. A native menu cannot be dismissed by clicks that land outside
// the app when the owner window is not focusable, so this window catches the
// click and tells main to close the menu.
const { ipcRenderer } = require('electron');

const bail = () => ipcRenderer.send('menu:catcher');

window.addEventListener('mousedown', bail, true);
window.addEventListener('contextmenu', bail, true);
window.addEventListener('wheel', bail, { capture: true, passive: true });
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') bail();
  },
  true
);
