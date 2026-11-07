const { copyFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'dist', 'index.html');
const destination = path.join(root, 'dist', '404.html');

copyFileSync(source, destination);

console.log('[Build] Created dist/404.html from dist/index.html');
