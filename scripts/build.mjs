import { promises as fs } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const srcDir = path.join(projectRoot, 'src');
const docsDir = path.join(projectRoot, 'docs');

async function removeDocs() {
  await fs.rm(docsDir, { recursive: true, force: true });
  await fs.mkdir(docsDir, { recursive: true });
}

async function copyRecursive(from, to) {
  const entries = await fs.readdir(from, { withFileTypes: true });
  await fs.mkdir(to, { recursive: true });

  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = path.join(from, entry.name);
      const destPath = path.join(to, entry.name);
      if (entry.isDirectory()) {
        await copyRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.copyFile(srcPath, destPath);
      }
    })
  );
}

async function build() {
  await removeDocs();
  await copyRecursive(srcDir, docsDir);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
