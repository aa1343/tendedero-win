# Tendedero for Windows

> An **unofficial Windows port** of a tiny macOS utility: screenshots and clipboard
> copies hang on a clothesline at the top of the screen. Rest the pointer at the top
> edge and the line slides down with its cards; move away and it tucks itself back.
>
> Original: [**alejandrobujan/tendedero**](https://github.com/alejandrobujan/tendedero)
> (MIT, by Alejandro Buján). This is a from-scratch Windows implementation written
> against that project's Swift sources. It is **unofficial and not affiliated** with
> the original. The original name and icon are not covered by the MIT licence; this
> port ships its own code-drawn icon and no original artwork.

```
                                            ╭─╮ ╭─╮ ╭─╮
   ──●──────────────────────────────────────┴─┴─┴─┴─┴──────────   ← the line
   (rest the pointer at the top edge for 0.25 s and it slides down)
```

## Running it

**Portable build** (recommended): unzip and double-click **`Start Tendedero.vbs`**
(no console window) or `Start Tendedero.cmd`.

- No Node, no Python, no runtime to install; copy the folder to any Windows machine.
- On launch: rest the pointer at the **top centre** of the screen for ~0.25 s and the
  line comes down; a T-shirt icon appears in the tray, its right-click menu is everything.
- No main window, no network requests, nothing is ever uploaded.

**Building from source**:

```powershell
npm install          # Electron, development dependency only
npm run dist         # writes the self-contained dist\Tendedero folder
```

`build.ps1` copies `src\` into `dist\Tendedero\resources\app\`, copies the Electron
runtime and writes the two launchers. Locales are trimmed to `zh-CN` / `en-US`.

## Features

| | |
|---|---|
| **A capture hangs instantly** | `Ctrl+Alt+S` grabs the screen and hangs it; the system screenshot folder can be watched too |
| **Copies hang too** | Images / text / links, each switchable; nothing is ever kept from a password field |
| **Acting on a card** | Click copies, double-click opens, drag it out to another app, the corner cross takes it down, `Del` on hover does the same |
| **Pin** | Pinned cards are never auto-cleaned; `Ctrl+Z` undoes take-downs and pins (20 steps) |
| **Search** | `Ctrl+Alt+F` searches the line, including text recognised inside screenshots (local Windows OCR, cached per file) |
| **Size & capacity** | Small / medium / large; keep as many as fit, or 25 / 50 / 100 |
| **Auto-clean** | Two clocks: cards come down after **1 day** by default (into the app's own Trash), and the Trash is emptied after **3 days** |
| **Bilingual UI** | Tray → Language → 中文 / English, applied immediately |
| **No dependencies, no network** | Just the Electron runtime; all data stays on the machine |

## Shortcuts

| Shortcut | What it does |
|---|---|
| `Ctrl+Alt+T` | Show / hide the line (configurable in the tray) |
| `Ctrl+Alt+F` | Search the line |
| `Ctrl+Alt+S` | Take a screenshot right now |
| `Ctrl+Z` | Undo the last take-down / pin (up to 20 steps) |

## Card gestures

| Gesture | What it does |
|---|---|
| Click | Copy — text and links go to the clipboard, an image is the image; a "Copied" badge shows |
| Double-click | Open (links in the browser, anything else with its default app) |
| Hold 450 ms | Open for editing (image → default editor, note → the file itself) |
| Middle click | Quick look; `Shift+click` selects |
| Drag out | Onto an Explorer folder = put it there; onto an app that accepts files (WordPad, a chat window…) = that app gets the file. The card stays on the line |
| Corner cross | Our own inbox file → into the app Trash (undoable); anything else → off the line; a pinned card → unpin |
| `Del` on hover | Take the card under the pointer down |
| Right click | Full menu; a click anywhere outside closes it |
| Wheel | Scrolls the line once it holds more than a screenful |
| `Esc` | Clear the selection / leave search |

## Tray menu

- **Take a screenshot now**, **Handle screenshots**, **Also watch folders** (up to 3 more)
- **Hang what you copy**: images, text, links
- **Bring the line down**: when the pointer rests at the top / when something new hangs / over full-screen apps
- **Keep on line**, **Auto-clean** (off the line / out of the Trash / clean up now), **Size**, **Zoom on hover**
- **Shortcut** (and the screenshot shortcut), **Sounds**, **Open at login**, **Open data folder**, **Language**, **Quit**

## Where the data lives

Everything is under `%APPDATA%\tendedero-win\` (tray → "Open data folder"):

| Path | Contents |
|---|---|
| `Screenshots\` | Captures and copied images |
| `Notes\` | Copied text, links and Markdown |
| `Trash\` | Files taken down from the line (the undo source; deleted for good once auto-clean expires) |
| `SearchIndex.json` | OCR text index, cached per file |
| `settings.json` | Every switch, the language and what hangs on the line |

Uninstalling means deleting that folder and this one: no registry keys, no service, no driver.

## Differences from the macOS original (each for a reason)

| Original | Windows port |
|---|---|
| Menu bar icon | Tray icon (a T-shirt PNG drawn in code) |
| Takes over the system screenshot settings (Inbox) | Own `Ctrl+Alt+S` capture plus a watched screenshot folder |
| Force Click | Middle click |
| ⌘ | Ctrl |
| Share sheet (AirDrop…) | Show in Explorer |
| Markup / screen recording trim | Opens the file in the default editor |
| Real glass blur | Painted frost (Windows cannot blur one window over another) |
| Vision OCR | Windows.Media.Ocr, on-device |
| Pinned to every Space | Virtual desktops are not addressable; the window stays on the current one |
| Always in the menu bar | 0.25 s rest at the top edge, or a shortcut |
| No "screenshots on the Desktop" leftover | Own `Screenshots\` folder, the Desktop stays clean |

## Development

```powershell
npm start                                          # electron . against the sources
npx electron . --remote-debugging-port=9335        # with a debug port
```

The renderer exposes `window.td.diag()` — `revealed`, `ignoringMouse`, `live`, `hitCount`,
`dragCalls`, `tickErrors` and friends. Card hit rectangles are reported by the renderer and
the main process polls the pointer at 30 Hz to decide reveal, retract and click-through;
most "clicked but nothing happened" bugs are visible in that chain.

## Feedback

Bugs, ideas, feature requests: the Issues tab (#1 lists what to include in a report).

## Licence

- Original author **Alejandro Buján**, MIT licensed.
- This port is MIT licensed as well — see `LICENSE`. Provenance and trademark notes are in
  `NOTICE.md`.
- Chinese: [README.zh-CN.md](README.zh-CN.md)
