function previewGroups(concepts = []) {
  const groups = new Map();
  for (const concept of concepts) {
    const name = String(concept.group || '本讲要点').trim() || '本讲要点';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(concept);
  }
  return [...groups].map(([title, items]) => ({ title, items }));
}

function mergeGeneratedPreview(previous = {}, generated, idFactory) {
  const old = new Map((previous.concepts || []).map(item => [String(item.title || '').trim().toLocaleLowerCase(), item]));
  return {
    ...previous,
    description: String(generated.description || previous.description || '').trim(),
    summary: generated.summary,
    objectives: generated.objectives,
    concepts: generated.concepts.map(item => {
      const found = old.get(item.title.trim().toLocaleLowerCase());
      return { id: found?.id || idFactory(), ...item, status: found?.status || null, note: found?.note || '' };
    }),
  };
}

function legacyPreviewDraft(draft, idFactory) {
  const summary = Array.isArray(draft.summary) ? draft.summary : String(draft.objectives || '').split(/\n+/).map(value => value.trim()).filter(Boolean);
  return {
    description: String(draft.description || summary.slice(0, 2).join(' ')),
    summary,
    objectives: String(draft.objectives || summary.join('\n')),
    concepts: (draft.concepts || []).map(item => ({ id: idFactory(), group: item.group || '本讲要点', title: item.title, summary: item.summary, status: null, note: '' })),
  };
}

const FORMULA = /(?:((?<![A-Za-z0-9_（(])[A-Za-zΑ-Ωα-ωϕφλβ][A-Za-z0-9_₀-₉ᵢⱼᵀ′]*(?:\([^()\n]{1,48}\))?\s*=\s*[^\s，。；：、]+)|[A-Za-z][₀-₉ᵢⱼ]+(?:[A-Za-z][₀-₉ᵢⱼ]+)+|\bC\([^()]*[+,][^()]*\)|\([^()]*[−+′][^()]*\)[²³]|λ∑[₀-₉ᵢⱼ]*\|[^|]+\|)/gu;

function mathToLatex(value) {
  const subscripts = { '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9','ᵢ':'i','ⱼ':'j' };
  return value.replace(/[₀-₉ᵢⱼ]+/gu, part => `_{${[...part].map(char => subscripts[char]).join('')}}`)
    .replace(/ϕ|φ/g, '\\phi ').replace(/λ/g, '\\lambda ').replace(/β/g, '\\beta ')
    .replace(/∑/g, '\\sum ').replace(/ᵀ/g, '^{\\mathsf T}').replace(/′/g, '^{\\prime}')
    .replace(/²/g, '^2').replace(/³/g, '^3').replace(/−/g, '-').replace(/≥/g, '\\ge ').replace(/≤/g, '\\le ').replace(/≠/g, '\\ne ')
    .replace(/·/g, '\\cdot ').replace(/\b(log|exp)\(/g, (_match, name) => `\\${name}(`)
    .replace(/\b(Precision|Recall|F1|TPR|FPR|AUC|MSE|MAE|TP|FP|TN|FN)\b/g, (_match, name) => `\\mathrm{${name}}`);
}

function formatPreviewMarkdown(markdown) {
  const source = String(markdown || '').replace(/\\\(([^\n]*?)\\\)/g, '$$$1$$').replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');
  // Keep authored Markdown, code and math intact. Only upgrade unmistakable
  // formula-like fragments in legacy AI prose at display time.
  return source.split(/(`[^`]*`)/g).map((part, index) => {
    if(index % 2)return part;
    const normalized=part.replace(/\\+\$([^$\n]+?)\\+\$/g,(_match,expression)=>`$${expression}$`);
    return normalized.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g).map((segment,segmentIndex)=>{
      if(segmentIndex%2)return segment;
      return segment.replace(FORMULA,(match,...args)=>{
        const offset=args.at(-2);
        let depth=0;
        for(const char of segment.slice(0,offset)){if(char==='(')depth++;else if(char===')')depth=Math.max(0,depth-1);}
        return depth ? match : `$${mathToLatex(match)}$`;
      });
    }).join('');
  }).join('');
}

module.exports = { previewGroups, mergeGeneratedPreview, legacyPreviewDraft, formatPreviewMarkdown };
