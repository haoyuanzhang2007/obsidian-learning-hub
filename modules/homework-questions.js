'use strict';
const {createHash}=require('crypto');
const {t:tr}=require('./i18n');
const text=value=>typeof value==='string'?value.trim():'';
const identity=item=>`${text(item.label)}\n${text(item.markdown).replace(/\s+/g,' ')}`;
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,12);
function normalizeHomeworkQuestions(items=[],previous=[]){
  const prior=new Map(previous.map(item=>[identity(item),item]));
  const questions=items.map((source,index)=>{
    const label=text(source?.label)||`Q${index+1}`,markdown=text(source?.markdown);
    if(!markdown)throw new Error(tr('作业题干不完整，请重新分析。'));
    const key=identity({label,markdown}),old=prior.get(key),id=old?.id||`q-${hash(key)}`;
    const oldParts=new Map((old?.subquestions||[]).map(part=>[identity(part),part]));
    const parts=(Array.isArray(source.subquestions)?source.subquestions:[]).map((part,i)=>{
      const label=text(part.label)||`(${i+1})`,markdown=text(part.markdown);if(!markdown)throw new Error(tr('作业小问题干不完整，请重新分析。'));
      const key=identity({label,markdown});return {id:oldParts.get(key)?.id||`${id}:p-${hash(key)}`,label,markdown,contextMarkdown:text(part.contextMarkdown)};
    });
    if(new Set(parts.map(part=>part.id)).size!==parts.length)throw new Error(tr('作业小问重复，请重新分析。'));
    return {id,label,markdown,contextMarkdown:text(source.contextMarkdown),subquestions:parts};
  });
  if(new Set(questions.map(q=>q.id)).size!==questions.length)throw new Error(tr('作业大题重复，请重新分析。'));
  return questions;
}
function flattenHomeworkQuestions(questions=[]){
  return questions.flatMap(question=>[question,...(question.subquestions||[]).map(part=>({...part,parentQuestionId:question.id,parentQuestionLabel:question.label,parentContext:question.contextMarkdown||question.markdown,topics:part.topics?.length?part.topics:question.topics||[],difficulty:part.difficulty||question.difficulty}))]);
}
function homeworkWrongPrompt(question){
  return question.parentQuestionId?[question.parentContext,question.contextMarkdown,`${question.parentQuestionLabel} ${question.label}\n${question.markdown}`].filter(Boolean).join('\n\n'):question.markdown;
}
module.exports={normalizeHomeworkQuestions,flattenHomeworkQuestions,homeworkWrongPrompt};
