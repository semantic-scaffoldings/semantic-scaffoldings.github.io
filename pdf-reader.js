/* Local PDF.js rendering: no browser PDF plug-in and no external service. */
var PaperPdfReader = (() => {
 'use strict';
 const ZOOMS = new Set(['width', '1', '1.25', '1.5', '2']);
 const clampPage = (value, total) => Math.min(Math.max(Math.trunc(Number(value)) || 1, 1), total);
 function hashState(hash) {
  const [edition, ...query] = String(hash || '').replace(/^#/, '').split('&');
  const params = new URLSearchParams(query.join('&'));
  return {edition, page: Math.max(1, Math.trunc(Number(params.get('page'))) || 1), zoom: ZOOMS.has(params.get('zoom')) ? params.get('zoom') : 'width'};
 }
 function linkURL(value) {
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
 }
 function annotationBox(viewport, rect) {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
  return {left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1)};
 }
 if (typeof document === 'undefined') return {clampPage, hashState, linkURL, annotationBox};
 const host = document.querySelector('[data-overleaf-page]');
 if (!host) return {clampPage, hashState, linkURL, annotationBox};
 const tabs = [...host.querySelectorAll('[data-ovp-tab]')];
 const panes = [...host.querySelectorAll('[data-ovp-pane]')];
 const readers = new Map();
 let modulePromise, activeEdition = '', resizeTimer;
 function pdfLibrary() {
  if (!modulePromise) modulePromise = import(new URL('assets/pdfjs/pdf.min.mjs', document.baseURI).href).then(lib => {
   lib.GlobalWorkerOptions.workerSrc = new URL('assets/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
   return lib;
  }).catch(error => { modulePromise = null; throw error; });
  return modulePromise;
 }
 const bounded = (promise, milliseconds, message) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message)), milliseconds); })]).finally(() => clearTimeout(timer));
 };
 function updateHash(push = false) {
  const reader = readers.get(activeEdition);
  const hash = '#' + activeEdition + (reader && reader.pageNumber > 1 ? '&page=' + reader.pageNumber : '') + (reader && reader.zoom !== 'width' ? '&zoom=' + reader.zoom : '');
  if (location.hash !== hash) history[push ? 'pushState' : 'replaceState'](history.state, '', hash);
 }
 class Reader {
  constructor(root) {
   this.root = root; this.edition = root.dataset.pdfReader;
   this.pageNumber = 1; this.zoom = 'width'; this.total = Number(root.dataset.pdfPages);
   this.request = 0; this.pdf = null; this.task = null; this.textTask = null; this.loadingTask = null; this.loadPromise = null;
   this.sheet = root.querySelector('[data-pdf-sheet]'); this.viewport = root.querySelector('[data-pdf-viewport]');
   this.status = root.querySelector('[data-pdf-status]'); this.failure = root.querySelector('[data-pdf-failure]');
   this.input = root.querySelector('[data-pdf-page]'); this.zoomInput = root.querySelector('[data-pdf-zoom]');
   this.previous = root.querySelector('[data-pdf-prev]'); this.next = root.querySelector('[data-pdf-next]');
   this.preview = root.closest('[data-ovp-pane]').querySelector('.ovp-preview');
   this.previous.addEventListener('click', () => this.go(this.pageNumber - 1));
   this.next.addEventListener('click', () => this.go(this.pageNumber + 1));
   this.input.addEventListener('change', () => this.go(this.input.value));
   this.input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); this.go(this.input.value); } });
   this.zoomInput.addEventListener('change', () => { this.zoom = this.zoomInput.value; updateHash(); this.render(); });
   root.querySelector('[data-pdf-retry]').addEventListener('click', () => { this.render(); });
   this.viewport.addEventListener('keydown', event => {
    if (event.target !== this.viewport) return;
    if (['ArrowRight', 'PageDown'].includes(event.key)) { event.preventDefault(); this.go(this.pageNumber + 1); }
    if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); this.go(this.pageNumber - 1); }
   });
  }
  controls() {
   this.pageNumber = clampPage(this.pageNumber, this.total);
   this.input.value = this.pageNumber; this.input.max = this.total;
   this.zoomInput.value = this.zoom;
   this.root.querySelector('[data-pdf-total]').textContent = this.total;
   this.previous.disabled = this.pageNumber <= 1; this.next.disabled = this.pageNumber >= this.total;
  }
  stop() {
   this.request++;
   this.task?.cancel(); this.textTask?.cancel();
   this.task = null; this.textTask = null;
  }
  go(page) { this.pageNumber = clampPage(page, this.total); this.controls(); updateHash(); this.render(); }
  async load(lib) {
   if (this.pdf) return this.pdf;
   if (!this.loadPromise) {
    const url = new URL(this.root.dataset.pdfUrl, document.baseURI);
    if (url.origin !== location.origin || !/\/paper-(?:single|two)-column\.pdf$/.test(url.pathname)) throw Error('Unexpected PDF source');
    this.loadingTask = lib.getDocument({url: url.href, isEvalSupported: false, useSystemFonts: true});
    this.loadingTask.onProgress = ({loaded, total}) => {
     if (activeEdition === this.edition && !this.pdf) this.status.textContent = total ? 'Loading PDF · ' + Math.min(100, Math.round(100 * loaded / total)) + '%' : 'Loading PDF…';
    };
    this.loadPromise = bounded(this.loadingTask.promise, 60000, 'PDF loading timed out').then(pdf => {
     this.pdf = pdf; this.total = pdf.numPages; this.controls(); return pdf;
    }).catch(error => { this.loadingTask?.destroy(); this.loadingTask = null; this.loadPromise = null; throw error; });
   }
   return this.loadPromise;
  }
  async destination(pdf, dest) {
   const value = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
   if (!Array.isArray(value) || value.length === 0) return null;
   const index = Number.isInteger(value[0]) ? value[0] : await pdf.getPageIndex(value[0]);
   return Number.isInteger(index) && index >= 0 && index < pdf.numPages ? index + 1 : null;
  }
  async addLinks(pdf, page, viewport, layer, ticket) {
   const annotations = await page.getAnnotations({intent: 'display'});
   if (ticket !== this.request) return;
   for (const annotation of annotations) {
    if (annotation.subtype !== 'Link' || !Array.isArray(annotation.rect)) continue;
    const external = linkURL(annotation.url), destination = annotation.dest;
    if (!external && !destination) continue;
    const box = annotationBox(viewport, annotation.rect);
    if (!box.width || !box.height) continue;
    const link = document.createElement('a');
    Object.assign(link.style, Object.fromEntries(Object.entries(box).map(([key, value]) => [key, value + 'px'])));
    if (external) {
     link.href = external; link.target = '_blank'; link.rel = 'noopener noreferrer';
     link.setAttribute('aria-label', 'Open linked source: ' + external);
     link.title = external;
    } else {
     link.href = '#' + this.edition;
     link.setAttribute('aria-label', 'Follow link within this PDF');
     link.addEventListener('click', async event => {
      event.preventDefault();
      try { const number = await this.destination(pdf, destination); if (number && activeEdition === this.edition) this.go(number); }
      catch { this.status.textContent = 'This PDF link could not be resolved. Use the page controls or the original PDF.'; }
     });
    }
    layer.append(link);
   }
  }
  async render() {
   this.stop(); const ticket = this.request;
   this.root.hidden = false; this.failure.hidden = true; this.viewport.hidden = false;
   this.status.dataset.error = 'false'; this.status.textContent = this.pdf ? 'Rendering page ' + this.pageNumber + '…' : 'Loading the PDF reader…';
   this.root.setAttribute('aria-busy', 'true'); this.controls();
   const current = () => ticket === this.request && activeEdition === this.edition;
   try {
    const lib = await bounded(pdfLibrary(), 15000, 'PDF reader loading timed out');
    if (!current()) return;
    const pdf = await this.load(lib);
    if (!current()) return;
    const page = await pdf.getPage(this.pageNumber);
    if (!current()) return;
    const original = page.getViewport({scale: 1}), available = Math.max(240, this.viewport.clientWidth - (innerWidth <= 720 ? 16 : 32));
    const scale = this.zoom === 'width' ? Math.min(available / original.width, 2) : Number(this.zoom) * 96 / 72;
    const viewport = page.getViewport({scale});
    const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', 'PDF page ' + this.pageNumber + ' of ' + this.total);
    canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
    const text = document.createElement('div'); text.className = 'pdf-text-layer';
    const links = document.createElement('div'); links.className = 'pdf-link-layer';
    this.sheet.replaceChildren(canvas, text, links);
    this.sheet.style.width = viewport.width + 'px'; this.sheet.style.height = viewport.height + 'px';
    this.sheet.style.setProperty('--total-scale-factor', viewport.scale);
    this.task = page.render({canvasContext: canvas.getContext('2d'), transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0], viewport, background: '#ffffff'});
    await this.task.promise;
    if (!current()) return;
    this.task = null; this.preview.hidden = true;
    this.viewport.scrollTop = 0; this.viewport.scrollLeft = 0;
    this.status.textContent = 'Page ' + this.pageNumber + ' of ' + this.total;
    const results = await Promise.allSettled([
     page.getTextContent().then(async content => {
      if (!current()) return;
      this.textTask = new lib.TextLayer({textContentSource: content, container: text, viewport});
      await this.textTask.render();
      if (!current()) return;
      // The site's typography reset must not change PDF.js's positioned fonts.
      text.querySelectorAll('span').forEach(span => { if (span.style.fontFamily) span.style.setProperty('font-family', span.style.fontFamily, 'important'); });
      this.textTask = null;
     }),
     this.addLinks(pdf, page, viewport, links, ticket),
    ]);
    if (!current()) return;
    if (results.some(result => result.status === 'rejected')) this.status.textContent += ' · Some text or links could not load; the original PDF remains available.';
    this.root.setAttribute('aria-busy', 'false'); updateHash();
   } catch (error) {
    if (!current() || error?.name === 'RenderingCancelledException' || error?.name === 'AbortException') return;
    this.root.setAttribute('aria-busy', 'false'); this.viewport.hidden = true;
    this.failure.hidden = false; this.preview.hidden = false;
    this.status.dataset.error = 'true'; this.status.textContent = 'The in-page PDF reader is unavailable.';
   }
  }
 }
 host.querySelectorAll('[data-pdf-reader]').forEach(root => readers.set(root.dataset.pdfReader, new Reader(root)));
 function show(key, {push = false, page, zoom, focus = false} = {}) {
  if (!tabs.some(tab => tab.dataset.ovpTab === key)) key = tabs[0]?.dataset.ovpTab;
  if (!key) return;
  for (const [edition, reader] of readers) if (edition !== key) reader.stop();
  activeEdition = key;
  for (const tab of tabs) {
   const selected = tab.dataset.ovpTab === key;
   tab.setAttribute('aria-selected', selected ? 'true' : 'false'); tab.tabIndex = selected ? 0 : -1;
   if (focus && selected) tab.focus();
  }
  panes.forEach(pane => { pane.hidden = pane.dataset.ovpPane !== key; });
  const reader = readers.get(key);
  if (reader) {
   if (page != null) reader.pageNumber = clampPage(page, reader.total);
   if (ZOOMS.has(zoom)) reader.zoom = zoom;
   reader.render();
  }
  updateHash(push);
 }
 tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => show(tab.dataset.ovpTab, {push: true}));
  tab.addEventListener('keydown', event => {
   const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
   if (next != null) { event.preventDefault(); show(tabs[next].dataset.ovpTab, {push: true, focus: true}); }
  });
 });
 function restore() { const state = hashState(location.hash); show(state.edition, state); }
 window.addEventListener('hashchange', restore);
 window.addEventListener('popstate', restore);
 window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { const reader = readers.get(activeEdition); if (reader?.zoom === 'width') reader.render(); }, 160); });
 restore();
 return {clampPage, hashState, linkURL, annotationBox};
})();
