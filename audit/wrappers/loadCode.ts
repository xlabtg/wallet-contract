import { Cell } from '@ton/core';
import { readFileSync } from 'fs';
import { join } from 'path';

const BUILD_DIR = join(__dirname, '..', 'build');

export function loadWalletCode(): Cell {
    const b64 = readFileSync(join(BUILD_DIR, 'wallet-v4.cell.base64'), 'utf8');
    return Cell.fromBase64(b64);
}

export function loadSubscriptionCode(): Cell {
    const b64 = readFileSync(join(BUILD_DIR, 'subscription.cell.base64'), 'utf8');
    return Cell.fromBase64(b64);
}
