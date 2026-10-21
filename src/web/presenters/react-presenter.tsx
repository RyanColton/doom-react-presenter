import React, { createContext, memo, Profiler, startTransition, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
// The profiling entry keeps <Profiler> live in production so the declarative presenter can report render time.
import { createRoot, type Root } from 'react-dom/profiling';
import type { Presenter } from '../../linuxdoom-1.10/i_video';
// React presenter. Strategies for turning the 320x200 RGBA frame into DOM:
//   declarative - the default and the most React-idiomatic. Each frame is an immutable
//                 snapshot passed top-down as props through root.render inside
//                 startTransition, so React schedules, time-slices and drops frames itself.
//                 Scanlines are memo components with a content comparator; each renders one
//                 keyed <span> per colour run, so the reconciler is literally diffing the
//                 image. Context carries screen geometry. ~120 fps idle, ~10 fps turning.
//   rows        - 200 <div>s, one per scanline, each a component holding its background in
//                 React state: a run-length-encoded linear-gradient. The presenter diffs rows
//                 and calls the setters of changed rows inside flushSync. 120 fps.
//   pixels-individual - 64,000 pixel <div>s, each a component holding its colour in React
//                 state. The presenter diffs the frame and calls the setter of every changed
//                 pixel inside a transition: ~40,000 scheduled updates per frame while turning.
//                 ~6-8 commits/s turning.
//   pixels-rows - the same 64,000 pixel <div>s, but the 200 row components hold the colours.
//                 The presenter calls the setter of every changed row; React reconciles that
//                 row's 320 pixel elements, bailing out of unchanged ones by element identity.
//                 ~200 scheduled updates per frame. ~9-10 commits/s turning, game loop ~50 fps.
export type ReactStrategy='pixels-individual'|'pixels-rows'|'declarative'|'rows';
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

// What the state-driven views (rows, pixels) get from the presenter. Each row or pixel
// component registers its own state setter under its index; the presenter calls a
// setter only for frames in which that row or pixel changed.
interface FrameStore {
    subscribe:(index:number,sink:(value:never)=>void)=>()=>void; // sink is the component's state setter
    width:number;height:number;
}

// ---- rows (one stateful component per scanline; React commits every change) --
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
function Row({store,y}:{store:FrameStore;y:number}){
    const [background,setBackground]=useState('');
    // The presenter calls setBackground only for frames in which this scanline changed.
    useEffect(()=>store.subscribe(y,setBackground),[store,y]);
    return <div className="screen-row" style={{background}}/>;
}
function RowsView({store}:{store:FrameStore}){
    // Built once; later frames reach rows through their state setters.
    const rows=new Array(store.height);
    for(let y=0;y<store.height;y++)rows[y]=<Row key={y} store={store} y={y}/>;
    return <div className="screen-surface screen-rows">{rows}</div>;
}

// ---- pixels-individual (one stateful component per pixel) ---------------------
function Pixel({store,index}:{store:FrameStore;index:number}){
    const [color,setColor]=useState('');
    // The presenter calls setColor only for frames in which this pixel changed.
    useEffect(()=>store.subscribe(index,setColor),[store,index]);
    return <div className="screen-pixel" style={{backgroundColor:color}}/>;
}
const IndividualRow=memo(function IndividualRow({store,y}:{store:FrameStore;y:number}){
    const items=new Array(store.width);
    for(let x=0;x<store.width;x++)items[x]=<Pixel key={x} store={store} index={y*store.width+x}/>;
    return <div className="screen-pixel-row">{items}</div>;
});
function IndividualPixelsView({store}:{store:FrameStore}){
    // Built once; rows never re-render, so React only walks into rows with pending updates.
    const rows=new Array(store.height);
    for(let y=0;y<store.height;y++)rows[y]=<IndividualRow key={y} store={store} y={y}/>;
    return <div className="screen-surface screen-pixel-rows">{rows}</div>;
}

// ---- pixels-rows (64,000 pixel elements, state held per row) ------------------
// Each row component holds its 320 colours in React state. The presenter diffs the frame
// and calls the setter of every row that changed, so React re-renders that row and
// reconciles its 320 pixel elements individually. Pixel elements come from a per-colour
// cache: an unchanged pixel receives the very same element object as last time and React
// bails out of it by identity, while changed ones update as usual. Compared with one
// setState per pixel this trades ~40,000 scheduled updates for ~200, about 30% more
// committed frames, and React still owns every pixel's DOM node.
const pixelElementCache=new Map<string,React.JSX.Element>();
function pixelElement(color:string):React.JSX.Element {
    let el=pixelElementCache.get(color);
    if(!el){el=<div className="screen-pixel" style={{backgroundColor:color}}/>;pixelElementCache.set(color,el);}
    return el;
}
function PixelRow({store,y}:{store:FrameStore;y:number}){
    const [colors,setColors]=useState<string[]|null>(null);
    // The presenter calls setColors only for frames in which this row changed.
    useEffect(()=>store.subscribe(y,setColors),[store,y]);
    return <div className="screen-pixel-row">{colors?colors.map(pixelElement):null}</div>;
}
function PixelsView({store}:{store:FrameStore}){
    // Built once; later frames reach rows through their state setters.
    const rows=new Array(store.height);
    for(let y=0;y<store.height;y++)rows[y]=<PixelRow key={y} store={store} y={y}/>;
    return <div className="screen-surface screen-pixel-rows">{rows}</div>;
}

// ---- declarative -----------------------------------------------------------
interface ScreenGeometry {width:number;height:number}
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
    const {width}=useContext(ScreenContext);
    const spans=useMemo(()=>runsOf(row).map(run=>runElement(run,width)),[row,width]);
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

const VIEWS:Record<'rows'|'pixels-individual'|'pixels-rows',(props:{store:FrameStore})=>React.JSX.Element>={rows:RowsView,'pixels-individual':IndividualPixelsView,'pixels-rows':PixelsView};

export class ReactPresenter implements Presenter {
    constructor(private strategy:ReactStrategy='rows'){}
    readonly stats:PresentStats={changedPixels:0};
    private host:HTMLElement|null=null;
    private container:HTMLElement|null=null;
    private root:Root|null=null;
    private frame=0;
    private pixels:Uint32Array|null=null;
    private previous:Uint32Array|null=null;                      // last frame delivered (rows, pixels)
    private sinks:Array<((value:never)=>void)|null>|null=null;    // state setters by row or pixel index

    mount(host:HTMLElement,width:number,height:number):void {
        this.host=host;
        this.container=document.createElement('div');this.container.className='screen-react-root';
        host.appendChild(this.container);
        // Scanlines and pixels are compositor layers in every strategy except rows, and a
        // layer edge on a fractional device pixel shows as a seam. Lock the host to 2x
        // (640x400) so each of the 200 rows is exactly two device pixels tall.
        if(this.strategy!=='rows')host.classList.add('square-pixels');
        this.geometry={width,height};
        if(this.strategy==='declarative'){
            this.stats.renderedFrames=0;this.root=createRoot(this.container);return;} // first root.render happens in present()
        this.sinks=new Array(this.strategy==='pixels-individual'?width*height:height).fill(null);
        this.stats.renderedFrames=0;
        const store:FrameStore={
            subscribe:(index,sink)=>{this.sinks![index]=sink;return()=>{if(this.sinks)this.sinks[index]=null;};},
            width,height,
        };
        const View=VIEWS[this.strategy];
        this.root=createRoot(this.container);
        // The Profiler counts commits so state-driven modes report React-committed fps too.
        flushSync(()=>this.root!.render(<Profiler id="screen" onRender={this.onStateCommit}><View store={store}/></Profiler>));
    }
    present(frame:Uint8ClampedArray<ArrayBuffer>):void {
        if(!this.container)return;
        if(!this.pixels||this.pixels.buffer!==frame.buffer)this.pixels=new Uint32Array(frame.buffer,frame.byteOffset,frame.byteLength>>2);
        this.frame++;
        switch(this.strategy){
            case 'declarative':this.renderDeclarative();return;
            // Every setter call schedules a React update; flushSync makes React render and
            // commit all of them before present() returns, so the frame is on screen when the
            // engine's animation callback ends.
            // rows: ~200 cheap updates, committed synchronously before present() returns.
            case 'rows':flushSync(()=>this.deliverRows(false));return;
            // pixels: up to 200 row updates that each reconcile 320 pixel elements. Delivered as
            // a transition so React time-slices the work and yields to the engine loop; the game
            // stays responsive at ~50 fps while React commits ~9-10 frames/s turning. flushSync
            // measured about the same commit rate but stalled the whole page to it.
            case 'pixels-rows':startTransition(()=>this.deliverRows(true));return;
            case 'pixels-individual':startTransition(()=>this.deliverPixels());return;
        }
    }
    // Delivery diffs against the last delivered frame and calls setters only for what
    // changed. Unchanged rows and pixels never hear about the frame: no setState, no render. Components mount before any frame arrives, so the history is seeded with a
    // value no 24-bit colour can equal and the first present delivers everything.
    private onStateCommit=(_id:string,_phase:string,actualDuration:number):void=>{
        this.stats.renderedFrames=(this.stats.renderedFrames??0)+1;
        this.stats.renderMs=this.stats.renderMs===undefined?actualDuration:this.stats.renderMs*0.9+actualDuration*0.1;
    };
    private history():Uint32Array {
        if(!this.previous)this.previous=new Uint32Array(this.pixels!.length).fill(0xffffffff);
        return this.previous;
    }
    private deliverPixels():void {
        const pixels=this.pixels!,previous=this.history(),sinks=this.sinks!;let changed=0;
        for(let i=0;i<pixels.length;i++){
            const c=pixels[i]&0xffffff;
            if(c===previous[i])continue;
            previous[i]=c;changed++;const sink=sinks[i] as ((color:string)=>void)|null;if(sink)sink(cssColor(c));
        }
        this.stats.changedPixels=changed;
    }
    // Hand each changed row to its component: as a colour array (pixels-rows) or a gradient (rows).
    private deliverRows(asColors:boolean):void {
        const pixels=this.pixels!,previous=this.history(),sinks=this.sinks!,{width,height}=this.geometry;let changed=0;
        for(let y=0;y<height;y++){
            const start=y*width;let same=true;
            for(let x=0;x<width;x++){if((pixels[start+x]&0xffffff)!==previous[start+x]){same=false;break;}}
            if(same)continue;
            for(let x=0;x<width;x++)previous[start+x]=pixels[start+x]&0xffffff;
            changed++;const sink=sinks[y] as ((value:string|string[])=>void)|null;if(!sink)continue;
            if(asColors){const colors=new Array<string>(width);for(let x=0;x<width;x++)colors[x]=cssColor(pixels[start+x]&0xffffff);sink(colors);}
            else sink(rowGradient(pixels,start,width));
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
    dispose():void {
        this.host?.classList.remove('square-pixels');this.root?.unmount();this.container?.remove();
        this.host=null;this.root=null;this.container=null;this.pixels=null;this.previous=null;this.sinks=null;
    }
}
