'use strict';
const {t:tr}=require('./i18n');
const checked=value=>value===true||value==='true'||value===1||value==='1';
const isLongTerm=task=>task?.taskType==='long-term';
function normalizeTaskOptions(values={},existing={}){
  const get=key=>Object.hasOwn(values,key)?values[key]:existing[key];
  const taskType=get('taskType')==='long-term'?'long-term':'one-time';
  const unit=values.durationUnit==='hours'?'hours':'minutes';
  let estimate=get('estimatedMinutes');
  if(estimate===undefined||estimate===null||String(estimate).trim()==='')estimate=null;
  else{
    estimate=Number(estimate)*(Object.hasOwn(values,'estimatedMinutes')&&unit==='hours'?60:1);
    if(!Number.isFinite(estimate)||estimate<1||estimate>100800)throw new Error(tr('预计用时须为 1–100800 分钟，可留空由 AI 估计。'));
    estimate=Math.round(estimate);
  }
  return {taskType,urgent:checked(get('urgent')),pinned:checked(get('pinned')),estimatedMinutes:estimate,minutesSource:estimate===null?'auto':'user',durationUnit:unit};
}
function taskDurationLabel(task){
  const explicit=Number(task?.estimatedMinutes)>0;
  if(isLongTerm(task))return explicit?tr('长期项目 · 每次 {0} 分钟',[task.estimatedMinutes]):tr('长期项目 · 每次用时由 AI 估计');
  return explicit?tr('预计 {0} 分钟',[task.estimatedMinutes]):Number(task?.aiEstimatedMinutes)>0?tr('AI 预计 {0} 分钟',[task.aiEstimatedMinutes]):task?.aiEstimateStatus==='pending'?tr('AI 正在评估用时'):tr('用时由 AI 估计');
}
// Pins are a display preference; only urgent and deadlines affect scheduling.
const deadline=task=>task.before||(task.due?`${task.due}T${/^\d\d:\d\d$/.test(task.dueTime||'')?task.dueTime:'23:59'}`:'9999');
const compareTaskPriority=(a,b)=>Number(!!b.urgent)-Number(!!a.urgent)||deadline(a).localeCompare(deadline(b));
module.exports={checked,isLongTerm,normalizeTaskOptions,taskDurationLabel,compareTaskPriority};
