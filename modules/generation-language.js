const normalizeGenerationLanguage = value => value === 'en' ? 'en' : 'zh-CN';

function generationLanguageInstruction(value) {
  return normalizeGenerationLanguage(value) === 'en'
    ? 'Write all generated prose, headings, topic names, questions, answers, and summaries in English. Preserve formulas, code, proper nouns, and useful terms from the source material.'
    : '所有生成的正文、标题、主题名、问题、答案和摘要使用中文；保留必要的英文术语、公式、代码及专有名词。';
}

function systemLanguageInstruction(value){
  return normalizeGenerationLanguage(value)==='en'
    ? 'Use English for every user-facing system reply, schedule summary, adjustment explanation, and generated task description, regardless of the language of earlier replies or source materials. Preserve user-provided task titles, course names, file names, identifiers, formulas, and code as written. Keep JSON keys unchanged.'
    : '本轮所有面向用户的系统回复、日程摘要、调整说明及生成的事项说明都使用中文，不受历史回复或资料语言影响。用户提供的任务标题、课程名、文件名、标识符、公式和代码保持原文，JSON字段名不变。';
}
module.exports = { normalizeGenerationLanguage, generationLanguageInstruction, systemLanguageInstruction };
