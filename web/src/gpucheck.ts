// Is there a real graphics card behind the page? Browsers always offer WebGL, but without a usable GPU (blocked driver, remote desktop, a virtual machine) they draw it
// on the CPU with a software rasteriser, and a 3D village then crawls. No imports: tests load it under plain node.

/** Renderer names (WEBGL_debug_renderer_info) that mean the CPU draws: Chrome's SwiftShader, Windows' Basic Render Driver, Mesa's llvmpipe and softpipe, and the like. */
const SOFTWARE = /swiftshader|basic render|llvmpipe|softpipe|software|microsoft basic|mesa offscreen|gdi generic/i;

export const isSoftwareRenderer = (name: string | null | undefined): boolean => !!name && SOFTWARE.test(name);

/** Graphics built into the processor (Intel HD / UHD / Iris, AMD's APU "Radeon Graphics" and Vega, phone and tablet GPUs): a real GPU, but one that shares the
 *  computer's memory and a small power budget, so the High preset's draw distance and shadows are too much for it. Intel Arc cards are discrete. */
const INTEGRATED = /intel(?!.*\barc\b)|radeon\(tm\) graphics|radeon graphics|radeon vega|vega \d+ graphics|mali|adreno|powervr|apple gpu/i;
export const isIntegratedGpu = (name: string | null | undefined): boolean => !!name && !isSoftwareRenderer(name) && INTEGRATED.test(name);

/** The name of what draws WebGL in this browser, or null when it will not say (the check is then skipped: a real GPU is assumed). */
export function rendererName(): string | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();   // give the probe's context back at once
    return name;
  } catch { return null; }
}
