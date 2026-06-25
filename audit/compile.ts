// Compiles the audited contracts with the bundled func-js (func 0.4.x).
// The original sources pin `#pragma version =0.2.0;`, an exact-match assertion
// that a modern compiler rejects. We strip ONLY that pragma line in-memory so
// the audited logic is compiled verbatim; the source files on disk are untouched.
import { compileFunc } from '@ton-community/func-js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const FUNC_DIR = join(__dirname, '..', 'func');
const BUILD_DIR = join(__dirname, 'build');

function readSource(name: string): string {
    const raw = readFileSync(join(FUNC_DIR, name), 'utf8');
    // Drop the exact-version pragma so func 0.4.x will compile the file.
    return raw.replace(/^#pragma version[^\n]*\n/m, '');
}

async function compileOne(label: string, mainFile: string) {
    const result = await compileFunc({
        sources: [
            { filename: 'stdlib.fc', content: readSource('stdlib.fc') },
            { filename: mainFile, content: readSource(mainFile) },
        ],
        targets: ['stdlib.fc', mainFile],
    });
    if (result.status === 'error') {
        throw new Error(`Compilation of ${label} failed:\n${result.message}`);
    }
    writeFileSync(join(BUILD_DIR, `${label}.cell.base64`), result.codeBoc);
    console.log(`[ok] ${label}: codeBoc ${result.codeBoc.length} base64 chars`);
    return result.codeBoc;
}

export async function compileAll() {
    const wallet = await compileOne('wallet-v4', 'wallet-v4-code.fc');
    const plugin = await compileOne('subscription', 'simple-subscription-plugin.fc');
    return { wallet, plugin };
}

if (require.main === module) {
    compileAll().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
