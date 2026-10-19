import React, { createContext, memo, Profiler, startTransition, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
// The profiling entry keeps <Profiler> live in production so the declarative presenter can report render time.
import { createRoot, type Root } from 'react-dom/profiling';
import type { Presenter } from '../../linuxdoom-1.10/i_video';
// React presenter. Strategies for turning the 320x200 RGBA frame into DOM:
//   rows        - 200 <div>s, one per scanline, background = run-length-encoded linear-gradient.
//                 React reconciles 200 style strings per frame. Playable (100+ fps).
//   pixels      - 64,000 <div>s, one per pixel. The parent re-renders every frame and React
//                 diffs every element; memo skips the DOM write for unchanged pixels.
//                 The literal version of the idea (~10 fps moving).
//   pixels-ref  - 64,000 <div>s under 200 row components. The presenter diffs the frame
//                 itself and only notifies pixels whose colour changed; each pixel writes
//                 the colour straight to its own DOM node through a ref, so React is not
//                 in the per-frame loop (the pattern animation libraries use). Rows are
//                 compositor layers so idle repaints are cheap. 120 fps idle, ~14 fps turning.
//   dom-pixels  - diagnostic floor: the same 64,000 <div>s written directly with no React.
//                 Shows what the browser alone costs for one element per pixel.
//   declarative - the most React-idiomatic version. Each frame is an immutable snapshot
//                 passed top-down as props through root.render inside startTransition, so
//                 React schedules, time-slices and drops frames itself. Scanlines are memo
//                 components with a content comparator; each renders one keyed <span> per
//                 colour run, so the reconciler is literally diffing the image. Context
//                 carries screen geometry. Playable, but React does all the work.
//   declarative-lossy - the same, but runs are merged lossily (colour tolerance plus a
//                 minimum run width) to cut the span count, trading texture detail for fps.
export type ReactStrategy='rows'|'pixels'|'pixels-ref'|'dom-pixels'|'declarative'|'declarative-lossy';
export interface LossyOptions {tolerance:number;minWidth:number}
export interface PresentStats {changedPixels:number;renderedFrames?:number;renderMs?:number;commitLatencyMs?:number}

// Pixel (little-endian ABGR as a Uint32, alpha masked off) -> "#rrggbb". DOOM produces
// at most a few thousand distinct colours (256-colour palette x gamma), so the cache
// stays small, and an unchanged colour yields the identical string object, which is
// what lets React's reference-equality checks bail out without a render.
const colorCache=new Map<number,string>();
function cssColor(rgb:number):string {
    let css=colorCache.get(rgb);
    if(css===undefined){
        const r=rgb&0xff,g=(rgb>>8)&0xff,b=(rgb>>16)&0xff;
        css='#'+((b|(g<<8)|(r<<16))|0x1000000).toString(16).slice(1);
        colorCache.set(rgb,css);
    }
    return css;
}

interface FrameStore {
    subscribe:(listener:()=>void)=>()=>void;                       // whole-frame subscribers (rows, pixels)
    subscribePixel:(index:number,sink:(color:string)=>void)=>()=>void; // per-pixel sinks, called only when that pixel changed
    getSnapshot:()=>number;                                         // frame counter
    colorAt:(index:number)=>string;
    pixels:()=>Uint32Array|null;
    width:number;height:number;
}

// ---- rows ------------------------------------------------------------------
function rowGradient(pixels:Uint32Array,rowStart:number,width:number):string {
    const stops:string[]=[],unit=100/width;
    let runColor=pixels[rowStart]&0xffffff,runStart=0;
    for(let x=1;x<width;x++){
        const c=pixels[rowStart+x]&0xffffff;
        if(c!==runColor){stops.push(`${cssColor(runColor)} ${runStart*unit}% ${x*unit}%`);runColor=c;runStart=x;}
    }
    stops.push(`${cssColor(runColor)} ${runStart*unit}% 100%`);
    return `linear-gradient(90deg,${stops.join(',')})`;
}
const Row=memo(function Row({background}:{background:string}){
    return <div className="screen-row" style={{background}}/>;
});
function RowsView({store}:{store:FrameStore}){
    const frame=useSyncExternalStore(store.subscribe,store.getSnapshot);
    const pixels=store.pixels(),rows=[];
    if(pixels)for(let y=0;y<store.height;y++)rows.push(<Row key={y} background={rowGradient(pixels,y*store.width,store.width)}/>);
    return <div className="screen-surface screen-rows" data-frame={frame}>{rows}</div>;
}

// ---- pixels ----------------------------------------------------------------
const Pixel=memo(function Pixel({color}:{color:string}){
    return <div className="screen-pixel" style={{backgroundColor:color}}/>;
});
function PixelsView({store}:{store:FrameStore}){
    const frame=useSyncExternalStore(store.subscribe,store.getSnapshot);
    const count=store.width*store.height,items=new Array(count);
    for(let i=0;i<count;i++)items[i]=<Pixel key={i} color={store.colorAt(i)}/>;
    const style={gridTemplateColumns:`repeat(${store.width},1fr)`,gridTemplateRows:`repeat(${store.height},1fr)`};
    return <div className="screen-surface screen-pixels" data-frame={frame} style={style}>{items}</div>;
}

// ---- pixels-ref ------------------------------------------------------------
function RefPixel({store,index}:{store:FrameStore;index:number}){
    const ref=useRef<HTMLDivElement>(null);
    useEffect(()=>store.subscribePixel(index,color=>{if(ref.current)ref.current.style.backgroundColor=color;}),[store,index]);
    return <div ref={ref} className="screen-pixel" style={{backgroundColor:store.colorAt(index)}}/>;
}
const PixelRow=memo(function PixelRow({store,y}:{store:FrameStore;y:number}){
    const items=new Array(store.width);
    for(let x=0;x<store.width;x++)items[x]=<RefPixel key={x} store={store} index={y*store.width+x}/>;
    return <div className="screen-pixel-row">{items}</div>;
});
function RefPixelsView({store}:{store:FrameStore}){
    // Rendered exactly once. Every later frame is delivered pixel by pixel through subscribePixel.
    const rows=new Array(store.height);
    for(let y=0;y<store.height;y++)rows[y]=<PixelRow key={y} store={store} y={y}/>;
    return <div className="screen-surface screen-pixel-rows">{rows}</div>;
}

// ---- declarative -----------------------------------------------------------
interface ScreenGeometry {width:number;height:number;lossy?:LossyOptions}
const ScreenContext=createContext<ScreenGeometry>({width:320,height:200});
interface Run {width:number;color:string}
function runsOf(row:Uint32Array):Run[] {
    const runs:Run[]=[];
    let color=row[0]&0xffffff,start=0;
    for(let x=1;x<row.length;x++){
        const c=row[x]&0xffffff;
        if(c!==color){runs.push({width:x-start,color:cssColor(color)});color=c;start=x;}
    }
    runs.push({width:row.length-start,color:cssColor(color)});
    return runs;
}
// One immutable <span> element per distinct run shape (width x colour), shared across
// every scanline and frame. When a scanline hands React the very same element object
// it received last time, React sees oldProps === newProps and bails out of that span
// before touching props or the DOM. Elements are keyless on purpose: index keys would
// make each element position-specific and defeat the sharing.
const runElementCache=new Map<string,React.JSX.Element>();
function runElement(run:Run,screenWidth:number):React.JSX.Element {
    const key=`${run.width}|${run.color}`;
    let element=runElementCache.get(key);
    if(!element){
        element=<span className="screen-run" style={{width:`${(run.width*100)/screenWidth}%`,backgroundColor:run.color}}/>;
        runElementCache.set(key,element);
    }
    return element;
}
// Lossy run-length encoding. Pass 1: a pixel joins the current run while its colour is
// within `tolerance` (RGB distance) of the run's first colour, which collapses texture
// noise. Pass 2: runs narrower than `minWidth` are absorbed by whichever neighbour is
// closer in colour, but only if that neighbour is within 2x tolerance: a one-pixel run
// that contrasts sharply with both sides (status bar digits, thin edges) is detail,
// not noise, and is kept. Fewer runs means fewer spans for React and the browser.
function colorDistanceSq(a:number,b:number):number {
    const dr=(a&0xff)-(b&0xff),dg=((a>>8)&0xff)-((b>>8)&0xff),db=((a>>16)&0xff)-((b>>16)&0xff);
    return dr*dr+dg*dg+db*db;
}
function runsOfLossy(row:Uint32Array,{tolerance,minWidth}:LossyOptions):Run[] {
    const tolSq=tolerance*tolerance,raw:{width:number;color:number}[]=[];
    let color=row[0]&0xffffff,start=0;
    for(let x=1;x<row.length;x++){
        const c=row[x]&0xffffff;
        if(c!==color&&colorDistanceSq(c,color)>tolSq){raw.push({width:x-start,color});color=c;start=x;}
    }
    raw.push({width:row.length-start,color});
    const merged:{width:number;color:number}[]=[];
    for(let i=0;i<raw.length;i++){
        const run=raw[i],prev=merged[merged.length-1],next=raw[i+1];
        if(run.width<minWidth&&(prev||next)){
            const dPrev=prev?colorDistanceSq(run.color,prev.color):Infinity,dNext=next?colorDistanceSq(run.color,next.color):Infinity;
            if(Math.min(dPrev,dNext)<=tolSq*4){if(dNext<dPrev)next.width+=run.width;else prev.width+=run.width;continue;}
        }
        merged.push(run);
    }
    return merged.map(r=>({width:r.width,color:cssColor(r.color)}));
}
function rowsEqual(a:{row:Uint32Array},b:{row:Uint32Array}):boolean {
    const x=a.row,y=b.row;
    if(x.length!==y.length)return false;
    for(let i=0;i<x.length;i++)if(x[i]!==y[i])return false;
    return true;
}
// memo with a content comparator: the row is a fresh subarray every frame, so React
// would otherwise re-render every scanline; comparing the 320 ints lets unchanged
// scanlines keep their committed spans untouched.
const Scanline=memo(function Scanline({row}:{row:Uint32Array}){
    const {width,lossy}=useContext(ScreenContext);
    const spans=useMemo(()=>(lossy?runsOfLossy(row,lossy):runsOf(row)).map(run=>runElement(run,width)),[row,width,lossy]);
    return <div className="screen-scanline">{spans}</div>;
},rowsEqual);
function DeclarativeScreen({frame,pixels,onCommit}:{frame:number;pixels:Uint32Array;onCommit:()=>void}){
    const {width,height}=useContext(ScreenContext);
    // Layout effect, not useEffect: passive effects after a transition commit are flushed in a
    // later task, which would delay the next frame's submission by a whole animation frame.
    useLayoutEffect(onCommit,[frame,onCommit]);
    const rows=new Array(height);
    for(let y=0;y<height;y++)rows[y]=<Scanline key={y} row={pixels.subarray(y*width,(y+1)*width)}/>;
    return <div className="screen-surface screen-declarative" data-frame={frame}>{rows}</div>;
}

const VIEWS:Record<Exclude<ReactStrategy,'dom-pixels'|'declarative'|'declarative-lossy'>,(props:{store:FrameStore})=>React.JSX.Element>={rows:RowsView,pixels:PixelsView,'pixels-ref':RefPixelsView};

export class ReactPresenter implements Presenter {
    constructor(private strategy:ReactStrategy='rows'){}
    readonly stats:PresentStats={changedPixels:0};
    private host:HTMLElement|null=null;
    private container:HTMLElement|null=null;
    private root:Root|null=null;
    private frame=0;
    private pixels:Uint32Array|null=null;
    private previous:Uint32Array|null=null;                      // last frame delivered per pixel (pixels-ref, dom-pixels)
    private listeners=new Set<()=>void>();
    private pixelSinks:Array<((color:string)=>void)|null>|null=null; // pixels-ref
    private domPixels:HTMLElement[]|null=null;                     // dom-pixels

    mount(host:HTMLElement,width:number,height:number):void {
        this.host=host;
        this.container=document.createElement('div');this.container.className='screen-react-root';
        host.appendChild(this.container);
        // One element per pixel only looks right when each pixel is a whole number of
        // device pixels, so lock the host to 2x (640x400) for every per-pixel strategy.
        if(this.strategy!=='rows')host.classList.add('square-pixels');
        if(this.strategy==='dom-pixels'){this.mountDom(width,height);return;}
        if(this.strategy==='declarative'||this.strategy==='declarative-lossy'){
            const lossy=this.strategy==='declarative-lossy'?((window as unknown as {doomLossyOptions?:LossyOptions}).doomLossyOptions??{tolerance:32,minWidth:2}):undefined;
            this.geometry={width,height,lossy};this.stats.renderedFrames=0;this.root=createRoot(this.container);return;} // first root.render happens in present()
        if(this.strategy==='pixels-ref')this.pixelSinks=new Array(width*height).fill(null);
        const store:FrameStore={
            subscribe:listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);},
            subscribePixel:(index,sink)=>{this.pixelSinks![index]=sink;return()=>{if(this.pixelSinks)this.pixelSinks[index]=null;};},
            getSnapshot:()=>this.frame,pixels:()=>this.pixels,width,height,
            colorAt:index=>cssColor(this.pixels?this.pixels[index]&0xffffff:0),
        };
        const View=VIEWS[this.strategy];
        this.root=createRoot(this.container);
        flushSync(()=>this.root!.render(<View store={store}/>));
    }
    present(frame:Uint8ClampedArray<ArrayBuffer>):void {
        if(!this.container)return;
        if(!this.pixels||this.pixels.buffer!==frame.buffer)this.pixels=new Uint32Array(frame.buffer,frame.byteOffset,frame.byteLength>>2);
        this.frame++;
        switch(this.strategy){
            case 'declarative':case 'declarative-lossy':this.renderDeclarative();return;
            case 'dom-pixels':this.deliverChanged(this.domSink);return;
            case 'pixels-ref':this.deliverChanged(this.refSink);return;
            default:
                // flushSync commits synchronously inside the engine's frame, mirroring putImageData's timing.
                flushSync(()=>{for(const listener of this.listeners)listener();});
        }
    }
    // Diff against the previously delivered frame and hand only the changed pixels to
    // `sink`. Unchanged pixels never hear about the frame: no callback, no render.
    private deliverChanged(sink:(index:number,color:string)=>void):void {
        const pixels=this.pixels!;
        if(!this.previous){
            // First frame after mount: the mount already rendered it (React) or needs every pixel (DOM).
            this.previous=new Uint32Array(pixels.length).fill(this.strategy==='dom-pixels'?0xffffffff:0);
            if(this.strategy==='pixels-ref'){for(let i=0;i<pixels.length;i++)this.previous[i]=pixels[i]&0xffffff;this.stats.changedPixels=pixels.length;return;}
        }
        const previous=this.previous;let changed=0;
        for(let i=0;i<pixels.length;i++){
            const c=pixels[i]&0xffffff;
            if(c===previous[i])continue;
            previous[i]=c;changed++;sink(i,cssColor(c));
        }
        this.stats.changedPixels=changed;
    }
    private geometry:ScreenGeometry={width:320,height:200};
    private submittedAt=0;
    private onCommit=():void=>{
        this.stats.renderedFrames=(this.stats.renderedFrames??0)+1;
        // Layout effects run after React's DOM mutations and before the browser paints, so
        // this is React's whole JavaScript cost for the frame: render, yields and commit.
        // (Under a transition it also includes engine work interleaved at yield points.)
        const latency=performance.now()-this.submittedAt;
        this.stats.commitLatencyMs=this.stats.commitLatencyMs===undefined?latency:this.stats.commitLatencyMs*0.9+latency*0.1;
    };
    // React's Profiler API reports the time React spent rendering the subtree for each commit.
    private onProfile=(_id:string,_phase:string,actualDuration:number):void=>{
        this.stats.renderMs=this.stats.renderMs===undefined?actualDuration:this.stats.renderMs*0.9+actualDuration*0.1;
    };
    private renderDeclarative():void {
        // Snapshot the frame so React sees immutable data, then hand it over as a
        // transition. Frames that arrive while React is mid-render land in the same
        // transition lane, so React batches them and renders the newest; no explicit
        // back-pressure is needed (measured: none).
        this.submit(this.frame,this.pixels!.slice());
    }
    private submit(frame:number,pixels:Uint32Array):void {
        this.submittedAt=performance.now();
        const element=(
            <ScreenContext.Provider value={this.geometry}>
                <Profiler id="screen" onRender={this.onProfile}>
                    <DeclarativeScreen frame={frame} pixels={pixels} onCommit={this.onCommit}/>
                </Profiler>
            </ScreenContext.Provider>
        );
        // A transition lets React time-slice the render and yield to the engine's animation
        // loop, which keeps the game ticking and input responsive while React is behind.
        // flushSync measured the same React fps while turning but stalled the engine to match.
        startTransition(()=>this.root!.render(element));
    }
    private refSink=(index:number,color:string):void=>{const sink=this.pixelSinks![index];if(sink)sink(color);};
    private domSink=(index:number,color:string):void=>{this.domPixels![index].style.backgroundColor=color;};
    private mountDom(width:number,height:number):void {
        const surface=document.createElement('div');surface.className='screen-surface screen-pixels';
        surface.style.gridTemplateColumns=`repeat(${width},1fr)`;surface.style.gridTemplateRows=`repeat(${height},1fr)`;
        const count=width*height,fragment=document.createDocumentFragment();this.domPixels=new Array(count);
        for(let i=0;i<count;i++){const el=document.createElement('div');el.className='screen-pixel';fragment.appendChild(el);this.domPixels[i]=el;}
        surface.appendChild(fragment);this.container!.appendChild(surface);
    }
    dispose():void {
        this.host?.classList.remove('square-pixels');this.root?.unmount();this.container?.remove();this.listeners.clear();
        this.host=null;this.root=null;this.container=null;this.pixels=null;this.previous=null;this.pixelSinks=null;this.domPixels=null;
    }
}
