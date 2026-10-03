const { t: tr } = require('./i18n');
'use strict';

const datePart=value=>String(value||'').slice(0,10);
const dueStamp=task=>task?.due?`${task.due}T${/^\d\d:\d\d$/.test(task.dueTime||'')?task.dueTime:'23:59'}`:'';
const completed=task=>task?.status==='on-time'||task?.status==='late'||task?.done===true;

function tasksForToday(tasks=[],slots=[],date=''){
  const scheduled=new Map();
  for(const slot of slots)if(slot?.taskId&&datePart(slot.start)===date&&(!scheduled.has(slot.taskId)||slot.start<scheduled.get(slot.taskId)))scheduled.set(slot.taskId,slot.start);
  return tasks.filter(task=>scheduled.has(task.id)||task.due===date||(!completed(task)&&task.due&&task.due<date)||datePart(task.completedAt)===date).sort((a,b)=>{
    if(completed(a)!==completed(b))return completed(a)?1:-1;
    const aTime=scheduled.get(a.id)||dueStamp(a)||'9999',bTime=scheduled.get(b.id)||dueStamp(b)||'9999';
    return aTime.localeCompare(bTime)||String(a.title||'').localeCompare(String(b.title||''),'zh-CN');
  });
}

function urgencyBand(task,nowStamp){
  const deadline=dueStamp(task);
  if(!deadline)return 5;
  const date=nowStamp.slice(0,10);
  if(deadline<nowStamp)return 0;
  if(task.due===date)return 1;
  const days=Math.round((new Date(`${task.due}T12:00`)-new Date(`${date}T12:00`))/86400000);
  return days<=1?2:days<=3?3:4;
}

function recentDeadlineTasks(tasks=[],nowStamp='',limit=5){
  const compare=(a,b)=>urgencyBand(a,nowStamp)-urgencyBand(b,nowStamp)||dueStamp(a).localeCompare(dueStamp(b))||Number(b.minutes||0)-Number(a.minutes||0)||String(a.title||'').localeCompare(String(b.title||''),'zh-CN');
  const pinned=tasks.filter(task=>task.pinned).sort(compare);
  const other=tasks.filter(task=>!task.pinned&&!completed(task)&&task.due).sort(compare).slice(0,Math.max(0,limit));
  return [...pinned,...other];
}

function deadlineLabel(task,nowStamp){
  if(!task.due)return tr("未设置 DDL");
  const clock=task.dueTime?` ${task.dueTime}`:'';
  const band=urgencyBand(task,nowStamp);
  const prefix=band===0?tr("已逾期 · "):band===1?tr("今天 · "):band===2?tr("明天 · "):band===3?tr("即将截止 · "):'';
  return `${prefix}${task.due}${clock}`;
}

module.exports={dueStamp,completed,tasksForToday,urgencyBand,recentDeadlineTasks,deadlineLabel};
