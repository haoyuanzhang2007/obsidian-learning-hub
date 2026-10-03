const EN = require('./ui-strings');
const ZH = require('./ui-copy');
let language = 'zh-CN';
const normalizeInterfaceLanguage = value => value === 'en' ? 'en' : 'zh-CN';
function setInterfaceLanguage(value) { language = normalizeInterfaceLanguage(value); }
function uiLocale() { return language === 'en' ? 'en-US' : 'zh-CN'; }
// Positional interpolation preserves user content, including braces and dollar signs.
// Only explicit interface keys are translated; notes and generated text stay intact.
function translate(value, key, values = []) {
  const language=normalizeInterfaceLanguage(value);
  const source = String(key ?? '');
  let copy = language === 'en' ? (EN[source] ?? source) : (ZH[source] ?? source);
  if(language==='en')copy=copy.replace(/\{(\d+)\} (tasks|courses|lessons|files|events|questions|chats|topics|concepts|assessments|days)/g,(phrase,index,noun)=>Number(values[index])===1?`{${index}} ${noun.slice(0,-1)}`:phrase);
  return copy.replace(/\{(\d+)\}/g, (token, index) => index < values.length ? String(values[index] ?? '') : token);
}
function t(key, values=[]){return translate(language,key,values);}
module.exports = {t, translate, uiLocale, setInterfaceLanguage, normalizeInterfaceLanguage};
