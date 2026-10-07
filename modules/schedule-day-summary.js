'use strict';
const {t:tr}=require('./i18n');
const {classifyCalendarEvent}=require('./planning');
function scheduleDaySummary(items=[],{tasks=[],choices={}}={}){
  if(items.some(row=>row.restRule&&row.allDay))return tr('休息日');
  let lecture=false,preview=false,review=false,homework=false,project=false,ongoing=false,task=false,profile=false;
  for(const row of items){
    if(row.restRule)continue;
    const linked=tasks.find(item=>item.id===row.taskId),kind=linked?.kind||row.kind,title=String(linked?.title||row.title||'');
    if(row.source==='google-calendar'){const type=classifyCalendarEvent(row,choices).type;if(type==='lec'||(['tut','lab'].includes(type)&&choices[row.id]?.attend===true))lecture=true;continue;}
    if(row.classAnchor)lecture=true;
    if(kind==='preview'||/预习|preview/i.test(title))preview=true;
    if(['recall','review'].includes(kind)||/复习|复盘|review|recall|recap/i.test(title))review=true;
    if(linked?.assignmentId||row.assignmentId||/作业|homework|assignment/i.test(title))homework=true;
    if(linked?.taskType==='long-term'||row.taskType==='long-term')ongoing=true;
    if(/项目|project/i.test(title))project=true;
    if(row.taskId||row.source==='manual'||['ai','ai-schedule'].includes(row.source))task=true;
    if(['profile-setting','system-schedule'].includes(row.source))profile=true;
  }
  if(lecture&&homework)return tr('课程与作业');
  if(lecture&&review)return tr('课程与复习');
  if(lecture&&preview)return tr('预习与上课');
  if(lecture)return tr('课堂学习');
  if(homework&&review)return tr('作业与复习');
  if(homework)return tr('完成作业');
  if(preview&&review)return tr('预习与复习');
  if(review)return tr('巩固复习');
  if(preview)return tr('课前预习');
  if(project)return tr('项目推进');
  if(ongoing)return tr('长期积累');
  if(task)return tr('任务推进');
  return tr(profile?'按周规划':'自由安排');
}
module.exports={scheduleDaySummary};
