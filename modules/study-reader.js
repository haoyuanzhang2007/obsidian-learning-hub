function toAISelection(s){return s?{...s,sourcePath:s.filePath,range:s.liveRange||s.range,formulaElement:s.liveElement||s.formulaElement,latex:s.latex||s.anchor?.latex,block:s.block??s.text?.startsWith('$$')}:null;}
const selectionService=(()=>{const module={exports:{}};
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
const { Plugin, ItemView, MarkdownView, Notice, setIcon, MarkdownRenderer, Component } = require('obsidian');
const TOOLBAR = 'study-selection-toolbar';
const HIGHLIGHT = 'margin-notes-anchors';
const FORMULA_SOURCES = new WeakMap();

function packAnnotations(items,gap=12){let end=0;return items.map(item=>{const top=Math.max(end,item.top,0);end=top+item.height+gap;return {...item,top};});}
function safeMarkdown(content) {
  const plain = (value) => value
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body) => '\n\n$$\n' + body.trim() + '\n$$\n\n')
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body) => '$' + body.trim() + '$');
  const protectedCode = /(^\s{0,3}(?:```|~~~)[^\n]*\n[\s\S]*?^\s{0,3}(?:```|~~~)[ \t]*$|`+[^`\n]*`+)/gm;
  let result = '';
  let previous = 0;
  for (const match of content.matchAll(protectedCode)) {
    result += plain(content.slice(previous, match.index)) + match[0];
    previous = match.index + match[0].length;
  }
  return (result + plain(content.slice(previous))).replace(/^(\s*)```mermaid\b/gim, '$1```text');
}

function sourceOffset(source, pos) {
  const lines = source.split('\n');
  let offset = 0;
  for (let i = 0; i < pos.line; i++) offset += lines[i].length + 1;
  return offset + pos.ch;
}

function nodePath(root, node) {
  const path = [];
  while (node && node !== root) {
    const parent = node.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, node));
    node = parent;
  }
  return node === root ? path : null;
}

function nodeAt(root, path) {
  let node = root;
  for (const index of path || []) {
    node = node?.childNodes?.[index];
    if (!node) return null;
  }
  return node;
}

function sameText(a, b) {
  return String(a).replace(/\s+/g, ' ').trim() === String(b).replace(/\s+/g, ' ').trim();
}

function formulaNodes(root) {
  return Array.from(root.querySelectorAll('.math, .katex, mjx-container')).filter((element) =>
    !element.parentElement?.closest('.math, .katex, mjx-container'));
}

function isBlockFormula(element) {
  return element.matches('.math-block') || element.closest?.('.el-math') != null ||
    element.querySelector?.('mjx-container[display="true"]') != null;
}

function recordFormulaSources(element, context) {
  const assign = (container, source) => {
    if (!source || !container?.querySelectorAll) return;
    const sources = sourceFormulas(source);
    const rendered = formulaNodes(container);
    for (const block of [false, true]) {
      const expected = sources.filter((item) => item.block === block);
      const actual = rendered.filter((item) => isBlockFormula(item) === block);
      if (expected.length && expected.length === actual.length) {
        actual.forEach((item, index) => FORMULA_SOURCES.set(item, expected[index]));
      }
    }
  };
  assign(element, context.getSectionInfo?.(element)?.text);
  for (const formula of formulaNodes(element)) {
    if (FORMULA_SOURCES.has(formula)) continue;
    const container = formula.closest?.('.el-math, .el-p, .el-li, .el-table, p, li, tr') || formula;
    assign(container, context.getSectionInfo?.(formula)?.text);
  }
}

function formulaLatex(element) {
  const direct = element?.getAttribute?.('data-tex') || element?.getAttribute?.('data-latex') ||
    element?.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
  if (direct?.trim()) return direct.trim();
  const container = element?.matches?.('mjx-container') ? element : element?.querySelector?.('mjx-container');
  if (!container) return FORMULA_SOURCES.get(element)?.latex || '';
  try {
    for (const item of window.MathJax?.startup?.document?.math || []) {
      if (item.typesetRoot === container) return item.math?.trim() || '';
    }
  } catch {}
  return FORMULA_SOURCES.get(element)?.latex || '';
}

function sourceFormulas(source) {
  let fence = null;
  const clean = source.split('\n').map((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return ' '.repeat(line.length);
    }
    if (fence) return ' '.repeat(line.length);
    return line.replace(/(`+)([^`]*?)\1/g, (part) => ' '.repeat(part.length));
  }).join('\n');
  const formulas = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] !== '$' || clean[i - 1] === '\\') continue;
    const count = clean[i + 1] === '$' ? 2 : 1;
    let end = i + count;
    while (end < clean.length) {
      if (count === 1 && clean[end] === '\n') break;
      if (clean[end] === '$' && clean[end - 1] !== '\\' &&
          (count === 1 ? clean[end + 1] !== '$' : clean[end + 1] === '$')) break;
      end++;
    }
    if (end < clean.length && clean[end] === '$') {
      const latex = source.slice(i + count, end).trim();
      if (latex) formulas.push({ latex, block: count === 2, start: i, end: end + count });
      i = end + count - 1;
    }
  }
  return formulas;
}

function inlineFormulaFromParagraph(source, element) {
  const paragraph = element.closest?.('p, li, td, th, h1, h2, h3, h4, h5, h6');
  if (!paragraph) return null;
  const rendered = formulaNodes(paragraph).filter((item) => !isBlockFormula(item));
  const ordinal = rendered.indexOf(element);
  if (ordinal < 0) return null;
  const skeleton = (node) => {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    if (node.matches?.('.math, .katex, mjx-container')) return '§';
    return Array.from(node.childNodes).map(skeleton).join('');
  };
  const normalize = (value) => value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+)/, '')
    .replace(/[\u200b\u00a0]/g, ' ')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ').trim();
  const expected = normalize(skeleton(paragraph));
  const matches = [];
  for (const line of source.split('\n')) {
    const formulas = sourceFormulas(line).filter((item) => !item.block);
    if (!paragraph.matches?.('td, th') && formulas.length !== rendered.length) continue;
    let text = '';
    let previous = 0;
    for (const item of formulas) {
      text += line.slice(previous, item.start) + '§';
      previous = item.end;
    }
    text += line.slice(previous);
    if (formulas.length === rendered.length && normalize(text) === expected) matches.push(formulas[ordinal]);
    if (paragraph.matches?.('td, th')) {
      const cellIndex = Number.isInteger(paragraph.cellIndex) ? paragraph.cellIndex : -1;
      const targetIndex = cellIndex + (text.startsWith('|') ? 1 : 0);
      let used = 0;
      for (const [index, cell] of text.split('|').entries()) {
        const count = (cell.match(/§/g) || []).length;
        if (index === targetIndex && count === rendered.length && normalize(cell) === expected) {
          matches.push(formulas[used + ordinal]);
        }
        used += count;
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function sourceFormulaFor(source, root, element) {
  if (!isBlockFormula(element)) {
    const inline = inlineFormulaFromParagraph(source, element);
    if (inline) return inline;
  }
  const formulas = sourceFormulas(source);
  const block = element.closest?.('.el-math, .el-p, .el-li, .el-table, p, li, tr') || element;
  let previous = block.previousElementSibling;
  while (previous && !previous.textContent?.trim()) previous = previous.previousElementSibling;
  const label = previous?.textContent?.trim();
  if (label && label.length <= 120) {
    const matches = formulas.filter((item) => source.slice(0, item.start).trimEnd().endsWith(label));
    if (matches.length === 1) return matches[0];
  }
  const lineElement = element.closest?.('[data-line]');
  const line = Number(lineElement?.getAttribute?.('data-line'));
  if (lineElement && Number.isInteger(line) && line >= 0) {
    const matches = formulas.filter((item) => {
      const sourceLine = source.slice(0, item.start).split('\n').length - 1;
      return sourceLine === line;
    });
    if (matches.length === 1) return matches[0];
  }
  const heading = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .filter((item) => item.compareDocumentPosition(element) & 4).at(-1);
  if (heading) {
    const headingText = heading.textContent?.replace(/\s+/g, ' ').trim();
    const sourceHeadings = Array.from(source.matchAll(/^#{1,6}\s+(.+?)\s*$/gm));
    const normalizedHeading=value=>String(value).replace(/\$[^$]+\$/g,'').replace(/[*_~`]/g,'').replace(/\s+/g,' ').trim();
    const matching = sourceHeadings.filter(match=>normalizedHeading(match[1])===normalizedHeading(headingText));
    if (matching.length === 1) {
      const start = matching[0].index + matching[0][0].length;
      const next = sourceHeadings.find((match) => match.index > start);
      const end = next?.index ?? source.length;
      const candidates = formulas.filter((item) => item.start >= start && item.start < end &&
        item.block === isBlockFormula(element));
      const following=Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).find(node=>heading.compareDocumentPosition(node)&4);
      const renderedSection=formulaNodes(root).filter(node=>isBlockFormula(node)===isBlockFormula(element)&&(heading.compareDocumentPosition(node)&4)&&(!following||(node.compareDocumentPosition(following)&4)));
      const ordinal=renderedSection.indexOf(element);
      if(ordinal>=0&&renderedSection.length===candidates.length)return candidates[ordinal];
    }
  }
  const rendered = formulaNodes(root);
  const index = rendered.indexOf(element);
  if(index>=0&&rendered.length===formulas.length&&rendered.every((node,i)=>isBlockFormula(node)===formulas[i].block))return formulas[index];
  return null;
}

async function formulaAtEvent(app, event) {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view?.file || view.getMode() !== 'preview') return null;
  const root = view.containerEl.querySelector('.markdown-preview-view');
  const element = event?.target?.closest?.('.math, .katex, mjx-container');
  if (!root || !element || !root.contains(element)) return null;
  const outer = element.closest('.math') || element.closest('.katex') || element;
  const allNodes = formulaNodes(root);
  const index = allNodes.indexOf(outer);
  if (index < 0) return null;
  let latex = formulaLatex(outer);
  let block = isBlockFormula(outer);
  if (!latex) {
    const source = await app.vault.cachedRead(view.file);
    const fromSource = sourceFormulaFor(source, root, outer);
    if (fromSource) { latex = fromSource.latex; block = fromSource.block; }
  }
  if(!latex){
    const source=await app.vault.cachedRead(view.file);
    const all=sourceFormulas(source).filter(item=>item.block===block);
    const heading=Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(h=>h.compareDocumentPosition(outer)&4).at(-1);
    let candidates=all;
    if(heading){const normalized=value=>String(value).replace(/\$[^$]+\$/g,'').replace(/[*_~`]/g,'').replace(/\s+/g,' ').trim();const headings=Array.from(source.matchAll(/^#{1,6}\s+(.+?)\s*$/gm));const matching=headings.filter(h=>normalized(h[1])===normalized(heading.textContent));if(matching.length===1){const start=matching[0].index+matching[0][0].length,next=headings.find(h=>h.index>start)?.index??source.length;candidates=all.filter(f=>f.start>=start&&f.start<next);}}
    if(candidates.length===1)latex=candidates[0].latex;
    else {const rect=outer.getBoundingClientRect();return{filePath:view.file.path,text:'公式（待选择源码）',mode:'preview',offset:null,rect:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom},anchor:{kind:'math',elementPath:nodePath(root,outer),latex:'',index:allNodes.indexOf(outer),occurrence:0},liveElement:outer,formulaElements:[outer],formulaCandidates:candidates.map(f=>f.latex),block};}
  }

  const rect = outer.getBoundingClientRect();
  const nodes = allNodes.filter((item) => formulaLatex(item) === latex);
  const delimiter = block ? '$$' : '$';
  return { filePath: view.file.path, text: delimiter + latex + delimiter, mode: 'preview', offset: null,
    rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    anchor: { kind: 'math', elementPath: nodePath(root, outer), latex, index,
      occurrence: nodes.indexOf(outer) },
    liveElement: outer, formulaElements: [outer] };
}

function restoreFormula(root, anchor) {
  if (anchor?.kind !== 'math') return null;
  const nodes = formulaNodes(root);
  const byPath = nodeAt(root, anchor.elementPath);
  if (byPath?.nodeType === 1 && nodes.includes(byPath) &&
      (formulaLatex(byPath) === anchor.latex || (!formulaLatex(byPath) && nodes.indexOf(byPath) === anchor.index))) return byPath;
  const matches = nodes.filter((item) => formulaLatex(item) === anchor.latex);
  return matches[anchor.occurrence || 0] || nodes[anchor.index] || null;
}

function tableSelectionMarkdown(table,range,visit,whole){
 const rows=Array.from(table.rows||[]),grid=[];
 for(let r=0;r<rows.length;r++){grid[r]||=[];let col=0;for(const cell of Array.from(rows[r].cells||[])){while(grid[r][col])col++;const selected=range.intersectsNode(cell),text=selected?visit(cell):'';const entry={cell,selected,text};const height=Math.max(1,cell.rowSpan||1),width=Math.max(1,cell.colSpan||1);for(let y=r;y<Math.min(rows.length,r+height);y++){grid[y]||=[];for(let x=col;x<col+width;x++)grid[y][x]=entry;}col+=width;}}
 const selectedRows=grid.map((cells,r)=>({cells,r})).filter(row=>row.cells.some(c=>c?.selected&&c.text.trim()));if(!selectedRows.length)return '';
 const columns=[...new Set(selectedRows.flatMap(row=>row.cells.flatMap((c,i)=>c?.selected&&c.text.trim()?[i]:[])))].sort((a,b)=>a-b);const left=columns[0],right=columns.at(-1);
 const headerRow=rows.findIndex(row=>Array.from(row.cells||[]).some(c=>c.tagName==='TH'));
 const escape=text=>String(text||'').trim().replace(/\r?\n/g,'<br>').replace(/\\?\|/g,'\\|');
 const format=cells=>'| '+cells.map(escape).join(' | ')+' |';
 const headers=Array.from({length:right-left+1},(_,i)=>headerRow>=0?whole(grid[headerRow]?.[left+i]?.cell):`列 ${left+i+1}`);
 const lines=[format(headers),format(headers.map(()=> '---'))];
 for(const {cells,r} of selectedRows){if(r===headerRow)continue;lines.push(format(Array.from({length:headers.length},(_,i)=>cells[left+i]?.selected?cells[left+i].text:'')));}
 return '\n\n'+lines.join('\n')+'\n\n';
}

async function richSelectionText(app, view, root, range) {
  const all = formulaNodes(root);
  const hasTable=Array.from(root.querySelectorAll('table')).some(table=>range.intersectsNode(table));
  const included = all.filter(element=>range.intersectsNode(element)||(hasTable&&element.closest?.('table')));
  if (!included.length&&!hasTable) return range.toString();
  const missing = included.some((element) => !formulaLatex(element));
  const source = missing ? await app.vault.cachedRead(view.file) : '';
  const formulaText = new Map(included.map((element) => {
    const item = formulaLatex(element) ? null : sourceFormulaFor(source, root, element);
    const latex = formulaLatex(element) || item?.latex || '';
    const block = isBlockFormula(element) || item?.block;
    const delimiter = block ? '$$' : '$';
    return [element, latex ? delimiter + latex + delimiter : '[无法读取公式]'];
  }));
  function whole(node){if(!node)return '';if(node.nodeType===3)return node.nodeValue;if(node.nodeType!==1)return '';if(formulaText.has(node))return formulaText.get(node);if(node.matches('br'))return '\n';return Array.from(node.childNodes).map(whole).join('');}
  function visit(node) {
    if (!range.intersectsNode(node)) return '';
    if(node.nodeType===1&&node.matches('table'))return tableSelectionMarkdown(node,range,visit,whole);
    if (node.nodeType === 3) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
      return node.nodeValue.slice(start, end);
    }
    if (node.nodeType !== 1) return '';
    if (formulaText.has(node)) {
      const value = formulaText.get(node);
      return value.startsWith('$$') ? '\n' + value + '\n' : value;
    }
    if (node.matches('br')) return '\n';
    const value = Array.from(node.childNodes).map(visit).join('');
    return node.matches('p, li, h1, h2, h3, h4, h5, h6, blockquote, tr, div') ? value + '\n' : value;
  }
  return Array.from(root.childNodes).map(visit).join('').replace(/\n{3,}/g, '\n\n').trim();
}

function captureAnchor(root, range) {
  if (!root || !range || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const index = textIndex(root);
  const start = index.nodes.find((part) => part.node === range.startContainer);
  return {
    startPath: nodePath(root, range.startContainer),
    startOffset: range.startOffset,
    endPath: nodePath(root, range.endContainer),
    endOffset: range.endOffset,
    domStart: start ? start.from + range.startOffset : null
  };
}

function restoreAnchor(root, anchor, quote) {
  if (!anchor?.startPath || !anchor?.endPath) return null;
  const start = nodeAt(root, anchor.startPath);
  const end = nodeAt(root, anchor.endPath);
  if (!start || !end) return null;
  try {
    const range = document.createRange();
    range.setStart(start, anchor.startOffset);
    range.setEnd(end, anchor.endOffset);
    return sameText(range.toString(), anchor.plainText ?? quote) ? range : null;
  } catch { return null; }
}

async function currentSelection(app) {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view?.file) return null;
  const editorText = view.getMode() === 'source' ? view.editor.getSelection() : '';
  let text = editorText;
  let mode = 'editor';
  if (!text?.trim()) {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.toString().trim()) return null;
    if (!selected.anchorNode?.parentElement?.closest('.markdown-preview-view')) return null;
    text = selected.toString();
    mode = 'preview';
  }
  const selected = window.getSelection();
  const box = selected?.rangeCount ? selected.getRangeAt(0).getBoundingClientRect() : null;
  const liveRange = selected?.rangeCount ? selected.getRangeAt(0).cloneRange() : null;
  const root = view.getMode() === 'preview'
    ? view.containerEl.querySelector('.markdown-preview-view')
    : view.containerEl.querySelector('.cm-content');
  const rect = box && (box.width || box.height)
    ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
    : null;
  if (mode === 'preview' && root && liveRange) text = await richSelectionText(app, view, root, liveRange);
  const anchor = captureAnchor(root, liveRange);
  if (anchor) anchor.plainText = liveRange.toString();
  const formulaElements = mode === 'preview' && root && liveRange
    ? formulaNodes(root).filter((element) => liveRange.intersectsNode(element)) : [];
  return { filePath: view.file.path, text, mode, rect, formulaElements,
    offset: mode === 'editor' ? sourceOffset(view.editor.getValue(), view.editor.getCursor('from')) : null,
    anchor, liveRange };
}

async function resolveSelectedFormula(_plugin,selected){if(!selected?.formulaCandidates)return selected;const candidates=selected.formulaCandidates;const chosen=candidates.length===1?candidates[0]:null;if(!chosen)return{...selected,text:'[公式]',formulaCandidates:null};const mark=selected.block?'$$':'$';return{...selected,text:mark+chosen+mark,anchor:{...selected.anchor,latex:chosen},formulaCandidates:null};}

function installToolbar(plugin) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'study-selection-action';
  button.setAttribute('aria-label', '添加批注');
  button.title = '添加批注';
  setIcon(button, 'message-circle');
  button.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation(); });
  button.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    const selected = plugin.lastSelection;
    document.dispatchEvent(new Event('study-selection-dismiss'));
    if (selected)resolveSelectedFormula(plugin,selected).then(resolved=>{if(resolved)plugin.startAnnotation(resolved);});
  });
  const aiButton=document.createElement('button');aiButton.type='button';aiButton.className='study-selection-action';aiButton.title='AI 解释';aiButton.setAttribute('aria-label','AI 解释');setIcon(aiButton,'sparkles');aiButton.addEventListener('mousedown',event=>{event.preventDefault();event.stopPropagation();});aiButton.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const selected=plugin.lastSelection;hide();if(selected)resolveSelectedFormula(plugin,selected).then(resolved=>{if(resolved){if(resolved.text==='[公式]')new Notice('需要选择源码后才能交给 AI 解释');else plugin.ai.explain(toAISelection(resolved));}});});
  function bar() {
    let element = document.querySelector('.' + TOOLBAR);
    if (!element) {
      element = document.createElement('div');
      element.className = TOOLBAR;
      document.body.appendChild(element);
    }
    return element;
  }
  function hide() {
    plugin.lastSelection = null;
    revision++;decorate(null);plugin.pointerDownFormula=null;
    button.style.display = 'none';aiButton.style.display='none';
    const parent = button.parentElement;
    if (parent && !Array.from(parent.children).some((child) => child.style.display !== 'none')) {
      parent.style.display = 'none';
      parent.classList.remove('study-selection-enter');
    }
  }
  function decorate(selected) {
    plugin.selectedFormulaElements?.forEach((element) => element.classList.remove('margin-notes-selected-math'));
    plugin.selectedFormulaElements = selected?.formulaElements || [];
    plugin.selectedFormulaElements.forEach((element) => element.classList.add('margin-notes-selected-math'));
  }
  let revision=0;
  async function update(event) {
    const token=++revision;
    if (event?.target?.closest?.('.' + TOOLBAR + ', .margin-notes-card, .selection-explainer-card')) return;
    const formulaClick = event?.type === 'mouseup' && plugin.pointerDownFormula &&
      event.target?.closest?.('.math, .katex, mjx-container');
    const selected = formulaClick
      ? await formulaAtEvent(plugin.app, event)
      : await currentSelection(plugin.app) || await formulaAtEvent(plugin.app, event);
    if(token!==revision)return;
    if (!selected) {
      hide(); decorate(null);

      return;
    }
    decorate(selected);
    plugin.lastSelection = selected;
    const element = bar();
    if (!button.isConnected) element.appendChild(button);if(!aiButton.isConnected)element.appendChild(aiButton);
    button.style.display = '';aiButton.style.display='';
    const entering = element.style.display !== 'flex';
    element.style.display = 'flex';
    if (entering) element.classList.add('study-selection-enter');
    const right = selected.rect?.right ?? window.innerWidth / 2;
    const bottom = selected.rect?.bottom ?? window.innerHeight / 3;
    const top = bottom + 8 + element.offsetHeight <= window.innerHeight - 12
      ? bottom + 8 : Math.max(12, (selected.rect?.top ?? bottom) - element.offsetHeight - 8);
    element.style.left = Math.max(12, Math.min(window.innerWidth - element.offsetWidth - 12,
      right - element.offsetWidth + 8)) + 'px';
    element.style.top = top + 'px';
  }
  plugin.registerDomEvent(document, 'pointerdown', (event) => {
    if(event.target?.closest?.('.study-selection-toolbar,.margin-notes-card,.selection-explainer-card,.margin-notes-sidebar'))return;
    revision++;hide();
    document.querySelectorAll('.selection-explainer-selected-math,.margin-notes-selected-math').forEach(el=>el.classList.remove('selection-explainer-selected-math','margin-notes-selected-math'));
    window.getSelection()?.removeAllRanges();
    plugin.pointerDownFormula = event.target?.closest?.('.math, .katex, mjx-container') || null;
  }, true);
  plugin.registerDomEvent(document, 'mouseup', update);
  plugin.registerDomEvent(document, 'keyup', update);
  plugin.registerDomEvent(document, 'study-selection-dismiss', hide);
  plugin.registerDomEvent(document, 'touchend', () => window.setTimeout(update, 80));
  plugin.register(() => {
    decorate(null);
    button.remove();aiButton.remove();
    const element = document.querySelector('.' + TOOLBAR);
    if (element && !element.children.length) element.remove();
  });
}

function textIndex(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.nodeValue) continue;
    nodes.push({ node, from: text.length, to: text.length + node.nodeValue.length });
    text += node.nodeValue;
  }
  return { nodes, text };
}

function rangeAt(index, start, length) {
  const end = start + length;
  const first = index.nodes.find((part) => part.from <= start && start < part.to);
  const last = index.nodes.find((part) => part.from < end && end <= part.to);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, start - first.from);
  range.setEnd(last.node, end - last.from);
  return range;
}

function findRange(index, quote, occurrence, nearest) {
  if (!quote) return null;
  const positions = [];
  for (let at = index.text.indexOf(quote); at >= 0; at = index.text.indexOf(quote, at + 1)) {
    positions.push(at);
  }
  if (!positions.length) return null;
  const at = Number.isFinite(nearest)
    ? positions.reduce((best, position) => Math.abs(position - nearest) < Math.abs(best - nearest) ? position : best)
    : positions[Math.min(occurrence || 0, positions.length - 1)];
  return rangeAt(index, at, quote.length);
}

const ANNOTATION_VIEW='margin-notes-sidebar';
class AnnotationSidebar extends ItemView{
 constructor(leaf,plugin){super(leaf);this.plugin=plugin;this.parts=[];}
 getViewType(){return ANNOTATION_VIEW;}getDisplayText(){return '页面批注';}getIcon(){return 'message-square';}
 async onOpen(){this.closed=false;await this.render();}async onClose(){this.closed=true;this.parts.forEach(c=>c.unload());this.parts=[];}
 async render(){this.renderAgain=true;if(this.rendering)return;this.rendering=true;try{do{this.renderAgain=false;await this.renderContent();}while(this.renderAgain&&!this.closed);}finally{this.rendering=false;}}
 async renderContent(){this.parts.forEach(c=>c.unload());this.parts=[];const root=this.contentEl;root.empty();root.addClass('margin-notes-sidebar');const file=this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file;const path=file?.path||this.plugin.sidebarPath;const entries=this.plugin.threads.filter(t=>t.filePath===path).sort((a,b)=>(a.anchor?.sourceStart??a.offset??a.createdAt??'').toString().localeCompare((b.anchor?.sourceStart??b.offset??b.createdAt??'').toString(),undefined,{numeric:true}));root.createEl('h3',{text:path?.split('/').at(-1)?.replace(/\.md$/,'')||'页面批注'});root.createDiv({text:`${entries.length} 条批注`,cls:'margin-notes-sidebar-count'});if(!entries.length){root.createEl('p',{text:'当前页面没有批注',cls:'margin-notes-sidebar-empty'});return;}for(const t of entries){const item=root.createDiv({cls:'margin-notes-sidebar-item'});const quote=item.createDiv({cls:'margin-notes-sidebar-quote markdown-rendered'});const component=new Component();component.load();this.parts.push(component);await MarkdownRenderer.render(this.plugin.app,safeMarkdown(t.quote||''),quote,t.filePath,component);const edit=item.createEl('button',{text:'定位 / 编辑',cls:'margin-notes-sidebar-edit'});edit.onclick=async()=>{await this.plugin.app.workspace.openLinkText(t.filePath,'',false);this.plugin.sidebarPath=t.filePath;this.plugin.renderAnchors();const range=this.plugin.ranges.get(t.id);const node=range?.startContainer?.parentElement||range;node?.scrollIntoView?.({block:'center',behavior:'smooth'});this.plugin.openThread(t.id);};for(const comment of t.comments||[]){item.createDiv({text:comment.source==='ai'?'AI':'我',cls:'margin-notes-sidebar-source'});const body=item.createDiv({cls:'markdown-rendered margin-notes-sidebar-body'});await MarkdownRenderer.render(this.plugin.app,safeMarkdown(comment.text||''),body,t.filePath,component);}}}
}

module.exports = class MarginNotes extends Plugin {
  singleSidebarLeaf(){
    const workspace=this.app.workspace;
    const leaves=workspace.getLeavesOfType(ANNOTATION_VIEW);
    if(!leaves.length)return null;
    const keep=leaves.find(leaf=>leaf===workspace.activeLeaf)||leaves[0];
    for(const leaf of leaves)if(leaf!==keep)leaf.detach();
    if(leaves.length>1)void workspace.requestSaveLayout?.();
    return keep;
  }
  refreshSidebar(){const leaf=this.singleSidebarLeaf();if(typeof leaf?.view?.render==='function')void leaf.view.render();}
  async openSidebar(){
    if(this.sidebarOpenPromise)return this.sidebarOpenPromise;
    const opening=(async()=>{
      let leaf=this.singleSidebarLeaf();
      if(!leaf){
        leaf=this.app.workspace.getRightLeaf(false);
        if(!leaf)return;
        await leaf.setViewState({type:ANNOTATION_VIEW,active:true});
        leaf=this.singleSidebarLeaf()||leaf;
      }
      this.app.workspace.revealLeaf(leaf);
      this.refreshSidebar();
    })();
    this.sidebarOpenPromise=opening;
    try{return await opening;}finally{if(this.sidebarOpenPromise===opening)this.sidebarOpenPromise=null;}
  }
  async persistThreads(){const records={};for(const thread of this.threads){const path=thread.filePath;(records[path]||={version:1,threads:[]}).threads.push(thread);}await this.store.save('annotations.json',records);this.refreshSidebar();}
  async onload() {
    this.store=getStore(this.app);
    const saved=await this.loadData();
    this.registerMarkdownPostProcessor(recordFormulaSources,1000);
    const records=await this.store.load('annotations.json');
    this.store.cache['annotations.json']=Object.fromEntries(Object.entries(records).map(([p,v])=>[p,JSON.stringify(v)]));
    this.threads=Object.entries(records).flatMap(([path,r])=>(r.threads||[]).map(t=>({...t,filePath:path})));
    if(Array.isArray(saved)&&saved.length&&!Object.keys(records).length){this.threads=saved.map(t=>({...t,comments:t.comments||[{id:t.id,text:t.note||'',createdAt:t.createdAt}]}));await this.persistThreads();}
    await this.saveData({storageVersion:1});
    this.pending = null;
    this.activeId = null;
    this.card = null;
    this.cardRenderComponents = [];
    this.markers = [];
    this.overlays = [];
    this.ranges = new Map();
    this.liveRanges = new Map();
    this.liveElements = new Map();
    this.mathElements = [];
    this.selectedFormulaElements = [];
    this.observer = null;
    this.observedRoot = null;
    this.scheduled = false;
    this.registerView(ANNOTATION_VIEW,leaf=>new AnnotationSidebar(leaf,this));
    this.addRibbonIcon('message-square','打开页面批注',()=>this.openSidebar());
    installToolbar(this);
    this.addCommand({ id: 'annotate-selection', name: '批注选中文本', editorCallback: (editor, view) => {
      if (!editor.getSelection().trim()) return new Notice('请先选中文本');
      currentSelection(this.app).then((selected) => { if (selected) this.startAnnotation(selected); });
    }});
    this.addCommand({id:'show-annotations',name:'打开当前页面全部批注',callback:()=>this.openSidebar()});
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if(file?.extension==='md')this.sidebarPath=file.path;this.refreshSidebar();
      const active = this.threads.find((item) => item.id === this.activeId);
      if (active && active.filePath !== file?.path) this.closeCard();
      this.scheduleRender();
    }));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.scheduleRender()));
    this.registerEvent(this.app.workspace.on('editor-change', () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
      await this.store.move(oldPath,file.path);
      let changed = false;
      for (const thread of this.threads) if (thread.filePath===oldPath||thread.filePath.startsWith(oldPath+'/')) { thread.filePath=file.path+thread.filePath.slice(oldPath.length); changed=true; }
      if (changed) { await this.persistThreads(); this.scheduleRender(); }
    }));
    this.registerDomEvent(document, 'scroll', event => {if(event.target?.classList?.contains('margin-notes-inline-rail')){this.marginScroll=event.target.scrollTop;return;}this.scheduleRender();}, true);
    this.registerDomEvent(document, 'pointerdown', (event) => {
      if (this.card && !event.target?.closest?.('.margin-notes-card, .margin-notes-marker, .study-selection-toolbar')) this.closeCard();
    }, true);
    this.registerDomEvent(window, 'resize', () => this.scheduleRender());
    this.app.workspace.onLayoutReady(() => {this.sidebarPath=this.app.workspace.getActiveFile()?.path;this.scheduleRender();void this.openSidebar();});
    this.register(() => this.cleanup());
  }

  cleanup() {
    this.marginComponents?.forEach(c=>c.unload());
    for(const el of document.querySelectorAll('.margin-notes-with-rail'))el.classList.remove('margin-notes-with-rail');
    this.observer?.disconnect();
    const previousRail=this.markers.find(item=>item.classList?.contains('margin-notes-inline-rail'));if(previousRail)this.marginScroll=previousRail.scrollTop;
    this.markers.forEach((item) => item.remove());
    this.overlays.forEach((item) => item.remove());
    this.mathElements.forEach((item) => item.classList.remove('margin-notes-math-anchor'));
    this.card?.remove();
    this.unloadCardComponents();
    globalThis.CSS?.highlights?.delete(HIGHLIGHT);
  }

  scheduleRender() {
    if (this.scheduled) return;
    this.scheduled = true;
    window.requestAnimationFrame(() => { this.scheduled = false; this.renderAnchors(); });
  }

  viewRoot() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return null;
    const root = view.getMode() === 'preview'
      ? view.containerEl.querySelector('.markdown-preview-view')
      : view.containerEl.querySelector('.cm-content');
    return root ? { view, root } : null;
  }

  observe(root) {
    if (root === this.observedRoot) return;
    this.observer?.disconnect();
    this.observedRoot = root;
    this.observer = root ? new MutationObserver(() => this.scheduleRender()) : null;
    this.observer?.observe(root, { childList: true, characterData: true, subtree: true });
  }

  renderAnchors() {
    this.markers.forEach((item) => item.remove());
    this.overlays.forEach((item) => item.remove());
    this.mathElements.forEach((item) => item.classList.remove('margin-notes-math-anchor'));
    this.markers = [];
    this.overlays = [];
    this.mathElements = [];
    this.ranges.clear();
    globalThis.CSS?.highlights?.delete(HIGHLIGHT);
    const context = this.viewRoot();
    this.observe(context?.root || null);
    if (!context) return;
    const visible = this.threads.filter((item) => item.filePath === context.view.file.path);
    if (!visible.length) {
      if (this.pending && this.card) this.positionCard(this.pending.liveRange?.getBoundingClientRect?.() ||
        this.pending.liveElement?.getBoundingClientRect?.() || this.pending.rect);
      return;
    }
    const index = textIndex(context.root);
    const ranges = [];
    const canHighlight = !!(globalThis.CSS?.highlights && typeof Highlight !== 'undefined');
    for (const thread of visible) {
      if (thread.anchor?.kind === 'math') {
        const liveElement = this.liveElements.get(thread.id);
        const element = liveElement && context.root.contains(liveElement) &&
          (formulaLatex(liveElement) === thread.anchor.latex || !formulaLatex(liveElement))
          ? liveElement : restoreFormula(context.root, thread.anchor);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        this.ranges.set(thread.id, element);
        element.classList.add('margin-notes-math-anchor');
        this.mathElements.push(element);
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'margin-notes-marker';
        marker.setAttribute('aria-label', '查看公式批注');
        setIcon(marker, 'message-circle');
        marker.style.left = Math.min(window.innerWidth - 30, rect.right + 8) + 'px';
        marker.style.top = Math.max(0, rect.top - 2) + 'px';
        marker.onclick = () => this.openThread(thread.id);
        document.body.appendChild(marker);
        this.markers.push(marker);
        continue;
      }
      const live = this.liveRanges.get(thread.id);
      const range = live && context.root.contains(live.startContainer) && context.root.contains(live.endContainer)
        ? live
        : restoreAnchor(context.root, thread.anchor, thread.quote)
          || findRange(index, thread.anchor?.plainText || thread.quote, thread.occurrence || 0, thread.anchor?.domStart);
      if (!range) continue;
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      this.ranges.set(thread.id, range);
      ranges.push(range);
      if (!canHighlight) {
        for (const box of range.getClientRects()) {
          const overlay = document.createElement('div');
          overlay.className = 'margin-notes-fallback-highlight';
          overlay.style.left = box.left + 'px';
          overlay.style.top = box.top + 'px';
          overlay.style.width = box.width + 'px';
          overlay.style.height = box.height + 'px';
          document.body.appendChild(overlay);
          this.overlays.push(overlay);
        }
      }
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'margin-notes-marker';
      marker.setAttribute('aria-label', '查看批注');
      setIcon(marker, 'message-circle');
      marker.style.left = Math.min(window.innerWidth - 30, rect.right + 8) + 'px';
      marker.style.top = Math.max(0, rect.top - 2) + 'px';
      marker.onclick = () => this.openThread(thread.id);
      document.body.appendChild(marker);
      this.markers.push(marker);
    }
    if (ranges.length && canHighlight) {
      globalThis.CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
    }
    if (this.activeId && this.card) {
      const range = this.ranges.get(this.activeId);
      if (range) this.positionCard(range.getBoundingClientRect());
    }
    if (this.pending && this.card) {
      const anchor = this.pending.liveRange?.getBoundingClientRect?.() ||
        this.pending.liveElement?.getBoundingClientRect?.() || this.pending.rect;
      this.positionCard(anchor);
    }
  }

  async startAnnotation(selected) {
    const quote = selected.text.trim();
    if (!quote) return new Notice('请先选中文本');
    
    const file = this.app.vault.getAbstractFileByPath(selected.filePath);
    if (!file || file.extension !== 'md') return new Notice('仅支持 Markdown 笔记');
    this.pending = { filePath: selected.filePath, quote, offset: selected.offset ?? null,
      occurrence: 0, anchor: selected.anchor || null, liveRange: selected.liveRange || null,
      liveElement: selected.liveElement || null, rect: selected.rect };
    this.activeId = null;
    await this.renderCard();
  }

  async addAIAnnotation({ filePath, quote, answer, range, formulaElement, latex, block }) {
    if (!answer?.trim()) throw new Error('AI 回复为空');
    const context = this.viewRoot();
    if (!context || context.view.file.path !== filePath) throw new Error('请返回选中内容所在的笔记');
    let anchor = null;
    let liveRange = null;
    let liveElement = null;
    if (formulaElement && context.root.contains(formulaElement)) {
      const index = formulaNodes(context.root).indexOf(formulaElement);
      if (index >= 0) {
        anchor = { kind: 'math', elementPath: nodePath(context.root, formulaElement),
          latex: latex || formulaLatex(formulaElement), index, occurrence: 0, block: !!block };
        liveElement = formulaElement;
      }
    }
    if (!anchor && range && context.root.contains(range.startContainer) && context.root.contains(range.endContainer)) {
      anchor = captureAnchor(context.root, range);
      if (anchor) { anchor.plainText = range.toString(); liveRange = range.cloneRange(); }
    }
    if (!anchor && this.lastSelection?.filePath === filePath && this.lastSelection.text === quote) {
      anchor = this.lastSelection.anchor;
      liveRange = this.lastSelection.liveRange;
      liveElement = this.lastSelection.liveElement;
    }
    if (!anchor) throw new Error('选区位置已变化，请重新选择后再试');
    const createdAt = new Date().toISOString();
    const id = Date.now() + '-' + Math.random().toString(36).slice(2);
    const thread = { id, filePath, quote, anchor, offset: null, occurrence: 0, createdAt,
      comments: [{ id, text: answer.trim(), source: 'ai', createdAt }] };
    this.threads.push(thread);
    if (liveRange) this.liveRanges.set(id, liveRange);
    if (liveElement) this.liveElements.set(id, liveElement);
    await this.persistThreads();
    this.scheduleRender();
    return id;
  }

  openThread(id) {
    const thread = this.threads.find((item) => item.id === id);
    if (!thread) return;
    this.pending = null;
    this.activeId = id;
    this.renderCard();
  }

  positionCard(rect) {
    if (!this.card) return;
    const width = this.card.offsetWidth;
    const height = this.card.offsetHeight;
    const fallback = { left: window.innerWidth / 2, right: window.innerWidth / 2, top: window.innerHeight / 3, bottom: window.innerHeight / 3 };
    const anchor = rect || fallback;
    const right = anchor.right + 22;
    const left = right + width <= window.innerWidth - 12
      ? right : anchor.left - width - 22 >= 12
        ? anchor.left - width - 22 : Math.max(12, Math.min(window.innerWidth - width - 12, anchor.left));
    this.card.style.left = (left + window.scrollX) + 'px';
    this.card.style.top = (Math.max(12, Math.min(window.innerHeight - height - 12, anchor.top - 8)) + window.scrollY) + 'px';
  }

  async renderCard() {
    const thread = this.activeId ? this.threads.find((item) => item.id === this.activeId) : null;
    if (!thread && !this.pending) return;
    if (!this.card) {
      this.card = document.createElement('section');
      this.card.className = 'margin-notes-card';
      this.card.setAttribute('role', 'dialog');
      this.card.setAttribute('aria-label', '批注');
      document.body.appendChild(this.card);
    }
    const root = this.card;
    this.unloadCardComponents();
    root.empty();
    const header = root.createDiv({ cls: 'margin-notes-header' });
    header.createEl('span', { text: '批注', cls: 'margin-notes-title' });
    header.createEl('button', { text: '×', cls: 'margin-notes-close', attr: { 'aria-label': '关闭批注' } }).onclick = () => this.closeCard();
    const quote = root.createDiv({ cls: 'margin-notes-quote markdown-rendered' });
    const quoteComponent = new Component();
    quoteComponent.load();
    this.cardRenderComponents.push(quoteComponent);
    const quoteText = thread?.quote || this.pending.quote;
    try { await MarkdownRenderer.render(this.app, safeMarkdown(quoteText), quote, thread?.filePath || this.pending.filePath, quoteComponent); }
    catch { quote.setText(quoteText); }
    if (thread) {
      for (const comment of thread.comments) {
        const isAI = comment.source === 'ai';
        const message = root.createDiv({ cls: 'margin-notes-message' + (isAI ? ' is-ai' : '') });
        const meta = message.createDiv({ cls: 'margin-notes-meta' });
        meta.createEl('strong', { text: isAI ? 'AI 解释' : '我的批注' });
        meta.createEl('time', { text: new Date(comment.createdAt).toLocaleString() });
        const body = message.createDiv({ cls: 'margin-notes-body markdown-rendered' });
        const component = new Component();
        component.load();
        this.cardRenderComponents.push(component);
        try { await MarkdownRenderer.render(this.app, safeMarkdown(comment.text), body, thread.filePath, component); }
        catch { body.setText(comment.text); }
      }
    }
    const input = root.createEl('textarea', { attr: { rows: '3', placeholder: thread ? '继续补充…' : '写下你的批注…' } });
    const footer = root.createDiv({ cls: 'margin-notes-footer' });
    if (thread) {
      footer.createEl('button', { text: '删除批注', cls: 'margin-notes-delete' }).onclick = async () => {
        this.threads = this.threads.filter((item) => item.id !== thread.id);
        this.liveRanges.delete(thread.id);
        this.liveElements.delete(thread.id);
        await this.persistThreads();
        this.closeCard();
        this.scheduleRender();
      };
    }
    const save = footer.createEl('button', { text: thread ? '回复' : '保存批注', cls: 'margin-notes-save' });
    save.onclick = async () => {
      const value = input.value.trim();
      if (!value) return new Notice('请先输入内容');
      save.disabled = true;
      const comment = { id: Date.now() + '-' + Math.random().toString(36).slice(2), text: value,
        source: 'human', createdAt: new Date().toISOString() };
      if (thread) thread.comments.push(comment);
      else {
        const pending = this.pending;
        const item = { id: comment.id, filePath: pending.filePath, quote: pending.quote,
          offset: pending.offset, occurrence: pending.occurrence, anchor: pending.anchor,
          comments: [comment], createdAt: comment.createdAt };
        this.threads.push(item);
        if (pending.liveRange) this.liveRanges.set(item.id, pending.liveRange);
        if (pending.liveElement) this.liveElements.set(item.id, pending.liveElement);
        this.activeId = item.id;
        this.pending = null;
      }
      await this.persistThreads();
      this.scheduleRender();
      await this.renderCard();
    };
    this.positionCard(this.pending?.rect || this.ranges.get(thread?.id)?.getBoundingClientRect());
    input.focus();
  }

  closeCard() {
    this.pending = null;
    this.activeId = null;
    this.card?.remove();
    this.card = null;
    this.unloadCardComponents();
  }

  unloadCardComponents() {
    this.cardRenderComponents?.forEach((component) => component.unload());
    this.cardRenderComponents = [];
  }
};

return {Controller:module.exports,select:currentSelection};
})();
const AIController=(()=>{const module={exports:{}};
const https = require('https');
const { Plugin, PluginSettingTab, Setting, MarkdownView, Notice, MarkdownRenderer, Component, setIcon } = require('obsidian');
const TOOLBAR = 'study-selection-toolbar';
const FORMULA_SOURCES = new WeakMap();
const DEFAULTS = { model: '', endpoint: 'https://api.deepseek.com/chat/completions', contextLines: 3 };
const CONTEXT_LINE_OPTIONS = [0, 1, 3, 5, 10];
const contextLineCount = (value) => CONTEXT_LINE_OPTIONS.includes(Number(value)) ? Number(value) : DEFAULTS.contextLines;
const SYSTEM_PROMPT = '你是严谨、清晰的学习助手。首次回答只解释【选中内容】；提供的上下文仅用于理解术语和指代，不要解释或概括上下文。随后保持连续对话。用简体中文回答。默认用一两段简洁文字或少量要点，不要为简单问题制作表格。用户要求深入时再展开。使用标准 Markdown。行内数学只用 $...$，独立公式只用单独成行的 $$...$$，不要使用 \\(...\\) 或 \\[...\\]。只有用户明确要求画图时才输出 Mermaid。不要假装看过未提供的整篇文档。';

function safeMarkdown(content, allowMermaid) {
  const normalized = normalizeMath(content);
  return allowMermaid ? normalized : normalized.replace(/^(\s*)```mermaid\b/gim, '$1```text');
}

function normalizeMath(content) {
  const plain = (value) => value
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body) => '\n\n$$\n' + body.trim() + '\n$$\n\n')
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body) => '$' + body.trim() + '$');
  const protectedCode = /(^\s{0,3}(?:```|~~~)[^\n]*\n[\s\S]*?^\s{0,3}(?:```|~~~)[ \t]*$|`+[^`\n]*`+)/gm;
  let result = '';
  let previous = 0;
  for (const match of content.matchAll(protectedCode)) {
    result += plain(content.slice(previous, match.index)) + match[0];
    previous = match.index + match[0].length;
  }
  return result + plain(content.slice(previous));
}

function inlineHostFor(view, selected) {
  if (view?.getMode() !== 'preview') return null;
  const preview = view.containerEl.querySelector('.markdown-preview-view');
  const target = selected.range?.endContainer || selected.formulaElement;
  if (!preview || !target || !preview.contains(target)) return null;
  let block = target.nodeType === 1 ? target : target.parentElement;
  while (block?.parentElement && !block.parentElement.matches('.markdown-preview-section, .markdown-preview-sizer, .markdown-preview-view')) {
    block = block.parentElement;
  }
  if (!block?.parentElement || !preview.contains(block)) return null;
  const host = document.createElement('div');
  host.className = 'selection-explainer-inline-host';
  block.after(host);
  return host;
}

function selectionRect() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return rect?.width || rect?.height ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null;
}

function editorContext(editor, lineCount = DEFAULTS.contextLines) {
  const count = contextLineCount(lineCount);
  if (!count) return { before: '', after: '' };
  const lines = editor.getValue().split('\n');
  const from = editor.getCursor('from').line;
  const to = editor.getCursor('to').line;
  return { before: lines.slice(Math.max(0, from - count), from).join('\n'),
    after: lines.slice(to + 1, to + count + 1).join('\n') };
}

function trimContext(context, lineCount = DEFAULTS.contextLines) {
  const count = contextLineCount(lineCount);
  if (!count) return { before: '', after: '' };
  const lines = (value) => value.split('\n').map((line) => line.trim()).filter(Boolean);
  return { before: lines(context?.before || '').slice(-count).join('\n'),
    after: lines(context?.after || '').slice(0, count).join('\n') };
}

function lineContext(beforeText, afterText, lineCount = DEFAULTS.contextLines) {
  return trimContext({ before: beforeText, after: afterText }, lineCount);
}

async function activeSelection(app){return toAISelection(await selectionService.select(app));}

async function previewContext(app, view, root, range, lineCount = DEFAULTS.contextLines) {
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(root);
  after.setStart(range.endContainer, range.endOffset);
  const beforeText = await richSelectionText(app, view, root, before, true);
  const afterText = await richSelectionText(app, view, root, after, true);
  return lineContext(beforeText, afterText, lineCount);
}

async function contextForSelection(app, selected, lineCount = DEFAULTS.contextLines) {
  const count = contextLineCount(lineCount);
  if (!count) return { before: '', after: '' };
  if (selected.context) return trimContext(selected.context, count);
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view?.file || view.file.path !== selected.sourcePath) return { before: '', after: '' };
  if (view.getMode?.() === 'source') return editorContext(view.editor, count);
  const root = view?.containerEl.querySelector('.markdown-preview-view');
  if (!root) return { before: '', after: '' };
  let range = selected.range;
  if (!range && selected.formulaElement && root.contains(selected.formulaElement)) {
    range = document.createRange();
    range.selectNode(selected.formulaElement);
  }
  return range ? previewContext(app, view, root, range, count) : { before: '', after: '' };
}

function initialPrompt(quote, context, lineCount = DEFAULTS.contextLines) {
  const count = contextLineCount(lineCount);
  const limitedContext = trimContext(context, count);
  const before = limitedContext.before || '（无）';
  const after = limitedContext.after || '（无）';
  let prompt = '请只解释【选中内容】。周围上下文仅用于理解指代与术语，不要逐行解释或概括上下文。\n\n';
  if (count) prompt += `【上文，最多 ${count} 行】\n${before}\n\n`;
  prompt += `【选中内容】\n${quote}`;
  if (count) prompt += `\n\n【下文，最多 ${count} 行】\n${after}`;
  return prompt;
}

function sourceFormulas(source) {
  let fence = null;
  const clean = source.split('\n').map((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return ' '.repeat(line.length);
    }
    if (fence) return ' '.repeat(line.length);
    return line.replace(/(`+)([^`]*?)\1/g, (part) => ' '.repeat(part.length));
  }).join('\n');
  const formulas = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] !== '$' || clean[i - 1] === '\\') continue;
    const count = clean[i + 1] === '$' ? 2 : 1;
    let end = i + count;
    while (end < clean.length) {
      if (count === 1 && clean[end] === '\n') break;
      if (clean[end] === '$' && clean[end - 1] !== '\\' &&
          (count === 1 ? clean[end + 1] !== '$' : clean[end + 1] === '$')) break;
      end++;
    }
    if (end < clean.length && clean[end] === '$') {
      const latex = source.slice(i + count, end).trim();
      if (latex) formulas.push({ latex, block: count === 2, start: i, end: end + count });
      i = end + count - 1;
    }
  }
  return formulas;
}

function inlineFormulaFromParagraph(source, element) {
  const paragraph = element.closest?.('p, li, td, th, h1, h2, h3, h4, h5, h6');
  if (!paragraph) return null;
  const rendered = formulaNodes(paragraph).filter((item) => !isBlockFormula(item));
  const ordinal = rendered.indexOf(element);
  if (ordinal < 0) return null;
  const skeleton = (node) => {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    if (node.matches?.('.math, .katex, mjx-container')) return '§';
    return Array.from(node.childNodes).map(skeleton).join('');
  };
  const normalize = (value) => value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+)/, '')
    .replace(/[\u200b\u00a0]/g, ' ')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ').trim();
  const expected = normalize(skeleton(paragraph));
  const matches = [];
  for (const line of source.split('\n')) {
    const formulas = sourceFormulas(line).filter((item) => !item.block);
    if (!paragraph.matches?.('td, th') && formulas.length !== rendered.length) continue;
    let text = '';
    let previous = 0;
    for (const item of formulas) {
      text += line.slice(previous, item.start) + '§';
      previous = item.end;
    }
    text += line.slice(previous);
    if (formulas.length === rendered.length && normalize(text) === expected) matches.push(formulas[ordinal]);
    if (paragraph.matches?.('td, th')) {
      const cellIndex = Number.isInteger(paragraph.cellIndex) ? paragraph.cellIndex : -1;
      const targetIndex = cellIndex + (text.startsWith('|') ? 1 : 0);
      let used = 0;
      for (const [index, cell] of text.split('|').entries()) {
        const count = (cell.match(/§/g) || []).length;
        if (index === targetIndex && count === rendered.length && normalize(cell) === expected) {
          matches.push(formulas[used + ordinal]);
        }
        used += count;
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function sourceFormulaFor(source, root, element) {
  if (!isBlockFormula(element)) {
    const inline = inlineFormulaFromParagraph(source, element);
    if (inline) return inline;
  }
  const formulas = sourceFormulas(source);
  const block = element.closest?.('.el-math, .el-p, .el-li, .el-table, p, li, tr') || element;
  let previous = block.previousElementSibling;
  while (previous && !previous.textContent?.trim()) previous = previous.previousElementSibling;
  const label = previous?.textContent?.trim();
  if (label && label.length <= 120) {
    const matches = formulas.filter((item) => source.slice(0, item.start).trimEnd().endsWith(label));
    if (matches.length === 1) return matches[0];
  }
  const lineElement = element.closest?.('[data-line]');
  const line = Number(lineElement?.getAttribute?.('data-line'));
  if (lineElement && Number.isInteger(line) && line >= 0) {
    const matches = formulas.filter((item) => {
      const sourceLine = source.slice(0, item.start).split('\n').length - 1;
      return sourceLine === line;
    });
    if (matches.length === 1) return matches[0];
  }
  const heading = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .filter((item) => item.compareDocumentPosition(element) & 4).at(-1);
  if (heading) {
    const headingText = heading.textContent?.replace(/\s+/g, ' ').trim();
    const sourceHeadings = Array.from(source.matchAll(/^#{1,6}\s+(.+?)\s*$/gm));
    const matching = sourceHeadings.filter((match) => match[1].replace(/\s+/g, ' ').trim() === headingText);
    if (matching.length === 1) {
      const start = matching[0].index + matching[0][0].length;
      const next = sourceHeadings.find((match) => match.index > start);
      const end = next?.index ?? source.length;
      const candidates = formulas.filter((item) => item.start >= start && item.start < end &&
        item.block === isBlockFormula(element));
      const following=Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).find(node=>heading.compareDocumentPosition(node)&4);
      const renderedSection=formulaNodes(root).filter(node=>isBlockFormula(node)===isBlockFormula(element)&&(heading.compareDocumentPosition(node)&4)&&(!following||(node.compareDocumentPosition(following)&4)));
      const ordinal=renderedSection.indexOf(element);
      if(ordinal>=0&&renderedSection.length===candidates.length)return candidates[ordinal];
    }
  }
  const rendered = formulaNodes(root);
  const index = rendered.indexOf(element);
  if(index>=0&&rendered.length===formulas.length&&rendered.every((node,i)=>isBlockFormula(node)===formulas[i].block))return formulas[index];
  return null;
}

function formulaNodes(root) {
  return Array.from(root.querySelectorAll('.math, .katex, mjx-container')).filter((element) =>
    !element.parentElement?.closest('.math, .katex, mjx-container'));
}

function isBlockFormula(element) {
  return element.matches('.math-block') || element.closest?.('.el-math') != null ||
    element.querySelector?.('mjx-container[display="true"]') != null;
}

function recordFormulaSources(element, context) {
  const assign = (container, source) => {
    if (!source || !container?.querySelectorAll) return;
    const sources = sourceFormulas(source);
    const rendered = formulaNodes(container);
    for (const block of [false, true]) {
      const expected = sources.filter((item) => item.block === block);
      const actual = rendered.filter((item) => isBlockFormula(item) === block);
      if (expected.length && expected.length === actual.length) {
        actual.forEach((item, index) => FORMULA_SOURCES.set(item, expected[index]));
      }
    }
  };
  assign(element, context.getSectionInfo?.(element)?.text);
  for (const formula of formulaNodes(element)) {
    if (FORMULA_SOURCES.has(formula)) continue;
    const container = formula.closest?.('.el-math, .el-p, .el-li, .el-table, p, li, tr') || formula;
    assign(container, context.getSectionInfo?.(formula)?.text);
  }
}

function formulaLatex(element) {
  const direct = element?.getAttribute?.('data-tex') || element?.getAttribute?.('data-latex') ||
    element?.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
  if (direct?.trim()) return direct.trim();
  const container = element?.matches?.('mjx-container') ? element : element?.querySelector?.('mjx-container');
  if (!container) return FORMULA_SOURCES.get(element)?.latex || '';
  try {
    for (const item of window.MathJax?.startup?.document?.math || []) {
      if (item.typesetRoot === container) return item.math?.trim() || '';
    }
  } catch {}
  return FORMULA_SOURCES.get(element)?.latex || '';
}

function tableSelectionMarkdown(table,range,visit,whole){
 const rows=Array.from(table.rows||[]),grid=[];
 for(let r=0;r<rows.length;r++){grid[r]||=[];let col=0;for(const cell of Array.from(rows[r].cells||[])){while(grid[r][col])col++;const selected=range.intersectsNode(cell),text=selected?visit(cell):'';const entry={cell,selected,text};const height=Math.max(1,cell.rowSpan||1),width=Math.max(1,cell.colSpan||1);for(let y=r;y<Math.min(rows.length,r+height);y++){grid[y]||=[];for(let x=col;x<col+width;x++)grid[y][x]=entry;}col+=width;}}
 const selectedRows=grid.map((cells,r)=>({cells,r})).filter(row=>row.cells.some(c=>c?.selected&&c.text.trim()));if(!selectedRows.length)return '';
 const columns=[...new Set(selectedRows.flatMap(row=>row.cells.flatMap((c,i)=>c?.selected&&c.text.trim()?[i]:[])))].sort((a,b)=>a-b);const left=columns[0],right=columns.at(-1);
 const headerRow=rows.findIndex(row=>Array.from(row.cells||[]).some(c=>c.tagName==='TH'));
 const escape=text=>String(text||'').trim().replace(/\r?\n/g,'<br>').replace(/\\?\|/g,'\\|');
 const format=cells=>'| '+cells.map(escape).join(' | ')+' |';
 const headers=Array.from({length:right-left+1},(_,i)=>headerRow>=0?whole(grid[headerRow]?.[left+i]?.cell):`列 ${left+i+1}`);
 const lines=[format(headers),format(headers.map(()=> '---'))];
 for(const {cells,r} of selectedRows){if(r===headerRow)continue;lines.push(format(Array.from({length:headers.length},(_,i)=>cells[left+i]?.selected?cells[left+i].text:'')));}
 return '\n\n'+lines.join('\n')+'\n\n';
}

async function richSelectionText(app, view, root, range, forceLines = false) {
  const all = formulaNodes(root);
  const hasTable=Array.from(root.querySelectorAll('table')).some(table=>range.intersectsNode(table));
  const included = all.filter(element=>range.intersectsNode(element)||(hasTable&&element.closest?.('table')));
  if (!included.length && !forceLines&&!hasTable) return range.toString();
  const missing = included.some((element) => !formulaLatex(element));
  const source = missing ? await app.vault.cachedRead(view.file) : '';
  const formulaText = new Map(included.map((element) => {
    const item = formulaLatex(element) ? null : sourceFormulaFor(source, root, element);
    const latex = formulaLatex(element) || item?.latex || '';
    const block = isBlockFormula(element) || item?.block;
    const delimiter = block ? '$$' : '$';
    return [element, latex ? delimiter + latex + delimiter : '[无法读取公式]'];
  }));
  function whole(node){if(!node)return '';if(node.nodeType===3)return node.nodeValue;if(node.nodeType!==1)return '';if(formulaText.has(node))return formulaText.get(node);if(node.matches('br'))return '\n';return Array.from(node.childNodes).map(whole).join('');}
  function visit(node) {
    if (!range.intersectsNode(node)) return '';
    if(node.nodeType===1&&node.matches('table'))return tableSelectionMarkdown(node,range,visit,whole);
    if (node.nodeType === 3) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
      return node.nodeValue.slice(start, end);
    }
    if (node.nodeType !== 1) return '';
    if (formulaText.has(node)) {
      const value = formulaText.get(node);
      return value.startsWith('$$') ? '\n' + value + '\n' : value;
    }
    if (node.matches('br')) return '\n';
    const value = Array.from(node.childNodes).map(visit).join('');
    return node.matches('p, li, h1, h2, h3, h4, h5, h6, blockquote, tr, div') ? value + '\n' : value;
  }
  return Array.from(root.childNodes).map(visit).join('').replace(/\n{3,}/g, '\n\n').trim();
}

async function formulaAtEvent(app, event) {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view?.file || view.getMode() !== 'preview') return null;
  const root = view.containerEl.querySelector('.markdown-preview-view');
  const element = event?.target?.closest?.('.math, .katex, mjx-container');
  if (!root || !element || !root.contains(element)) return null;
  const outer = element.closest('.math') || element.closest('.katex') || element;
  let latex = formulaLatex(outer);
  let block = isBlockFormula(outer);
  if (!latex) {
    const source = await app.vault.cachedRead(view.file);
    const fromSource = sourceFormulaFor(source, root, outer);
    if (fromSource) { latex = fromSource.latex; block = fromSource.block; }
  }
  if (!latex) return null;
  const rect = outer.getBoundingClientRect();
  const delimiter = block ? '$$' : '$';
  return { text: delimiter + latex + delimiter, formulaElements: [outer],
    formulaElement: outer, latex, block,
    rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    sourcePath: view.file.path };
}

function installToolbar(plugin) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'study-selection-action';
  button.setAttribute('aria-label', 'AI 解释');
  button.title = 'AI 解释';
  setIcon(button, 'sparkles');
  button.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopPropagation(); });
  button.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    const selected = plugin.lastSelection;
    document.dispatchEvent(new Event('study-selection-dismiss'));
    if (selected) plugin.explain(selected);
  });
  function bar() {
    let element = document.querySelector('.' + TOOLBAR);
    if (!element) {
      element = document.createElement('div');
      element.className = TOOLBAR;
      document.body.appendChild(element);
    }
    return element;
  }
  function hide() {
    plugin.lastSelection = null;
    button.style.display = 'none';
    const parent = button.parentElement;
    if (parent && !Array.from(parent.children).some((child) => child.style.display !== 'none')) {
      parent.style.display = 'none';
      parent.classList.remove('study-selection-enter');
    }
  }
  function decorate(selected) {
    plugin.selectedFormulaElements?.forEach((element) => element.classList.remove('selection-explainer-selected-math'));
    plugin.selectedFormulaElements = selected?.formulaElements || [];
    plugin.selectedFormulaElements.forEach((element) => element.classList.add('selection-explainer-selected-math'));
  }
  async function update(event) {
    if (event?.target?.closest?.('.' + TOOLBAR + ', .margin-notes-card, .selection-explainer-card')) return;
    const formulaClick = event?.type === 'mouseup' && plugin.pointerDownFormula &&
      event.target?.closest?.('.math, .katex, mjx-container');
    const selected = formulaClick
      ? await formulaAtEvent(plugin.app, event)
      : await activeSelection(plugin.app) || await formulaAtEvent(plugin.app, event);
    if (!selected) {
      hide(); decorate(null);

      return;
    }
    decorate(selected);
    plugin.lastSelection = selected;
    const element = bar();
    if (!button.isConnected) element.appendChild(button);
    button.style.display = '';
    const entering = element.style.display !== 'flex';
    element.style.display = 'flex';
    if (entering) element.classList.add('study-selection-enter');
    const right = selected.rect?.right ?? window.innerWidth / 2;
    const bottom = selected.rect?.bottom ?? window.innerHeight / 3;
    const top = bottom + 8 + element.offsetHeight <= window.innerHeight - 12
      ? bottom + 8 : Math.max(12, (selected.rect?.top ?? bottom) - element.offsetHeight - 8);
    element.style.left = Math.max(12, Math.min(window.innerWidth - element.offsetWidth - 12,
      right - element.offsetWidth + 8)) + 'px';
    element.style.top = top + 'px';
  }
  plugin.registerDomEvent(document, 'pointerdown', (event) => {
    plugin.pointerDownFormula = event.target?.closest?.('.math, .katex, mjx-container') || null;
  }, true);
  plugin.registerDomEvent(document, 'mouseup', update);
  plugin.registerDomEvent(document, 'keyup', update);
  plugin.registerDomEvent(document, 'study-selection-dismiss', hide);
  plugin.registerDomEvent(document, 'touchend', () => window.setTimeout(update, 80));
  plugin.register(() => {
    decorate(null);
    button.remove();
    const element = document.querySelector('.' + TOOLBAR);
    if (element && !element.children.length) element.remove();
  });
}

class ExplainerSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const root = this.containerEl;
    root.empty();
    root.createEl('h2', { text: 'AI 解释设置' });
    root.createEl('p', { text: 'API Key 使用本页面 DeepSeek API 设置中的共用密钥。' });
    new Setting(root).setName('模型 ID').setDesc('请填写所用服务在控制台提供的准确模型 ID。')
      .addText((text) => text.setPlaceholder('模型 ID').setValue(this.plugin.settings.model).onChange(async (value) => {
        this.plugin.settings.model = value.trim(); await this.plugin.saveData(this.plugin.settings);
      }));
    new Setting(root).setName('接口地址').setDesc('默认使用 DeepSeek 官方 Chat Completions 接口。')
      .addText((text) => text.setValue(this.plugin.settings.endpoint).onChange(async (value) => {
        this.plugin.settings.endpoint = value.trim(); await this.plugin.saveData(this.plugin.settings);
      }));
    new Setting(root).setName('解释上下文范围')
      .setDesc('控制发送给 AI 的选中内容周边文字；选中内容前后各取相同行数。')
      .addDropdown((dropdown) => {
        dropdown.addOption('0', '仅选中内容');
        dropdown.addOption('1', '前后各 1 行');
        dropdown.addOption('3', '前后各 3 行');
        dropdown.addOption('5', '前后各 5 行');
        dropdown.addOption('10', '前后各 10 行');
        dropdown.setValue(String(contextLineCount(this.plugin.settings.contextLines)))
          .onChange(async (value) => {
            this.plugin.settings.contextLines = contextLineCount(value);
            await this.plugin.saveData(this.plugin.settings);
          });
      });
  }
}

function streamChat(endpoint, apiKey, payload, onDelta, onRequest, inactivityTimeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(endpoint); }
    catch { reject(new Error('接口地址无效')); return; }
    if (url.protocol !== 'https:') { reject(new Error('接口地址必须使用 HTTPS')); return; }
    const body = JSON.stringify(payload);
    let finished = false;
    const done = (error) => {
      if (finished) return;
      finished = true;
      if (error) reject(error);
      else resolve();
    };
    const request = https.request(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        let errorBody = '';
        response.on('data', (chunk) => { if (errorBody.length < 2048) errorBody += chunk.toString('utf8'); });
        response.on('end', () => {
          let message = 'HTTP ' + response.statusCode;
          try { message += '：' + (JSON.parse(errorBody).error?.message || '请求失败'); } catch {}
          done(new Error(message));
        });
        response.on('error', done);
        return;
      }
      let buffer = '';
      let completed = false;
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer += chunk;
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
          if (!data) continue;
          if (data === '[DONE]') { completed = true; continue; }
          try {
            const value = JSON.parse(data);
            if (value.error) throw new Error(value.error.message || 'API 返回错误');
            const delta = value.choices?.[0]?.delta?.content;
            if (delta) onDelta(delta);
          } catch (error) {
            done(error);
            request.destroy();
            return;
          }
        }
        if (buffer.length > 2_000_000) { done(new Error('流式响应格式错误')); request.destroy(); }
      });
      response.on('end', () => done(completed ? null : new Error('响应意外中断')));
      response.on('error', done);
    });
    onRequest(request);
    request.setTimeout(inactivityTimeoutMs, () => request.destroy(new Error(`等待模型响应超时（连续 ${Math.round(inactivityTimeoutMs / 1000)} 秒没有收到数据）`)));
    request.on('error', done);
    request.write(body);
    request.end();
  });
}

module.exports = class SelectionExplainer extends Plugin {
  async onload() {
    const savedSettings = Object.assign({}, await this.loadData());
    const hadLegacyApiKey = Object.prototype.hasOwnProperty.call(savedSettings, 'apiKey');
    const legacyApiKey = savedSettings.apiKey;
    await this.adoptSharedDeepSeekApiKey?.(legacyApiKey);
    delete savedSettings.apiKey;
    this.settings = Object.assign({}, DEFAULTS, savedSettings);
    if (hadLegacyApiKey) await this.saveData(this.settings);

    this.session = null;
    this.requestId = 0;
    this.selectedFormulaElements = [];
    this.activeRequest = null;
    this.addSettingTab(new ExplainerSettings(this.app, this));
    this.addCommand({ id: 'explain-selection', name: 'AI 解释选中文本', editorCallback: async (editor, view) => {
      const text = editor.getSelection();
      if (!text.trim()) return new Notice('请先选中文本');
    this.explain(await activeSelection(this.app) || { text, rect: selectionRect(), sourcePath: view.file?.path || '' });
    }});

    this.registerDomEvent(document,'click',event=>{
      if(!this.session||event.button!==0||event.target?.closest?.('.selection-explainer-card,.study-selection-toolbar'))return;
      const target=event.target;if(!target?.matches?.('.markdown-preview-view,.markdown-preview-sizer,.markdown-preview-section,.markdown-preview-section > div,.cm-scroller,.cm-content,.workspace-leaf-content'))return;
      const bounds=target.getBoundingClientRect();if(event.clientX>=bounds.right-18)return;
      this.closeCard();
    },true);
    this.registerDomEvent(window, 'resize', () => { if (this.session) this.positionCard(); });
    this.registerDomEvent(document, 'scroll', () => { if (this.session) this.positionCard(); }, true);
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if(this.session)this.positionCard();
    }));
    this.register(() => this.closeCard());
  }

  closeCard() {
    this.requestId++;
    this.activeRequest?.destroy();
    this.activeRequest = null;
    if (this.session?.renderTimer) window.clearTimeout(this.session.renderTimer);
    this.session?.renderComponents?.forEach((component) => component.unload());
    this.session?.quoteComponent?.unload();
    this.session?.card?.remove();
    this.session?.host?.remove();
    this.session = null;
  }

  positionCard() {
    const session = this.session;
    if (!session) return;
    if (session.host) {
      if(session.host.isConnected)return;
      session.card.classList.add('has-opened');document.body.appendChild(session.card);session.card.classList.add('is-floating');session.host=null;
      session.rect=session.lastAnchor||session.rect;
    }
    const width = session.card.offsetWidth;
    const selectedRoot=session.selected?.range?.startContainer;
    const rects=selectedRoot?.isConnected?session.selected.range.getClientRects():null;
    const anchor = rects?.length ? rects[rects.length - 1]
      : session.selected?.formulaElement?.isConnected?session.selected.formulaElement.getBoundingClientRect():session.rect;
    if (!anchor) return;
    session.lastAnchor=anchor;
    const hasLiveAnchor=!!rects?.length||session.selected?.formulaElement?.isConnected;
    const scrollDelta=hasLiveAnchor?0:(session.scrollRoot?.scrollTop||0)-(session.scrollAtOpen||0);
    const pane=session.notePane?.getBoundingClientRect?.();
    const center=pane?(pane.left+pane.right)/2:window.innerWidth/2;
    session.card.style.left=Math.max(12,Math.min(window.innerWidth-width-12,center-width/2))+'px';
    let top=anchor.bottom+12-scrollDelta;
    if(session.initialCardTop==null){const room=window.innerHeight-top-12;if(room<260){session.anchorShift=Math.max(12,window.innerHeight-Math.min(600,window.innerHeight-24)-12)-top;top+=session.anchorShift;}else session.anchorShift=0;session.initialCardTop=top;session.card.style.maxHeight=Math.max(140,window.innerHeight-top-12)+'px';}
    else top+=session.anchorShift||0;
    session.card.style.top=top+'px';
    session.card.style.position='fixed';
  }

  async explain(selected) {
    const quote = selected.text?.trim();
    if (!quote) return new Notice('请先选中文本');
    
    if (quote.length > 12000) return new Notice('选中内容过长，请缩短到 12000 字以内');
    if (!this.getSharedDeepSeekSettings?.().apiKey) {
      new Notice('请先在 Learning Hub 设置中填写共用 DeepSeek API Key 和 AI 解释模型 ID');
      this.app.setting?.open();
      this.app.setting?.openTabById?.(this.settingsHost?.manifest.id || this.manifest.id);
      return;
    }
    try { if (new URL(this.settings.endpoint).protocol !== 'https:') throw new Error(); }
    catch { return new Notice('接口地址必须是有效的 HTTPS 地址'); }
    this.closeCard();
    let context;
    try { context = await contextForSelection(this.app, selected, this.settings.contextLines); }
    catch { context = { before: '', after: '' }; new Notice('无法读取周边上下文，将只解释选中内容'); }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const host = view?.file?.path === selected.sourcePath ? inlineHostFor(view, selected) : null;
    const card = document.createElement('section');
    card.className = 'selection-explainer-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'AI 解释');
    if (host) host.appendChild(card);
    else { card.classList.add('is-floating'); document.body.appendChild(card); }
    const header = card.createDiv({ cls: 'selection-explainer-header' });
    header.createEl('span', { text: '解释', cls: 'selection-explainer-title' });
    header.createEl('button', { text: '×', cls: 'selection-explainer-close', attr: { 'aria-label': '关闭解释' } }).onclick = () => this.closeCard();
    const thread = card.createDiv({ cls: 'selection-explainer-thread' });
    const composer = card.createDiv({ cls: 'selection-explainer-composer' });
    const input = composer.createEl('textarea', { attr: { rows: '2', placeholder: '继续追问…', 'aria-label': '继续追问' } });
    const send = composer.createEl('button', { text: '发送', cls: 'selection-explainer-send' });
    const actions=card.createDiv({cls:'selection-explainer-actions is-persistent'});
    card.insertBefore(actions,composer);
    const save=actions.createEl('button',{text:'存为批注',cls:'selection-explainer-save-annotation'});
    const expand=actions.createEl('button',{text:'更详细解释',cls:'selection-explainer-expand'});
    const copy=actions.createEl('button',{text:'复制',cls:'selection-explainer-copy'});
    this.session = { card, host, rect: selected.rect, quote, sourcePath: selected.sourcePath || '',
      selected, context, notePane:view?.containerEl,
      thread, input, send, actions, save, expand, copy, savedAnswers:new Set(), scrollRoot:view?.containerEl.querySelector('.markdown-preview-view,.cm-scroller'), scrollAtOpen:view?.containerEl.querySelector('.markdown-preview-view,.cm-scroller')?.scrollTop||0, history: [], loading: false, lastAnswer: '',
      renderComponents: new Map(), renderPromises: new Map(), renderTimer: null,
      allowMermaid: false, answers: [] };
    send.onclick = () => this.followUp();
    save.onclick=()=>{const current=this.session;if(!current||current.loading||!current.lastAnswer)return;this.addAnswerToNotes(current,current.lastAnswer,save);};
    expand.onclick=()=>{if(this.session?.loading||!this.session?.lastAnswer)return;this.sendTurn('请针对最初选中的内容，把刚才的解释讲得更详细：补充必要的基础概念，逐步说明公式或推导，给出具体例子，并指出常见误解。周围上下文只用于理解，不要扩展成整篇笔记的讲解。',false,true);};
    copy.onclick=async()=>{if(!this.session?.lastAnswer)return;try{await navigator.clipboard.writeText(this.session.lastAnswer);copy.setText('已复制');}catch{new Notice('复制失败');}};
    this.syncActions(this.session);

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.followUp();
      }
    });
    this.positionCard();
    const session = this.session;
    if (this.session !== session) return;
    await this.sendTurn(initialPrompt(quote, session.context, this.settings.contextLines), false);
  }

  async addAnswerToNotes(session, answer, button) {
    const notes = this.notes;
    if (!notes?.addAIAnnotation) return new Notice('请先启用「批注」插件');
    button.disabled = true;
    try {
      await notes.addAIAnnotation({ filePath: session.sourcePath, quote: session.quote, answer,
        range: session.selected.range, formulaElement: session.selected.formulaElement,
        latex: session.selected.latex, block: session.selected.block });
      session.savedAnswers?.add(answer);button.setText('已加入批注');
      new Notice('AI 解释已加入批注');
    } catch (error) {
      button.disabled = false;
      new Notice('加入批注失败：' + (error.message || error));
    }
  }

  async followUp() {
    const session = this.session;
    if (!session || session.loading) return;
    const question = session.input.value.trim();
    if (!question) return;
    session.input.value = '';
    await this.sendTurn(question, true);
  }

  async renderMarkdown(session, element, content) {
    const previousRender = session.renderPromises.get(element) || Promise.resolve();
    const render = previousRender.catch(() => {}).then(async () => {
      if (this.session !== session) return;
      const component=new Component();component.load();
      const staging=document.createElement('div');staging.className=element.className;
      try{await MarkdownRenderer.render(this.app,safeMarkdown(content,session.allowMermaid),staging,session.sourcePath,component);}catch{staging.setText(content);}
      if(this.session!==session){component.unload();return;}
      const keepAtBottom=session.thread.scrollHeight-session.thread.scrollTop-session.thread.clientHeight<64;
      const scrollTop=session.thread.scrollTop;
      session.renderComponents.get(element)?.unload();
      element.replaceChildren(...Array.from(staging.childNodes));
      session.renderComponents.set(element,component);
      session.thread.scrollTop=keepAtBottom?session.thread.scrollHeight:scrollTop;
      this.positionCard();
    });
    session.renderPromises.set(element, render);
    await render;
  }

  scheduleMarkdown(session, element, content) {
    if (session.renderTimer) return;
    session.renderTimer = window.setTimeout(() => {
      session.renderTimer = null;
      this.renderMarkdown(session, element, content());
    }, 120);
  }

  syncActions(session){if(!session?.save)return;const unavailable=session.loading||!session.lastAnswer;session.save.disabled=unavailable||session.savedAnswers.has(session.lastAnswer);session.expand.disabled=unavailable;session.copy.disabled=unavailable;session.save.setText(session.savedAnswers.has(session.lastAnswer)?'已加入批注':'存为批注');session.copy.setText('复制');}

  async sendTurn(message, showUser, detailed = false) {
    const session = this.session;
    if (!session || session.loading) return;
    session.loading = true;
    session.send.disabled = true;
    this.syncActions(session);
    if (showUser) {
      const user = session.thread.createDiv({ cls: 'selection-explainer-message is-user' });
      user.createEl('div', { text: message, cls: 'selection-explainer-user-text' });
    }
    session.history.push({ role: 'user', content: message });
    if(detailed)session.thread.createEl('hr',{cls:'selection-explainer-detail-divider'});
    const assistant = session.thread.createDiv({ cls: 'selection-explainer-message is-assistant' });
    assistant.createEl('div', { text: detailed?'详细解释':'解释', cls: detailed?'selection-explainer-detail-label':'selection-explainer-message-label' });
    const body = assistant.createDiv({ cls: 'selection-explainer-answer markdown-rendered' });
    body.createEl('span', { text: detailed ? '正在深入思考并生成解释' : '正在生成', cls: 'selection-explainer-loading' });
    this.positionCard();
    session.thread.scrollTop = session.thread.scrollHeight;
    const requestId = ++this.requestId;
    let answer = '';
    try {
      await streamChat(this.getSharedDeepSeekSettings().endpoint || this.settings.endpoint, this.getSharedDeepSeekSettings().apiKey, {
        model: this.settings.model || this.getSharedDeepSeekSettings().model || 'deepseek-flash',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...session.history],
        thinking: { type: detailed ? 'enabled' : 'disabled' },
        ...(detailed ? {reasoning_effort:'high'} : {}),
        max_tokens: detailed ? 16384 : 1800,
        stream: true
      }, (delta) => {
        if (this.session !== session || requestId !== this.requestId) return;
        answer += delta;
        if (answer === delta) body.setText(answer);
        this.scheduleMarkdown(session, body, () => answer);
      }, (request) => { this.activeRequest = request; }, detailed ? 240_000 : 90_000);
      if (this.session !== session || requestId !== this.requestId) return;
      if (session.renderTimer) { window.clearTimeout(session.renderTimer); session.renderTimer = null; }
      if (!answer) throw new Error('API 未返回解释内容');
      await this.renderMarkdown(session, body, answer);
      session.answers.push({ element: body, content: answer });
      if (!session.allowMermaid && /^\s*```mermaid\b/im.test(answer)) {
        const showDiagram = assistant.createEl('button', { text: '显示 Mermaid 图表', cls: 'selection-explainer-diagram-action' });
        showDiagram.onclick = async () => {
          session.allowMermaid = true;
          showDiagram.remove();
          for (const item of session.answers) await this.renderMarkdown(session, item.element, item.content);
        };
      }
      session.history.push({ role: 'assistant', content: answer });
      session.lastAnswer = answer;

    } catch (error) {
      if (this.session !== session || requestId !== this.requestId) return;
      if (session.renderTimer) { window.clearTimeout(session.renderTimer); session.renderTimer = null; }
      if (answer) {
        await this.renderMarkdown(session, body, answer);
        body.createEl('p', { text: '回复中断：' + (error.message || error), cls: 'selection-explainer-error' });
      } else body.setText('请求失败：' + (error.message || error));
      session.history.pop();
    } finally {
      if (this.session === session && requestId === this.requestId) {
        this.activeRequest = null;
        session.loading = false;
        session.send.disabled = false;
        this.syncActions(session);
        this.positionCard();
      }
    }
  }
};

return module.exports;
})();

module.exports=class StudyReader{
 async persist(){const snapshot=JSON.parse(JSON.stringify(this.config));this.configQueue=(this.configQueue||Promise.resolve()).catch(()=>{}).then(()=>this.saveData(snapshot));return this.configQueue;}
 async onload(){this.config=await this.loadData()||{};
 const readLegacy=async id=>{const path=`${this.app.vault.configDir}/plugins/${id}/data.json`;return await this.app.vault.adapter.exists(path)?JSON.parse(await this.app.vault.adapter.read(path)):{};};
 if(!this.config.api){this.config.api=await readLegacy('selection-explainer');await this.persist();}
 const ai=new AIController(this.app,this.manifest),notes=new selectionService.Controller(this.app,this.manifest);this.ai=ai;this.notes=notes;ai.notes=notes;notes.ai=ai;
 for(const child of [ai,notes])for(const method of ['register','registerEvent','registerDomEvent','registerView','registerMarkdownPostProcessor','addCommand','addRibbonIcon','addSettingTab'])child[method]=this[method].bind(this);
 ai.settingsHost=this.settingsHost;ai.getSharedDeepSeekSettings=this.getSharedDeepSeekSettings;ai.adoptSharedDeepSeekApiKey=this.adoptSharedDeepSeekApiKey;
 ai.loadData=async()=>this.config.api;ai.saveData=async value=>{this.config.api=value;await this.persist();};notes.loadData=async()=>({storageVersion:1});notes.saveData=async()=>{};
 await ai.onload();await notes.onload();
 }
};
