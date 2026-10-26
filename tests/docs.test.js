// Documentation must not drift from the code: links resolve, every doc is reachable from
// the index, and every environment variable the code reads is in .env.example.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const docs = fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`);
const pages = ['README.md', 'CONTRIBUTING.md', ...docs];

describe('documentation', () => {
  it('every relative link and image resolves', () => {
    const broken = [];
    for (const page of pages) {
      const dir = path.dirname(path.join(ROOT, page));
      for (const [, target] of read(page).matchAll(/(?:\]\(|src="|srcset=")(?!https?:|#|mailto:)([^)"#\s]+)/g)) {
        if (!fs.existsSync(path.join(dir, target))) broken.push(`${page} -> ${target}`);
      }
    }
    assert.deepEqual(broken, []);
  });

  it('every guide is linked from docs/README.md and the root README', () => {
    const index = read('docs/README.md');
    const readme = read('README.md');
    const missing = docs.filter((d) => d !== 'docs/README.md').filter((d) => {
      const name = path.basename(d);
      return !index.includes(`(${name})`) || !readme.includes(`(${d})`);
    });
    assert.deepEqual(missing, []);
  });

  it('the README footer is the house credit line and nothing follows it', () => {
    const footer = '<p align="center"><sub>Made with ❤️ by <a href="https://github.com/CaputoDavide93">Davide Caputo</a></sub></p>';
    assert.equal(read('README.md').trimEnd().split('\n').pop(), footer);
  });

  it('every screenshot has a light and a dark file', () => {
    const files = fs.readdirSync(path.join(ROOT, 'docs/assets/screenshots'));
    const names = new Set(files.map((f) => f.replace(/-(light|dark)\.png$/, '')));
    for (const n of names) {
      assert.ok(files.includes(`${n}-light.png`) && files.includes(`${n}-dark.png`), `${n} needs both schemes`);
    }
  });
});

describe('.env.example', () => {
  it('lists every environment variable the code reads', () => {
    const files = ['server.js', ...fs.readdirSync(path.join(ROOT, 'src')).map((f) => `src/${f}`)];
    const used = new Set();
    for (const f of files) for (const [, v] of read(f).matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)) used.add(v);
    const example = read('.env.example');
    const missing = [...used].filter((v) => !new RegExp(`^#?\\s*${v}=`, 'm').test(example));
    assert.deepEqual(missing, []);
  });
});
