const normalizeGenerationLanguage = value => value === 'en' ? 'en' : 'zh-CN';

function generationLanguageInstruction(value) {
  return normalizeGenerationLanguage(value) === 'en'
    ? 'Write all generated prose, headings, topic names, questions, answers, and summaries in English. Preserve formulas, code, proper nouns, and useful terms from the source material.'
    : '所有生成的正文、标题、主题名、问题、答案和摘要使用中文；保留必要的英文术语、公式、代码及专有名词。';
}

module.exports = { normalizeGenerationLanguage, generationLanguageInstruction };
