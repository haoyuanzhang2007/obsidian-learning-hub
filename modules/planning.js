'use strict';

const {compareTaskPriority}=require('./task-options');
const {randomUUID}=require('crypto');
const day=value=>String(value||'').slice(0,10);
const minutes=value=>{if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value||''))return NaN;const [year,month,date,hour,minute]=value.match(/\d+/g).map(Number);return Date.UTC(year,month-1,date,hour,minute)/60000;};
const overlap=(a,b)=>minutes(a.start)<minutes(b.end)&&minutes(b.start)<minutes(a.end);
const plus=(stamp,count)=>new Date((minutes(stamp)+count)*60000).toISOString().slice(0,16);

function classifyCalendarEvent(event,overrides={}){
  const title=String(event?.title||'');
  const match=title.match(/\b(lec(?:ture)?|tut(?:orial)?|lab(?:oratory)?)\b/i);
  const type=overrides[event?.id]?.type||(!match?'event':/^lec/i.test(match[1])?'lec':/^tut/i.test(match[1])?'tut':'lab');
  const courseCode=(title.match(/\b([A-Z]{4})\s*[- ]?\s*(\d{4})\b/i)||[]).slice(1,3).join(' ').toUpperCase();
  return {type,courseCode};
}

function applyCalendarAttendanceRules(events=[],choices={},rules=[]){
  const next={...choices};
  for(const event of events){if(typeof next[event.id]?.attend==='boolean')continue;const type=classifyCalendarEvent(event,next).type,day=new Date(String(event.start).slice(0,10)+'T12:00:00Z').getUTCDay();
    const rule=rules.find(row=>row.type===type&&String(event.title||'').toLowerCase().includes(String(row.title||'').toLowerCase())&&(!Array.isArray(row.days)||row.days.includes(day)));if(rule)next[event.id]={...(next[event.id]||{}),attend:rule.attend===true};
  }return next;
}

function matchCalendarCourse(event,courses=[]){
  const code=classifyCalendarEvent(event).courseCode;
  if(code){const exact=courses.find(course=>course.toUpperCase().startsWith(`${code} -`));if(exact)return exact;}
  const compact=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  const title=compact(String(event?.title||'').replace(/\s*\[(?:LEC|TUT|LAB)\]\s*/gi,' '));
  return courses.find(course=>{const name=compact(course.split(' - ').slice(1).join(' - '));return name.length>=8&&title.length>=8&&(name.startsWith(title)||title.startsWith(name));})||null;
}

function calendarBlocks(events,choices={}){
  return (events||[]).filter(event=>{
    const type=classifyCalendarEvent(event,choices).type;
    if(type==='lec')return true;
    if((type==='tut'||type==='lab')&&choices[event.id]?.attend===true)return true;
    if(event.busy===false)return false;
    return type==='event';
  }).map(event=>({...event,busy:true}));
}

function estimateMinutes(task,history=[]){
  if(Number(task.aiEstimatedMinutes)>0&&!Number(task.estimatedMinutes))return Math.round(Number(task.aiEstimatedMinutes));
  if(Number.isFinite(Number(task.estimatedMinutes))&&Number(task.estimatedMinutes)>0)return Math.round(Number(task.estimatedMinutes));
  const title=String(task.title||'').toLowerCase(),description=String(task.description||'');
  let base=task.taskType==='long-term'&&/词汇|单词|vocab|word/.test(title)?20:45;
  if(/论文|报告|project|presentation|编程|代码|实验报告|essay|作业/.test(title))base=90;
  else if(/复习|review|阅读|read/.test(title))base=40;
  else if(/预习|preview/.test(title))base=50;
  if(description.length>160)base+=30;
  if(description.length>500)base+=30;
  if(/复杂|困难|综合|多步骤|难题/.test(`${title} ${description}`))base+=30;
  const relevant=history.filter(x=>x.kind===(task.kind||'task')&&Number(x.estimatedMinutes)>0).slice(-12);
  if(relevant.length){
    const ratio=relevant.reduce((sum,x)=>sum+Math.min(2.5,Math.max(.5,Number(x.actualMinutes)>0?Number(x.actualMinutes)/Number(x.estimatedMinutes):x.status==='late'?1.25:1)),0)/relevant.length;
    const late=relevant.filter(x=>x.status==='late').length/relevant.length;
    base*=Math.max(.8,Math.min(2,ratio+late*.15));
  }
  return Math.max(20,Math.min(360,Math.round(base/5)*5));
}

function taskStatus(item){return item?.status|| (item?.done?'on-time':'unfinished');}

function scheduleItemState(slot,{choices={},outcomes={},tasks=[],now=''}={}){
  const calendar=slot?.source==='google-calendar';
  const system=slot?.source==='system-schedule'||slot?.source==='profile-setting'||(slot?.source==='fixed-setting'&&slot.title?.startsWith('睡眠'));
  const type=calendar?classifyCalendarEvent(slot,choices).type:'';
  const course=['lec','tut','lab'].includes(type);
  let status=course||system?null:taskStatus(calendar?outcomes[slot.id]:slot);
  if(!calendar&&status==='unfinished'&&slot?.taskId){const linked=tasks.find(task=>task.id===slot.taskId);if(linked)status=taskStatus(linked);}
  const expired=!!(now&&slot?.end&&(system?slot.end<=now:slot.end<now));
  const hiddenRule=slot?.visible===false||(slot?.source==='fixed-setting'&&slot.title?.startsWith('睡眠'));
  return {course,type,status,expired,hidden:hiddenRule||expired&&(system||course||status!=='unfinished'),overdue:!hiddenRule&&expired&&!system&&!course&&status==='unfinished'};
}

function retainPendingCalendarEvents(previousEvents=[],pendingEvents=[],currentEvents=[],{choices={},outcomes={},now=''}={}){
  const currentIds=new Set(currentEvents.map(event=>event.id));
  const previous=new Map([...pendingEvents,...previousEvents].map(event=>[event.id,event]));
  return [...previous.values()].filter(event=>!currentIds.has(event.id)&&scheduleItemState(event,{choices,outcomes,now}).overdue);
}

function planIncrementally({request,existing=[],now='',idFactory=randomUUID}={}){
  const current=now||`${request.startDate}T00:00`;
  const tasks=new Map(request.tasks.map(task=>[task.id,task]));
  const hard=[...request.fixedBlocks,...request.busySlots,...(request.restBlocks||[])];
  const kept=[],assigned=new Map();
  for(const slot of [...existing].sort((a,b)=>String(a.start).localeCompare(String(b.start)))){
    if(!['ai','ai-schedule'].includes(slot.source)){kept.push(slot);continue;}
    if(slot.start.slice(0,10)<request.startDate||slot.start.slice(0,10)>request.endDate){kept.push(slot);continue;}
    if(slot.start<current||taskStatus(slot)!=='unfinished'){
      kept.push(slot);
      if(slot.taskId&&(slot.start>=current||taskStatus(slot)!=='unfinished'))assigned.set(slot.taskId,(assigned.get(slot.taskId)||0)+minutes(slot.end)-minutes(slot.start));
      continue;
    }
    const task=tasks.get(slot.taskId);
    const available=request.availability.some(window=>slot.start>=window.start&&slot.end<=window.end);
    if(!task||!available||hard.some(block=>overlap(slot,block))||kept.some(block=>overlap(slot,block))||task.before&&slot.end>task.before||task.due&&day(slot.end)>task.due)continue;
    const already=assigned.get(task.id)||0,remaining=task.minutes-already;
    if(remaining<=0)continue;
    const duration=minutes(slot.end)-minutes(slot.start);
    const retained=duration>remaining?{...slot,end:plus(slot.start,remaining)}:slot;
    kept.push(retained);
    assigned.set(task.id,already+Math.min(duration,remaining));
  }
  const occupied=[...hard,...kept];
  const pending=[...tasks.values()].sort(compareTaskPriority);
  const added=[];
  for(const task of pending){
    let remaining=Math.max(0,task.minutes-(assigned.get(task.id)||0));
    for(const window of request.availability){
      if(remaining<15)break;
      const limit=[window.end,task.before||'9999-12-31T23:59',task.due?`${task.due}T23:59`:'9999-12-31T23:59'].sort()[0];
      let cursor=Math.max(minutes(window.start),minutes(current));
      while(remaining>=15&&cursor+15<=Math.min(minutes(window.end),minutes(limit))){
        const next=occupied.filter(block=>minutes(block.end)>cursor&&minutes(block.start)<minutes(limit)).sort((a,b)=>a.start.localeCompare(b.start))[0];
        if(next&&minutes(next.start)<=cursor){cursor=minutes(next.end);continue;}
        const free=Math.min(minutes(window.end),minutes(limit),next?minutes(next.start):Infinity)-cursor;
        const duration=Math.min(90,remaining,free);
        if(duration<15){cursor=next?minutes(next.end):minutes(window.end);continue;}
        const start=plus('1970-01-01T00:00',cursor),end=plus('1970-01-01T00:00',cursor+duration);
        const slot={id:idFactory(),taskId:task.id,title:task.title,start,end,source:'ai',fixed:false,reason:'每日滚动安排',acceptedAt:new Date().toISOString(),course:task.course||'',lessonPath:task.lessonPath||'',kind:task.kind||'task',round:task.round||0};
        added.push(slot);occupied.push(slot);remaining-=duration;cursor+=duration;
      }
    }
  }
  return {slots:[...kept,...added].sort((a,b)=>a.start.localeCompare(b.start)),unscheduled:pending.filter(task=>{
    const total=[...kept,...added].filter(slot=>slot.taskId===task.id).reduce((sum,slot)=>sum+minutes(slot.end)-minutes(slot.start),0);
    return total<task.minutes;
  }).map(task=>task.id),added:added.length};
}

module.exports={applyCalendarAttendanceRules,classifyCalendarEvent,matchCalendarCourse,calendarBlocks,estimateMinutes,taskStatus,scheduleItemState,retainPendingCalendarEvents,planIncrementally};
