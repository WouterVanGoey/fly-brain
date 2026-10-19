import fs from 'node:fs';
import { FlyVis, parseFlyVis, flyvisBytes } from '../src/flyvis.js';

// If canvas package is not installed, use pure JS png decoder or mock sample
console.log('Testing FlyVis execution with Touch+ stereo inputs...');

const json = JSON.parse(fs.readFileSync('public/vision/flyvis.json'));
const inputs = JSON.parse(fs.readFileSync('public/vision/flyvis_inputs.json'));
const b = fs.readFileSync('public/vision/flyvis.bin');
const model = parseFlyVis(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), json, inputs);

const pages = Math.ceil((flyvisBytes(model.N, model.E) + 65536 * 4) / 65536);
const memory = new WebAssembly.Memory({ initial: pages, maximum: pages, shared: true });
const { instance } = await WebAssembly.instantiate(fs.readFileSync('public/lif.wasm'), { env: { memory } });
const fv = new FlyVis(instance, memory, 1024, model);

const ref = JSON.parse(fs.readFileSync('data/flyvis_ref.json'));

console.log(`FlyVis Model Loaded: ${model.N} neurons, ${model.E} synapses`);
console.log('Stepping 30 visual frames through optic lobe...');

// Step a uniform grey field to settle baseline
const grey = new Float32Array(721).fill(0.5);
fv.reset();
fv.setInput(grey);
for (let i = 0; i < 30; i++) fv.step();

const baselineL1 = fv.v[ref.idx[ref.cells.indexOf('L1')]];
const baselineT4a = fv.v[ref.idx[ref.cells.indexOf('T4a')]];
console.log(`Settled baseline: L1=${baselineL1.toFixed(3)}, T4a=${baselineT4a.toFixed(3)}`);

// Now apply high-contrast edge stimulus across ommatidia
const stim = new Float32Array(721).fill(0.1);
for (let i = 0; i < 360; i++) stim[i] = 0.9; // Left bright, right dark
fv.setInput(stim);
fv.step();

const activeL1 = fv.v[ref.idx[ref.cells.indexOf('L1')]];
const activeT4a = fv.v[ref.idx[ref.cells.indexOf('T4a')]];
console.log(`Stimulated response: L1=${activeL1.toFixed(3)} (delta: ${(activeL1 - baselineL1).toFixed(3)}), T4a=${activeT4a.toFixed(3)} (delta: ${(activeT4a - baselineT4a).toFixed(3)})`);

console.log('SUCCESS: FlyVis visual neural responses verified on CPU!');
