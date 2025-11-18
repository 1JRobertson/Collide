import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const docsDir = path.join(projectRoot, 'docs');

const DEFAULT_PORT = 8080;
const portArg = Number.parseInt(process.argv[2], 10);
const resolvedPort = Number.isFinite(portArg) && portArg > 0 ? portArg : Number.parseInt(process.env.PORT || '', 10);
const port = Number.isFinite(resolvedPort) && resolvedPort > 0 ? resolvedPort : DEFAULT_PORT;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

async function ensureDocsDirectory() {
  try {
    const stats = await fs.stat(docsDir);
    if (!stats.isDirectory()) {
      throw new Error('docs path is not a directory');
    }
  } catch (error) {
    console.error('Could not find built docs directory.');
    console.error('Run "npm run build" before starting the server.');
    console.error(error.message);
    process.exitCode = 1;
    process.exit();
  }
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

async function resolveFilePath(requestPath) {
  const decodedPath = decodeURIComponent(requestPath);
  const normalized = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
  const stripped = normalized.replace(/^[/\\]+/, '');
  const targetPath = stripped || '';
  let target = path.join(docsDir, targetPath);
  const relative = path.relative(docsDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  try {
    const stats = await fs.stat(target);
    if (stats.isDirectory()) {
      return path.join(target, 'index.html');
    }
    return target;
  } catch (error) {
    if (error.code === 'ENOENT' && !target.endsWith('.html')) {
      const htmlFallback = `${target}.html`;
      try {
        await fs.access(htmlFallback);
        return htmlFallback;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function readFile(filePath) {
  const data = await fs.readFile(filePath);
  return data;
}

await ensureDocsDirectory();

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  const { pathname } = new URL(req.url, `http://localhost:${port}`);

  let filePath = await resolveFilePath(pathname);
  if (!filePath) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': getContentType(filePath),
      'cache-control': 'no-cache'
    });
    res.end(data);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : 500;
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(status === 404 ? 'Not found' : 'Server error');
  }
});

server.listen(port, () => {
  console.log(`Serving docs from ${docsDir}`);
  console.log(`Open http://localhost:${port}/`);
});
