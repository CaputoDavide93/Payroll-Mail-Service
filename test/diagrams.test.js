// The README diagrams are drawn SVGs (tools/gen_diagram.py), served from <picture>
// blocks. These checks keep the pages honest: every reference resolves, both colour
// schemes and real alt text are present, nothing GitHub strips is in the SVGs, and
// Mermaid does not quietly come back.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'docs', 'assets');
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.md')).map((f) => path.join(ROOT, f));
const read = (p) => fs.readFileSync(p, 'utf8');

describe('README diagrams', () => {
  it('every picture points at files that exist', () => {
    const missing = [];
    for (const page of pages) {
      for (const [, ref] of read(page).matchAll(/(?:srcset|src)="([^"]+\.svg)"/g)) {
        if (!fs.existsSync(path.join(path.dirname(page), ref))) missing.push(`${path.basename(page)} -> ${ref}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('every picture offers a dark source and real alt text', () => {
    const blocks = pages.flatMap((p) => [...read(p).matchAll(/<picture>[\s\S]*?<\/picture>/g)].map((m) => m[0]));
    assert.ok(blocks.length >= 2, `only ${blocks.length} <picture> blocks found`);
    for (const block of blocks) {
      assert.match(block, /prefers-color-scheme: dark/);
      assert.match(block, /alt="[^"]{40,}"/);
    }
  });

  it('every diagram exists in both schemes and carries nothing GitHub strips', () => {
    const svgs = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.svg'));
    for (const f of svgs) {
      const twin = f.endsWith('-light.svg') ? f.replace('-light.svg', '-dark.svg') : f.replace('-dark.svg', '-light.svg');
      assert.ok(svgs.includes(twin), `${f} has no ${twin}`);
      const svg = fs.readFileSync(path.join(ASSETS, f), 'utf8');
      for (const banned of ['<script', '<style', '@import', '<foreignObject']) {
        assert.ok(!svg.includes(banned), `${f} contains ${banned}`);
      }
    }
  });

  it('Mermaid has not come back', () => {
    for (const page of pages) assert.doesNotMatch(read(page), /^```mermaid/m, path.basename(page));
  });
});
