import type { Presenter } from '../../linuxdoom-1.10/i_video';
// The original presentation path: blit the RGBA frame into a <canvas> with
// putImageData. Kept as the baseline the React presenter is compared against.
export class CanvasPresenter implements Presenter {
    private canvas:HTMLCanvasElement|null=null;
    private context:CanvasRenderingContext2D|null=null;
    private image:ImageData|null=null;
    mount(host:HTMLElement,width:number,height:number):void {
        const canvas=document.createElement('canvas');
        canvas.width=width;canvas.height=height;canvas.className='screen-surface screen-canvas';
        host.appendChild(canvas);
        this.canvas=canvas;this.context=canvas.getContext('2d',{alpha:false});
    }
    present(frame:Uint8ClampedArray<ArrayBuffer>):void {
        if(!this.context||!this.canvas)return;
        // Wrap the shared frame buffer once; no per-frame copy is needed.
        if(!this.image||this.image.data.buffer!==frame.buffer)this.image=new ImageData(frame,this.canvas.width,this.canvas.height);
        this.context.putImageData(this.image,0,0);
    }
    dispose():void {this.canvas?.remove();this.canvas=null;this.context=null;this.image=null;}
}
