'use strict';
const {estimateMinutes,taskStatus}=require('./planning');
function existingLessonStudyTasks(study={},records=[]){
  const paths=new Set(records.filter(row=>row.inScope!==false).map(row=>row.file.path));
  const realLesson=task=>!!task.lessonPath&&paths.has(task.lessonPath);
  return {...study,previews:(study.previews||[]).filter(realLesson),reviews:(study.reviews||[]).filter(realLesson)};
}
// Learning state is the authority; no task checkbox can bypass a learning step.
function reconcileLearningTodos({previous=[],study={previews:[],reviews:[]},records=[],date,currentLocal,dismissedIds=[]}={}){
  study=existingLessonStudyTasks(study,records);
  const seeds=new Map([...study.previews,...study.reviews].map(task=>[task.id,{...task,learningLocked:task.after>currentLocal}])),finished=new Map();
  const scoped=records.filter(row=>row.inScope!==false),paths=new Set(scoped.map(row=>row.file.path));
  for(const {file,flow,course,plan=[],previewMinutes,recallMinutes,reviewMinutes=[]} of scoped){
    const base={course,lessonPath:file.path,source:'学习流程',domain:'course'},label=`${course.split(' - ')[0]} ${file.basename}`;
    const previewId=`preview:${file.path}`,recallId=`recall:${file.path}`;
    if(flow.milestones?.previewedAt||flow.milestones?.learnedAt)finished.set(previewId,flow.milestones.previewedAt||flow.milestones.learnedAt);
    else if(!seeds.has(previewId))seeds.set(previewId,{...base,id:previewId,title:`${label} · 预习`,kind:'preview',minutes:previewMinutes||30,due:'',learningLocked:false});
    if(flow.recall?.completedAt)finished.set(recallId,flow.recall.completedAt);
    else if(flow.milestones?.learnedAt&&!seeds.has(recallId))seeds.set(recallId,{...base,id:recallId,title:`${label} · 引导式回忆`,kind:'recall',minutes:recallMinutes||30,due:date,learningLocked:false});
    if(!flow.milestones?.learnedAt)for(const task of seeds.values())if(task.lessonPath===file.path&&task.kind==='recall')task.learningLocked=true;
    for(const round of plan){
      const id=`review:${file.path}:${round.round}`;
      if(round.completedAt){finished.set(id,round.completedAt);continue;}
      if(!round.due)continue;
      const dependencies=[];if(!flow.recall?.completedAt)dependencies.push(recallId);
      if(round.round>1&&!plan[round.round-2]?.completedAt)dependencies.push(`review:${file.path}:${round.round-1}`);
      seeds.set(id,{...base,id,title:`${label} · 第 ${round.round} 轮复习`,kind:'review',round:round.round,minutes:reviewMinutes[round.round-1]||[15,15,20][round.round-1],due:round.due,after:round.due+'T00:00',dependsOn:dependencies,learningLocked:!round.unlocked});
    }
  }
  const old=new Map(previous.map(task=>[task.id,task])),manual=previous.filter(task=>!task.learningManaged&&!seeds.has(task.id)),managed=[];
  for(const seed of seeds.values()){
    if(finished.has(seed.id))continue;
    const existing=old.get(seed.id)||{},title=existing.generatedTitle&&existing.title!==existing.generatedTitle?existing.title:seed.title;
    const generic=!seed.lessonPath,status=generic?taskStatus(existing):'unfinished';
    const task={...existing,...seed,title,generatedTitle:seed.title,description:existing.description||'',learningManaged:true,taskType:'one-time',urgent:!!existing.urgent,pinned:!!existing.pinned,estimatedMinutes:existing.estimatedMinutes??null,minutesSource:existing.estimatedMinutes?'user':'auto',status,done:status!=='unfinished',createdAt:existing.createdAt||currentLocal,source:seed.source||'学习流程'};
    task.minutes=Number(task.estimatedMinutes)||Number(seed.minutes)||estimateMinutes(task);managed.push(task);
  }
  for(const task of previous.filter(task=>task.learningManaged&&!seeds.has(task.id)||task.learningManaged&&finished.has(task.id))){
    const completedAt=finished.get(task.id);
    if(completedAt){managed.push({...task,status:task.due&&completedAt.slice(0,10)>task.due?'late':'on-time',done:true,completedAt,learningLocked:false});continue;}
    // Calendar-only placeholders have no learning material and must not become todos.
    if(task.lessonPath&&taskStatus(task)!=='unfinished')managed.push(task);
    else if(task.lessonPath&&paths.has(task.lessonPath)&&task.kind==='preview'&&!finished.has(task.id))managed.push(task);
  }
  const dismissed=new Set(dismissedIds);
  return [...manual,...managed].filter(task=>!task.learningManaged||!dismissed.has(task.id));
}
module.exports={existingLessonStudyTasks,reconcileLearningTodos};
