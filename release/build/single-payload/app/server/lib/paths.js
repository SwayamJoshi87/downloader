import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export function getToolPath(toolName) {
    return path.resolve(__dirname, '..', '..', 'resources', 'tools', toolName);
}
