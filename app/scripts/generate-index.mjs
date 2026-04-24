import fs from 'node:fs';
import path from 'node:path';

const appDir = process.cwd();
const rootDir = path.resolve(appDir, '..');
const emojisDir = path.join(rootDir, 'emojis');
const outputDir = path.join(appDir, 'data');
const outputPath = path.join(outputDir, 'emoji-index.json');

const IMAGE_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif']);

function slugify(input) {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function walk(dirPath, results = []) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) {
      continue;
    }

    results.push(fullPath);
  }

  return results;
}

if (!fs.existsSync(emojisDir)) {
  console.error('Cannot find emojis directory:', emojisDir);
  process.exit(1);
}

const files = walk(emojisDir);
const aliasCounter = new Map();

const items = files.map((fullPath) => {
  const relativeToRoot = path.relative(rootDir, fullPath).split(path.sep).join('/');
  const parent = path.basename(path.dirname(fullPath));
  const name = path.basename(fullPath, path.extname(fullPath));

  const baseAlias = slugify(`${parent} ${name}`) || 'emoji';
  const count = aliasCounter.get(baseAlias) || 0;
  aliasCounter.set(baseAlias, count + 1);

  const alias = count === 0 ? baseAlias : `${baseAlias}-${count + 1}`;

  return {
    alias,
    name,
    group: parent,
    path: relativeToRoot,
    trigger: `:${alias}`,
    keywords: [slugify(parent), slugify(name)].filter(Boolean)
  };
});

items.sort((a, b) => a.alias.localeCompare(b.alias));

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(
  outputPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      total: items.length,
      items
    },
    null,
    2
  ),
  'utf-8'
);

console.log(`Generated ${items.length} emoji aliases at ${outputPath}`);
