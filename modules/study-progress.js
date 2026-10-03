const getStore=(()=>{
const {normalizePath}=require('obsidian');
function directory(path){const parts=path.split('/');const name=parts.pop();if(!name?.endsWith('.md')||parts.some(p=>p==='..'||p.startsWith('.')))throw Error('无效笔记路径');return normalizePath([...parts,'.note-data',name.slice(0,-3)].join('/'));}
class Store{
 constructor(app){this.app=app;this.adapter=app.vault.adapter;this.queue=Promise.resolve();this.cache={};}
 serial(fn){const job=this.queue.catch(()=>{}).then(fn);this.queue=job;return job;}
 async read(path,name){const target=directory(path)+'/'+name;if(!await this.adapter.exists(target))return null;const value=JSON.parse(await this.adapter.read(target));if(value.version!==1)throw Error('附加数据版本不支持：'+target);return value;}
 async ensure(path){const dir=directory(path);let current='';for(const part of dir.split('/')){current=current?current+'/'+part:part;if(!await this.adapter.exists(current))await this.adapter.mkdir(current);}const target=dir+'/metadata.json';let metadata=await this.read(path,'metadata.json');if(!metadata)metadata={version:1,id:globalThis.crypto.randomUUID(),createdAt:new Date().toISOString()};if(metadata.notePath!==path){metadata.notePath=path;metadata.updatedAt=new Date().toISOString();await this.adapter.write(target,JSON.stringify(metadata,null,2));}}
 async load(name){const records={};for(const file of this.app.vault.getMarkdownFiles()){if(file.path.split('/').some(p=>p.startsWith('.')))continue;const value=await this.read(file.path,name);if(value)records[file.path]=value;}return records;}
 save(name,records){const snapshot=JSON.parse(JSON.stringify(records));return this.serial(async()=>{const previous=this.cache[name]||{};for(const path of new Set([...Object.keys(previous),...Object.keys(snapshot)])){const value=snapshot[path],encoded=value?JSON.stringify(value):null;if(previous[path]===encoded)continue;if(!this.app.vault.getAbstractFileByPath(path))continue;const target=directory(path)+'/'+name;if(value){await this.ensure(path);await this.adapter.write(target,JSON.stringify({...value,updatedAt:new Date().toISOString()},null,2));}else if(await this.adapter.exists(target))await this.adapter.remove(target);}this.cache[name]=Object.fromEntries(Object.entries(snapshot).map(([p,v])=>[p,JSON.stringify(v)]));});}
 move(oldPath,newPath){return this.serial(async()=>{if(oldPath.endsWith('.md')&&newPath.endsWith('.md')){const old=directory(oldPath),next=directory(newPath);if(old!==next&&await this.adapter.exists(old)){if(await this.adapter.exists(next))throw Error('目标已有附加数据，未覆盖：'+next);const parent=next.slice(0,next.lastIndexOf('/'));if(!await this.adapter.exists(parent))await this.adapter.mkdir(parent);await this.adapter.rename(old,next);}}for(const file of this.app.vault.getMarkdownFiles()){if(file.path===newPath||file.path.startsWith(newPath+'/')){if(await this.adapter.exists(directory(file.path)))await this.ensure(file.path);}}for(const name of Object.keys(this.cache)){const cache=this.cache[name];for(const p of Object.keys(cache))if(p===oldPath||p.startsWith(oldPath+'/')){cache[newPath+p.slice(oldPath.length)]=cache[p];delete cache[p];}}});}
}
return {directory,getStore(app){return app.__studyNoteDataStore||(app.__studyNoteDataStore=new Store(app));}};

})().getStore;
const { Plugin, PluginSettingTab, Setting, MarkdownView, Notice, normalizePath } = require('obsidian');

const DEFAULT_COURSES = [];
const DEFAULTS = {
  useCourseIndex: true,
  semesterCourses: DEFAULT_COURSES
};
const STUDY_ROOT = 'Courses/';
const COURSE_INDEX = 'Courses/Courses.md';
const STAGES = [
  { key: 'previewed', label: '已预习' },
  { key: 'learned', label: '已学习' },
  { key: 'reviewed', label: '已复习' }
];
function complete(value) { return value === true || value === 'true'; }

function progress(frontmatter) {
  return STAGES.map((stage) => complete(frontmatter?.[stage.key]));
}

function studyFile(file, frontmatter) {
  return file.path.startsWith(STUDY_ROOT) || complete(frontmatter?.study);
}

function courseFolder(file) {
  if (!file.path.startsWith(STUDY_ROOT)) return '';
  return file.path.slice(STUDY_ROOT.length).split('/')[0];
}

function lessonPage(file) {
  if (!file?.path?.startsWith(STUDY_ROOT) || !file.path.endsWith('.md')) return false;
  const parts = file.path.slice(STUDY_ROOT.length).split('/');
  const title = parts.at(-1).slice(0, -3);
  if (!/^L\d+(?:\b|[_-])/.test(title)) return false;
  return parts.length === 2 || (parts.length === 3 && parts[1] === title);
}

function currentCoursesFromIndex(markdown) {
  const current = String(markdown).split(/^#\s+All Courses\s*$/m)[0];
  const folders = new Set();
  for (const match of current.matchAll(/\]\(([^)]+)\)/g)) {
    let target = match[1];
    try { target = decodeURIComponent(target); } catch (_) { /* Keep original path. */ }
    const folder = target.split('/')[0];
    if (/^[A-Z]{4}\s+\d{4}\b/.test(folder)) folders.add(folder);
  }
  return Array.from(folders);
}

function arcPath(index) {
  const start = -90 + index * 120 + 5;
  const end = -90 + (index + 1) * 120 - 5;
  const point = (angle) => {
    const radians = angle * Math.PI / 180;
    return [32 + 23 * Math.cos(radians), 32 + 23 * Math.sin(radians)];
  };
  const [x1, y1] = point(start);
  const [x2, y2] = point(end);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A 23 23 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function ring(parent, values, small = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', STAGES.map((stage, index) =>
    stage.label + (values[index] ? '完成' : '未完成')).join('、'));
  svg.classList.add('study-progress-ring');
  if (small) svg.classList.add('is-small');
  for (let index = 0; index < STAGES.length; index++) {
    for (const kind of ['track', 'part']) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', arcPath(index));
      path.setAttribute('pathLength', '100');
      path.classList.add('study-progress-ring-' + kind);
      svg.appendChild(path);
    }
  }
  const disc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  disc.setAttribute('cx', '32'); disc.setAttribute('cy', '32'); disc.setAttribute('r', '28');
  disc.classList.add('study-progress-success-disc');
  svg.appendChild(disc);
  const check = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  check.setAttribute('d', 'M 18 32 L 28 42 L 46 23');
  check.setAttribute('pathLength', '100');
  check.classList.add('study-progress-success-check');
  svg.appendChild(check);
  parent.appendChild(svg);
  updateRing(svg, values);
  return svg;
}

function updateRing(svg, values) {
  const signature = values.map(Boolean).map(Number).join('');
  if (svg.dataset.progress === signature) return;
  svg.dataset.progress = signature;
  svg.setAttribute('aria-label', STAGES.map((stage, index) =>
    stage.label + (values[index] ? '完成' : '未完成')).join('、'));
  svg.querySelectorAll('.study-progress-ring-part').forEach((part, index) =>
    part.classList.toggle('is-complete', values[index]));
  svg.classList.toggle('is-finished', values.every(Boolean));
}

function syncRing(host, values) {
  const svg = host.querySelector('.study-progress-ring');
  if (!svg) return ring(host, values, true);
  updateRing(svg, values);
  return svg;
}

function linkTarget(raw) {
  if (!raw || raw.startsWith('#')) return '';
  let value = raw;
  try { value = decodeURIComponent(raw); } catch (_) { /* Obsidian may already provide decoded paths. */ }
  return value.split('#')[0].replace(/\.md$/i, '');
}

class StudySettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const root = this.containerEl;
    root.empty();
    root.createEl('h2', { text: '学习进度圆环' });
    new Setting(root).setName('自动识别本学期课程')
      .setDesc('读取 Courses/Courses.md 中「All Courses」标题之前的课程链接。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.useCourseIndex)
        .onChange(async (value) => {
          this.plugin.settings.useCourseIndex = value;
          await this.plugin.persistState();
          await this.plugin.reloadCourses();
          this.display();
        }));
    if (!this.plugin.settings.useCourseIndex) {
      new Setting(root).setName('手动课程名单')
        .setDesc('每行一个 Courses 下的课程文件夹名。')
        .addTextArea((input) => input.setValue(this.plugin.settings.semesterCourses.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.semesterCourses = value.split('\n').map((line) => line.trim()).filter(Boolean);
            await this.plugin.persistState();
            await this.plugin.reloadCourses();
          }));
    }
  }
}
module.exports = class StudyProgress {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.store=getStore(this.app);
    const records=await this.store.load('progress.json');
    this.store.cache['progress.json']=Object.fromEntries(Object.entries(records).map(([p,v])=>[p,JSON.stringify(v)]));
    this.settings.progressByPath||={};this.settings.studyPaths||={};this.settings.ringOverrides||={};
    for(const [path,r] of Object.entries(records)){this.settings.progressByPath[path]=r.stages||{};if(typeof r.ringOverride==='boolean')this.settings.ringOverrides[path]=r.ringOverride;if(r.manualStudy)this.settings.studyPaths[path]=true;}
    if (!Array.isArray(this.settings.semesterCourses)) this.settings.semesterCourses = DEFAULT_COURSES;
    this.currentCourses = new Set(this.settings.semesterCourses);
    this.settings.progressByPath ||= {};
    this.settings.studyPaths ||= {};
    this.settings.ringOverrides ||= {};
    this.saveQueue = Promise.resolve();
    await this.persistState();
    this.linkSources = new WeakMap();
    this.refreshTimer = null;
    this.addSettingTab(new StudySettings(this.app, this));
    this.addCommand({ id: 'mark-study-note', name: '为当前页面添加学习圆环', callback: () => this.markCurrentNote() });
    this.addCommand({ id: 'remove-study-ring', name: '移除当前页面的学习圆环', callback: () => {
      const file = this.app.workspace.getActiveFile();
      if (file?.extension === 'md') void this.setRingEnabled(file, false);
    } });
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file?.extension !== 'md') return;
      const enabled = this.hasRing(file);
      menu.addItem((item) => item.setTitle(enabled ? '移除学习圆环' : '添加学习圆环')
        .setIcon(enabled ? 'circle-minus' : 'circle-plus')
        .onClick(() => this.setRingEnabled(file, !enabled)));
    }));
    for (const stage of STAGES) {
      this.addCommand({ id: 'toggle-' + stage.key, name: '切换' + stage.label,
        callback: () => this.toggleCurrentStage(stage.key) });
    }
    this.registerMarkdownPostProcessor((element, context) => {
      for (const link of element.querySelectorAll('a.internal-link')) {
        this.linkSources.set(link, context.sourcePath);
      }
      this.decorateLinks(element, context.sourcePath);
    });
    const refresh = () => this.scheduleRefresh();
    this.registerEvent(this.app.workspace.on('active-leaf-change', refresh));
    this.registerEvent(this.app.workspace.on('file-open', () => { this.closeStagePicker(); refresh(); }));
    this.registerEvent(this.app.workspace.on('layout-change', refresh));
    this.registerEvent(this.app.metadataCache.on('changed', refresh));
    this.registerEvent(this.app.vault.on('create', refresh));
    this.registerEvent(this.app.vault.on('delete', refresh));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      void this.moveStoredState(oldPath, file.path);
      refresh();
    }));
    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (file?.path === COURSE_INDEX) void this.reloadCourses();
      refresh();
    }));
    this.app.workspace.onLayoutReady(async () => {
      try {
        await this.migrateProgress();
        await this.reloadCourses();
      } catch (error) { console.error('Study Progress:', error); }
      const observer = new MutationObserver((mutations) => {
        const selector = '.inline-title, a.internal-link';
        if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) =>
          node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))))) {
          this.scheduleRefresh();
        }
      });
      observer.observe(this.app.workspace.containerEl || document.body, { childList: true, subtree: true });
      this.register(() => observer.disconnect());
      this.scheduleRefresh();
    });
    this.register(() => {
      if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
      for (const host of document.querySelectorAll('.study-progress-title-ring, .study-progress-link-ring')) host.remove();
      this.closeStagePicker();
    });
  }

  async markCurrentNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') return new Notice('请先打开一篇 Markdown 笔记');
    await this.setRingEnabled(file, true);
  }

  async setRingEnabled(file, enabled) {
    this.settings.ringOverrides[file.path] = enabled;
    if (enabled) this.settings.studyPaths[file.path] = true;
    this.closeStagePicker();
    await this.persistState();
    this.app.workspace.trigger('study-progress:progress-change', file);
    this.scheduleRefresh();
    new Notice(enabled ? '已添加学习圆环' : '已移除学习圆环，进度已保留');
  }

  async toggleCurrentStage(key) {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') return new Notice('请先打开一篇 Markdown 笔记');
    await this.toggleStage(file, key);
  }

  async toggleStage(file, key) {
    if (!STAGES.some((stage) => stage.key === key)) return;
    if (!this.hasRing(file)) return new Notice('该页面未启用学习圆环');
    const values = this.stateFor(file);
    this.settings.progressByPath[file.path] = { ...values, [key]: !complete(values[key]) };
    await this.persistState();
    this.app.workspace.trigger('study-progress:progress-change', file);
    this.scheduleRefresh();
  }

  async setStage(file, key, value) {
    if (!STAGES.some((stage) => stage.key === key) || !file?.path) return;
    const current = this.stateFor(file);
    const next = Boolean(value);
    if (complete(current[key]) === next) return;
    this.settings.progressByPath[file.path] = { ...current, [key]: next };
    await this.persistState();
    this.app.workspace.trigger('study-progress:progress-change', file);
    this.scheduleRefresh();
  }

  stateFor(file) {
    return { previewed: false, learned: false, reviewed: false,
      ...this.settings.progressByPath[file.path], study: !!this.settings.studyPaths[file.path] };
  }

  persistState(){const snapshot=JSON.parse(JSON.stringify(this.settings));const records={};for(const path of new Set([...Object.keys(snapshot.progressByPath),...Object.keys(snapshot.studyPaths),...Object.keys(snapshot.ringOverrides)])){records[path]={version:1,stages:snapshot.progressByPath[path]||{},manualStudy:!!snapshot.studyPaths[path]};if(typeof snapshot.ringOverrides[path]==='boolean')records[path].ringOverride=snapshot.ringOverrides[path];}const settings={...snapshot,storageVersion:1};delete settings.progressByPath;delete settings.studyPaths;delete settings.ringOverrides;this.saveQueue=this.saveQueue.catch(()=>{}).then(async()=>{await this.store.save('progress.json',records);await this.saveData(settings);});return this.saveQueue;}

  async migrateProgress() {
    if (this.settings.progressStorageVersion === 1) return;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const legacy = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      if (STAGES.some((stage) => legacy[stage.key] != null) &&
          !Object.prototype.hasOwnProperty.call(this.settings.progressByPath, file.path)) {
        this.settings.progressByPath[file.path] = Object.fromEntries(
          STAGES.map((stage) => [stage.key, complete(legacy[stage.key])]));
      }
      if (complete(legacy.study)) this.settings.studyPaths[file.path] = true;
    }
    this.settings.progressStorageVersion = 1;
    await this.persistState();
  }

  async moveStoredState(oldPath, newPath) {
    await this.store.move(oldPath,newPath);
    let changed = false;
    for (const store of [this.settings.progressByPath, this.settings.studyPaths, this.settings.ringOverrides]) {
      for (const key of Object.keys(store)) {
        if (key === oldPath || key.startsWith(oldPath + '/')) {
          store[newPath + key.slice(oldPath.length)] = store[key];
          delete store[key];
          changed = true;
        }
      }
    }
    if (changed) await this.persistState();
  }

  async reloadCourses() {
    const fallback = this.settings.semesterCourses;
    let names = fallback;
    if (this.settings.useCourseIndex) {
      const file = this.app.vault.getAbstractFileByPath(COURSE_INDEX);
      if (file?.extension === 'md') {
        const parsed = currentCoursesFromIndex(await this.app.vault.cachedRead(file));
        if (parsed.length) names = parsed;
      }
    }
    this.currentCourses = new Set(names);
    this.scheduleRefresh();
  }

  hasRing(file) {
    if (!file?.path?.endsWith('.md')) return false;
    const override = this.settings.ringOverrides?.[file.path];
    if (typeof override === 'boolean') return override;
    return !!this.settings.studyPaths[file.path] ||
      (this.currentCourses.has(courseFolder(file)) && lessonPage(file));
  }

  scheduleRefresh() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshDecorations();
    }, 80);
  }

  refreshDecorations() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const file = view.file;
      for (const title of view.containerEl.querySelectorAll('.inline-title')) {
        const existing = title.querySelector(':scope > .study-progress-title-ring');
        if (!file || !this.hasRing(file)) { existing?.remove(); continue; }
        const host = existing || document.createElement('button');
        if (!existing) {
          host.type = 'button';
          host.className = 'study-progress-title-ring';
          host.setAttribute('contenteditable', 'false');
          host.setAttribute('aria-haspopup', 'dialog');
          host.setAttribute('aria-expanded', 'false');
          host.addEventListener('mousedown', (event) => event.stopPropagation());
          host.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const target = this.app.vault.getAbstractFileByPath(host.dataset.notePath);
            if (target) this.showStagePicker(target, host);
          });
          title.appendChild(host);
        }
        host.dataset.notePath = file.path;
        const values = progress(this.stateFor(file));
        syncRing(host, values);
        host.setAttribute('aria-label', `学习进度：${values.filter(Boolean).length}/3。点击修改`);
      }
      this.decorateLinks(view.containerEl, file?.path || '');
    }
  }

  showStagePicker(file, anchor) {
    if (this.stagePicker?.anchor === anchor) { this.closeStagePicker(); return; }
    this.closeStagePicker();
    const panel = document.createElement('div');
    panel.className = 'study-progress-stage-picker';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '修改学习进度');
    panel.createDiv({ text: '学习进度', cls: 'study-progress-picker-heading' });
    const buttons = [];
    const update = () => {
      const values = progress(this.stateFor(file));
      buttons.forEach((button, index) => {
        button.classList.toggle('is-done', values[index]);
        button.setAttribute('aria-pressed', String(values[index]));
        button.querySelector('.study-progress-picker-state').textContent = values[index] ? '已完成' : '标记完成';
      });
      next.textContent = values.every(Boolean) ? '全部完成 ✓' : '完成下一步 · ' + STAGES[values.findIndex((value) => !value)].label;
      next.disabled = values.every(Boolean);
      next.classList.toggle('is-finished', values.every(Boolean));
    };
    const change = async (key) => {
      buttons.forEach((button) => { button.disabled = true; });
      next.disabled = true;
      try {
        await this.toggleStage(file, key);
        this.refreshDecorations();
      } catch (error) {
        console.error('Study Progress progress:', error);
        new Notice('进度保存失败，请重试');
      } finally {
        buttons.forEach((button) => { button.disabled = false; });
        update();
      }
    };
    STAGES.forEach((stage, index) => {
      const button = panel.createEl('button', { cls: 'study-progress-picker-row', attr: { type: 'button' } });
      button.createSpan({ cls: 'study-progress-picker-dot', attr: { 'aria-hidden': 'true' } });
      button.createSpan({ text: stage.label, cls: 'study-progress-picker-label' });
      button.createSpan({ cls: 'study-progress-picker-state' });
      button.onclick = () => { void change(stage.key); };
      buttons.push(button);
    });
    const next = panel.createEl('button', { cls: 'study-progress-picker-next', attr: { type: 'button' } });
    next.onclick = () => {
      const index = progress(this.stateFor(file)).findIndex((value) => !value);
      if (index >= 0) void change(STAGES[index].key);
    };
    const remove = panel.createEl('button', { text: '移除这个页面的圆环', cls: 'study-progress-picker-remove', attr: { type: 'button' } });
    remove.onclick = () => { void this.setRingEnabled(file, false); };
    update();
    document.body.appendChild(panel);
    const rect = anchor.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    panel.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - bounds.width - 12)) + 'px';
    panel.style.top = (rect.bottom + bounds.height + 8 < window.innerHeight
      ? rect.bottom + 8 : Math.max(12, rect.top - bounds.height - 8)) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    const outside = (event) => {
      if (!panel.contains(event.target) && !anchor.contains(event.target)) this.closeStagePicker();
    };
    const keyboard = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); this.closeStagePicker(true); }
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : 2) + 3) % 3].focus();
      }
    };
    const scroll = (event) => { if (event.type === 'resize' || !panel.contains(event.target)) this.closeStagePicker(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    panel.addEventListener('keydown', keyboard);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    this.stagePicker = { panel, anchor, cleanup: () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', scroll);
    } };
    buttons[0].focus({ preventScroll: true });
  }

  closeStagePicker(restoreFocus = false) {
    const picker = this.stagePicker;
    if (!picker) return;
    this.stagePicker = null;
    picker.cleanup();
    picker.panel.remove();
    picker.anchor.setAttribute('aria-expanded', 'false');
    if (restoreFocus && picker.anchor.isConnected) picker.anchor.focus({ preventScroll: true });
  }

  decorateLinks(container, sourcePath) {
    for (const link of container.querySelectorAll('a.internal-link')) {
      const raw = link.getAttribute('data-href') || link.getAttribute('href');
      const target = linkTarget(raw);
      const existing = link.querySelector(':scope > .study-progress-link-ring');
      const context = this.linkSources.get(link) || sourcePath;
      const file = target && this.app.metadataCache.getFirstLinkpathDest(target, context);
      if (!file || !this.hasRing(file)) { existing?.remove(); continue; }
      const host = existing || document.createElement('span');
      if (!existing) {
        host.className = 'study-progress-link-ring';
        host.setAttribute('aria-hidden', 'true');
        link.appendChild(host);
      }
      syncRing(host, progress(this.stateFor(file)));
    }
  }

};
