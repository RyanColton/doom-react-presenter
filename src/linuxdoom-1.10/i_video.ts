// Copyright (C) 1993-1996 id Software, Inc. GPL-2.0-only.
// Browser platform implementation. Each finished frame is converted from the 8-bit
// screen to RGBA and handed to the installed Presenter, which owns the DOM it draws
// with. The host element passed to I_InitGraphics only provides keyboard focus,
// pointer lock and fullscreen.
import { SCREENWIDTH, SCREENHEIGHT, KEY_RIGHTARROW, KEY_LEFTARROW, KEY_UPARROW, KEY_DOWNARROW,
    KEY_ESCAPE, KEY_ENTER, KEY_TAB, KEY_BACKSPACE, KEY_RSHIFT, KEY_RCTRL, KEY_RALT, KEY_PAUSE } from './doomdef.h';
import { evtype_t } from './d_event.h';
import type { event_t } from './d_event.h';
import { screens, gammatable, usegamma } from './v_video';
import { I_Error } from './i_system';
// Displays frames. `mount` creates the presenter's DOM inside the host; `present` receives
// the frame as RGBA bytes (width * height * 4) in a buffer that is reused for every frame,
// so a presenter copies anything it needs after the call returns; `dispose` removes the DOM.
export interface Presenter {
    mount(host: HTMLElement, width: number, height: number): void;
    present(frame: Uint8ClampedArray<ArrayBuffer>): void;
    dispose(): void;
}
let host: HTMLElement | null = null;
let presenter: Presenter | null = null;
const frame = new Uint8ClampedArray(SCREENWIDTH * SCREENHEIGHT * 4);
let dispose: (() => void) | null = null;
const palette = new Uint8Array(768);
const pending: event_t[] = [];
export function I_InitGraphics(canvas: HTMLElement): void {
    I_ShutdownGraphics();
    host = canvas;
    for (let i = 0; i < 256; i++) palette.fill(i, i * 3, i * 3 + 3);
    const keys: Record<string, number> = {
        ArrowRight: KEY_RIGHTARROW, ArrowLeft: KEY_LEFTARROW, ArrowUp: KEY_UPARROW, ArrowDown: KEY_DOWNARROW,
        Escape: KEY_ESCAPE, Enter: KEY_ENTER, Tab: KEY_TAB, Backspace: KEY_BACKSPACE,
        ShiftLeft: KEY_RSHIFT, ShiftRight: KEY_RSHIFT, ControlLeft: KEY_RCTRL, ControlRight: KEY_RCTRL,
        AltLeft: KEY_RALT, AltRight: KEY_RALT, Pause: KEY_PAUSE,
    };
    const held = new Set<number>();
    const postKey = (e: KeyboardEvent): void => {
        if (document.activeElement !== canvas) return;
        const f = /^F(\d+)$/.exec(e.code);
        const key = keys[e.code] ?? (f ? (Number(f[1]) <= 10 ? 0x80 + 0x3a + Number(f[1]) : 0x80 + 0x57 + Number(f[1]) - 11)
            : e.key.length === 1 ? e.key.toLowerCase().charCodeAt(0) : 0);
        if (!key) return;
        e.preventDefault();
        if (e.repeat) return;
        if (e.type === 'keydown') held.add(key); else held.delete(key);
        pending.push({ type: e.type === 'keydown' ? evtype_t.ev_keydown : evtype_t.ev_keyup, data1: key, data2: 0, data3: 0 });
    };
    let mouseButtons=0;
    const mouse = (e: MouseEvent): void => {
        if(document.pointerLockElement!==canvas)return;
        // DOM and X11 use different right/middle bit positions.
        mouseButtons=(e.buttons&1)|((e.buttons&4)>>1)|((e.buttons&2)<<1);
        pending.push({type:evtype_t.ev_mouse,data1:mouseButtons,data2:Math.trunc(e.movementX),data3:-Math.trunc(e.movementY)});
    };
    const unlock = (): void => {if(document.pointerLockElement!==canvas){mouseButtons=0;pending.push({type:evtype_t.ev_mouse,data1:0,data2:0,data3:0});}};
    const contextMenu=(e:MouseEvent):void=>{if(document.pointerLockElement===canvas)e.preventDefault();};
    window.addEventListener('mousemove',mouse);window.addEventListener('mousedown',mouse);window.addEventListener('mouseup',mouse);
    document.addEventListener('pointerlockchange',unlock);canvas.addEventListener('contextmenu',contextMenu);
    const release = (): void => { for (const key of held) pending.push({ type: evtype_t.ev_keyup, data1: key, data2: 0, data3: 0 }); held.clear();if(mouseButtons){mouseButtons=0;pending.push({type:evtype_t.ev_mouse,data1:0,data2:0,data3:0});} };
    window.addEventListener('keydown', postKey); window.addEventListener('keyup', postKey);
    window.addEventListener('blur', release); canvas.addEventListener('blur', release);
    dispose = () => {
        if(document.pointerLockElement===canvas)document.exitPointerLock();
        window.removeEventListener('mousemove',mouse);window.removeEventListener('mousedown',mouse);window.removeEventListener('mouseup',mouse);
        document.removeEventListener('pointerlockchange',unlock);canvas.removeEventListener('contextmenu',contextMenu);
        window.removeEventListener('keydown', postKey); window.removeEventListener('keyup', postKey);
        window.removeEventListener('blur', release); canvas.removeEventListener('blur', release);
    };
}
export function I_ShutdownGraphics(): void { dispose?.(); dispose = null; presenter?.dispose(); presenter = null; host = null; pending.length = 0; }
export function I_SetPresenter(next: Presenter | null): void {
    if (!host) I_Error('I_SetPresenter before I_InitGraphics');
    presenter?.dispose();
    presenter = next;
    presenter?.mount(host, SCREENWIDTH, SCREENHEIGHT);
    presenter?.present(frame); // the new presenter shows the current frame at once
}
export function I_SetPalette(pal: Uint8Array): void {
    if (pal.length < 768) I_Error('PLAYPAL must contain at least 768 bytes');
    palette.set(pal.subarray(0, 768));
}
export function I_FinishUpdate(): void {
    if (!host) return;
    const gamma = gammatable[usegamma];
    for (let i = 0; i < screens[0].length; i++) {
        const color = screens[0][i] * 3, dest = i * 4;
        frame[dest] = gamma[palette[color]];
        frame[dest + 1] = gamma[palette[color + 1]];
        frame[dest + 2] = gamma[palette[color + 2]];
        frame[dest + 3] = 255;
    }
    presenter?.present(frame);
}
export function I_ReadScreen(scr: Uint8Array): void { scr.set(screens[0]); }
export function I_StartTic(): event_t[] { return pending.splice(0); }
export function I_StartFrame(): void { /* empty in upstream */ }
export function I_UpdateNoBlit(): void { /* empty in upstream */ }
