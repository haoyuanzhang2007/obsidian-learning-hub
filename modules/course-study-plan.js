'use strict';
const {classifyCalendarEvent,matchCalendarCourse}=require('./planning');
const datePart=value=>String(value||'').slice(0,10);
const plus=(date,n)=>new Date(new Date(date+'T12:00:00Z').getTime()+n*86400000).toISOString().slice(0,10);
const lessonDate=file=>(file.basename.match(/@(\d{4}) (\d{2}) (\d{2})/)||[]).slice(1).join('-');
function collectCourseStudyTasks({courses=[],events=[],choices={},records=[],currentLocal,startDate,endDate,slots=[],profileActivities=[]}={}){
  const done=(id,expected=15)=>slots.filter(slot=>slot.taskId===id&&['on-time','late'].includes(slot.status)).reduce((sum,slot)=>sum+(new Date(slot.end)-new Date(slot.start))/60000,0)>=expected;
  const classEvents=events.filter(event=>classifyCalendarEvent(event,choices).type==='lec'||event.classType==='lec').filter(event=>!(/\bPE\b|Physical Education|体育课/i.test(event.title))).map(event=>({...event,course:event.course||matchCalendarCourse(event,courses)||''})).filter(event=>datePart(event.start)<=plus(endDate,1)&&datePart(event.end)>=plus(startDate,-1)).sort((a,b)=>a.start.localeCompare(b.start));
  const previews=[],reviews=[],used=new Set(),coverage=[];
  for(const event of classEvents){
    const date=datePart(event.start),code=event.course?event.course.split(' - ')[0]:String(event.title).replace(/\s*\[LEC\]\s*/gi,'').trim(),courseRecords=records.filter(row=>row.course===event.course&&row.inScope!==false);
    const exact=courseRecords.find(row=>lessonDate(row.file)===date);
    if(event.start>currentLocal){
      const target=exact||courseRecords.find(row=>!used.has(row.file.path)&&!row.flow.milestones?.learnedAt&&!row.flow.milestones?.previewedAt&&(!lessonDate(row.file)||lessonDate(row.file)>=date));
      if(!target?.flow.milestones?.previewedAt){
        const id=target?`preview:${target.file.path}`:`course-preview:${event.id}`;
        if(!done(id,Math.max(15,target?.previewMinutes||30))&&(!target||!used.has(target.file.path))){
          previews.push({id,title:`${code} ${target?.file.basename||date+' Lec'} · 预习`,minutes:Math.max(15,target?.previewMinutes||30),due:date,before:event.start,course:event.course,lessonPath:target?.file.path||'',kind:'preview',source:event.course,calendarEventId:event.id,domain:'course'});
          if(target)used.add(target.file.path);
        }
      }
    }
    if(event.end<=endDate+'T23:59'){
      const id=exact?`recall:${exact.file.path}`:`course-review:${event.id}`,future=event.end>currentLocal;
      const compact=value=>String(value||'').replace(/\bAI\b/gi,'Artificial Intelligence').toLowerCase().replace(/[^a-z0-9]/g,'');
      const recap=profileActivities.find(block=>{
        const topic=String(block.title).split('：')[1]?.replace(/^(上午|下午)\s*/,'');
        return topic&&block.title.includes('图书馆课后复盘')&&datePart(block.start)===date&&block.start>=event.end&&new Date(block.start)-new Date(event.end)<=10800000&&compact(event.title).includes(compact(topic));
      });
      if(recap){coverage.push({course:event.course,eventId:event.id,reviewCoveredBy:recap.title,start:recap.start,end:recap.end});continue;}
      // Uploaded, learned lessons use their recall/spaced-review records.
      if(!done(id,20)&&(!exact?.flow.milestones?.learnedAt||future))reviews.push({id,title:`${code} ${date} Lec · 课后复习`,minutes:20,after:event.end,due:plus(date,1)<startDate?startDate:plus(date,1),course:event.course,lessonPath:exact?.file.path||'',kind:exact?'recall':'review',source:event.course,calendarEventId:event.id,domain:'course',round:0});
    }
  }
  for(const row of records){
    const {file,flow,course}=row;if(row.inScope===false||!flow.milestones?.learnedAt)continue;
    const recallId=`recall:${file.path}`,recallNeeded=!flow.recall?.completedAt&&!done(recallId,row.recallMinutes||30);
    if(recallNeeded)reviews.push({id:recallId,title:`${course.split(' - ')[0]} ${file.basename} · 引导式回忆`,minutes:row.recallMinutes||30,due:startDate,course,lessonPath:file.path,kind:'recall',source:'课后巩固',domain:'course'});
    for(const round of row.plan||[]){
      const id=`review:${file.path}:${round.round}`;if(!round.due||round.due>endDate||round.completedAt||done(id,Math.max(15,row.reviewMinutes?.[round.round-1]||[15,15,20][round.round-1])))continue;
      const previous=(row.plan||[])[round.round-2],dependencies=[];
      if(recallNeeded)dependencies.push(recallId);
      if(previous&&!previous.completedAt&&!done(`review:${file.path}:${previous.round}`,Math.max(15,row.reviewMinutes?.[previous.round-1]||15)))dependencies.push(`review:${file.path}:${previous.round}`);
      reviews.push({id,title:`${course.split(' - ')[0]} ${file.basename} · 第 ${round.round} 轮复习`,minutes:Math.max(15,row.reviewMinutes?.[round.round-1]||[15,15,20][round.round-1]),due:round.due<startDate?startDate:round.due,after:round.due+'T00:00',dependsOn:dependencies,course,lessonPath:file.path,kind:'review',round:round.round,source:'间隔复习',domain:'course'});
    }
  }
  return {previews,reviews,coverage};
}
module.exports={collectCourseStudyTasks};
