import test from 'node:test';
import assert from 'node:assert/strict';
import { isSoftwareRenderer, isIntegratedGpu } from '../src/gpucheck.ts';

test('a software rasteriser is recognised by the name the browser reports', () => {
  for (const name of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'Google SwiftShader',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'softpipe',
    'GDI Generic',
  ]) assert.equal(isSoftwareRenderer(name), true, name);
});

test('a real graphics card is not taken for a software one', () => {
  for (const name of [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002520) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.16.1692)',
    'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Apple M2',
    'Mali-G78',
    'Adreno (TM) 740',
  ]) assert.equal(isSoftwareRenderer(name), false, name);
});

test('no name means no verdict: a real GPU is assumed', () => {
  assert.equal(isSoftwareRenderer(null), false);
  assert.equal(isSoftwareRenderer(''), false);
  assert.equal(isSoftwareRenderer(undefined), false);
});

test('graphics built into the processor are recognised (they start on the Medium preset)', () => {
  for (const name of [
    'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Mali-G78',
    'Adreno (TM) 740',
  ]) assert.equal(isIntegratedGpu(name), true, name);
});

test('graphics cards and software renderers are not taken for built-in graphics', () => {
  for (const name of [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002520) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.16.1692)',
    'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Google SwiftShader',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
  ]) assert.equal(isIntegratedGpu(name), false, name);
  assert.equal(isIntegratedGpu(null), false);
});
