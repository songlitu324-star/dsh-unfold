/**
 * Run the built note in a real DOM (linkedom) and look at what it produced.
 *
 * The page is one file of plain DOM code, so parsing it, attaching the handful of browser globals it
 * touches, and running its inline script is enough to catch a large class of mistakes that no amount of
 * reading the template would: selectors that match nothing, a render that throws halfway, citations that
 * lose their handlers, an empty table of contents.
 */
import { readFileSync } from 'node:fs';
import { parseHTML } from '../vendor/dom/node_modules/linkedom/esm/index.js';

const file = process.argv[2];
const html = readFileSync(file, 'utf8');
const { window, document } = parseHTML(html);

// Browser globals the page expects.
const store = new Map();
window.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
window.IntersectionObserver = class {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.speechSynthesis = { speak() {}, cancel() {}, getVoices: () => [] };
window.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text;
  }
};
// Every request the page makes, so the speech path can be checked end to end.
const calls = [];
window.fetch = (url, init) => {
  let body = null;
  try { body = init && init.body ? JSON.parse(init.body) : null; } catch (e) { body = null; }
  calls.push({ url: String(url), body });
  if (String(url).includes('/tts')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })),
    });
  }
  return Promise.resolve({ ok: true, text: () => Promise.resolve('{"ok":true}') });
};
window.scrollTo = () => {};
// linkedom has the selector/event surface but not layout, so the two scroll calls the page makes are
// no-ops here.
window.Element.prototype.scrollIntoView = () => {};
window.Element.prototype.scrollTo = () => {};
window.location = { href: 'file:///note.html', origin: 'null' };

// Audio playback: Node has no <audio>, and the page plays blob URLs. Emulate just enough for the
// lecture to advance when the speech ends.
const played = [];
globalThis.Audio = class {
  constructor(src) {
    this.src = src;
    this.paused = true;
    played.push(src);
  }
  play() {
    this.paused = false;
    setTimeout(() => { if (typeof this.onended === 'function') this.onended(); }, 0);
    return Promise.resolve();
  }
  pause() { this.paused = true; }
};
if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = (blob) => `blob:mock/${played.length}`;
if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = () => {};

// Run the page's own script (the only non-JSON inline script).
const scripts = [...document.querySelectorAll('script')].filter((s) => s.getAttribute('type') !== 'application/json');
if (scripts.length !== 1) throw new Error(`expected 1 inline script, found ${scripts.length}`);
const source = scripts[0].textContent;
const factory = new Function('window', 'document', 'localStorage', 'IntersectionObserver', 'speechSynthesis', 'SpeechSynthesisUtterance', 'fetch', 'scrollTo', source);

try {
  factory(
    window,
    document,
    window.localStorage,
    window.IntersectionObserver,
    window.speechSynthesis,
    window.SpeechSynthesisUtterance,
    window.fetch,
    window.scrollTo,
  );
} catch (error) {
  console.log('SCRIPT THREW:', error?.stack ?? error);
  process.exit(1);
}

const data = JSON.parse(document.getElementById('data').textContent);
const count = (selector) => document.querySelectorAll(selector).length;
console.log('title element:', document.querySelector('h1')?.textContent?.trim() ?? '(none)');
console.log('sections in DOM:', count('.sec'), 'blocks in DOM:', count('.blk'));
console.log('cite chips:', count('.cite'), 'toc entries:', count('#toc a, #toc button'));
console.log('route items:', count('.route li'), 'quiz items:', count('#quiz details'));
console.log('beats in data:', data.lecture.length, 'play button:', document.getElementById('play') !== null);
console.log('citecard imgs actually rendered:', count('#citecard img'));
console.log('has fold classes:', document.body.className || '(none)');

const click = (node) => {
  const ev = document.createEvent('Event');
  ev.initEvent('click', true, true);
  node?.dispatchEvent(ev);
};

// A citation chip must be able to show its screenshot: the crop has a png and the chip is bound.
const chips = [...document.querySelectorAll('.cite')];
console.log('first chip text:', chips[0]?.textContent ?? '(none)');
const first = chips[0];
click(first);
console.log('after click, citecard class:', document.getElementById('citecard')?.className ?? '(none)');
const img = document.getElementById('citecard')?.querySelector('img');
console.log('citecard img src starts:', typeof img?.src === 'string' ? img.src.slice(0, 32) : '(no img)');

// Teaching mode: pressing next should mark beats and move the laser.
click(document.getElementById('next'));
console.log('pos label:', document.getElementById('pos')?.textContent ?? '(none)');
console.log('spot blocks:', count('.blk.spot'), 'seen blocks:', count('.blk.seen'));

// The voice menu: the default voice comes from the host, the rest of the list is the menu, and the
// browser engine is always the last resort.
const voiceSel = document.getElementById('voiceName');
const options = voiceSel ? [...voiceSel.options] : [];
const chosen = options.filter((o) => o.hasAttribute('selected')).map((o) => o.value).join(',') || '(none)';
console.log('voice options:', options.length, '| selected:', chosen);
console.log('voice has default:', options.some((o) => o.value === 'zh-CN-YunjianNeural'), '| has browser fallback:', options.some((o) => o.value === 'browser'));
if (chosen !== 'zh-CN-YunjianNeural') throw new Error(`default voice is not selected (got ${chosen})`);
if (!options.some((o) => o.value === 'browser')) throw new Error('browser fallback missing from the voice menu');

// Pressing play should ask the bridge for speech in that voice, not fall back to the browser engine.
click(document.getElementById('play'));
await new Promise((resolve) => setTimeout(resolve, 30));
const tts = calls.find((c) => c.url.includes('/tts'));
console.log('requests after play:', calls.length, '| tts request:', tts ? tts.url : '(none)');
console.log('tts voice:', tts?.body?.voice ?? '(none)', '| rate:', tts?.body?.rate ?? '(none)');
console.log('audio played:', played.length);
if (!tts) throw new Error('play did not request synthesized speech');
if (tts.body?.voice !== 'zh-CN-YunjianNeural') throw new Error(`wrong voice requested: ${tts.body?.voice}`);
if (played.length === 0) throw new Error('synthesized speech was never played');
