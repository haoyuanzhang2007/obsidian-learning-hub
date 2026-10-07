'use strict';
const {MarkdownRenderer,Notice,setIcon}=require('obsidian');
const {t:tr}=require('./i18n');
const {renderTokenUsage}=require('./token-usage');
const {materialKind,practiceContext}=require('./practice-materials');
const {flattenHomeworkQuestions,homeworkWrongPrompt}=require('./homework-questions');
const {estimateMinutes,taskStatus}=require('./planning');
const {taskDurationLabel}=require('./task-options');
const label=kind=>kind==='tutorial'?'Tutorial':'Lab';
const practiceMethods={
  practiceAnalysisPath(course,id){return `${this.labDataFolder(course,id)}/analysis.json`;},
  async readPracticeAnalysis(course,id){try{return JSON.parse(await this.app.vault.adapter.read(this.practiceAnalysisPath(course,id)));}catch(error){if(error.code==='ENOENT'||!await this.app.vault.adapter.exists?.(this.practiceAnalysisPath(course,id)))return null;throw error;}},
  syncPracticeTodo(course,item){
    const tasks=this.state.tasks||[],linked=tasks.find(t=>t.materialId===item.id);
    if(item.deleted||item.includeTodo!==true||!item.files?.length){if(!linked)return false;this.state.tasks=tasks.filter(t=>t.id!==linked.id);this.state.slots=(this.state.slots||[]).filter(s=>s.taskId!==linked.id);return true;}
    const values={materialId:item.id,materialKind:materialKind(item),course,lessonPath:item.lessonPath||'',kind:'practice',title:`${label(materialKind(item))} · ${item.title}`,due:item.due||'',dueTime:'',aiEstimatedMinutes:Number(item.estimatedMinutes)||null,aiEstimateStatus:item.estimatedMinutes?'complete':item.analysisStatus==='failed'?'unavailable':'pending',source:label(materialKind(item))};values.minutes=estimateMinutes({...values,estimatedMinutes:linked?.estimatedMinutes},this.state.completionHistory);
    if(linked){const changed=Object.keys(values).some(k=>linked[k]!==values[k]);Object.assign(linked,values);return changed;}
    this.state.tasks||=[];this.state.tasks.push({...values,id:`practice:${item.id}`,taskType:'one-time',status:'unfinished',done:false,urgent:false,pinned:false,createdAt:new Date().toISOString()});return true;
  },
  async reviewPracticeMaterials(course,lessonPath,selectedId=null){
    const {labs}=await this.readLabs(course),selected=selectedId?labs.filter(item=>item.id===selectedId):practiceContext(labs,lessonPath),materials=[];
    for(const item of selected){
      const analysis=item.analysisStale?null:await this.readPracticeAnalysis(course,item.id);
      let content=analysis;
      if(!content){try{content={sourceText:await this.labSourceText(item),warnings:[tr('原始资料尚未完成整理，答案与题干可能混排。')]};}catch(error){throw new Error(tr('无法读取复习资料「{0}」：{1}',[item.title,error.message]));}}
      materials.push({id:item.id,kind:materialKind(item),title:item.title,scope:item.lessonPath?'lesson':'course',lessonPath:item.lessonPath||'',topics:item.topics||[],files:(item.files||[]).map(f=>({name:f.name,role:f.role||'mixed'})),...content});
    }
    return materials;
  },
  async renderPracticeReviewLinks(el,course,lessonPath){
    const {labs}=await this.readLabs(course),items=practiceContext(labs,lessonPath);if(!items.length)return;
    const row=el.createDiv({cls:'lh-practice-review-links'});row.createSpan({text:tr('AI 复习参考')});for(const item of items)row.createEl('button',{text:label(materialKind(item))+' · '+item.title,cls:'lh-text-link'}).onclick=()=>this.openHub('practice',course,undefined,null,0,item.id);
  },
  renderMaterialsHeader(el,course,active,counts){
    const header=el.createDiv({cls:'lh-materials-header'}),copy=header.createDiv({cls:'lh-materials-heading'});
    copy.createDiv({text:tr('课程资料'),cls:'lh-materials-kicker'});copy.createEl('h1',{text:tr('作业与练习')});copy.createEl('p',{text:tr('整理课后任务，汇集复习资料。')});
    header.createEl('button',{text:tr('课程概览 ↗'),cls:'lh-text-link lh-materials-back'}).onclick=()=>this.openHub('course',course);
    const toolbar=el.createDiv({cls:'lh-materials-toolbar'});this.renderPracticeTabs(toolbar,course,active,counts);
    const name=active==='homework'?tr('上传作业'):active==='tutorial'?tr('上传 Tutorial'):tr('上传 Lab 资料'),upload=toolbar.createEl('button',{cls:'lh-primary lh-materials-upload',attr:{type:'button'}});setIcon(upload.createSpan({cls:'lh-materials-button-icon'}),'plus');upload.createSpan({text:name});upload.onclick=()=>active==='homework'?this.uploadHomework(course):this.uploadLab(course,active);
  },
  renderPracticeTabs(el,course,active,counts={}){
    const tabs=el.createDiv({cls:'lh-practice-tabs',attr:{role:'tablist','aria-label':tr('资料类型')}});
    for(const [key,name] of [['homework',tr('作业')],['tutorial','Tutorial'],['lab','Lab']]){const button=tabs.createEl('button',{cls:'lh-practice-tab'+(active===key?' is-active':''),attr:{type:'button',role:'tab','aria-selected':String(active===key)}});button.createSpan({text:name});button.createSpan({text:String(counts[key]||0),cls:'lh-materials-tab-count'});button.onclick=()=>{this.practiceTab||=new Map();this.practiceTab.set(course,key);void this.refreshLabView(course);};}
  },
  renderMaterialsEmpty(el,course,kind){
    const surface=el.createDiv({cls:'lh-panel lh-materials-empty'}),icon=surface.createDiv({cls:'lh-materials-empty-icon'});setIcon(icon,kind==='homework'?'notebook-pen':kind==='tutorial'?'book-open':'code-2');
    surface.createEl('h2',{text:tr(kind==='homework'?'还没有作业':kind==='tutorial'?'还没有 Tutorial 资料':'还没有 Lab 资料')});
    surface.createEl('p',{text:tr(kind==='homework'?'上传作业后，自动估算用时并加入待办。':kind==='tutorial'?'上传习题与讲解，复习时参考题目和知识点。':'把讲解、练习 Notebook 与答案放进同一份资料。')});
    const formats=surface.createDiv({cls:'lh-materials-formats'});for(const format of (kind==='homework'?['PDF','Markdown','TXT']:['PDF','Notebook','Markdown','TXT']))formats.createSpan({text:format});
    const button=surface.createEl('button',{text:tr('选择文件'),cls:'lh-secondary'});button.onclick=()=>kind==='homework'?this.uploadHomework(course):this.uploadLab(course,kind);
    const tip=el.createDiv({cls:'lh-materials-tip'});setIcon(tip.createSpan({cls:'lh-materials-tip-icon'}),'link-2');tip.createSpan({text:tr('上传时可关联讲次，让复习参考更准确。')});
  },
  renderPracticeStatus(host,item){
    const progress=this.labProgress?.get(item.id);
    if(['extracting','analyzing','queued'].includes(item.analysisStatus)){
      const line=host.createDiv({cls:'lh-homework-analysis-line'});if(this.labRunning?.has(item.id))line.createSpan({cls:'lh-analysis-spinner'});line.createSpan({text:tr(this.labRunning?.has(item.id)?'正在整理练习资料':'等待解析资料')});
      if(progress){progress.elapsedEl=host.createDiv({cls:'lh-homework-progress-detail'});progress.usageEl=host.createDiv({cls:'lh-homework-progress-usage'});this.updateHomeworkProgress(progress);}
    }else host.createSpan({text:tr(item.analysisStatus==='complete'?'资料已整理':'资料解析失败')+(item.analysisError?' · '+item.analysisError:''),cls:item.analysisStatus==='failed'?'lh-assignment-warning':''});
  },
  async renderPracticeCatalog(el,course,kind){
    const store=await this.readLabs(course),items=store.labs.filter(x=>materialKind(x)===kind).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    for(const archived of [false,true]){
      const subset=items.filter(item=>!!item.archivedAt===archived);if(archived&&!subset.length)continue;const section=el.createDiv({cls:'lh-homework-catalog-section'+(archived?' is-archived':'')});
      if(archived){const head=section.createDiv({cls:'lh-section-title'});head.createEl('h2',{text:tr('已归档')});head.createSpan({text:tr('{0} 份',[subset.length])});}
      if(!subset.length){this.renderMaterialsEmpty(section,course,kind);continue;}
      const grid=section.createDiv({cls:'lh-homework-catalog'});
      for(const item of subset){const card=grid.createDiv({cls:'lh-panel lh-homework-card'}),top=card.createDiv({cls:'lh-homework-card-head'});setIcon(top.createSpan({cls:'lh-homework-card-icon'}),kind==='lab'?'code-2':'book-open');top.createSpan({text:label(kind),cls:'lh-homework-card-meta'});const open=()=>this.openHub('practice',course,undefined,null,0,item.id),title=card.createEl('h3').createEl('button',{text:item.title,cls:'lh-homework-card-open'});title.onclick=open;card.createDiv({text:[item.lessonPath?.split('/').at(-1)?.replace(/\.md$/,'')||tr('整个课程'),item.estimatedMinutes?tr('AI 预计 {0} 分钟',[item.estimatedMinutes]):tr('分析后显示预计用时'),tr('{0} 个文件',[item.files?.length||0])].join(' · '),cls:'lh-homework-card-meta'});const topics=card.createDiv({cls:'lh-assignment-topics'});for(const topic of item.topics||[])topics.createSpan({text:topic});this.renderPracticeStatus(card.createDiv({cls:'lh-homework-analysis-status'}),item);const foot=card.createDiv({cls:'lh-homework-card-foot'});foot.createSpan({text:tr(item.useForReview===false?'不用于复习':'用于复习参考')});foot.createEl('button',{text:tr('查看资料 →'),cls:'lh-text-link'}).onclick=open;}
    }
  },
  async openPracticeFile(file){
    if(!file.path?.toLowerCase().endsWith('.ipynb'))return this.open(file.path);
    try{const shell=require('electron').shell||require('@electron/remote').shell;const error=await shell.openPath(require('path').join(this.vaultPath(),file.path));if(error)throw new Error(error);}catch(error){new Notice(tr('请用 Jupyter 或 VS Code 打开 Notebook：{0}',[file.path]));}
  },
  async renderPracticeMarkdown(host,markdown,source){
    if(MarkdownRenderer?.render)await MarkdownRenderer.render(this.app,markdown,host,source,this);else if(MarkdownRenderer?.renderMarkdown)await MarkdownRenderer.renderMarkdown(markdown,host,source,this);else host.setText(markdown);
  },
  async mutatePractice(course,id,mutation){
    this.practiceMutations||=new Map();const key=course,previous=this.practiceMutations.get(key)||Promise.resolve();
    const job=previous.catch(()=>{}).then(async()=>{const store=await this.readLabs(course),item=store.labs.find(x=>x.id===id);if(!item)return;await mutation(item);await this.saveLabs(course,store);});this.practiceMutations.set(key,job);try{await job;}finally{if(this.practiceMutations.get(key)===job)this.practiceMutations.delete(key);}
  },
  async setPracticeWrong(course,id,questionId,selected){
    await this.mutatePractice(course,id,async item=>{
      if(materialKind(item)!=='tutorial')return;
      const analysis=await this.readPracticeAnalysis(course,id),question=flattenHomeworkQuestions(analysis?.questions||[]).find(q=>q.id===questionId);if(!question)throw new Error(tr('练习题目已不存在。'));
      const ids=new Set(item.wrongQuestionIds||[]);if(ids.has(questionId)===selected)return;if(selected){ids.add(questionId);await this.appendError(this.courseErrorPath(course),{course},{sourceMaterialId:id,questionId,parentQuestionId:question.parentQuestionId||'',mode:'tutorial',prompt:homeworkWrongPrompt(question),reference:question.answer||'',topic:(item.topics||[]).join(' · '),rating:'wrong',createdAt:new Date().toISOString()});}else{ids.delete(questionId);await this.filterErrorLog(this.courseErrorPath(course),e=>!(e.sourceMaterialId===id&&e.questionId===questionId));}item.wrongQuestionIds=[...ids];
    });
  },
  async renderPracticeDetail(el,course,id){
    el.empty();el.addClass('learning-hub','lh-practice-detail');const store=await this.readLabs(course),item=store.labs.find(x=>x.id===id);
    el.createEl('button',{text:tr('← 返回资料列表'),cls:'lh-text-link lh-homework-back'}).onclick=()=>{this.practiceTab||=new Map();this.practiceTab.set(course,materialKind(item));void this.openHub('assignments',course);};
    if(!item){el.createEl('h2',{text:tr('资料已不存在')});return;}
    const kind=materialKind(item);this.header(el,course.split(' - ')[0]+' / '+label(kind),item.title,tr('题目与参考答案分开显示，笔记和完成状态按小问保存。'));
    const actions=el.createDiv({cls:'lh-assignment-toolbar'});
    actions.createEl('button',{text:tr('编辑信息'),cls:'lh-secondary'}).onclick=()=>this.editLab(course,item);
    const reparse=actions.createEl('button',{text:tr('重新解析'),cls:'lh-secondary'});reparse.disabled=!!this.labRunning?.has(id);reparse.onclick=()=>void this.analyzeLab(course,id).catch(e=>new Notice(e.message));
    const linked=this.state.tasks.find(t=>t.materialId===id);if(linked)actions.createEl('button',{text:tr('记录完成情况'),cls:'lh-secondary'}).onclick=()=>this.recordOutcome(linked,'task');
    actions.createEl('button',{text:tr(item.archivedAt?'移出归档':'归档'),cls:'lh-secondary'}).onclick=()=>this.toggleLabArchive(course,id);
    actions.createEl('button',{text:tr('删除资料'),cls:'lh-secondary'}).onclick=()=>this.confirmDeletePractice(course,item);
    const status=el.createDiv({cls:'lh-homework-analysis-status'});this.renderPracticeStatus(status,item);
    const files=el.createDiv({cls:'lh-practice-files'});for(const f of item.files||[]){const button=files.createEl('button',{text:f.name,cls:'lh-secondary'});button.onclick=()=>void this.openPracticeFile(f);}
    if(item.analysisStale)el.createDiv({text:tr('资料类型已修改，请重新解析。'),cls:'lh-practice-warning'});
    const analysis=item.analysisStale?null:await this.readPracticeAnalysis(course,id);
    if(!analysis){const legacy=el.createDiv({cls:'lh-panel lh-practice-summary markdown-rendered'});try{await this.renderPracticeMarkdown(legacy,await this.app.vault.adapter.read(this.labContentPath(course,id)),this.labContentPath(course,id));}catch{legacy.setText(tr('整理完成后，这里会显示题目和代码模板。'));}return;}
    for(const warning of analysis.warnings||[])el.createDiv({text:warning,cls:'lh-practice-warning'});
    const summary=el.createEl('details',{cls:'lh-practice-summary'});summary.createEl('summary',{text:tr('主题与学习要求')});await this.renderPracticeMarkdown(summary.createDiv({cls:'markdown-rendered'}),analysis.markdown,this.labContentPath(course,id));
    const questions=flattenHomeworkQuestions(analysis.questions||[]);if(!questions.length)return;
    this.practiceSelection||=new Map();const key=course+':'+id,current=questions.find(q=>q.id===this.practiceSelection.get(key))||questions[0];
    const layout=el.createDiv({cls:'lh-practice-layout'}),nav=layout.createDiv({cls:'lh-panel lh-practice-nav',attr:{'aria-label':tr('题目目录')}}),body=layout.createDiv({cls:'lh-panel lh-practice-question'});
    for(const q of questions){const button=nav.createEl('button',{text:q.parentQuestionId?`${q.parentQuestionLabel} ${q.label}`:q.label,cls:'lh-practice-question-link'+(q.id===current.id?' is-active':'')+(q.parentQuestionId?' is-child':''),attr:{'aria-current':q.id===current.id?'true':'false'}});button.onclick=()=>{this.practiceSelection.set(key,q.id);void this.refreshLabView(course);};}
    body.createDiv({text:current.source||'',cls:'lh-homework-card-meta'});body.createEl('h2',{text:current.parentQuestionId?`${current.parentQuestionLabel} ${current.label}`:current.label});if(current.parentContext)await this.renderPracticeMarkdown(body.createDiv({cls:'lh-practice-context markdown-rendered'}),current.parentContext,this.labContentPath(course,id));await this.renderPracticeMarkdown(body.createDiv({cls:'markdown-rendered'}),current.markdown,this.labContentPath(course,id));if(current.codeTemplate)body.createEl('pre',{cls:'lh-practice-code'}).createEl('code',{text:current.codeTemplate});
    const field=body.createEl('label',{text:tr('我的笔记 / 解答'),cls:'lh-practice-answer-label'}),note=field.createEl('textarea',{attr:{placeholder:tr('记录推导、思路或代码问题…'),'aria-label':tr('我的笔记 / 解答')}});note.value=item.questionNotes?.[current.id]||'';const saved=body.createDiv({cls:'lh-homework-card-meta',attr:{'aria-live':'polite'}});note.onchange=()=>void this.mutatePractice(course,id,item=>{item.questionNotes||={};item.questionNotes[current.id]=note.value;}).then(()=>saved.setText(tr('已保存'))).catch(e=>new Notice(e.message));
    const controls=body.createDiv({cls:'lh-practice-question-controls'}),doneLabel=controls.createEl('label',{cls:'lh-practice-toggle'}),done=doneLabel.createEl('input',{attr:{type:'checkbox'}});done.checked=!!item.questionDone?.[current.id];doneLabel.createSpan({text:tr('已完成这一问')});done.onchange=()=>void this.mutatePractice(course,id,item=>{item.questionDone||={};item.questionDone[current.id]=done.checked;}).catch(e=>new Notice(e.message));
    if(kind==='tutorial'){const wrongLabel=controls.createEl('label',{cls:'lh-practice-toggle'}),wrong=wrongLabel.createEl('input',{attr:{type:'checkbox'}});wrong.checked=(item.wrongQuestionIds||[]).includes(current.id);wrongLabel.createSpan({text:tr('加入错题')});wrong.onchange=()=>{wrong.disabled=true;void this.setPracticeWrong(course,id,current.id,wrong.checked).catch(e=>{wrong.checked=!wrong.checked;new Notice(e.message);}).finally(()=>{wrong.disabled=false;});};}
    if(current.answer){const answer=body.createEl('details',{cls:'lh-practice-reference'});answer.createEl('summary',{text:tr('查看参考答案与讲解')});await this.renderPracticeMarkdown(answer.createDiv({cls:'markdown-rendered'}),current.answer,this.labContentPath(course,id));}
  },
};
module.exports={practiceMethods};
