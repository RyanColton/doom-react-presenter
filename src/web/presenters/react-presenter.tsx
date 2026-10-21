import React, { createContext, memo, Profiler, startTransition, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
// The profiling entry point is the production reconciler with <Profiler> timing enabled,
// which the readout uses to report React's render time per commit.
import { createRoot, type Root } from 'react-dom/profiling';
import type { Presenter } from '../../linuxdoom-1.10/i_video';

// Renders the engine's 320x200 frame with React. Four strategies share one presenter:
//
//   pixels-individual  64,000 pixel <div>s, each a component that holds its colour in state.
//                      The presenter calls the setter of every pixel whose colour changed.
//   pixels-rows        The same 64,000 pixel <div>s, but each of the 200 row components holds
//                      its 320 colours in state. The presenter calls the setter of every row
//                      that changed and React reconciles that row's pixel elements.
//   declarative        Each frame is passed to React as immutable props. Scanline components
//                      run-length encode their row into one <span> per colour run, and React
//                      reconciles those spans; frames are rendered as transitions.
//   rows               200 scanline <div>s, each a component that holds its background in
//                      state: the row run-length encoded into a CSS linear-gradient.
export type ReactStrategy='pixels-individual'|'pixels-rows'|'declarative'|'rows';

// Counters the page readout displays. `changed` is the number of pixels (or rows, for the
// row-based strategies) delivered to React for the last frame; the others are filled in by
// React's Profiler and commit callbacks.
export interface PresentStats {changed:number;renderedFrames?:number;renderMs?:number;commitLatencyMs?:number}

// Converts a pixel (a Uint32 in little-endian ABGR order with the alpha byte masked off) to
// a CSS hex colour. The cache keeps the few thousand colours DOOM produces and returns the
// identical string object for an unchanged colour, which lets React's reference-equality
// checks skip work.
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

// Interface between the presenter and the state-driven views. A component registers its
// state setter under its row or pixel index, and the presenter calls that setter with the
// component's new value only for frames in which that row or pixel changed.
interface FrameStore {
    subscribe:(index:number,setter:(value:never)=>void)=>()=>void;
    width:number;height:number;
}

// ---- pixels-individual ------------------------------------------------------

function Pixel({store,index}:{store:FrameStore;index:number}){
    const [color,setColor]=useState('');
    useEffect(()=>store.subscribe(index,setColor),[store,index]);
    return <div className="screen-pixel" style={{backgroundColor:color}}/>;
}
// Rows are memoized with constant props, so they never re-render. React only descends into
// a row when one of its pixels has a pending state update.
const IndividualRow=memo(function IndividualRow({store,y}:{store:FrameStore;y:number}){
    const items=new Array(store.width);
    for(let x=0;x<store.width;x++)items[x]=<Pixel key={x} store={store} index={y*store.width+x}/>;
    return <div className="screen-pixel-row">{items}</div>;
});
function IndividualPixelsView({store}:{store:FrameStore}){
    const rows=new Array(store.height);
    for(let y=0;y<store.height;y++)rows[y]=<IndividualRow key={y} store={store} y={y}/>;
    return <div className="screen-surface screen-pixel-rows">{rows}</div>;
}

// ---- pixels-rows ------------------------------------------------------------

// One immutable pixel element per colour, shared by every row and frame. A pixel whose
// colour did not change receives the same element object as before, and React bails out
// of it by identity without comparing props or touching the DOM. The elements are keyless
// so that they can be shared across positions.
const pixelElementCache=new Map<string,React.JSX.Element>();
function pixelElement(color:string):React.JSX.Element {
    let el=pixelElementCache.get(color);
    if(!el){el=<div className="screen-pixel" style={{backgroundColor:color}}/>;pixelElementCache.set(color,el);}
    return el;
}
function PixelRow({store,y}:{store:FrameStore;y:number}){
    const [colors,setColors]=useState<string[]|null>(null);
    useEffect(()=>store.subscribe(y,setColors),[store,y]);
    return <div className="screen-pixel-row">{colors?colors.map(pixelElement):null}</div>;
}
function PixelsView({store}:{store:FrameStore}){
    const rows=new Array(store.height);
    for(let y=0;y<store.height;y++)rows[y]=<PixelRow key={y} store={store} y={y}/>;
    return <div className="screen-surface screen-pixel-rows">{rows}</div>;
}

// ---- declarative ------------------------------------------------------------

interface ScreenGeometry {width:number;height:number}
const ScreenContext=createContext<ScreenGeometry>({width:320,height:200});

// A horizontal stretch of consecutive pixels in one scanline that share a colour.
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
// One immutable <span> element per distinct run shape (width and colour), shared by every
// scanline and frame, so React bails out of an unchanged span by identity. Keyless for the
// same reason as the pixel elements above.
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
// Each frame gives every scanline a new subarray, so memo compares the row's contents
// rather than its identity. A scanline whose pixels are unchanged keeps its committed spans.
const Scanline=memo(function Scanline({row}:{row:Uint32Array}){
    const {width}=useContext(ScreenContext);
    const spans=useMemo(()=>runsOf(row).map(run=>runElement(run,width)),[row,width]);
    return <div className="screen-scanline">{spans}</div>;
},rowsEqual);
function DeclarativeScreen({frame,pixels,onCommit}:{frame:number;pixels:Uint32Array;onCommit:()=>void}){
    const {width,height}=useContext(ScreenContext);
    // A layout effect runs after React's DOM mutations and before the browser paints, which
    // is the moment the presenter measures a frame's commit.
    useLayoutEffect(onCommit,[frame,onCommit]);
    const rows=new Array(height);
    for(let y=0;y<height;y++)rows[y]=<Scanline key={y} row={pixels.subarray(y*width,(y+1)*width)}/>;
    return <div className="screen-surface screen-declarative" data-frame={frame}>{rows}</div>;
}

// ---- rows -------------------------------------------------------------------

// Encodes one scanline as a CSS gradient with a hard colour stop per run.
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
    useEffect(()=>store.subscribe(y,setBackground),[store,y]);
    return <div className="screen-row" style={{background}}/>;
}
function RowsView({store}:{store:FrameStore}){
    const rows=new Array(store.height);
    for(let y=0;y<store.height;y++)rows[y]=<Row key={y} store={store} y={y}/>;
    return <div className="screen-surface screen-rows">{rows}</div>;
}

const STATE_VIEWS:Record<Exclude<ReactStrategy,'declarative'>,(props:{store:FrameStore})=>React.JSX.Element>={
    'pixels-individual':IndividualPixelsView,'pixels-rows':PixelsView,rows:RowsView,
};

// ---- presenter --------------------------------------------------------------

export class ReactPresenter implements Presenter {
    constructor(private strategy:ReactStrategy){}
    readonly stats:PresentStats={changed:0};
    private host:HTMLElement|null=null;
    private container:HTMLElement|null=null;
    private root:Root|null=null;
    private geometry:ScreenGeometry={width:320,height:200};
    private frame=0;
    // The engine's RGBA frame viewed as one Uint32 per pixel. The engine overwrites it in
    // place, so anything that must outlive present() is copied.
    private pixels:Uint32Array|null=null;
    // The last frame delivered to the state-driven views, used to find what changed.
    private previous:Uint32Array|null=null;
    // State setters registered by row or pixel components, indexed by row or pixel.
    private setters:Array<((value:never)=>void)|null>|null=null;
    private submittedAt=0;

    mount(host:HTMLElement,width:number,height:number):void {
        this.host=host;
        this.geometry={width,height};
        this.container=document.createElement('div');this.container.className='screen-react-root';
        host.appendChild(this.container);
        // Scanlines and pixel rows are compositor layers, and a layer edge on a fractional
        // device pixel shows as a seam. Locking the host to 640x400 makes each of the 200
        // rows exactly two device pixels tall. The gradient rows have no layers of their own.
        if(this.strategy!=='rows')host.classList.add('square-pixels');
        this.root=createRoot(this.container);
        this.stats.renderedFrames=0;
        if(this.strategy==='declarative')return; // rendered on the first present()
        this.setters=new Array(this.strategy==='pixels-individual'?width*height:height).fill(null);
        const store:FrameStore={
            subscribe:(index,setter)=>{this.setters![index]=setter;return()=>{if(this.setters)this.setters[index]=null;};},
            width,height,
        };
        const View=STATE_VIEWS[this.strategy];
        flushSync(()=>this.root!.render(<Profiler id="screen" onRender={this.onStateCommit}><View store={store}/></Profiler>));
    }

    present(frame:Uint8ClampedArray<ArrayBuffer>):void {
        if(!this.root)return;
        if(!this.pixels||this.pixels.buffer!==frame.buffer)this.pixels=new Uint32Array(frame.buffer,frame.byteOffset,frame.byteLength>>2);
        this.frame++;
        switch(this.strategy){
            case 'declarative':this.renderDeclarative();return;
            // The gradient rows are cheap enough to commit synchronously, so the frame is on
            // screen before the engine's animation callback returns.
            case 'rows':flushSync(()=>this.deliverRows(false));return;
            // The pixel strategies schedule far more work per frame. Delivering it as a
            // transition lets React time-slice the render and yield to the engine's animation
            // loop, so the game keeps ticking and input stays responsive while React catches up.
            case 'pixels-rows':startTransition(()=>this.deliverRows(true));return;
            case 'pixels-individual':startTransition(()=>this.deliverPixels());return;
        }
    }

    dispose():void {
        this.host?.classList.remove('square-pixels');this.root?.unmount();this.container?.remove();
        this.host=null;this.root=null;this.container=null;this.pixels=null;this.previous=null;this.setters=null;
    }

    // ---- state-driven delivery (pixels-individual, pixels-rows, rows)

    // Components mount before the first frame exists, so the history starts at a value no
    // 24-bit colour can equal and the first present() delivers every row or pixel.
    private history():Uint32Array {
        if(!this.previous)this.previous=new Uint32Array(this.pixels!.length).fill(0xffffffff);
        return this.previous;
    }
    // Calls the setter of each pixel whose colour differs from the last delivered frame.
    private deliverPixels():void {
        const pixels=this.pixels!,previous=this.history(),setters=this.setters!;let changed=0;
        for(let i=0;i<pixels.length;i++){
            const c=pixels[i]&0xffffff;
            if(c===previous[i])continue;
            previous[i]=c;changed++;const setter=setters[i] as ((color:string)=>void)|null;if(setter)setter(cssColor(c));
        }
        this.stats.changed=changed;
    }
    // Calls the setter of each row that differs from the last delivered frame, with either
    // the row's colours (pixels-rows) or its gradient (rows).
    private deliverRows(asColors:boolean):void {
        const pixels=this.pixels!,previous=this.history(),setters=this.setters!,{width,height}=this.geometry;let changed=0;
        for(let y=0;y<height;y++){
            const start=y*width;let same=true;
            for(let x=0;x<width;x++){if((pixels[start+x]&0xffffff)!==previous[start+x]){same=false;break;}}
            if(same)continue;
            for(let x=0;x<width;x++)previous[start+x]=pixels[start+x]&0xffffff;
            changed++;const setter=setters[y] as ((value:string|string[])=>void)|null;if(!setter)continue;
            if(asColors){const colors=new Array<string>(width);for(let x=0;x<width;x++)colors[x]=cssColor(pixels[start+x]&0xffffff);setter(colors);}
            else setter(rowGradient(pixels,start,width));
        }
        this.stats.changed=changed;
    }
    // Profiler callback: one call per commit of the state-driven view.
    private onStateCommit=(_id:string,_phase:string,actualDuration:number):void=>{
        this.stats.renderedFrames=(this.stats.renderedFrames??0)+1;
        this.stats.renderMs=this.stats.renderMs===undefined?actualDuration:this.stats.renderMs*0.9+actualDuration*0.1;
    };

    // ---- declarative delivery

    // Copies the frame so React receives immutable props, then renders it as a transition.
    // Frames that arrive while React is mid-render join the same transition, so React renders
    // the newest and skips the rest.
    private renderDeclarative():void {
        this.submittedAt=performance.now();
        const element=(
            <ScreenContext.Provider value={this.geometry}>
                <Profiler id="screen" onRender={this.onDeclarativeRender}>
                    <DeclarativeScreen frame={this.frame} pixels={this.pixels!.slice()} onCommit={this.onDeclarativeCommit}/>
                </Profiler>
            </ScreenContext.Provider>
        );
        startTransition(()=>this.root!.render(element));
    }
    private onDeclarativeRender=(_id:string,_phase:string,actualDuration:number):void=>{
        this.stats.renderMs=this.stats.renderMs===undefined?actualDuration:this.stats.renderMs*0.9+actualDuration*0.1;
    };
    // Runs in the screen's layout effect, so the elapsed time since submission covers React's
    // render, any yields to the engine, and the DOM commit, but not the browser's paint.
    private onDeclarativeCommit=():void=>{
        this.stats.renderedFrames=(this.stats.renderedFrames??0)+1;
        const latency=performance.now()-this.submittedAt;
        this.stats.commitLatencyMs=this.stats.commitLatencyMs===undefined?latency:this.stats.commitLatencyMs*0.9+latency*0.1;
    };
}
