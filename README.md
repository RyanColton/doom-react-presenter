# DOOM → TypeScript

Conversión progresiva de [id-Software/DOOM](https://github.com/id-Software/DOOM) a TypeScript nativo para navegador, conservando los nombres de módulos, funciones y tablas. **Incluye inspección 3D y un primer modo jugable de un jugador con simulación y renderer nativos. La conversión completa sigue pendiente.** No se utiliza WebAssembly ni se ejecuta el código C para la aplicación.

[**▶ Jugar con el WAD shareware original**](https://kant003.github.io/doomJavascript/?wad=shareware) · [Prueba sintética](https://kant003.github.io/doomJavascript/?wad=demo) · [Ejemplo con iframe](https://kant003.github.io/doomJavascript/embed.html)

## Ejecutar

Requiere Node.js 20.19+ o 22.12+ y npm.

```sh
npm install
npm run dev
```

Abrir la URL que muestra Vite, normalmente `http://127.0.0.1:5173/`. La web abre por defecto la vista 3D del nivel cuando hay mapas disponibles y descarga por defecto el WAD original de DOOM shareware 1.9 desde un archivo externo. También permite seleccionar WAD locales, cargar un enlace o usar datos sintéticos. La cámara de inspección de la prueba sintética empieza 160 unidades detrás del inicio del jugador para mostrar mejor la habitación. No sube los archivos a ningún servidor.

- **Imagen de título**: lee `PLAYPAL` y `TITLEPIC` (o `INTERPIC`/`CREDIT`), dibujando los posts originales sobre el framebuffer.
- **Geometría del mapa**: inspecciona vértices, líneas y posición inicial. Es una utilidad de desarrollo, no el automapa original ni un modo jugable.
- **Vista 3D del nivel**: recorre el BSP y dibuja paredes opacas, suelos, techos y cielo con las rutinas convertidas. Haz clic en el Canvas: W/S mueve la cámara, A/D gira y Q/E desplaza de lado. Hay botones equivalentes para girar/avanzar y volver al inicio. Es una cámara libre de inspección, sin colisiones ni simulación. Muestra objetos estáticos mediante el spawnstate original, con sprites, transparencias, rotaciones, iluminación y recorte contra paredes; no ejecuta acciones ni representa una partida jugable.
- **Jugar este mapa**: inicia al jugador y los actores reales, con colisiones, enemigos, armas, recogidas, especiales y efectos de sonido. Haz clic en la pantalla: W/S avanza, A/D gira, Q/E mueve de lado, Shift corre, Espacio/Ctrl dispara, F usa y 1–7 selecciona armas disponibles. Esc abre el menú original; Pause o el botón Pausa detiene la simulación. F reinicia tras morir. La partida inicial usa dificultad media; Nueva partida permite elegir episodio y dificultad, con confirmación para Nightmare. Menú u opciones permiten cambiar mensajes, sensibilidad, tamaño de pantalla y volúmenes. Activar ratón captura el puntero si el navegador lo permite; izquierdo dispara, central desplaza de lado y derecho avanza. Esc libera el ratón. Los mapas sintéticos incluyen un enemigo, munición, sprites propios y un interruptor EXIT frente al inicio; E1M8 permite comprobar el final del episodio con fuente y fondo de prueba; no contiene recursos comerciales. Al completar un mapa aparece un resumen de bajas, objetos, secretos y tiempo. Continuar carga el destino original si está en el WAD, conservando inventario y vida. Si falta el mapa, el resumen informa de ello. Las rutas secretas y finales se respetan; la intermisión dibuja las estadísticas y el mapa de progreso con los patches originales del WAD, manteniendo también un resumen HTML. Los finales ya usan texto, fuente, imágenes y animaciones con las rutinas originales convertidas; si faltan recursos, se muestra el texto como alternativa web.
- **Diagnóstico del nivel**: ejecuta los lectores de `p_setup.c`, enlaza sectores/líneas/segs/subsectors, valida BSP/REJECT/BLOCKMAP y consulta el sector del inicio mediante `R_PointInSubsector`. No genera actores.
- **Texturas de pared**: interpreta PNAMES/TEXTURE1/TEXTURE2 y muestra columnas obtenidas por `R_GetColumn` y dibujadas por `R_DrawColumn`. El muestreo vertical de esta vista conserva la repetición clásica a 128 píxeles.
- **Gamma**: usa las cinco tablas literales del original.
- **Efecto melt**: aplica la transición original a la vista seleccionada, a 35 tics/s.

Para PWAD que dependan del juego base, seleccionar también el IWAD. La web coloca el IWAD primero; los PWAD posteriores pueden sobrescribir recursos. Mapas Hexen/UDMF, patches altos extendidos y formatos de source ports modernos no forman parte de esta etapa. Las columnas de texturas transparentes que requieren composición de varios patches no están representadas como posts en la cache opaca original; se rechazan explícitamente.

## Cargar un WAD mediante un enlace

- Sin parámetros o con `?wad=shareware`: descarga DOOM shareware 1.9 (episodio 1, unos 4 MiB).
- `?wad=demo`: usa la prueba sintética sin descargas externas.
- `?wad=https%3A%2F%2Fservidor.example%2Fdoom1.wad`: carga un enlace directo. El servidor debe permitir CORS. Los ZIP y páginas de descarga HTML no sirven como WAD.
- Se puede repetir `wad` para cargar un IWAD con sus PWAD. El IWAD se coloca primero; los PWAD conservan su orden.
- `&map=E1M2`: selecciona el mapa inicial. Si no existe, se informa y se muestra el primero disponible.
- `&embed=1`: presentación compacta para un iframe. Hay que pulsar **Jugar este mapa** para empezar y activar el sonido.

También hay un formulario **Cargar enlace** y un botón **Cargar DOOM shareware**. Las descargas tienen un límite de 64 MiB por archivo y 30 segundos por carga. Si fallan, se muestran los datos sintéticos con el motivo del error; elegir archivos locales o la prueba cancela una descarga anterior.

El archivo original no se incorpora al repositorio ni al paquete de despliegue. Se carga sin modificar desde [Doom-Utils/shareware-collection](https://github.com/Doom-Utils/shareware-collection/tree/6591a922701e5769b32278e9c555b1bf93f5714c/Doom%201.9), en una revisión fija. Su SHA-256 comprobado es `1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771`. Los datos shareware conservan sus condiciones originales; la licencia GPL del motor no convierte el WAD en dominio público.

## Incrustar el juego

El README de GitHub no puede ejecutar un iframe: [GitHub Flavored Markdown filtra esa etiqueta](https://github.github.com/gfm/#disallowed-raw-html-extension-). El enlace de juego situado arriba abre la aplicación. En una web propia o un visor Markdown que permita HTML e iframes puedes usar:

```html
<iframe
  src="https://kant003.github.io/doomJavascript/?embed=1&amp;wad=shareware"
  title="DOOM en TypeScript"
  width="960"
  height="820"
  style="width:100%;max-width:960px;border:0"
  allow="fullscreen; autoplay"
  allowfullscreen>
</iframe>
```

[Ver el ejemplo funcional en GitHub Pages](https://kant003.github.io/doomJavascript/embed.html). El botón de inicio dentro del juego activa el audio; no se inicia una partida automáticamente al abrir el documento. Para tus propios datos, sustituye `wad=shareware` por el enlace del WAD codificado para una URL.

## Publicación en GitHub Pages

La web se publica en https://kant003.github.io/doomJavascript/ desde la rama `master` mediante `.github/workflows/pages.yml`. Cada push instala dependencias con `npm ci`, ejecuta `npm run verify` y publica únicamente `dist/`. Los pull requests ejecutan las comprobaciones sin desplegar. También se puede lanzar el workflow manualmente desde Actions.

GitHub Pages debe tener **GitHub Actions** seleccionado como fuente en Settings → Pages. Vite genera rutas relativas para servir los recursos bajo el directorio del repositorio. No se requieren secretos de despliegue adicionales: el workflow usa los permisos de Pages y el token temporal de GitHub.

## Estructura

```text
original/                    Fuente original íntegra, sin modificaciones
  linuxdoom-1.10/             Motor C
  ipx/                       Herramientas de red originales
  sersrc/                    Herramientas serie originales
  sndserv/                   Servidor de sonido original
src/
  linuxdoom-1.10/             Conversiones reales a TypeScript
    m_fixed.ts               m_fixed.c → m_fixed.ts
    m_fixed.h.ts             m_fixed.h → m_fixed.h.ts
    ...
  web/                       Interfaz y utilidades de validación del navegador
scripts/                     Generación de tablas e inventario
public/port-status.json       Correspondencias, estados y hashes del original
tests/                       Pruebas de recursos, aritmética y vídeo
PORT_STATUS.md               Inventario de cada fichero C/H
PORTING.md                   Convenciones y pasos para completar el motor
```

Se distingue `.h.ts` de `.ts` para mantener una correspondencia inequívoca con cabeceras e implementaciones que comparten nombre. No se han creado módulos vacíos para aparentar que todos los archivos estén convertidos.

## Estado

Implementados: punto fijo 16.16, RNG original con dos streams, tablas trigonométricas, tipos internos de actores/jugadores/mapas, intercambio de bytes, argumentos, cheats, datos de armas, WAD, vídeo de 8 bits, primitivas de columnas/spans, texturas compuestas, flats, cabeceras de sprites, iluminación y transiciones. Se han convertido los lectores geométricos de `p_setup.c`, la geometría/proyección/iluminación de `r_main.c`, la visibilidad de `r_bsp.c`, las paredes/transparentes de `r_segs.c`, los visplanes de `r_plane.c` y el renderer de sprites/psprites de `r_things.c`. Se conservan las tablas de `info.c` con 967 estados y 137 tipos de actor. La interfaz de plataforma es parcial.

También se han trasladado la lista de thinkers y el ticker (`p_tick.c`), las utilidades espaciales y trazas (`p_maputl.c`) y el ciclo de vida de actores (`p_mobj.c`): estados, movimiento XY/Z, spawn, proyectiles y respawn. `p_user.c` incorpora las rutinas de control y actualización del jugador: movimiento, altura/bob, muerte, selección de arma y poderes. `p_pspr.c` incorpora animación, munición, selección y acciones de armas, incluyendo proyectiles, melee, hitscan y spray BFG. `p_enemy.c` incorpora sus 64 funciones: percepción, persecución, ataques, resurrección, lost souls y eventos de jefes. `p_map.c` incorpora colisiones, sliding, teletransporte, alturas, apuntado y trazas de impactos, uso de líneas y explosiones; `p_sight.c` incorpora línea de visión con BSP/REJECT. `p_inter.c` incorpora daño, armadura, muertes, objetos soltados y los 36 tipos de recogidas originales. Se incluyen las 285 macros de texto de `d_englsh.h`. `p_floor.c`, `p_ceilng.c`, `p_plats.c` y `p_doors.c` incorporan movimiento de sectores, escaleras, trituradoras, elevadores, puertas y llaves; `p_switch.c` y `p_spec.c` incorporan interruptores, botones temporizados, activación por uso/cruce/disparo, daño y secretos de sectores, donut, animaciones y actualización de especiales. `p_lights.c` incorpora fuego, flashes, luces estroboscópicas, glow y eventos por tag; `p_telept.c` incorpora destinos, telefrag, niebla y orientación del teletransporte. Los módulos de simulación requieren dependencias explícitas de gameplay todavía pendientes; la vista de inspección usa objetos estáticos y cámara libre, mientras que Jugar conecta los subsistemas nativos con P_Ticker y R_RenderPlayerView. Se pueden escuchar los efectos del WAD desde el panel de audio (selector, volumen, Probar sonido y Detener). El WAD de prueba incluye un tono sintético; no incluye sonidos comerciales. El modo de un jugador ya puede iniciarse; la progresión entre mapas ya funciona con el resumen web; la música MUS y los gráficos originales de intermisiones/finales ya están enlazados.

La intermisión de un jugador usa el recuento original de `wi_stuff.c`: pausas a 35 tics/s, porcentajes, tiempo/par, sonidos y transición entre mapas. F o Espacio completa el recuento; una segunda pulsación avanza. También hay botones en el resumen. La presentación usa los fondos, nombres de nivel, números, porcentajes, tiempos y mapa de nodos originales del WAD. Si faltan estos patches, se conserva el resumen HTML. La prueba sintética incluye sus propios gráficos, sin arte comercial.

Los finales (`f_finale.c`) incorporan sus doce funciones: texto progresivo y fondos de flats, imágenes por episodio, panorama del conejo con END0–END6 y reparto de Doom II con sus 17 personajes, ataques, muerte por teclado y sonidos. Doom espera el tiempo original del texto antes de mostrar la imagen; Doom II admite avanzar después de su pausa inicial. El reparto no ejecuta las acciones de combate de los actores. [Probar el final sintético de E1M8](https://kant003.github.io/doomJavascript/?wad=demo&map=E1M8): pulsa Jugar y después F frente a EXIT. La música cambia con el texto, el panorama y el reparto. La ejecución automática del melt solicitado por esos cambios de pantalla sigue pendiente.

**Pendientes:** completar g_game/doomstat, fidelidad instrumental/MIDI, intermisiones multijugador, completar menús de guardado/carga, demos y red. Jugar usa un adaptador web de un jugador, selección de dificultad, barra del WAD y resumen textual accesible. Las 74 acciones están enlazadas a sus implementaciones; movimiento, combate, enemigos, especiales, sonido y render funcionan juntos en las pruebas y en el nivel sintético del navegador. No se ha validado una campaña completa con los WAD comerciales.

Consultar [PORT_STATUS.md](PORT_STATUS.md) para el estado exacto. El conteo de archivos no representa un porcentaje de funcionalidad.

La intermisión conserva una errata del código Linux publicado: `WI_drawAnimatedBack` comprueba la constante `commercial` y no el modo activo, por lo que no pinta los patches de animación. Su estado, periodos enteros, excepciones por nivel y consumo del RNG cosmético sí se ejecutan como en C. El fondo, los nodos y las demás partes de la pantalla se dibujan normalmente. No afecta al RNG de gameplay.

## Validación

```sh
npm run verify
```

Ejecuta inventario, comprobación estricta de TypeScript, pruebas y build para navegador. `npm run build` genera `dist/`, que puede servirse desde un alojamiento estático.

Las pruebas generales funcionan sin un compilador de C y comprueban todas las tablas literales contra la fuente original. Las seis pruebas adicionales de `original-parity.test.ts` compilan un pequeño oráculo a partir de los módulos C originales cuando está disponible `clang`. Si no existe un compilador operativo, se indican explícitamente como omitidas. `tests/c-compat/values.h` aporta únicamente las constantes de la cabecera histórica que falta en macOS; no modifica los algoritmos.

Los scripts `generate-tables.py`, `generate-runtime-types.py`, `generate-info.py`, `generate-strings.py` y `generate-items.py` requieren Python 3 solo para regenerar las tablas. No se ejecutan durante el build normal.

## Fuente y licencia

Fuente fijada al commit `a77dfb96cb91780ca334d0d4cfd86957558007e0` de id-Software/DOOM. Se conserva la fuente y su copyright. La copia raíz de `LICENSE.TXT` procede del repositorio original y contiene GPL-2.0. Los encabezados antiguos se retienen para trazabilidad; debe consultarse la licencia raíz del repositorio.

DOOM es software publicado bajo GPL-2.0, no dominio público. El repositorio no incluye los datos comerciales del juego. Para visualizar sus recursos, proporciona un WAD que tengas derecho a utilizar. Los datos sintéticos incluidos son únicamente una fixture de pruebas y no contienen recursos comerciales de DOOM.

La música MUS del WAD comienza al pulsar **Jugar**. El panel de audio permite ajustar su volumen por separado de los efectos; **Pausa/Esc** pausa también el tema. Se conservan las selecciones de música por mapa, intermisión y final. El navegador utiliza un sintetizador básico con percusión: reproduce las notas y los controles principales, con timbres aproximados. No emula OPL/DMX ni carga SoundFonts; MIDI estándar y los efectos de modulación/reverb/chorus siguen pendientes. Los datos de prueba incluyen una melodía propia.

La barra de estado (`st_stuff.c` y `st_lib.c`) ya muestra los gráficos del WAD: munición, salud, armadura, armas, llaves y las expresiones originales del rostro. La partida renderiza el mundo a 320×168 y reserva los 32 píxeles inferiores para la barra. El ticker y las paletas de daño, bonus, berserk y traje antirradiación siguen las reglas originales. Los WAD sin todos esos patches usan el HUD textual; la vista de inspección conserva la pantalla completa. ST_Responder y el automapa están conectados a la partida.

Los mensajes de recogidas y puertas usan ahora `hu_stuff.c`/`hu_lib.c`: se dibujan con STCFN sobre el mundo durante cuatro segundos. **Intro** vuelve a mostrar el último aviso. El texto accesible bajo el juego sigue el mismo contador y la pausa lo congela. Los títulos y la lógica de chat del original están convertidos y verificados; la partida web continúa siendo de un jugador y el título aparece al abrir el automapa.

Pulsa **Tab** durante la partida para abrir el automapa original (`am_map.c`). **F** activa/desactiva seguimiento, **flechas** desplazan al desactivarlo, **= / −** regulan zoom, **0** cambia a vista amplia, **G** muestra la cuadrícula, **M** coloca una de diez marcas y **C** las borra. Las líneas se descubren mediante el render original; el título, la barra y los mensajes se mantienen visibles. La simulación continúa hasta pulsar Pausa/Esc.

Los trucos de `ST_Responder` funcionan escribiéndolos con la pantalla enfocada: `iddqd`, `idfa`, `idkfa`, `idclip`/`idspispopd`, `idbehold` y sus sufijos, `idchoppers`, `idmypos`, `idmus11` e `idclev12`. `iddt` en el automapa cicla líneas/actores. El cambio de nivel se aplica en el siguiente tic y comprueba que el mapa esté cargado. Se conserva la errata original que rechaza todos los IDCLEV comerciales (Doom II); puedes elegir esos mapas con el selector web. Los trucos también conservan sus efectos y peculiaridades originales, incluidos los poderes de un tic de CHOPPERS.

## React presenter POC (branch `react-presenter`)

`src/linuxdoom-1.10/i_video.ts` no longer draws to a canvas directly. `I_FinishUpdate`
converts `screens[0]` through the palette into an RGBA frame and hands it to a
swappable `Presenter` (`mount` / `present` / `dispose`). The `#screen` element is
a plain focusable `<div>` that only provides keyboard focus, pointer lock and
fullscreen; the presenter owns whatever DOM it draws with.

- `src/web/presenters/canvas-presenter.ts` – the original `putImageData` path.
- `src/web/presenters/react-presenter.tsx` – React 19, six strategies:
  - **rows**: 200 scanline `<div>`s with run-length-encoded `linear-gradient`
    backgrounds. React reconciles 200 style strings per frame. Playable, 100+ fps.
  - **declarative**: the most React-idiomatic version. Each frame is an immutable
    snapshot passed top-down as props via `root.render` inside `startTransition`,
    so React time-slices the render and drops stale frames itself. Scanlines are
    `memo` components with a content comparator; each renders one keyed `<span>`
    per colour run, so the reconciler diffs the image. Context carries geometry.
    Tuned with: shared immutable run elements (React bails out on identical element
    objects), a layout-effect commit handoff, scanlines as compositor layers with
    `contain:strict`, and the `react-dom/profiling` build so `<Profiler>` reports
    render time in production. 120 fps idle, ~40 fps walking, ~10 fps turning; the
    game keeps ticking at 35 Hz because the transition yields to the engine loop.
    The ceiling is the browser styling, laying out and painting 30-50k spans.
  - **declarative-lossy**: the declarative renderer with lossy run merging. A pixel
    joins the current run while within an RGB distance (tolerance 32) of the run's
    first colour, and runs narrower than 2 px are absorbed by the closer-coloured
    neighbour, but only when that neighbour is within 2x tolerance, so one-pixel
    high-contrast detail (status bar digits, edges) survives. Spans drop from ~35k
    to ~7k while turning and the frame rate goes from ~10 to ~115 fps. Tolerance
    alone smears textures at 48+; unguarded min-width destroys the HUD. Override
    via `window.doomLossyOptions={tolerance,minWidth}` before selecting it.
  - **pixels**: 64,000 `<div>`s, parent re-renders every frame, memo skips unchanged
    pixels. The literal version. ~10 fps while moving.
  - **pixels-ref**: 64,000 `<div>`s under 200 row components. The presenter diffs
    the frame and only notifies changed pixels; each pixel writes its colour to its
    own node through a ref, so React is not in the per-frame loop. Rows are
    compositor layers. 120 fps idle, ~14 fps turning. The limit is the browser
    repainting 64,000 boxes, not React.
  - **dom-pixels**: the same 64,000 `<div>`s written directly with no React, as the
    floor for comparison.

The **Renderer** dropdown in the display footer hot-swaps presenters mid-game;
the readout shows fps, `present()` time per frame and changed pixels. Judge speed
on a production build (`npm run build && npx vite preview`): development-mode
React is about 4x slower on the per-pixel strategies.
