// Copyright (C) 1993-1996 id Software, Inc. GPL-2.0-only.
// m_menu.c: original menu layout, navigation, timing and supported callbacks.
// Save files, title/demo loop and process termination remain platform work.
import * as K from './doomdef.h';
import { evtype_t as EV,type event_t } from './d_event.h';
import type { player_t } from './d_player.h';
import * as T from './d_englsh.h';
import { sfxenum_t as SFX } from './sounds.h';
import { W_CheckNumForName,W_CacheLumpName } from './w_wad';
import { screens,V_DrawPatchDirect,V_PatchHeader,V_SetGamma,usegamma } from './v_video';
import { HU_CanLoad,HU_FontPatch,HU_ForceMessage,chat_on } from './hu_stuff';
import { I_GetTime } from './i_system';
export interface menu_context_t {
    gamemode:K.GameMode_t;netgame:boolean;demoplayback:boolean;automapactive:boolean;usergame:boolean;
    players:player_t[];consoleplayer:number;
    G_DeferedInitNew(skill:K.skill_t,episode:number,map:number):void;
    S_StartSound(origin:null,sound:SFX):void;
    R_SetViewSize(blocks:number,detail:number):void;
    setVolumes(effects:number,music:number):void;
    endGame():void;
}
interface menuitem_t {status:number;name:string;routine:((choice:number)=>void)|null;alphaKey:number}
interface menu_t {id:string;prevMenu:menu_t|null;menuitems:menuitem_t[];routine:()=>void;x:number;y:number;lastOn:number}
let context:menu_context_t;
export let menuactive=false,inhelpscreens=false,showMessages=true,detailLevel=0,screenblocks=10,screenSize=7,mouseSensitivity=5;
export let snd_SfxVolume=15,snd_MusicVolume=15; // 0-15; both start at maximum
let currentMenu:menu_t,itemOn=0,skullAnimCounter=10,whichSkull=0,epi=0;
let messageToPrint=false,messageString='',messageLastMenuActive=false,messageNeedsInput=false,messageRoutine:((response:number)=>void)|null=null;
let MainDef:menu_t,EpiDef:menu_t,NewDef:menu_t,OptionsDef:menu_t,SoundDef:menu_t,ReadDef1:menu_t,ReadDef2:menu_t;
let joywait=0,mousewait=0,mousey=0,lasty=0,mousex=0,lastx=0;
export function M_InitContext(value:menu_context_t):void {context=value;}
export function M_SetVolumes(effects:number,music:number):void {snd_SfxVolume=Math.max(0,Math.min(15,Math.round(effects)));snd_MusicVolume=Math.max(0,Math.min(15,Math.round(music)));}
function patch(name:string,x:number,y:number):void {
    // A PWAD without menu art may still be played; use its HU font as fallback.
    if(W_CheckNumForName(name)>=0)V_DrawPatchDirect(x,y,0,W_CacheLumpName(name,101));
    else M_WriteText(x,y,labels[name]??name);
}
const labels:Record<string,string>={M_DOOM:'DOOM',M_NGAME:'NEW GAME',M_OPTION:'OPTIONS',M_LOADG:'LOAD GAME',M_SAVEG:'SAVE GAME',M_RDTHIS:'READ THIS!',M_QUITG:'QUIT GAME',M_NEWG:'NEW GAME',M_SKILL:'CHOOSE SKILL LEVEL:',M_EPISOD:'WHICH EPISODE?',M_EPI1:'KNEE-DEEP IN THE DEAD',M_EPI2:'THE SHORES OF HELL',M_EPI3:'INFERNO',M_EPI4:'THY FLESH CONSUMED',M_JKILL:"I'M TOO YOUNG TO DIE.",M_ROUGH:'HEY, NOT TOO ROUGH.',M_HURT:'HURT ME PLENTY.',M_ULTRA:'ULTRA-VIOLENCE.',M_NMARE:'NIGHTMARE!',M_OPTTTL:'OPTIONS',M_ENDGAM:'END GAME',M_MESSG:'MESSAGES',M_DETAIL:'GRAPHIC DETAIL',M_SCRNSZ:'SCREEN SIZE',M_MSENS:'MOUSE SENSITIVITY',M_SVOL:'SOUND VOLUME',M_SFXVOL:'SFX VOLUME',M_MUSVOL:'MUSIC VOLUME',M_MSGON:'ON',M_MSGOFF:'OFF',M_GDHIGH:'HIGH',M_GDLOW:'LOW'};
export function M_DrawMainMenu():void {patch('M_DOOM',94,2);}
export function M_DrawNewGame():void {patch('M_NEWG',96,14);patch('M_SKILL',54,38);}
export function M_DrawEpisode():void {patch('M_EPISOD',54,38);}
export function M_DrawOptions():void {
    patch('M_OPTTTL',108,15);patch(detailLevel?'M_GDLOW':'M_GDHIGH',235,69);patch(showMessages?'M_MSGON':'M_MSGOFF',180,53);
    M_DrawThermo(60,133,10,mouseSensitivity);M_DrawThermo(60,101,9,screenSize);
}
export function M_DrawSound():void {patch('M_SVOL',60,38);M_DrawThermo(80,80,16,snd_SfxVolume);M_DrawThermo(80,112,16,snd_MusicVolume);}
export function M_DrawReadThis1():void {inhelpscreens=true;const name=context.gamemode===K.GameMode_t.commercial?'HELP':'HELP1';if(W_CheckNumForName(name)>=0)patch(name,0,0);else M_WriteText(12,65,'W/S: MOVE   A/D: TURN\nSPACE/CTRL: FIRE   F: USE\nTAB: MAP   ESC: MENU\nENTER: NEXT PAGE');}
export function M_DrawReadThis2():void {inhelpscreens=true;patch(context.gamemode===K.GameMode_t.retail||context.gamemode===K.GameMode_t.commercial?'CREDIT':'HELP2',0,0);}
export function M_NewGame(_choice:number):void {if(context.netgame&&!context.demoplayback){M_StartMessage(T.NEWGAME,null,false);return;}M_SetupNextMenu(context.gamemode===K.GameMode_t.commercial?NewDef:EpiDef);}
export function M_VerifyNightmare(ch:number):void {if(ch!==121)return;context.G_DeferedInitNew(K.skill_t.sk_nightmare,epi+1,1);M_ClearMenus();}
export function M_ChooseSkill(choice:number):void {if(choice===K.skill_t.sk_nightmare){M_StartMessage(T.NIGHTMARE,M_VerifyNightmare,true);return;}context.G_DeferedInitNew(choice,epi+1,1);M_ClearMenus();}
export function M_Episode(choice:number):void {
    if(context.gamemode===K.GameMode_t.shareware&&choice){M_StartMessage(T.SWSTRING,null,false);M_SetupNextMenu(ReadDef1);return;}
    if(context.gamemode===K.GameMode_t.registered&&choice>2)choice=0;epi=choice;M_SetupNextMenu(NewDef);
}
export function M_Options(_choice:number):void {M_SetupNextMenu(OptionsDef);}
export function M_Sound(_choice:number):void {M_SetupNextMenu(SoundDef);}
export function M_ChangeMessages(_choice:number):void {showMessages=!showMessages;const text=showMessages?T.MSGON:T.MSGOFF;if(HU_CanLoad())HU_ForceMessage(text);else context.players[context.consoleplayer].message=text;}
export function M_ChangeSensitivity(choice:number):void {mouseSensitivity=Math.max(0,Math.min(9,mouseSensitivity+(choice?1:-1)));}
export function M_ChangeDetail(_choice:number):void {detailLevel=1-detailLevel;/* Upstream returns here: low detail mode n.a. */}
export function M_SizeDisplay(choice:number):void {if(choice&&screenSize<8){screenSize++;screenblocks++;}else if(!choice&&screenSize>0){screenSize--;screenblocks--;}context.R_SetViewSize(screenblocks,detailLevel);}
export function M_SfxVol(choice:number):void {snd_SfxVolume=Math.max(0,Math.min(15,snd_SfxVolume+(choice?1:-1)));context.setVolumes(snd_SfxVolume,snd_MusicVolume);}
export function M_MusicVol(choice:number):void {snd_MusicVolume=Math.max(0,Math.min(15,snd_MusicVolume+(choice?1:-1)));context.setVolumes(snd_SfxVolume,snd_MusicVolume);}
export function M_EndGameResponse(ch:number):void {if(ch!==121)return;currentMenu.lastOn=itemOn;M_ClearMenus();context.endGame();}
export function M_EndGame(_choice:number):void {if(!context.usergame){context.S_StartSound(null,SFX.sfx_oof);return;}if(context.netgame){M_StartMessage(T.NETEND,null,false);return;}M_StartMessage(T.ENDGAME,M_EndGameResponse,true);}
export function M_ReadThis(_choice:number):void {M_SetupNextMenu(ReadDef1);}
export function M_ReadThis2(_choice:number):void {M_SetupNextMenu(ReadDef2);}
export function M_FinishReadThis(_choice:number):void {M_SetupNextMenu(MainDef);}
export function M_DrawThermo(x:number,y:number,width:number,dot:number):void {
    if(!['M_THERML','M_THERMM','M_THERMR','M_THERMO'].every(name=>W_CheckNumForName(name)>=0)){for(let i=0;i<(width+2)*8;i++)screens[0][(y+4)*320+x+i]=128;for(let row=0;row<8;row++)screens[0][(y+row)*320+x+8+dot*8]=255;return;}
    patch('M_THERML',x,y);for(let i=0;i<width;i++)patch('M_THERMM',x+8+i*8,y);patch('M_THERMR',x+8+width*8,y);patch('M_THERMO',x+8+dot*8,y);}
export function M_StartMessage(text:string,routine:((response:number)=>void)|null,input:boolean):void {messageLastMenuActive=menuactive;messageToPrint=true;messageString=text;messageRoutine=routine;messageNeedsInput=input;menuactive=true;}
export function M_StopMessage():void {menuactive=messageLastMenuActive;messageToPrint=false;}
export function M_StringWidth(text:string):number {let width=0;for(const ch of text.toUpperCase()){const c=ch.charCodeAt(0);width+=c<33||c>95||!HU_CanLoad()?4:V_PatchHeader(HU_FontPatch(c)).width;}return width;}
export function M_StringHeight(text:string):number {return (HU_CanLoad()?V_PatchHeader(HU_FontPatch(33)).height:8)*text.split('\n').length;}
export function M_WriteText(x:number,y:number,text:string):void {if(!HU_CanLoad())return;let cx=x,cy=y;for(const ch of text.toUpperCase()){if(ch==='\n'){cx=x;cy+=12;continue;}const c=ch.charCodeAt(0);if(c<33||c>95){cx+=4;continue;}const bytes=HU_FontPatch(c),w=V_PatchHeader(bytes).width;if(cx+w>320)break;V_DrawPatchDirect(cx,cy,0,bytes);cx+=w;}}
export function M_StartControlPanel():void {if(menuactive)return;menuactive=true;currentMenu=MainDef;itemOn=currentMenu.lastOn;}
export function M_ClearMenus():void {menuactive=false;}
function M_SetupNextMenu(menu:menu_t):void {currentMenu=menu;itemOn=menu.lastOn;}
export function M_Ticker():void {if(--skullAnimCounter<=0){whichSkull^=1;skullAnimCounter=8;}}
export function M_Drawer():void {
    inhelpscreens=false;
    if(messageToPrint){let y=Math.trunc(100-M_StringHeight(messageString)/2);for(const line of messageString.split('\n')){M_WriteText(Math.trunc(160-M_StringWidth(line)/2),y,line);y+=HU_CanLoad()?V_PatchHeader(HU_FontPatch(33)).height:8;}return;}
    if(!menuactive)return;currentMenu.routine();currentMenu.menuitems.forEach((item,i)=>{if(item.name)patch(item.name,currentMenu.x,currentMenu.y+i*16);});
    const skull=`M_SKULL${whichSkull+1}`,x=currentMenu.x-32,y=currentMenu.y-5+itemOn*16;if(W_CheckNumForName(skull)>=0){const h=V_PatchHeader(W_CacheLumpName(skull,101));if(x-h.leftoffset+h.width<=320&&y-h.topoffset+h.height<=200)patch(skull,x,y);}else M_WriteText(x,y,'>');
}
function unavailable():void {M_StartMessage('GUARDAR Y CARGAR PARTIDAS\nTODAVIA NO ESTA IMPLEMENTADO.\n\nPULSA UNA TECLA.',null,false);}
function quit():void {M_StartMessage('VOLVER A LA INSPECCION?\n\nPRESS Y OR N.',M_EndGameResponse,true);}
export function M_Init():void {
    const item=(name:string,routine:((choice:number)=>void)|null,key:string,status=1):menuitem_t=>({name,routine,alphaKey:key.charCodeAt(0)||0,status});
    const menu=(id:string,x:number,y:number,routine:()=>void,items:menuitem_t[],lastOn=0):menu_t=>({id,x,y,routine,menuitems:items,lastOn,prevMenu:null});
    MainDef=menu('main',97,64,M_DrawMainMenu,[item('M_NGAME',M_NewGame,'n'),item('M_OPTION',M_Options,'o'),item('M_LOADG',unavailable,'l'),item('M_SAVEG',unavailable,'s'),item('M_RDTHIS',M_ReadThis,'r'),item('M_QUITG',quit,'q')]);
    EpiDef=menu('episode',48,63,M_DrawEpisode,['k','t','i','t'].map((key,i)=>item(`M_EPI${i+1}`,M_Episode,key)));
    NewDef=menu('skill',48,63,M_DrawNewGame,['M_JKILL','M_ROUGH','M_HURT','M_ULTRA','M_NMARE'].map((name,i)=>item(name,M_ChooseSkill,['i','h','h','u','n'][i])),2);
    OptionsDef=menu('options',60,37,M_DrawOptions,[item('M_ENDGAM',M_EndGame,'e'),item('M_MESSG',M_ChangeMessages,'m'),item('M_DETAIL',M_ChangeDetail,'g'),item('M_SCRNSZ',M_SizeDisplay,'s',2),item('',null,'',-1),item('M_MSENS',M_ChangeSensitivity,'m',2),item('',null,'',-1),item('M_SVOL',M_Sound,'s')]);
    SoundDef=menu('sound',80,64,M_DrawSound,[item('M_SFXVOL',M_SfxVol,'s',2),item('',null,'',-1),item('M_MUSVOL',M_MusicVol,'m',2),item('',null,'',-1)]);
    ReadDef1=menu('help1',280,185,M_DrawReadThis1,[item('',M_ReadThis2,'')]);ReadDef2=menu('help2',330,175,M_DrawReadThis2,[item('',M_FinishReadThis,'')]);
    EpiDef.prevMenu=OptionsDef.prevMenu=MainDef;NewDef.prevMenu=EpiDef;SoundDef.prevMenu=OptionsDef;ReadDef1.prevMenu=MainDef;ReadDef2.prevMenu=ReadDef1;
    if(context.gamemode===K.GameMode_t.commercial){MainDef.menuitems.splice(4,1);MainDef.y+=8;NewDef.prevMenu=MainDef;ReadDef1.x=330;ReadDef1.y=165;ReadDef1.menuitems[0].routine=M_FinishReadThis;}
    else if(context.gamemode!==K.GameMode_t.retail)EpiDef.menuitems.pop();
    currentMenu=MainDef;menuactive=false;itemOn=0;whichSkull=0;skullAnimCounter=10;screenSize=screenblocks-3;messageToPrint=false;messageString='';messageLastMenuActive=false;
    joywait=mousewait=mousey=lasty=mousex=lastx=0;
}
export function M_Responder(event:event_t):boolean {
    let ch=-1;const now=I_GetTime();
    if(event.type===EV.ev_joystick&&joywait<now){if(event.data3===-1){ch=K.KEY_UPARROW;joywait=now+5;}else if(event.data3===1){ch=K.KEY_DOWNARROW;joywait=now+5;}if(event.data2===-1){ch=K.KEY_LEFTARROW;joywait=now+2;}else if(event.data2===1){ch=K.KEY_RIGHTARROW;joywait=now+2;}if(event.data1&1){ch=K.KEY_ENTER;joywait=now+5;}if(event.data1&2){ch=K.KEY_BACKSPACE;joywait=now+5;}}
    else if(event.type===EV.ev_mouse&&mousewait<now){mousey+=event.data3;if(mousey<lasty-30){ch=K.KEY_DOWNARROW;mousewait=now+5;mousey=lasty-=30;}else if(mousey>lasty+30){ch=K.KEY_UPARROW;mousewait=now+5;mousey=lasty+=30;}mousex+=event.data2;if(mousex<lastx-30){ch=K.KEY_LEFTARROW;mousewait=now+5;mousex=lastx-=30;}else if(mousex>lastx+30){ch=K.KEY_RIGHTARROW;mousewait=now+5;mousex=lastx+=30;}if(event.data1&1){ch=K.KEY_ENTER;mousewait=now+15;}if(event.data1&2){ch=K.KEY_BACKSPACE;mousewait=now+15;}}
    else if(event.type===EV.ev_keydown)ch=event.data1;
    if(ch===-1)return false;
    const sound=(s:SFX)=>context.S_StartSound(null,s);
    if(messageToPrint){if(messageNeedsInput&&![32,110,121,K.KEY_ESCAPE].includes(ch))return false;menuactive=messageLastMenuActive;messageToPrint=false;messageRoutine?.(ch);menuactive=false;sound(SFX.sfx_swtchx);return true;}
    if(!menuactive)switch(ch){
        case K.KEY_MINUS:case K.KEY_EQUALS:if(context.automapactive||chat_on)return false;M_SizeDisplay(ch===K.KEY_EQUALS?1:0);sound(SFX.sfx_stnmov);return true;
        case K.KEY_F1:M_StartControlPanel();M_SetupNextMenu(context.gamemode===K.GameMode_t.retail?ReadDef2:ReadDef1);itemOn=0;sound(SFX.sfx_swtchn);return true;
        case K.KEY_F2:case K.KEY_F3:case K.KEY_F6:case K.KEY_F9:unavailable();sound(SFX.sfx_swtchn);return true;
        case K.KEY_F4:M_StartControlPanel();M_SetupNextMenu(SoundDef);itemOn=0;sound(SFX.sfx_swtchn);return true;
        case K.KEY_F5:M_ChangeDetail(0);sound(SFX.sfx_swtchn);return true;
        case K.KEY_F7:M_EndGame(0);sound(SFX.sfx_swtchn);return true;
        case K.KEY_F8:M_ChangeMessages(0);sound(SFX.sfx_swtchn);return true;
        case K.KEY_F10:quit();sound(SFX.sfx_swtchn);return true;
        case K.KEY_F11:V_SetGamma(usegamma+1);context.players[context.consoleplayer].message=[T.GAMMALVL0,T.GAMMALVL1,T.GAMMALVL2,T.GAMMALVL3,T.GAMMALVL4][usegamma];return true;
    }
    if(!menuactive){if(ch!==K.KEY_ESCAPE)return false;M_StartControlPanel();sound(SFX.sfx_swtchn);return true;}
    const items=currentMenu.menuitems,item=items[itemOn];
    switch(ch){
        case K.KEY_DOWNARROW:case K.KEY_UPARROW:do{itemOn=(itemOn+(ch===K.KEY_DOWNARROW?1:items.length-1))%items.length;sound(SFX.sfx_pstop);}while(items[itemOn].status===-1);return true;
        case K.KEY_LEFTARROW:case K.KEY_RIGHTARROW:if(item.routine&&item.status===2){sound(SFX.sfx_stnmov);item.routine(ch===K.KEY_RIGHTARROW?1:0);}return true;
        case K.KEY_ENTER:if(item.routine&&item.status){currentMenu.lastOn=itemOn;item.routine(item.status===2?1:itemOn);sound(item.status===2?SFX.sfx_stnmov:SFX.sfx_pistol);}return true;
        case K.KEY_ESCAPE:currentMenu.lastOn=itemOn;M_ClearMenus();sound(SFX.sfx_swtchx);return true;
        case K.KEY_BACKSPACE:currentMenu.lastOn=itemOn;if(currentMenu.prevMenu){M_SetupNextMenu(currentMenu.prevMenu);sound(SFX.sfx_swtchn);}return true;
        default:for(let i=1;i<=items.length;i++){const index=(itemOn+i)%items.length;if(items[index].alphaKey===ch){itemOn=index;sound(SFX.sfx_pstop);return true;}}
    }return false;
}
export function M_GetState(){return {active:menuactive,menu:currentMenu?.id,title:({main:'principal',episode:'episodio',skill:'dificultad',options:'opciones',sound:'sonido',help1:'ayuda',help2:'ayuda'} as Record<string,string>)[currentMenu?.id],selection:labels[currentMenu?.menuitems[itemOn]?.name]??currentMenu?.menuitems[itemOn]?.name,itemOn,whichSkull,skullAnimCounter,message:messageToPrint?messageString:null,screenblocks,detailLevel,showMessages,sfxVolume:snd_SfxVolume,musicVolume:snd_MusicVolume,mouseSensitivity};}
