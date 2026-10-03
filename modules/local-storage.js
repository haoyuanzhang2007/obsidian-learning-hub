// Vault-local hidden plugin state. Never put credentials or learning state in release assets.
const fs = require('fs/promises');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const DATA_FILES = ['data.json', 'study-progress.json', 'study-reader.json', 'vault-guide.json', 'vault-guide-change-log.json'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function createLocalStorage(vaultPath, { pluginId = 'learning-hub', configDir = '.obsidian' } = {}) {
  const vaultRoot = path.resolve(vaultPath);
  const vaultId = digest(vaultRoot).slice(0, 32);
  const root = path.join(vaultRoot, '.learning-hub');
  const configPrefix = `${configDir}/plugins/${pluginId}/`;
  function normalized(value) {
    const parts = String(value).replace(/\\/g, '/').split('/');
    if (parts.some(part => part === '..') || path.isAbsolute(value)) throw new Error('Invalid local data path');
    return parts.filter(part => part && part !== '.').join('/');
  }
  function resolveData(value) {
    const name = normalized(value);
    if (name.startsWith(configPrefix) && DATA_FILES.includes(name.slice(configPrefix.length))) return path.join(root, 'plugin-data', name.slice(configPrefix.length));
    if (name === '.learning-hub' || name.startsWith('.learning-hub/')) return path.join(vaultRoot, name);
    if (name.split('/').some(part => part === '.learning-hub' || part === '.note-data')) return path.join(root, 'vault-data', name);
    return null;
  }
  async function atomicWrite(target, bytes) {
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, bytes, { mode: 0o600 });
      await fs.rename(temp, target);
      await fs.chmod(target, 0o600);
    } finally { await fs.rm(temp, { force: true }); }
  }
  let saveQueue = Promise.resolve();
  function writeJson(name, value) {
    const bytes = JSON.stringify(value, null, 2) + '\n';
    const job = saveQueue.catch(() => {}).then(() => atomicWrite(path.join(root, 'plugin-data', name), bytes));
    saveQueue = job;
    return job;
  }
  async function readJson(name) {
    try { return JSON.parse(await fs.readFile(path.join(root, 'plugin-data', name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function migrate() {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    await fs.chmod(root, 0o700);
    const files = [], directories = [];
    const pluginDirectory = path.join(vaultRoot, configDir, 'plugins', pluginId);
    for (const name of DATA_FILES) {
      const source = path.join(pluginDirectory, name);
      try { if ((await fs.lstat(source)).isFile()) files.push({ source, target: path.join(root, 'plugin-data', name) }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    async function walk(directory, inData = false) {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const source = path.join(directory, entry.name);
        if (source === root) continue;
        if (entry.isSymbolicLink()) { if (inData) throw new Error('Cannot migrate symlinked learning data'); continue; }
        if (entry.isDirectory()) {
          if (!inData && (entry.name.startsWith('.') && !['.learning-hub', '.note-data'].includes(entry.name) || source === path.join(vaultRoot, configDir))) continue;
          const isData = inData || ['.learning-hub', '.note-data'].includes(entry.name);
          if (isData) directories.push(source);
          await walk(source, isData);
        } else if (inData && entry.isFile()) {
          const relative = path.relative(vaultRoot, source);
          files.push({ source, target: path.join(root, 'vault-data', relative) });
        }
      }
    }
    await walk(vaultRoot);
    // Copy all files and verify bytes before deleting any old file.
    for (const item of files) {
      const bytes = await fs.readFile(item.source);
      try {
        const existing = await fs.readFile(item.target);
        if (!existing.equals(bytes)) throw new Error('Local learning data migration conflict; original data preserved');
      } catch (error) { if (error.code !== 'ENOENT') throw error; await atomicWrite(item.target, bytes); }
      if (!(await fs.readFile(item.target)).equals(bytes)) throw new Error('Local learning data verification failed');
      item.sha256 = digest(bytes);
    }
    if (files.length) await atomicWrite(path.join(root, 'migration.json'), JSON.stringify({ version: 1, completedAt: new Date().toISOString(), files: files.map(item => ({ from: path.relative(vaultRoot, item.source), sha256: item.sha256 })) }, null, 2));
    for (const item of files) {
      // Abort cleanup if anything changed while migration was running.
      if (digest(await fs.readFile(item.source)) !== item.sha256) throw new Error('Learning data changed during migration; original preserved');
      await fs.unlink(item.source);
    }
    for (const directory of directories.reverse()) {
      try { await fs.rmdir(directory); } catch (error) { if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error; }
    }
    return { migratedFiles: files.length, root };
  }
  function wrapAdapter(original) {
    const methods = {
      async exists(name) { try { await fs.access(resolveData(name)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } },
      read: name => fs.readFile(resolveData(name), 'utf8'),
      readBinary: async name => { const b = await fs.readFile(resolveData(name)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
      write: (name, text) => atomicWrite(resolveData(name), text),
      writeBinary: (name, data) => atomicWrite(resolveData(name), Buffer.from(data)),
      mkdir: name => fs.mkdir(resolveData(name), { recursive: true, mode: 0o700 }),
      remove: name => fs.unlink(resolveData(name)),
      rmdir: (name, recursive) => recursive ? fs.rm(resolveData(name), { recursive: true }) : fs.rmdir(resolveData(name)),
      async rename(from, to) {
        const source = resolveData(from), target = resolveData(to);
        if (!source || !target) throw new Error('Cannot move learning data outside local storage');
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        try { await fs.access(target); throw new Error('Learning data destination already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        return fs.rename(source, target);
      },
      async stat(name) { try { const s = await fs.stat(resolveData(name)); return { type: s.isDirectory() ? 'folder' : 'file', ctime: s.birthtimeMs, mtime: s.mtimeMs, size: s.size }; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
      async list(name) { const entries = await fs.readdir(resolveData(name), { withFileTypes: true }); return { files: entries.filter(e => e.isFile()).map(e => `${name}/${e.name}`), folders: entries.filter(e => e.isDirectory()).map(e => `${name}/${e.name}`) }; },
    };
    return new Proxy(original, { get(target, key) {
      if (methods[key]) return (...args) => resolveData(args[0]) ? methods[key](...args) : target[key](...args);
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
  return { root, vaultId, migrate, readJson, writeJson, resolveData, wrapAdapter };
}

async function initializeLocalStorage(host) {
  const originalApp = host.app, vault = originalApp.vault;
  const storage = createLocalStorage(vault.adapter.getBasePath(), { pluginId: host.manifest.id, configDir: vault.configDir });
  await storage.migrate();
  host.localStorage = storage;
  host.loadData = () => storage.readJson('data.json');
  host.saveData = value => storage.writeJson('data.json', value);
  const adapter = storage.wrapAdapter(vault.adapter);
  const localVault = new Proxy(vault, { get(target, key) { if (key === 'adapter') return adapter; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
  host.app = new Proxy(originalApp, { get(target, key) { if (key === 'vault') return localVault; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
  // Discard the old shared cache so it cannot retain the vault adapter after reload.
  delete originalApp.__studyNoteDataStore;
  return storage;
}
module.exports = { DATA_FILES, createLocalStorage, initializeLocalStorage };
