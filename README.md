# ReactDOOM

DOOM, with the screen drawn by React. `react-dom`, one O further.

The game engine is a TypeScript port of the original DOOM source,
[kant003/doomJavascript](https://github.com/kant003/doomJavascript), which this
repository is forked from. That project ports the engine file by file from
[id Software's release](https://github.com/id-Software/DOOM): level loading, the
BSP renderer, monsters, weapons, doors, sound and music all live there, and
none of it is changed here. This fork replaces one thing: how the finished
frame gets onto the page. The engine still rasterizes every frame into its
320x200 screen buffer exactly as DOOM did in 1993; instead of copying that
buffer into a `<canvas>`, it is handed to React, which turns it into DOM.

Play it: **https://ryancolton.github.io/ReactDOOM/**. The page downloads
the shareware WAD itself. Pick a map, press Play, click the screen, and switch
renderers from the dropdown while playing.

## The presenter seam

`src/linuxdoom-1.10/i_video.ts` is the engine's video driver. Once per
animation frame, after the engine has drawn, `I_FinishUpdate` converts the 8-bit
palette-indexed screen into an RGBA buffer and calls `present()` on whatever
`Presenter` is installed. A presenter is three methods: `mount` creates its DOM
inside the `#screen` element, `present` receives the frame, `dispose` tears
down. The engine never learns what the presenter does with the frame, and
presenters can be swapped while the game runs. The `#screen` element itself is
a plain `<div>` that only provides keyboard focus, pointer lock and fullscreen.

The RGBA buffer is reused for every frame, so a presenter reads it during
`present()` and copies anything it needs to keep.

## The four React presenters

All four live in `src/web/presenters/react-presenter.tsx` and use React 19.
They differ in what the DOM looks like and in how frames reach React.

**Per pixel, individual updates.** The DOM is a literal copy of the screen:
64,000 `<div>`s, one per pixel, each a React component that holds its colour in
`useState`. Each frame the presenter diffs the new frame against the last one it
delivered and calls the state setter of every pixel whose colour changed. React
re-renders those components, diffs their output and commits the DOM writes.
While turning, that is around 40,000 state updates per frame.

**Per pixel, row updates.** The same 64,000 pixel `<div>`s, but state lives in
the 200 row components, each holding an array of 320 colours. The presenter
calls the setter of every row that changed, and React reconciles that row's 320
pixel elements. Pixel elements come from a per-colour cache, so a pixel whose
colour did not change receives the identical element object and React skips it
by identity. Around 200 state updates per frame instead of 40,000, and React
still reconciles every pixel individually.

**Declarative.** No component holds screen state. Each frame is copied and
passed to React as props through `root.render` inside `startTransition`, so
React schedules the work, time-slices it, and renders the newest frame if
several arrive while it is busy. Each of the 200 scanlines is a memoized
component whose comparator checks the row's pixels; a changed row run-length
encodes itself into one `<span>` per colour run, and React's reconciler diffs
those spans against the previous frame's. The DOM holds between 12,000 and
35,000 spans depending on the scene.

**Row gradients.** 200 scanline `<div>`s, each a component that holds its
background in `useState`. The background is the row run-length encoded into a
CSS `linear-gradient` with a hard colour stop per run, so the browser's gradient
rasterizer draws the pixels and React only reconciles 200 style strings.

The two pixel strategies deliver their updates inside `startTransition` so
React yields to the engine's animation loop between slices; the game keeps
ticking and input stays responsive while React commits frames as fast as it
can. The gradient rows commit synchronously with `flushSync` because they are
cheap enough to finish inside the frame.

## What the readout shows

The simulation runs at 35 tics per second, so the screen changes at most 35
times a second. The line under the screen shows:

- **fps**: how often the engine hands a frame to the presenter.
- **react fps**: how often React committed a changed frame. 35 is the ceiling
  that matters.
- **render**: React's render time per commit, from React's Profiler API. The
  presenter imports `react-dom/profiling`, the production reconciler with
  Profiler timing kept on, so this works in the built site.
- **react total**: for the declarative presenter, the time from handing React
  the frame to React's layout effect after the DOM commit.
- **present**: how long `present()` itself took.
- **changed**: how many pixels or rows were delivered to React for the frame.

Measured on a laptop in Chrome while turning in place, the hardest case
because nearly every pixel changes: row gradients commit all 35 frames, the
declarative presenter commits about 15, per pixel with row updates about 10,
and per pixel with individual updates about 6. The gap between the pixel
strategies and the rest is the browser's cost of styling and painting 64,000
elements, which no amount of React work can reduce.

## Running it locally

```sh
npm install
npm run dev
```

Open the URL Vite prints. `npm run build` produces the static site in `dist/`;
`npx vite preview` serves it. React runs in development mode under `npm run
dev` and is several times slower on the pixel strategies, so judge speed on a
production build.

`npm run verify` runs the port's inventory, type check, tests and build. The
GitHub Actions workflow runs it on every push and publishes `dist/` to the
public site repository.

## Controls

W and S move, A and D turn, Q and E strafe, F uses, Space or Ctrl fires, 1 to 7
select weapons, Tab opens the automap, Esc opens the DOOM menu.

## License

GPL-2.0, inherited from the DOOM source release. See `LICENSE.TXT`.
