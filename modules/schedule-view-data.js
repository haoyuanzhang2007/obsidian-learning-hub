'use strict';
const {t:tr}=require('./i18n');
const {classifyCalendarEvent}=require('./planning');
const {expandProfileActivities,routineForDate}=require('./schedule-profile');
const {visibleRestBlocks}=require('./study-availability');
const STAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const clockMinutes=time=>/^([01]\d|2[0-3]):[0-5]\d$/.test(time||'')?Number(time.slice(0,2))*60+Number(time.slice(3)):null;
const nextDate=(date,days=1)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
function matchesClassAnchor(event,anchor){
  if(event.start!==anchor.start||event.end!==anchor.end)return false;
  if(event.source!=='google-calendar'&&!event.classAnchor)return false;
  const key=value=>String(value||'').replace(/\bAI\b/gi,'Artificial Intelligence').replace(/\[(LEC|TUT|LAB)\]/gi,'').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g,'');
  const a=key(event.title),b=key(anchor.title);return a.length>=2&&b.length>=2&&(a.includes(b)||b.includes(a));
}
const plusMinutes=(stamp,n)=>new Date(new Date(stamp+':00Z').valueOf()+n*60000).toISOString().slice(0,16);
function isRoutineItem(item){
  if(item.calendarRoutine||item.source==='system-schedule')return true;
  if(item.taskId)return false;
  if(item.classAnchor)return false;
  if(['profile-setting','fixed-setting'].includes(item.source))return !/课后复盘|复习|Weekly Review|recap/i.test(item.title||'');
  if(['sleep','wake','meal','exercise','relaxation','commute','routine'].includes(item.kind)||['sleep','wake','meal','exercise','routine'].includes(item.systemKind))return true;
  if(item.source==='manual'&&/^(起床|睡觉|睡眠|睡前放松|运动(?:与洗澡)?|午餐|晚餐|wake(?: up)?|sleep|bedtime relaxation|exercise|lunch|dinner)$/i.test(String(item.title||'').trim()))return true;
  return false;
}
function isProjectItem(item){
  if(!item||item.restRule||item.visible===false||isRoutineItem(item)||item.classAnchor||item.source==='google-calendar')return false;
  return !!item.taskId||['ai','ai-schedule','manual'].includes(item.source)||['preview','review','recall','assignment','project','task','coding','research'].includes(item.kind)||/课后复盘|Weekly Review|recap/i.test(item.title||'');
}
function calendarCategory(item,choices={}){
  if(item.restRule)return 'rest';
  if(item.source==='google-calendar'){const type=classifyCalendarEvent(item,choices).type;return ['lec','tut','lab'].includes(type)||/^(PE|Physical Education|体育课)$/i.test(String(item.title||'').trim())?'course':'external';}
  if(item.classAnchor)return 'course';
  if(isRoutineItem(item))return 'routine';
  return 'task';
}
function completeCalendarItems({settings={},slots=[],events=[],dates=[]}={}){
  const blocks=expandProfileActivities(settings,dates).filter(item=>(item.visible!==false||/起床|wake|breakfast/i.test(item.title||''))&&!/前往教室|walk to class|commute to class/i.test(item.title||'')),calendarIds=new Set(events.map(event=>event.id));
  const all=[...slots.filter(item=>!(item.source==='google-calendar'&&calendarIds.has(item.id))&&!(item.source==='fixed-setting'&&/^睡眠/.test(item.title||'')&&dates.every(date=>{const r=routineForDate(settings,date)||settings.dailyRoutine||{};return clockMinutes(r.sleepTime)!==null&&clockMinutes(r.wakeTime)!==null;}))),...events];
  const sameTime=(a,b)=>a.start===b.start&&a.end===b.end;
  for(const block of blocks)if(!all.some(item=>(block.classAnchor?matchesClassAnchor(item,block):sameTime(item,block)&&(item.profileActivity||item.source==='fixed-setting'))))all.push({...block,visible:true});
  // Exact times from the imported profile are calendar facts, not new AI tasks.
  for(const date of dates){
    const weekday=new Date(date+'T12:00:00Z').getUTCDay(),meal=settings.scheduleProfile?.meals?.find(row=>row.day===weekday);
    for(const kind of ['lunch','dinner','exercise']){const window=meal?.[kind];if(!window||(kind==='exercise'&&meal.exerciseCoveredByPE))continue;const item={id:`calendar-${kind}-${date}`,start:date+'T'+window.start,end:date+'T'+window.end,title:tr(kind==='lunch'?'午餐':kind==='dinner'?'晚餐':'运动与洗澡'),meal:kind,source:'profile-setting',calendarRoutine:true,systemKind:kind,fixed:true};if(!all.some(row=>((row.meal||row.mealKind)===kind&&row.start?.slice(0,10)===date)||sameTime(row,item)&&/午餐|晚餐|运动|lunch|dinner|exercise/i.test(row.title||'')))all.push(item);}
    const routine=routineForDate(settings,date)||settings.dailyRoutine||{},wake=clockMinutes(routine.wakeTime),sleep=clockMinutes(routine.sleepTime);if(wake===null||sleep===null)continue;
    if(!all.some(row=>row.start===date+'T'+routine.wakeTime&&/起床|wake|breakfast/i.test(row.title||'')))all.push({id:'calendar-wake-'+date,title:tr('起床'),start:date+'T'+routine.wakeTime,end:plusMinutes(date+'T'+routine.wakeTime,15),source:'profile-setting',systemKind:'wake',calendarRoutine:true,fixed:true});
    const after=nextDate(date),nextRoutine=routineForDate(settings,after)||routine;
    all.push({id:'calendar-sleep-'+date,title:tr('睡觉'),start:date+'T'+routine.sleepTime,end:(sleep<wake?date:after)+'T'+(sleep<wake?routine.wakeTime:nextRoutine.wakeTime),source:'profile-setting',systemKind:'sleep',calendarRoutine:true,fixed:true});
  }
  if(dates.length){const first=dates[0],previous=nextDate(first,-1),r=routineForDate(settings,previous)||settings.dailyRoutine||{},current=routineForDate(settings,first)||settings.dailyRoutine||{};if(clockMinutes(r.sleepTime)!==null&&clockMinutes(r.wakeTime)!==null&&r.sleepTime>r.wakeTime)all.push({id:'calendar-sleep-'+previous,title:tr('睡觉'),start:previous+'T'+r.sleepTime,end:first+'T'+current.wakeTime,source:'profile-setting',systemKind:'sleep',calendarRoutine:true,fixed:true});}
  const fixed=settings.fixedBlocks||[];
  for(const [index,row] of fixed.entries())for(const date of dates){const day=new Date(date+'T12:00:00Z').getUTCDay(),selector=row.days??row.day;const matches=row.date?row.date===date:selector==null||selector==='daily'||selector==='*'||(selector==='weekday'&&day>0&&day<6)||(selector==='weekend'&&(day===0||day===6))||(Array.isArray(selector)?selector:[selector]).some(value=>Number(value)===day||['sun','mon','tue','wed','thu','fri','sat'][day]===String(value).slice(0,3).toLowerCase());if(!matches||clockMinutes(row.start)===null||clockMinutes(row.end)===null||row.end<=row.start||/^睡眠/.test(row.title||''))continue;const item={id:`calendar-fixed-${date}-${index}`,title:row.title||tr('固定安排'),start:date+'T'+row.start,end:date+'T'+row.end,source:'profile-setting',calendarRoutine:true,fixed:true};if(!all.some(existing=>sameTime(existing,item)&&existing.fixed))all.push(item);}
  all.push(...visibleRestBlocks(settings,dates));
  const seen=new Set();return all.filter(item=>{if(!STAMP.test(item.start)||!STAMP.test(item.end)||item.end<=item.start)return false;const key=`${item.id||item.title}|${item.start}|${item.end}`;if(seen.has(key))return false;seen.add(key);return dates.some(date=>item.start<nextDate(date)+'T00:00'&&item.end>date+'T00:00');}).sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
}
function calendarDayLayout(items,date,{pixelsPerHour=64}={}){
  const dayStart=date+'T00:00',dayEnd=nextDate(date)+'T00:00',active=items.filter(item=>item.start<dayEnd&&item.end>dayStart),allDay=[],events=[],rests=[];
  for(const item of active){if(item.allDay){allDay.push(item);continue;}const from=item.start<dayStart?dayStart:item.start,to=item.end>dayEnd?dayEnd:item.end,start=clockMinutes(from.slice(11)),end=to===dayEnd?1440:clockMinutes(to.slice(11));if(start===null||end===null||end<=start)continue;const segment={item,start,end,top:start*pixelsPerHour/60,height:Math.min((1440-start)*pixelsPerHour/60,Math.max(18,(end-start)*pixelsPerHour/60)),continuesBefore:item.start<dayStart,continuesAfter:item.end>dayEnd};if(item.restRule)rests.push(segment);else events.push(segment);}
  events.sort((a,b)=>a.start-b.start||b.end-a.end);let cluster=[],maxEnd=0;
  const flush=()=>{const lanes=[];for(const row of cluster){const visualEnd=Math.max(row.end,row.start+18*60/pixelsPerHour);let lane=lanes.findIndex(end=>end<=row.start);if(lane<0)lane=lanes.length;lanes[lane]=visualEnd;row.lane=lane;}for(const row of cluster)row.lanes=lanes.length;cluster=[];maxEnd=0;};
  for(const row of events){if(cluster.length&&row.start>=maxEnd)flush();cluster.push(row);maxEnd=Math.max(maxEnd,row.end,row.start+18*60/pixelsPerHour);}if(cluster.length)flush();
  return {allDay,events,rests};
}
module.exports={matchesClassAnchor,isProjectItem,isRoutineItem,calendarCategory,completeCalendarItems,calendarDayLayout};
