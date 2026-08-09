import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import bs58 from 'bs58';
const inflateRaw = promisify(zlib.inflateRaw);
async function fetchPaste(baseUrl, pasteId) {
    const url = `${baseUrl}/?pasteid=${pasteId}`;
    const res = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'X-Requested-With': 'JSONHttpRequest',
        },
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch paste: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json());
    if (json.status !== 0 && json.status !== undefined) {
        throw new Error(json.message || `Paste server returned status ${json.status}`);
    }
    return json;
}
async function decryptAesGcm(ciphertextB64, masterKey, adata) {
    const spec = adata[0];
    const iv = Buffer.from(spec[0], 'base64');
    const salt = Buffer.from(spec[1], 'base64');
    const iterations = spec[2];
    const tagSizeBits = spec[4];
    const tagLength = tagSizeBits / 8;
    // Derive AES key from master key via PBKDF2-SHA256.
    const derivedKey = crypto.pbkdf2Sync(masterKey, salt, iterations, 32, 'sha256');
    const encrypted = Buffer.from(ciphertextB64, 'base64');
    const cipherLen = encrypted.length - tagLength;
    if (cipherLen < 0) {
        throw new Error('Invalid ciphertext: shorter than auth tag length');
    }
    const ciphertext = encrypted.subarray(0, cipherLen);
    const authTag = encrypted.subarray(cipherLen);
    const aad = Buffer.from(JSON.stringify(adata), 'utf-8');
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv, { authTagLength: tagLength });
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return new Uint8Array(decrypted);
}
export async function decryptPaste(pasteUrl) {
    const url = new URL(pasteUrl);
    const baseUrl = `${url.protocol}//${url.host}`;
    const pasteIdMatch = url.search.match(/[?&]([a-f0-9]{16,32})/) || url.search.match(/[?&]pasteid=([a-f0-9]{16,32})/);
    if (!pasteIdMatch) {
        throw new Error('Could not extract paste ID from URL');
    }
    const pasteId = pasteIdMatch[1];
    const keyFragment = url.hash.slice(1);
    if (!keyFragment) {
        throw new Error('Could not extract decryption key from URL fragment');
    }
    let masterKey;
    try {
        masterKey = bs58.decode(keyFragment);
    }
    catch {
        throw new Error('Invalid decryption key in URL fragment (not valid base58)');
    }
    const paste = await fetchPaste(baseUrl, pasteId);
    const decrypted = await decryptAesGcm(paste.ct, masterKey, paste.adata);
    const spec = paste.adata[0];
    const compression = spec[7];
    let plaintextBytes;
    if (compression === 'zlib') {
        plaintextBytes = await inflateRaw(decrypted);
    }
    else {
        plaintextBytes = decrypted;
    }
    const text = new TextDecoder().decode(plaintextBytes);
    const parsed = JSON.parse(text);
    return parsed.paste;
}
