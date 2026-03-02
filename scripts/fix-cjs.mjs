#!/usr/bin/env node
/**
 * fix-cjs.mjs — Rename all .js files in dist/cjs to .cjs for CommonJS interop
 */
import { readdir, rename, stat } from 'fs/promises';
import { join } from 'path';

async function renameCjs(dir) {
    const files = await readdir(dir);
    for (const file of files) {
        const full = join(dir, file);
        const info = await stat(full);
        if (info.isDirectory()) {
            await renameCjs(full);
        } else if (file.endsWith('.js')) {
            await rename(full, full.replace(/\.js$/, '.cjs'));
        }
    }
}

await renameCjs('./dist/cjs');
console.log('✅ Renamed .js → .cjs in dist/cjs/');
