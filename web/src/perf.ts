import type * as THREE from 'three';

interface Layer { name: string; set(on: boolean): void }
interface Result { name: string; ms: number }

/** FPS counter, per-section CPU timings, GPU timer and an automatic "what costs the most?" profiler. */
export class Perf {
  open = false;
  private badge: HTMLElement; private panel: HTMLElement; private graph: HTMLCanvasElement; private body: HTMLElement; private btn: HTMLButtonElement;
  private sections = new Map<string, number>();
  private starts = new Map<string, number>();
  private frames: number[] = [];
  private last = 0; private shown = 0;
  private renderMs = 0; private gpuMs = 0; private gpuOk = false;
  private ext: any = null; private pending: any[] = [];
  private stats: Record<string, number> = {};
  // profiler state
  private layers: Layer[] = [];
  private prof: { idx: number; phase: 'base' | 'warm' | 'measure'; n: number; sum: number; base: number; results: Result[]; done: boolean } | null = null;
  profiling = false;
  private lastRes: { base: number; results: Result[] } | null = null;

  constructor(host: HTMLElement) {
    this.badge = document.createElement('button'); this.badge.id = 'fps-badge'; this.badge.title = 'Performance monitor (F3)'; this.badge.textContent = '-- fps';
    this.panel = document.createElement('div'); this.panel.id = 'perf'; this.panel.hidden = true;
    this.panel.innerHTML = `<div class="ph"><b>Performance</b><span id="perf-sub"></span><button id="perf-x" title="Close">✕</button></div><canvas id="perf-g" width="260" height="56"></canvas><div id="perf-body"></div><div class="pb"><button id="perf-prof">Find the biggest cost</button></div>`;
    host.append(this.badge, this.panel);
    this.graph = this.panel.querySelector('#perf-g') as HTMLCanvasElement; this.body = this.panel.querySelector('#perf-body') as HTMLElement;
    this.btn = this.panel.querySelector('#perf-prof') as HTMLButtonElement;
    this.badge.onclick = () => this.toggle();
    (this.panel.querySelector('#perf-x') as HTMLElement).onclick = () => this.toggle(false);
    this.btn.onclick = () => this.startProfile();
  }

  /** Show or hide the small frame-rate counter. */
  setBadge(on: boolean) { this.badge.style.display = on ? '' : 'none'; }

  toggle(on = !this.open) { this.open = on; this.panel.hidden = !on; }

  attachGpu(gl: WebGL2RenderingContext) { this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); }
  setLayers(l: Layer[]) { this.layers = l; }

  /** Measure a CPU section (exponentially smoothed milliseconds). */
  start(name: string) { this.starts.set(name, performance.now()); }
  stop(name: string) { const t = performance.now() - (this.starts.get(name) ?? performance.now()); this.sections.set(name, (this.sections.get(name) ?? t) * 0.9 + t * 0.1); }
  time<T>(name: string, fn: () => T): T { this.start(name); try { return fn(); } finally { this.stop(name); } }
  counts(c: Record<string, number>) { this.stats = c; }
  /** Lines about the multiplayer sync (one per other player), shown under the timings. They are plain text: names come from other players, so they are escaped here. */
  netNotes(lines: string[]) { this.net = lines; }
  private net: string[] = [];

  /** Render with timing. While profiling, the GPU is synchronised so the time is the true cost. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    let q: any = null;
    if (this.ext && !this.profiling && !this.pending.length) { q = gl.createQuery(); gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); }
    const t0 = performance.now();
    renderer.render(scene, cam);
    if (this.profiling) gl.finish();
    const ms = performance.now() - t0;
    this.renderMs = this.renderMs * 0.9 + ms * 0.1;
    if (this.profiling) this.profileSample(ms);
    if (q) { gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push(q); }
    // collect finished GPU queries
    if (this.pending.length) {
      const p = this.pending[0], disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      if (gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE)) {
        if (!disjoint) { this.gpuMs = this.gpuMs * 0.85 + (gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6) * 0.15; this.gpuOk = true; }
        gl.deleteQuery(p); this.pending.shift();
      }
    }
  }

  /** Call once at the end of every frame. */
  frame(now: number, info: { calls: number; triangles: number; geometries: number; textures: number }) {
    if (this.last) { const dt = now - this.last; this.frames.push(dt); if (this.frames.length > 240) this.frames.shift(); }
    this.last = now;
    if (now - this.shown < 400) return;
    this.shown = now;
    const f = this.frames.slice(-60); if (!f.length) return;
    const avg = f.reduce((a, b) => a + b, 0) / f.length, fps = 1000 / avg;
    const sorted = [...this.frames].sort((a, b) => b - a), low = 1000 / (sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.01)))[0] ?? avg);
    this.badge.textContent = `${Math.round(fps)} fps`;
    this.badge.className = fps >= 55 ? 'good' : fps >= 30 ? 'ok' : 'bad';
    if (!this.open) return;
    this.draw(fps, avg, low, info);
  }

  private draw(fps: number, avg: number, low: number, info: { calls: number; triangles: number; geometries: number; textures: number }) {
    const g = this.graph.getContext('2d')!, W = this.graph.width, H = this.graph.height;
    g.clearRect(0, 0, W, H); g.fillStyle = '#00000055'; g.fillRect(0, 0, W, H);
    const max = 50;
    for (const [ms, c] of [[16.7, '#7fc06288'], [33.3, '#d9b56a88']] as const) { g.strokeStyle = c; g.beginPath(); g.moveTo(0, H - (ms / max) * H); g.lineTo(W, H - (ms / max) * H); g.stroke(); }
    g.strokeStyle = '#ffe9a8'; g.lineWidth = 1.2; g.beginPath();
    this.frames.forEach((v, i) => { const x = (i / 240) * W, y = H - Math.min(1, v / max) * H; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    (this.panel.querySelector('#perf-sub') as HTMLElement).textContent = `${fps.toFixed(0)} fps · ${avg.toFixed(1)} ms · 1% low ${low.toFixed(0)}`;

    const rows = [...this.sections.entries()].filter(([k]) => k !== 'frame').sort((a, b) => b[1] - a[1]);
    const cpuTotal = rows.reduce((a, [, v]) => a + v, 0) || 1;
    const top = rows[0];
    const bound = this.gpuOk ? (this.gpuMs > cpuTotal ? 'GPU-bound' : 'CPU-bound') : '';
    let html = '';
    if (top) html += `<div class="hot">Biggest CPU cost: <b>${top[0]}</b> — ${top[1].toFixed(2)} ms (${Math.round((top[1] / cpuTotal) * 100)}%) ${bound ? '· <b>' + bound + '</b>' : ''}</div>`;
    html += '<table>' + rows.map(([k, v], i) => `<tr class="${i === 0 ? 'top' : ''}"><td>${k}</td><td class="n">${v.toFixed(2)} ms</td><td><i style="width:${Math.min(100, (v / cpuTotal) * 100)}%"></i></td></tr>`).join('') + '</table>';
    html += `<div class="kv"><span>GPU time</span><b>${this.gpuOk ? this.gpuMs.toFixed(2) + ' ms' : 'not available'}</b><span>Render call</span><b>${this.renderMs.toFixed(2)} ms</b>
      <span>Draw calls</span><b>${info.calls}</b><span>Triangles</span><b>${(info.triangles / 1000).toFixed(0)}k</b><span>Geometries / textures</span><b>${info.geometries} / ${info.textures}</b>
      ${Object.entries(this.stats).map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>`;
    if (this.net.length) html += '<div class="eyebrow">Multiplayer sync</div>' + this.net.map(l => `<div class="kv-line">${l.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))}</div>`).join('');
    if (this.prof && !this.prof.done) html += `<div class="hot">Profiling… ${this.layers[this.prof.idx - 1]?.name ?? 'baseline'} (${this.prof.idx}/${this.layers.length})</div>`;
    if (this.lastRes) {
      const r = [...this.lastRes.results].sort((a, b) => b.ms - a.ms);
      html += `<div class="eyebrow">What each part costs per frame (baseline ${this.lastRes.base.toFixed(1)} ms)</div><table>` + r.map((x, i) => `<tr class="${i === 0 ? 'top' : ''}"><td>${x.name}</td><td class="n">${x.ms.toFixed(2)} ms</td><td><i style="width:${Math.min(100, Math.max(0, (x.ms / Math.max(0.01, this.lastRes!.base)) * 100))}%"></i></td></tr>`).join('') + '</table>';
    }
    this.body.innerHTML = html;
  }

  // ---- automatic profiler: switch each layer off in turn and see how much frame time it saves ----
  startProfile() {
    if (this.profiling || !this.layers.length) return;
    this.profiling = true; this.btn.disabled = true; this.lastRes = null;
    this.prof = { idx: 0, phase: 'base', n: 0, sum: 0, base: 0, results: [], done: false };
  }

  private profileSample(ms: number) {
    const p = this.prof!; p.n++;
    if (p.phase === 'warm') { if (p.n >= 5) { p.phase = 'measure'; p.n = 0; p.sum = 0; } return; }
    p.sum += ms;
    const need = p.phase === 'base' ? 40 : 18;
    if (p.n < need) return;
    const avg = p.sum / p.n;
    if (p.phase === 'base') p.base = avg;
    else { this.layers[p.idx - 1].set(true); p.results.push({ name: this.layers[p.idx - 1].name, ms: Math.max(0, p.base - avg) }); }
    if (p.idx >= this.layers.length) { this.profiling = false; p.done = true; this.btn.disabled = false; this.lastRes = { base: p.base, results: p.results }; this.layers.forEach(l => l.set(true)); return; }
    this.layers[p.idx].set(false); p.idx++; p.phase = 'warm'; p.n = 0; p.sum = 0;
  }
}
