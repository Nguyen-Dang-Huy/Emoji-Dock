const fs = require('node:fs');
const path = require('node:path');
const Fuse = require('fuse.js');
const { app } = require('electron');

const appDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(appDir, '..');
const indexPath = path.join(appDir, 'data', 'emoji-index.json');
const bundledCustomAliasPath = path.join(appDir, 'data', 'custom-aliases.json');
const imageExtensions = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif']);

let db = { total: 0, items: [] };
let aliasMap = new Map();
let searchableItems = [];
let fuse = null;

function runtimeCustomAliasPath() {
  try {
    const userData = app?.getPath('userData');
    if (userData) {
      return path.join(userData, 'custom-aliases.json');
    }
  } catch {
    // Fallback to bundled path in non-electron runtime.
  }

  return bundledCustomAliasPath;
}

function runtimeUserEmojiDir() {
  try {
    const userData = app?.getPath('userData');
    if (userData) {
      return path.join(userData, 'emojis');
    }
  } catch {
    // Ignore and use fallback below.
  }

  return path.join(appDir, 'user-emojis');
}

function runtimeImportedEmojiIndexPath() {
  try {
    const userData = app?.getPath('userData');
    if (userData) {
      return path.join(userData, 'imported-emojis.json');
    }
  } catch {
    // Ignore and use fallback below.
  }

  return path.join(appDir, 'imported-emojis.json');
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function normalizePathForComparison(filePath) {
  if (!filePath) {
    return '';
  }

  return path.resolve(String(filePath)).toLowerCase();
}

function listImageFiles(startPaths) {
  const results = [];

  function walk(currentPath) {
    if (!currentPath || !fs.existsSync(currentPath)) {
      return;
    }

    const stat = fs.statSync(currentPath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        walk(path.join(currentPath, entry.name));
      }
      return;
    }

    if (imageExtensions.has(path.extname(currentPath).toLowerCase())) {
      results.push(currentPath);
    }
  }

  for (const startPath of startPaths || []) {
    walk(startPath);
  }

  return results;
}

function ensureImportedEmojiStorage() {
  ensureDirectory(runtimeUserEmojiDir());
  const indexPathName = runtimeImportedEmojiIndexPath();
  ensureDirectory(path.dirname(indexPathName));
  if (!fs.existsSync(indexPathName)) {
    fs.writeFileSync(indexPathName, JSON.stringify({ version: 1, items: [] }, null, 2), 'utf-8');
  }
}

function readImportedEmojiItems() {
  const indexPathName = runtimeImportedEmojiIndexPath();
  if (!fs.existsSync(indexPathName)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(indexPathName, 'utf-8'));
    const items = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
    return items.filter((item) => item && typeof item === 'object' && typeof item.alias === 'string' && typeof item.path === 'string');
  } catch {
    return [];
  }
}

function writeImportedEmojiItems(items) {
  const indexPathName = runtimeImportedEmojiIndexPath();
  ensureDirectory(path.dirname(indexPathName));
  fs.writeFileSync(indexPathName, JSON.stringify({ version: 1, items }, null, 2), 'utf-8');
}

function clearImportedEmojiStorage() {
  const removedAliases = readImportedEmojiItems()
    .map((item) => normalizeAlias(item.alias))
    .filter(Boolean);

  const importedDir = runtimeUserEmojiDir();
  const indexPathName = runtimeImportedEmojiIndexPath();

  try {
    if (fs.existsSync(importedDir)) {
      fs.rmSync(importedDir, { recursive: true, force: true });
    }
  } catch (error) {
    return { ok: false, reason: 'file_delete_failed', error: String(error?.message || error) };
  }

  try {
    if (fs.existsSync(indexPathName)) {
      fs.unlinkSync(indexPathName);
    }
  } catch (error) {
    return { ok: false, reason: 'file_delete_failed', error: String(error?.message || error) };
  }

  ensureImportedEmojiStorage();
  loadDb();
  return { ok: true, removedAliases };
}

function ensureCustomAliasFile() {
  const targetPath = runtimeCustomAliasPath();
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }

  const sourcePath = fs.existsSync(bundledCustomAliasPath) ? bundledCustomAliasPath : null;

  try {
    if (sourcePath) {
      fs.copyFileSync(sourcePath, targetPath);
    } else {
      fs.writeFileSync(targetPath, '{}\n', 'utf-8');
    }
  } catch {
    // If writing fails, later reads/writes will fallback safely.
  }

  return targetPath;
}

function normalizeAlias(value) {
  return String(value || '').trim().replace(/^:/, '').toLowerCase();
}

function buildSearch(items) {
  searchableItems = items;
  fuse = new Fuse(searchableItems, {
    includeScore: true,
    threshold: 0.33,
    keys: ['alias', 'name', 'group', 'keywords', 'canonicalAlias']
  });
}

function addAliasMapping(item) {
  aliasMap.set(item.alias, item);
}

function loadCustomAliases(baseItems) {
  const customAliasPath = ensureCustomAliasFile();
  if (!fs.existsSync(customAliasPath)) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(customAliasPath, 'utf-8'));
  } catch {
    return [];
  }

  const mappings = parsed && typeof parsed === 'object' ? parsed : {};
  const customItems = [];

  for (const [rawShortAlias, rawTargetAlias] of Object.entries(mappings)) {
    const shortAlias = normalizeAlias(rawShortAlias);
    const targetAlias = normalizeAlias(rawTargetAlias);

    if (!shortAlias || !targetAlias) {
      continue;
    }

    if (aliasMap.has(shortAlias)) {
      continue;
    }

    const target = baseItems.find((item) => item.alias === targetAlias);
    if (!target) {
      continue;
    }

    const customItem = {
      ...target,
      alias: shortAlias,
      canonicalAlias: target.alias,
      isCustomAlias: true,
      keywords: Array.from(new Set([...(target.keywords || []), shortAlias]))
    };

    customItems.push(customItem);
    addAliasMapping(customItem);
  }

  return customItems;
}

function loadImportedItems(baseItems) {
  ensureImportedEmojiStorage();
  const importedItems = [];
  const seenAliases = new Set(baseItems.map((item) => item.alias));
  const seenSources = new Set();

  for (const rawItem of readImportedEmojiItems()) {
    const alias = normalizeAlias(rawItem.alias);
    const absolutePath = path.isAbsolute(rawItem.path)
      ? rawItem.path
      : path.join(runtimeUserEmojiDir(), rawItem.path);

    if (!alias || !absolutePath || !fs.existsSync(absolutePath)) {
      continue;
    }

    const ext = path.extname(absolutePath).toLowerCase();
    if (!imageExtensions.has(ext)) {
      continue;
    }

    const sourceKey = normalizePathForComparison(rawItem.importedFrom || rawItem.path);
    if (sourceKey && seenSources.has(sourceKey)) {
      continue;
    }

    if (seenAliases.has(alias)) {
      continue;
    }

    const item = {
      alias,
      name: rawItem.name || path.basename(absolutePath, ext),
      group: rawItem.group || 'Imported',
      path: absolutePath,
      keywords: Array.isArray(rawItem.keywords) ? rawItem.keywords : [slugify(rawItem.name || alias), 'imported'].filter(Boolean),
      isImported: true
    };

    importedItems.push(item);
    seenAliases.add(alias);
    if (sourceKey) {
      seenSources.add(sourceKey);
    }
  }

  return importedItems;
}

function readCustomAliasMappings() {
  const customAliasPath = ensureCustomAliasFile();
  if (!fs.existsSync(customAliasPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(customAliasPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function sanitizeCustomMappings(mappings) {
  const normalized = {};
  const errors = [];
  const baseAliases = new Set(db.items.map((item) => item.alias));

  for (const [rawShort, rawTarget] of Object.entries(mappings || {})) {
    const shortAlias = normalizeAlias(rawShort);
    const targetAlias = normalizeAlias(rawTarget);

    if (!shortAlias || !targetAlias) {
      continue;
    }

    if (!/^[-a-z0-9_]+$/.test(shortAlias)) {
      errors.push(`Invalid short alias: ${rawShort}`);
      continue;
    }

    if (!baseAliases.has(targetAlias)) {
      errors.push(`Target alias not found: ${targetAlias}`);
      continue;
    }

    normalized[shortAlias] = targetAlias;
  }

  return { normalized, errors };
}

function writeCustomAliasMappings(mappings) {
  const { normalized, errors } = sanitizeCustomMappings(mappings);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const customAliasPath = ensureCustomAliasFile();
  try {
    fs.writeFileSync(customAliasPath, JSON.stringify(normalized, null, 2), 'utf-8');
    loadDb();
    return { ok: true, mappings: normalized };
  } catch (error) {
    return { ok: false, errors: [String(error?.message || error)] };
  }
}

function generateUniqueAlias(baseAlias, existingAliases) {
  const normalized = normalizeAlias(baseAlias) || 'emoji';
  let alias = normalized;
  let suffix = 2;

  while (existingAliases.has(alias)) {
    alias = `${normalized}-${suffix}`;
    suffix += 1;
  }

  return alias;
}

function importEmojiPaths(sourcePaths) {
  const files = listImageFiles(sourcePaths);
  if (files.length === 0) {
    return { ok: false, errors: ['No supported image files found.'] };
  }

  ensureImportedEmojiStorage();

  const importedIndex = readImportedEmojiItems();
  const importedSourceKeys = new Set(
    importedIndex.map((item) => normalizePathForComparison(item.importedFrom || item.path))
  );
  const existingAliases = new Set([
    ...db.items.map((item) => item.alias),
    ...importedIndex.map((item) => normalizeAlias(item.alias))
  ]);
  const importedDir = runtimeUserEmojiDir();
  ensureDirectory(importedDir);

  const importedNow = [];
  const skipped = [];
  const importedDirKey = normalizePathForComparison(importedDir);

  for (const sourcePath of files) {
    const ext = path.extname(sourcePath).toLowerCase();
    if (!imageExtensions.has(ext)) {
      continue;
    }

    const sourceKey = normalizePathForComparison(sourcePath);
    if (sourceKey && importedSourceKeys.has(sourceKey)) {
      skipped.push({ sourcePath, reason: 'already_imported' });
      continue;
    }

    if (sourceKey && importedDirKey && sourceKey.startsWith(importedDirKey)) {
      skipped.push({ sourcePath, reason: 'managed_folder' });
      continue;
    }

    const baseAlias = slugify(path.basename(sourcePath, ext)) || 'emoji';
    const alias = generateUniqueAlias(baseAlias, existingAliases);
    const fileName = `${alias}${ext}`;
    const destinationPath = path.join(importedDir, fileName);

    try {
      fs.copyFileSync(sourcePath, destinationPath);
    } catch (error) {
      return { ok: false, errors: [`Failed to import ${path.basename(sourcePath)}: ${String(error?.message || error)}`] };
    }

    importedIndex.push({
      alias,
      name: path.basename(sourcePath, ext),
      group: 'Imported',
      path: destinationPath,
      keywords: Array.from(new Set([slugify(path.basename(sourcePath, ext)), 'imported'].filter(Boolean))),
      importedFrom: sourcePath,
      addedAt: new Date().toISOString()
    });

    importedNow.push({
      alias,
      name: path.basename(sourcePath, ext),
      group: 'Imported',
      path: destinationPath,
      keywords: Array.from(new Set([slugify(path.basename(sourcePath, ext)), 'imported'].filter(Boolean))),
      isImported: true
    });

    existingAliases.add(alias);
    if (sourceKey) {
      importedSourceKeys.add(sourceKey);
    }
  }

  if (importedNow.length === 0) {
    return {
      ok: true,
      imported: [],
      skipped,
      message: skipped.some((item) => item.reason === 'already_imported')
        ? 'This file is already in your imported list.'
        : 'No new emoji files were imported.'
    };
  }

  writeImportedEmojiItems(importedIndex);
  loadDb();

  return { ok: true, imported: importedNow, skipped };
}

function deleteImportedEmoji(alias) {
  const normalizedAlias = normalizeAlias(alias);
  if (!normalizedAlias) {
    return { ok: false, reason: 'invalid_alias' };
  }

  ensureImportedEmojiStorage();

  const importedIndex = readImportedEmojiItems();
  const match = importedIndex.find((item) => normalizeAlias(item.alias) === normalizedAlias);

  if (!match) {
    return { ok: false, reason: 'not_imported' };
  }

  const absolutePath = path.isAbsolute(match.path)
    ? match.path
    : path.join(runtimeUserEmojiDir(), match.path);

  try {
    if (absolutePath && fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch (error) {
    return { ok: false, reason: 'file_delete_failed', error: String(error?.message || error) };
  }

  const remaining = importedIndex.filter((item) => normalizeAlias(item.alias) !== normalizedAlias);
  writeImportedEmojiItems(remaining);
  loadDb();

  return { ok: true, alias: normalizedAlias };
}

function loadDb() {
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Missing emoji index: ${indexPath}. Run: npm run index`);
  }

  const raw = fs.readFileSync(indexPath, 'utf-8');
  db = JSON.parse(raw);

  aliasMap = new Map();
  db.items.forEach((item) => {
    addAliasMapping(item);
  });

  const importedItems = loadImportedItems(db.items);
  // Merge imported items into main db - put imported items first so they display
  db.items = [...importedItems, ...db.items];
  importedItems.forEach((item) => {
    addAliasMapping(item);
  });
  
  const customItems = loadCustomAliases(db.items);
  buildSearch([...customItems, ...db.items]);
}

function toAbsolutePath(relativePath) {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }

  const candidates = [
    path.join(rootDir, relativePath),
    process.resourcesPath ? path.join(process.resourcesPath, relativePath) : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', relativePath) : null
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] || path.join(rootDir, relativePath);
}

function getAll() {
  return db.items;
}

function getBaseAliases() {
  return db.items.map((item) => ({ alias: item.alias, name: item.name, group: item.group }));
}

function getCustomAliases() {
  return readCustomAliasMappings();
}

function getByAlias(alias) {
  return aliasMap.get(normalizeAlias(alias)) || null;
}

function getByAliases(aliases) {
  if (!Array.isArray(aliases)) {
    return [];
  }

  const found = [];
  const seen = new Set();

  for (const alias of aliases) {
    const matched = getByAlias(alias);
    if (!matched || seen.has(matched.alias)) {
      continue;
    }

    seen.add(matched.alias);
    found.push(matched);
  }

  return found;
}

function search(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) {
    return db.items; // Return all items, pagination handled in UI
  }

  const normalized = normalizeAlias(trimmed);
  const hits = fuse.search(normalized).slice(0, 200).map((result) => result.item);

  const exact = getByAlias(normalized);
  if (exact && !hits.find((item) => item.alias === exact.alias)) {
    hits.unshift(exact);
  }

  return hits;
}

loadDb();

module.exports = {
  getAll,
  getBaseAliases,
  getCustomAliases,
  importEmojiPaths,
  deleteImportedEmoji,
  clearImportedEmojiStorage,
  writeCustomAliasMappings,
  getByAlias,
  getByAliases,
  search,
  toAbsolutePath
};
