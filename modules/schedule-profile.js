'use strict';

// A vault-owned timetable. Personal schedules stay in local state, not release assets.
const {normalizeAvailability,normalizeRoutine,normalizeDateAvailability,expandRestBlocks}=require('./study-availability');
const TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
const minute=time=>Number(time.slice(0,2))*60+Number(time.slice(3));
const weekday=date=>new Date(date+'T12:00:00Z').getUTCDay();
const isWeekend=date=>[0,6].includes(weekday(date));
function normalizeScheduleProfile(value){
  if(!value)return null;
  const routine=normalizeRoutine(value.routine);
  const windows=(value.windows||[]).map(row=>({...normalizeAvailability([row])[0],kind:['deep','light','recap'].includes(row.kind)?row.kind:'deep',optional:!!row.optional,enabled:row.enabled!==false}));
  const activities=(value.activities||[]).map(row=>({...normalizeAvailability([row])[0],title:String(row.title||'固定活动'),classAnchor:!!row.classAnchor,classType:['lec','tut','lab'].includes(row.classType)?row.classType:'lec',visible:row.visible!==false}));
  const meals=(value.meals||[]).map(row=>{
    if(!Number.isInteger(row.day)||row.day<0||row.day>6)throw new Error('作息规划的星期无效');
    const result={day:row.day,exerciseCoveredByPE:!!row.exerciseCoveredByPE};
    for(const kind of ['lunch','dinner','exercise'])if(row[kind]){
      const {start,end}=row[kind];if(!TIME.test(start)||!TIME.test(end)||minute(end)-minute(start)!==60)throw new Error('作息规划中的用餐和运动必须持续一小时');
      result[kind]={start,end};
    }
    if(!result.lunch||!result.dinner)throw new Error('作息规划缺少午餐或晚餐');
    return result;
  });
  if(new Set(meals.map(row=>row.day)).size!==7)throw new Error('作息规划必须包含七天的用餐时间');
  return {version:1,name:String(value.name||'一周作息规划'),sourceNote:String(value.sourceNote||''),routine,weekendFlexMinutes:Math.min(60,Math.max(0,Number(value.weekendFlexMinutes)||0)),recapBufferMinutes:Math.max(0,Math.min(10,Number(value.recapBufferMinutes)||0)),windows,activities,meals};
}
function normalizeRoutineExceptions(rows=[],profile){
  if(!Array.isArray(rows))throw new Error('周末作息例外格式无效');
  const seen=new Set();
  return rows.map(row=>{
    normalizeDateAvailability([{date:row.date,start:'00:00',end:'00:01',available:true}]);
    if(!profile||!isWeekend(row.date)||seen.has(row.date))throw new Error('只能设置周六或周日的单日作息例外');
    seen.add(row.date);const routine=normalizeRoutine(row),base=profile.routine;
    const shift=time=>((minute(time)+720)%1440)-720;
    const sleepShift=shift(routine.sleepTime)-shift(base.sleepTime),wakeShift=minute(routine.wakeTime)-minute(base.wakeTime);
    if(sleepShift!==wakeShift||Math.abs(wakeShift)>profile.weekendFlexMinutes)throw new Error('周末睡眠与起床须按规划允许幅度整体移动，保持原睡眠时长');
    return {date:row.date,...routine};
  });
}
function routineForDate(settings,date){
  const profile=settings.scheduleProfile;
  if(!profile)return settings.dailyRoutine;
  return normalizeRoutineExceptions(settings.routineExceptions||[],profile).find(row=>row.date===date)||profile.routine;
}
function enforceProfileSettings(settings){
  const profile=settings.scheduleProfile;if(!profile)return;
  const routine=normalizeRoutine(settings.dailyRoutine);
  if(routine.wakeTime!==profile.routine.wakeTime||routine.sleepTime!==profile.routine.sleepTime)throw new Error('起床与睡眠须符合当前规划；周末调整请设置指定日期的 routineExceptions');
  normalizeRoutineExceptions(settings.routineExceptions||[],profile);
  for(const row of [...normalizeAvailability(settings.availability),...normalizeDateAvailability(settings.dateAvailability||[]).filter(row=>row.available)]){
    const day=row.date?weekday(row.date):row.day;
    if(!profile.windows.some(window=>window.day===day&&row.start>=window.start&&row.end<=window.end))throw new Error('学习时间必须在已导入规划的学习窗口内；不能占用娱乐、睡眠或固定活动');
  }
}
function expandProfileActivities(settings,dates,{includeHidden=false}={}){
  const profile=settings.scheduleProfile;if(!profile)return [];
  const rests=expandRestBlocks(settings.restBlocks||[],dates);
  return dates.flatMap(date=>profile.activities.filter(row=>row.day===weekday(date)).map((row,index)=>{
    const routine=routineForDate(settings,date),morning=row.title==='起床、洗漱与早餐';
    const start=morning?routine.wakeTime:row.start;
    const end=morning?String(Math.floor((minute(start)+30)/60)).padStart(2,'0')+':'+String((minute(start)+30)%60).padStart(2,'0'):row.end;
    return {id:`profile-${date}-${index}`,title:row.title,start:date+'T'+start,end:date+'T'+end,source:'profile-setting',fixed:true,profileActivity:true,classAnchor:row.classAnchor,classType:row.classType||'lec',systemKind:'routine',visible:includeHidden||(!morning&&row.visible!==false)};
  })).filter(block=>!(/课后复盘|Weekly Review/.test(block.title)&&rests.some(rest=>block.start<rest.end&&rest.start<block.end)));
}
function profileWorkWindows(settings,availability){
  const profile=settings.scheduleProfile;if(!profile)return [];
  return availability.flatMap(window=>profile.windows.filter(row=>row.day===weekday(window.start.slice(0,10))).flatMap(row=>{
    const start=[window.start,window.start.slice(0,10)+'T'+row.start].sort().at(-1),end=[window.end,window.start.slice(0,10)+'T'+row.end].sort()[0];
    return start<end?[{start,end,kind:row.kind,optional:row.optional}]:[];
  }));
}
function inferWorkMode(task){
  if(['deep','light','recap'].includes(task.workMode))return task.workMode;
  if(['project','assignment','coding','research','lab'].includes(task.kind))return 'deep';
  if(['review','preview','recap','recall'].includes(task.kind))return task.kind==='recap'?'recap':'light';
  const text=[task.title,task.description,task.source].join(' ');
  if(task.taskType==='long-term'&&/背单词|词汇|vocab|memorize.*word/i.test(text))return 'light';
  if(/课后复盘|课后回顾/.test(text))return 'recap';
  return /algorithm|\bOJ\b|machine learning|linear algebra|statistics|assignment|homework|\bVLA\b|coding|project|essay|report|论文|报告|编程|代码|科研|作业|算法|机器学习|线性代数|统计|项目/i.test(text)?'deep':'light';
}
function profilePrompt(profile){
  if(!profile)return '';
  return [
    `严格执行已导入的「${profile.name}」。这是用户选定的时间规划，不是可以凭紧急程度放宽的建议。`,
    '工作日睡眠固定；周末默认同一作息，只有用户明确指定日期时才可按weekendFlexMinutes整体移动，保留规划原有睡眠时长及早餐洗漱时间。',
    '午餐、晚餐按每个日期的 mealRequirements 精确开始结束；exercise 尽可能保留对应固定的一小时，运动洗澡之后再吃晚饭。规划指定晚间运动和晚饭时遵循对应时段；exerciseCoveredByPE=true表示体育课已算运动，不额外排跑步。',
    '仅在 availability 内安排任务。workWindows.kind=light 只放轻学习、小任务或整理；kind=recap 只做刚结束课程的图书馆课后复盘；kind=deep 才可启动复杂任务。≤10分钟留给移动休息，不排任务。20–30分钟课间不塞作业、科研、编程等复杂任务。',
    profile.recapBufferMinutes?`图书馆复盘仅使用当前规划明确列出的kind=recap窗口及对应固定活动；其start/end已包含移动休息预留，以现存精确边界为准，不再次缩短或恢复旧边界。已删除的固定复盘不得重新补回，也不能把Deep Work后的移动休息自动变成课后复盘。visible=false 的前往教室、课程切换及缓冲仍占用时间，仅不在界面显示，不能填入学习任务。`:'',
    'Deep Work 必须拥有至少90分钟的连续真实空档；结合 freeWorkWindows 识别被课程、饭点和其他忙碌事项切断的空档。复杂任务优先连续90–180分钟；任务预计用时不足90分钟时不人为延长，但仍需从至少90分钟空档的起点附近启动。不要把复杂任务压进长窗口末尾不足90分钟的碎片。',
    '标记optional的窗口不必用满，只有availability中启用的才可排。各optional窗口以用户当前设置为准。娱乐、社交、睡前放松不可用于赶DDL，放不下就明确列入unscheduled，不虚构任务填满时间。Weekly Review及轻学习窗口按当前规划精确执行。',
    '课程锚点与Google Calendar均为硬约束。LEC全部参加，TUT/LAB未明确指定时默认不参加；已列入规划的TUT/LAB及用户勾选的课程需要参加；冲突时报告冲突，请用户显式改时间规则，不能自行移动课、运动或用餐。',
  ].join('\n');
}
module.exports={normalizeScheduleProfile,normalizeRoutineExceptions,routineForDate,enforceProfileSettings,expandProfileActivities,profileWorkWindows,inferWorkMode,profilePrompt};
