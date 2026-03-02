#!/usr/bin/env node
/**
 * fix-cjs.mjs
 *
 * Post-build script that:
 *  1. Renames all *.js files in dist/cjs to *.cjs
 *  2. Rewrites require() / import paths inside .cjs files so relative
 *     imports also point to .cjs instead of .js
 *  3. Writes a package.json into dist/cjs declaring "type": "commonjs"
 *     so Node is never confused about the module format.
 */

import { readdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CJS_DIR = join(__dirname, '..', 'dist', 'cjs');

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await walk(full)));
        } else if (entry.isFile()) {
            files.push(full);
        }
    }
    return files;
}

/**
 * Rewrite relative .js imports/requires → .cjs
 * Handles:
 *   require('./foo')       → require('./foo.cjs')       [no ext]
 *   require('./foo.js')    → require('./foo.cjs')       [.js ext]
 *   require("../bar.js")   → require("../bar.cjs")
 */
function rewriteContent(source) {
    // Match require('...') and require("...")
    return source.replace(
        /require\((['"])(\.{1,2}\/[^'"]*?)(\.js)?\1\)/g,
        (_, q, path, ext) => {
            // Only rewrite relative paths that don't already end in .cjs
            if (path.endsWith('.cjs')) return _;
            return `require(${q}${path}.cjs${q})`;
        },
    );
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (!existsSync(CJS_DIR)) {
    console.error(`[fix-cjs] dist/cjs not found — run build:cjs first`);
    process.exit(1);
}

const allFiles = await walk(CJS_DIR);
const jsFiles = allFiles.filter((f) => f.endsWith('.js'));

// Step 1: Rewrite content of all .js files
for (const file of jsFiles) {
    const original = await readFile(file, 'utf8');
    const patched = rewriteContent(original);
    if (patched !== original) {
        await writeFile(file, patched, 'utf8');
    }
}

// Step 2: Rename .js → .cjs
for (const file of jsFiles) {
    const newPath = file.replace(/\.js$/, '.cjs');
    await rename(file, newPath);
}

// Step 3: Write a package.json that marks this dir as CJS
await writeFile(
    join(CJS_DIR, 'package.json'),
    JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
    'utf8',
);

console.log(`[fix-cjs] Renamed ${jsFiles.length} file(s) → .cjs in dist/cjs`);
