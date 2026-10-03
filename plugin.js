const {configureDateInput,validateTemporalInputs}=require('./modules/date-input');
const { t: tr, translate, uiLocale, setInterfaceLanguage, normalizeInterfaceLanguage } = require('./modules/i18n');
const {Plugin, ItemView, Modal, Notice, TFile, MarkdownView, MarkdownRenderer, requestUrl, setIcon, normalizePath} = require('obsidian');
const path = require('path');
const {generationLanguageInstruction}=require('./modules/generation-language');
const {CodexClient} = require('./modules/codex-client');
const {formatCodexUsage,formatDeepSeekUsage} = require('./modules/token-usage');
const {extractPdfText, combineLectureSlides, previewSchema, previewPrompt, validatePreviewDraft} = require('./modules/lecture-ai');
const {courseInitialSchema,courseInitialPrompt,validateCourseInitial,formatCourseInitial,mergeCourseInitialNote}=require('./modules/course-initial');
const {previewGroups,mergeGeneratedPreview,legacyPreviewDraft,formatPreviewMarkdown}=require('./modules/preview-structure');
const {buildScheduleRequest,validateScheduleDraft,acceptScheduleDraft}=require('./modules/schedule-ai');
const {classifyCalendarEvent,matchCalendarCourse,calendarBlocks,estimateMinutes,taskStatus,scheduleItemState,retainPendingCalendarEvents,planIncrementally}=require('./modules/planning');
const {completed,tasksForToday,recentDeadlineTasks,deadlineLabel,urgencyBand}=require('./modules/task-views');
const {taskIntakePrompt,parseTaskIntake,validDate}=require('./modules/task-intake');
const {WEEKDAYS,normalizeAvailability,normalizeRestBlocks,expandRestBlocks,availabilityPrompt,parseAvailabilityResponse}=require('./modules/study-availability');
const {noteSchema,notePrompt,validateNoteDraft,questionsSchema,questionsPrompt,validateQuestions}=require('./modules/study-ai');
const {organizeSchema,analyzeSchema,combineHomeworkTexts,organizeHomeworkPrompt,validateOrganizedHomework,analyzeHomeworkPrompt,validateHomeworkAnalysis}=require('./modules/homework-ai');
const {labSchema,labPrompt,validateLabDraft}=require('./modules/lab-ai');
const {MISCONCEPTION_SYSTEM,misconceptionRequest,parseMisconception}=require('./modules/chat-error-ai');
const {DEFAULT_PRICING,PRICING_URL,parseOfficialPricing}=require('./modules/deepseek-pricing');
const {DEEPSEEK_ENDPOINT,DEFAULT_SYSTEM_PROMPT,createDeepSeekChatClient}=require('./modules/deepseek-chat');
const {createChatStore}=require('./modules/chat-store');
const {CHAT_VIEW_TYPE,LearningChatView}=require('./modules/chat-view');
const {normalizeGoogleState,localTimestamp,createGoogleCalendarClient}=require('./modules/google-calendar');
const {normalizeSemesterLabel,semesterIdForName,semesterSortValue,parseSemesterCatalog}=require('./modules/semesters');
const {normalizeDraftSettings,draftTimestamp,isTimestampDraft,draftParentFolder,draftTitleRequest,parseDraftTitle,uniqueDraftPath}=require('./modules/drafts');

const ROOT = 'Courses';
const INDEX = `${ROOT}/Courses.md`;
const HOME = 'Home.md';
const SCHEDULE = '学习系统/完整日程.md';
const TASKS = '学习系统/待办.md';
const RETROSPECT = '学习系统/复盘.md';
const DRAFT_FOLDER = 'Draft';
const DRAFTS_PAGE = 'drafts';
const NAV = 'learning-hub-navigation';
const MAIN = 'learning-hub-main';
const ANNOTATION_VIEW = 'margin-notes-sidebar';
const PREVIEW_TIMEOUT_MS = 8 * 60 * 1000;
const DEFAULT_COURSES = [];
const STAGES = [['previewed','待预习'], ['learned','待学习'], ['reviewed','待复习']];
const REVIEW_ROUNDS = [
  {day:1,title:'01 · 初次巩固',subtitle:'核心概念与薄弱点',minutes:'5–10 分钟'},
  {day:7,title:'02 · 应用检验',subtitle:'提取、方法选择与应用',minutes:'约 15 分钟'},
  {day:21,title:'03 · 混合迁移',subtitle:'跨讲次联系与综合题',minutes:'约 20 分钟'}
];
const pad = n => String(n).padStart(2,'0');
const today = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const localNow = () => { const d=new Date(); return `${today()}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const addDays = (date,days) => { const [y,m,d]=date.slice(0,10).split('-').map(Number); const result=new Date(y,m-1,d+days); return `${result.getFullYear()}-${pad(result.getMonth()+1)}-${pad(result.getDate())}`; };
const now = () => new Date().toISOString();
const bool = x => x === true || x === 'true';
const safeSegment = value => String(value||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/^\.+$/,'_').trim().slice(0,100)||'Untitled';
const asFile = (app,path) => { const f=app.vault.getAbstractFileByPath(path); return f instanceof TFile ? f : null; };

class EntryModal extends Modal {
  constructor(app, title, fields, done, onDelete=null) { super(app); this.title=title; this.fields=fields; this.done=done; this.onDelete=onDelete; }
  onOpen() {
    const el=this.contentEl; el.empty(); el.addClass('learning-hub-modal');
    el.createEl('h2',{text:this.title}); const inputs={};
    for(const f of this.fields){ const row=el.createDiv({cls:'lh-form-row'}); row.createEl('label',{text:f.label}); const input=f.options?row.createEl('select'):row.createEl(f.multiline?'textarea':'input',{attr:f.multiline?{placeholder:f.placeholder||''}:{type:f.type||'text',placeholder:f.placeholder||''}});if(f.options)for(const option of f.options)input.createEl('option',{text:option.label,attr:{value:option.value}}); if(f.value)input.value=f.value; configureDateInput(input);inputs[f.key]=input; }
    const footer=el.createDiv({cls:'lh-confirm-actions'});
    if(this.onDelete){const remove=footer.createEl('button',{text:tr('删除待办'),cls:'lh-task-edit-delete'});remove.onclick=()=>new ConfirmModal(this.app,tr('删除此待办？'),tr('删除后，与此待办关联的日程安排会一并移除；历史完成记录会保留。'),tr('确认删除'),async()=>{await this.onDelete();this.close();}).open();}
    const cancel=footer.createEl('button',{text:tr('取消')});cancel.onclick=()=>this.close();
    const action=footer.createEl('button',{text:tr("保存"),cls:'mod-cta'});
    action.onclick=async()=>{ if(!validateTemporalInputs(el))return;const values=Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value.trim()])); if(!values.title){new Notice(tr("请填写名称"));return;} if(await this.done(values)!==false)this.close(); };
  }
}

class OutcomeModal extends Modal {
  constructor(app,title,estimated,done,initialStatus='on-time'){super(app);this.title=title;this.estimated=estimated;this.done=done;this.initialStatus=initialStatus;}
  onOpen(){
    this.modalEl.addClass('lh-outcome-shell');
    const el=this.contentEl;el.empty();el.addClass('learning-hub-modal','lh-outcome-modal');
    const head=el.createDiv({cls:'lh-outcome-head'});
    head.createSpan({text:tr("完成记录"),cls:'lh-outcome-kicker'});
    head.createEl('h2',{text:this.title});
    head.createEl('p',{text:this.estimated?tr("预计用时 {0} 分钟 · 记录实际情况，帮助后续安排更准确。", [this.estimated]):tr("记录实际完成情况，帮助后续安排更准确。")});
    const options=el.createDiv({cls:'lh-outcome-options',attr:{role:'group','aria-label':tr("完成情况")}});
    const choices=[['on-time',tr("按时完成"),tr("按计划完成")],['late',tr("未按时完成"),tr("完成了，但比计划晚")],['unfinished',tr("未完成"),tr("保留在待办中")]];
    let selected=this.initialStatus;
    const buttons=new Map();
    for(const [value,label,description] of choices){
      const button=options.createEl('button',{cls:'lh-outcome-choice',attr:{type:'button','aria-pressed':'false'}});
      button.createSpan({text:label,cls:'lh-outcome-choice-title'});
      button.createSpan({text:description,cls:'lh-outcome-choice-note'});
      button.onclick=()=>{selected=value;updateSelection();};
      buttons.set(value,button);
    }
    const fields=el.createDiv({cls:'lh-outcome-fields'});
    const dateRow=fields.createDiv({cls:'lh-outcome-field'});dateRow.createEl('label',{text:tr("实际完成日期")});const date=dateRow.createEl('input',{attr:{type:'date'}});configureDateInput(date);date.max=today();date.required=true;date.value=today();
    const timeRow=fields.createDiv({cls:'lh-outcome-field'});timeRow.createEl('label',{text:tr("实际用时"),cls:'lh-outcome-time-label'});const duration=timeRow.createEl('input',{attr:{type:'number',min:'1',placeholder:this.estimated?tr("预计 {0} 分钟", [this.estimated]):tr("分钟（可选）")}});
    const updateSelection=()=>{for(const [value,button] of buttons){button.classList.toggle('is-selected',value===selected);button.setAttribute('aria-pressed',String(value===selected));}fields.hidden=selected==='unfinished';options.classList.toggle('is-unfinished',fields.hidden);};
    updateSelection();
    const footer=el.createDiv({cls:'lh-outcome-footer'});
    const cancel=footer.createEl('button',{text:tr("取消"),cls:'lh-outcome-cancel'});cancel.onclick=()=>this.close();
    const save=footer.createEl('button',{text:tr("保存记录"),cls:'lh-outcome-save'});save.onclick=async()=>{if(selected!=='unfinished'&&!validateTemporalInputs(el))return;if(selected!=='unfinished'&&(!date.value||date.value>today())){new Notice(tr("请选择今天或更早的完成日期"));return;}save.disabled=true;try{await this.done({status:selected,completedAt:selected==='unfinished'?'':`${date.value}T12:00`,actualMinutes:selected==='unfinished'?0:Number(duration.value)||0});this.close();}catch(error){console.error('Learning Hub completion:',error);new Notice(tr("保存失败：{0}", [error.message]));save.disabled=false;}};
  }
}

class TaskIntakeModal extends Modal {
  constructor(plugin){super(plugin.app);this.plugin=plugin;this.history=[];this.messages=[];this.drafts=[];this.composerDraft='';this.busy=false;this.reviewing=false;this.closed=false;}
  onOpen(){
    this.modalEl.addClass('lh-task-intake-shell');
    this.contentEl.addClass('learning-hub-modal','lh-task-intake-modal');
    this.courses=this.plugin.coursesForSemester();
    this.lessonFiles=this.courses.flatMap(course=>this.plugin.lessons(course));
    this.lessons=this.lessonFiles.map(file=>file.path);
    this.messages=[{role:'assistant',content:tr("告诉我你要完成哪些事，可以一次说多个。说明、DDL、课程或讲次会分别记录；没提到的字段会留空。")}];
    this.render();
  }
  onClose(){this.closed=true;this.contentEl.empty();}
  render(){
    const root=this.contentEl;root.empty();
    const head=root.createDiv({cls:'lh-intake-head'});head.createSpan({text:tr("DEEPSEEK · 待办录入"),cls:'lh-intake-kicker'});head.createEl('h2',{text:this.reviewing?tr("核对 {0} 项待办", [this.drafts.length]):tr("对话添加待办")});head.createEl('p',{text:this.reviewing?tr("逐项检查或删除。确认后才会一起加入待办。"):tr("可以一次说多个事项；只提取对话中明确的信息。")});
    if(this.reviewing){this.renderReview(root);return;}
    const messages=root.createDiv({cls:'lh-intake-messages',attr:{role:'log','aria-label':tr("待办录入对话")}});
    for(const message of this.messages){const bubble=messages.createDiv({cls:`lh-intake-message is-${message.role}`});bubble.createSpan({text:message.role==='user'?tr("你"):'DeepSeek',cls:'lh-intake-role'});bubble.createDiv({text:message.content,cls:'lh-intake-copy'});const usage=message.role==='assistant'&&Object.prototype.hasOwnProperty.call(message,'usage')?formatDeepSeekUsage(message.usage):'';if(usage)bubble.createDiv({text:usage,cls:'lh-intake-usage'});}
    messages.scrollTop=messages.scrollHeight;
    if(this.drafts.length){const preview=root.createDiv({cls:'lh-intake-preview'});preview.createSpan({text:tr("当前草稿 · {0} 项", [this.drafts.length]),cls:'lh-intake-preview-label'});for(const [index,draft] of this.drafts.entries()){const item=preview.createDiv({cls:'lh-intake-preview-item'});item.createEl('strong',{text:`${index+1}. ${draft.title||tr("未命名事项")}`});item.createSpan({text:[draft.due?`${tr("截止")} ${draft.due}${draft.dueTime?` ${draft.dueTime}`:''}`:tr("未设置 DDL"),draft.course?.split(' - ')[0]||tr("未关联课程")].join(' · '),cls:'lh-intake-preview-meta'});}}
    const composer=root.createDiv({cls:'lh-intake-composer'});
    const input=composer.createEl('textarea',{attr:{placeholder:this.plugin.state.deepseek.apiKey?tr("例如：周五 23:59 前提交机器学习作业第 2 题…"):tr("请先在插件设置中填写 DeepSeek API Key"),'aria-label':tr("描述要添加的待办")}});input.value=this.composerDraft;input.disabled=this.busy||!this.plugin.state.deepseek.apiKey;input.oninput=()=>{this.composerDraft=input.value;};input.onkeydown=event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();void this.send();}};
    const send=composer.createEl('button',{text:this.busy?tr("正在整理…"):tr("发送"),cls:'lh-intake-send'});send.disabled=this.busy||!this.plugin.state.deepseek.apiKey;send.onclick=()=>void this.send();
    const footer=root.createDiv({cls:'lh-intake-footer'});footer.createSpan({text:tr("⌘ / Ctrl + Enter 发送"),cls:'lh-intake-hint'});
    const cancel=footer.createEl('button',{text:tr("取消"),cls:'lh-intake-quiet'});cancel.onclick=()=>this.close();
    const review=footer.createEl('button',{text:tr("核对 {0} 项 →", [this.drafts.length]),cls:'lh-intake-primary'});review.disabled=this.busy||!this.drafts.length;review.onclick=()=>{this.reviewing=true;this.render();};
  }
  async send(){
    const question=this.composerDraft.trim();if(!question||this.busy)return;
    if(!this.plugin.state.deepseek.apiKey){new Notice(tr("请先在 Learning Hub 设置中填写 DeepSeek API Key。"));return;}
    this.composerDraft='';this.messages.push({role:'user',content:question});this.busy=true;this.render();
    try{
      const systemPrompt=`${taskIntakePrompt({date:today(),courses:this.courses,lessons:this.lessons})}\n当前已核对草稿列表：${JSON.stringify(this.drafts)}`;
      const result=await this.plugin.callDeepSeek({user:question,history:this.history,systemPrompt,thinking:false,reasoningEffort:'none',maxTokens:Math.min(6000,1200+this.drafts.length*170)});
      const parsed=parseTaskIntake(result.content,this.drafts,this.courses,this.lessons);
      if(this.closed)return;
      this.history=result.history;this.drafts=parsed.drafts;this.messages.push({role:'assistant',content:parsed.reply,usage:result.usage});
    }catch(error){if(this.closed)return;console.error('Learning Hub task intake:',error);this.messages.push({role:'assistant',content:error.message||'暂时无法整理事项，请重试。'});}
    finally{if(!this.closed){this.busy=false;this.render();}}
  }
  renderReview(root){
    const forms=root.createDiv({cls:'lh-intake-forms'});
    const readers=[];
    this.drafts.forEach((draft,index)=>{
      const form=forms.createDiv({cls:'lh-intake-form'});
      const top=form.createDiv({cls:'lh-intake-form-top'});top.createEl('strong',{text:tr("事项 {0}", [index+1])});const remove=top.createEl('button',{text:tr("删除此项"),cls:'lh-intake-remove'});remove.onclick=()=>{this.drafts=readers.map(read=>read());this.drafts.splice(index,1);this.render();};
      const field=(label,type,value,options)=>{const wrap=form.createDiv({cls:'lh-intake-field'});wrap.createEl('label',{text:label});const input=options?wrap.createEl('select'):wrap.createEl(type==='textarea'?'textarea':'input',{attr:type==='textarea'?{}:{type}});if(options)for(const option of options)input.createEl('option',{text:option.label,attr:{value:option.value}});configureDateInput(input);input.value=value||'';return input;};
      const title=field(tr("需要完成的事项"),'text',draft.title);
      const description=field(tr("详细说明（可选）"),'textarea',draft.description);
      const dates=form.createDiv({cls:'lh-intake-date-fields'});
      const dateField=dates.createDiv({cls:'lh-intake-field'});dateField.createEl('label',{text:tr("DDL 日期（可选）")});const due=dateField.createEl('input',{attr:{type:'date'}});configureDateInput(due);due.value=draft.due;
      const timeField=dates.createDiv({cls:'lh-intake-field'});timeField.createEl('label',{text:tr("DDL 时间（可选）")});const dueTime=timeField.createEl('input',{attr:{type:'time'}});dueTime.value=draft.dueTime;
      const course=field(tr("关联课程（可选）"),'select',draft.course,[{label:tr("不关联课程"),value:''},...this.courses.map(value=>({label:value,value}))]);
      const lesson=field(tr("关联讲次（可选）"),'select',draft.lessonPath,[{label:tr("不关联讲次"),value:''},...this.lessonFiles.map(file=>({label:`${file.parent?.name||''} · ${file.basename}`,value:file.path}))]);
      const pinRow=form.createEl('label',{cls:'lh-intake-pin'});const pinned=pinRow.createEl('input',{attr:{type:'checkbox'}});pinned.checked=!!draft.pinned;pinRow.createSpan({text:tr("在最近事项中置顶")});
      readers.push(()=>({title:title.value.trim(),description:description.value.trim(),due:due.value,dueTime:dueTime.value,course:course.value,lessonPath:lesson.value,pinned:pinned.checked,source:'DeepSeek 对话'}));
    });
    const readAll=()=>readers.map(read=>read());
    const add=forms.createEl('button',{text:tr("＋ 新增一项"),cls:'lh-intake-add'});add.onclick=()=>{this.drafts=[...readAll(),{title:'',description:'',due:'',dueTime:'',course:'',lessonPath:'',pinned:false}];this.render();};
    const footer=root.createDiv({cls:'lh-intake-footer'});footer.createSpan({text:tr("保存前请检查 AI 提取的内容。"),cls:'lh-intake-hint'});
    const back=footer.createEl('button',{text:tr("返回对话"),cls:'lh-intake-quiet'});back.onclick=()=>{this.drafts=readAll();this.reviewing=false;this.render();};
    const save=footer.createEl('button',{text:tr("确认添加 {0} 项", [this.drafts.length]),cls:'lh-intake-primary'});save.disabled=!this.drafts.length;save.onclick=async()=>{if(!validateTemporalInputs(root))return;save.disabled=true;try{const values=readAll();if(await this.plugin.saveTasks(values)){new Notice(tr("已添加 {0} 项待办", [values.length]));this.close();}else save.disabled=false;}catch(error){console.error('Learning Hub task save:',error);new Notice(tr("添加待办失败：{0}", [error.message]));save.disabled=false;}};
  }
}

class StudyAvailabilityModal extends Modal {
  constructor(plugin){
    super(plugin.app);this.plugin=plugin;this.history=[];this.messages=[];this.composerDraft='';this.busy=false;this.ready=false;this.closed=false;
    const availability=plugin.state.ai?.availability;
    this.initialAvailability=Array.isArray(availability)?availability.map(row=>({day:Number(row.day),start:String(row.start||''),end:String(row.end||'')})):[];
    this.proposed=this.initialAvailability.map(row=>({...row}));
    this.initialRestBlocks=normalizeRestBlocks(plugin.state.ai?.restBlocks||[]);
    this.proposedRestBlocks=this.initialRestBlocks.map(row=>({...row,days:row.days?[...row.days]:undefined}));
  }
  onOpen(){
    this.modalEl.addClass('lh-availability-shell');
    this.contentEl.addClass('learning-hub-modal','lh-availability-modal');
    this.messages=[{role:'assistant',content:tr("告诉我每周可学习的时间，也可以说哪些日期或时段休息。我会整理成可核对的安排；点击应用后才保存并更新滚动日程。")}];
    this.render();
  }
  onClose(){this.closed=true;this.contentEl.empty();}
  render(){
    const root=this.contentEl;root.empty();
    const head=root.createDiv({cls:'lh-intake-head'});head.createSpan({text:tr("DEEPSEEK · 时间安排"),cls:'lh-intake-kicker'});head.createEl('h2',{text:tr("设置可学习时间与休息安排")});head.createEl('p',{text:tr("告诉我每周可学习的时间，也可以说哪些日期或时段休息。我会整理成可核对的安排；点击应用后才保存并更新滚动日程。")});
    if(!this.plugin.state.deepseek.apiKey)root.createDiv({text:tr("请先在 Learning Hub 设置中填写统一的 DeepSeek API Key。"),cls:'lh-availability-key-notice'});
    const messages=root.createDiv({cls:'lh-intake-messages',attr:{role:'log','aria-label':tr("可学习时间与休息安排对话")} });
    for(const message of this.messages){
      const bubble=messages.createDiv({cls:`lh-intake-message is-${message.role}`});bubble.createSpan({text:message.role==='user'?tr("你"):'DeepSeek',cls:'lh-intake-role'});bubble.createDiv({text:message.content,cls:'lh-intake-copy'});
      const usage=message.role==='assistant'&&Object.prototype.hasOwnProperty.call(message,'usage')?formatDeepSeekUsage(message.usage):'';if(usage)bubble.createDiv({text:usage,cls:'lh-intake-usage'});
    }
    messages.scrollTop=messages.scrollHeight;
    const preview=root.createDiv({cls:'lh-availability-preview'});const previewHead=preview.createDiv({cls:'lh-availability-preview-head'});previewHead.createEl('strong',{text:tr("周时段预览")});previewHead.createSpan({text:this.ready?tr("AI 已整理 · 请核对后应用"):tr("AI 修改后会显示在这里")});
    const grid=preview.createDiv({cls:'lh-availability-grid'});
    for(const day of [1,2,3,4,5,6,0]){
      const item=grid.createDiv({cls:'lh-availability-day'});item.createSpan({text:tr(WEEKDAYS[day]),cls:'lh-availability-day-name'});
      const windows=this.proposed.filter(row=>row.day===day),list=item.createDiv({cls:'lh-availability-windows'});
      if(windows.length)for(const window of windows)list.createSpan({text:`${window.start}–${window.end}`,cls:'lh-availability-chip'});
      else list.createSpan({text:tr("未设置"),cls:'lh-availability-empty'});
    }
    const rests=preview.createDiv({cls:'lh-availability-rest-list'});rests.createEl('strong',{text:tr("休息安排")});
    if(!this.proposedRestBlocks.length)rests.createSpan({text:tr("暂无额外休息安排"),cls:'lh-availability-empty'});
    for(const block of this.proposedRestBlocks){
      const when=block.date||block.days.map(day=>tr(WEEKDAYS[day])).join('、');
      const time=block.allDay?tr("全天休息"):tr("{0}–{1} 休息",[block.start,block.end]);
      rests.createSpan({text:`${when} · ${time}`,cls:'lh-availability-rest-chip'});
    }
    if(!this.proposed.length)preview.createDiv({text:tr("至少保留一个每周可学习时段，才能安排滚动日程。"),cls:'lh-availability-warning'});
    const composer=root.createDiv({cls:'lh-intake-composer'});
    const input=composer.createEl('textarea',{attr:{placeholder:this.plugin.state.deepseek.apiKey?tr("例如：每周一到周五晚上 7 点到 10 点可以学习，10 月 10 日休息…"):tr("请先在插件设置中填写 DeepSeek API Key"),'aria-label':tr("描述可学习时间和休息安排")} });input.value=this.composerDraft;input.disabled=this.busy||!this.plugin.state.deepseek.apiKey;input.oninput=()=>{this.composerDraft=input.value;};input.onkeydown=event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();void this.send();}};
    const send=composer.createEl('button',{text:this.busy?tr("正在整理…"):tr("发送"),cls:'lh-intake-send'});send.disabled=this.busy||!this.plugin.state.deepseek.apiKey;send.onclick=()=>void this.send();
    const footer=root.createDiv({cls:'lh-intake-footer'});footer.createSpan({text:!this.plugin.state.deepseek.apiKey?tr("先在设置中填写统一的 DeepSeek API Key。"):tr("预览不会自动保存；确认后才应用并更新未来 7 天的滚动日程。"),cls:'lh-intake-hint'});
    const cancel=footer.createEl('button',{text:tr("取消"),cls:'lh-intake-quiet'});cancel.onclick=()=>this.close();
    const apply=footer.createEl('button',{text:tr("应用时间安排"),cls:'lh-intake-primary'});apply.disabled=this.busy||!this.ready||!this.proposed.length;apply.onclick=()=>void this.apply();
  }
  async send(){
    const question=this.composerDraft.trim();if(!question||this.busy)return;
    if(!this.plugin.state.deepseek.apiKey){new Notice(tr("请先在 Learning Hub 设置中填写统一的 DeepSeek API Key。"));return;}
    this.composerDraft='';this.ready=false;this.messages.push({role:'user',content:question});this.busy=true;this.render();
    try{
      const timezone=this.plugin.state.ai.timezone||'Asia/Shanghai';
      const systemPrompt=availabilityPrompt({availability:this.proposed,restBlocks:this.proposedRestBlocks,timezone});
      const result=await this.plugin.callDeepSeek({user:question,history:this.history,systemPrompt,thinking:false,reasoningEffort:'none',maxTokens:1800,responseFormat:{type:'json_object'}});
      const parsed=parseAvailabilityResponse(result.content,{restBlocks:this.proposedRestBlocks});
      if(this.closed)return;
      this.history=result.history;this.proposed=parsed.availability;this.proposedRestBlocks=parsed.restBlocks;this.ready=parsed.ready;
      this.messages.push({role:'assistant',content:parsed.reply,usage:result.usage});
    }catch(error){if(this.closed)return;console.error('Learning Hub study availability:',error);this.messages.push({role:'assistant',content:error.message||tr("暂时无法整理可学习时间，请重试。")});}
    finally{if(!this.closed){this.busy=false;this.render();}}
  }
  async apply(){
    if(this.busy||!this.ready||!this.proposed.length)return;
    const current=this.plugin.state.ai?.availability;
    const currentRest=this.plugin.state.ai?.restBlocks||[];
    if(JSON.stringify(current||[])!==JSON.stringify(this.initialAvailability)||JSON.stringify(normalizeRestBlocks(currentRest))!==JSON.stringify(this.initialRestBlocks)){new Notice(tr("时间安排已在其他窗口中更新，请重新打开设置。"));return;}
    let next,nextRest;
    try{next=normalizeAvailability(this.proposed);nextRest=normalizeRestBlocks(this.proposedRestBlocks);}
    catch(error){new Notice(error.message);return;}
    try{this.plugin.state.ai.availability=next;this.plugin.state.ai.restBlocks=nextRest;await this.plugin.saveData(this.plugin.state);}
    catch(error){this.plugin.state.ai.availability=this.initialAvailability.map(row=>({...row}));this.plugin.state.ai.restBlocks=this.initialRestBlocks.map(row=>({...row,days:row.days?[...row.days]:undefined}));new Notice(tr("保存失败：{0}",[error.message]));return;}
    this.close();
    try{if(this.plugin.rollingPromise)try{await this.plugin.rollingPromise;}catch(_){}await this.plugin.updateRollingSchedule();new Notice(tr("可学习时间与休息安排已更新，滚动日程已同步。"));}
    catch(error){new Notice(tr("时间安排已保存，但滚动日程更新失败：{0}",[error.message]));}
    for(const leaf of this.plugin.app.workspace.getLeavesOfType(MAIN))if(leaf.view?.page==='schedule')await leaf.view.render();
  }
}

class CourseInitialModal extends Modal {
  constructor(plugin,course,sourcePath){super(plugin.app);this.plugin=plugin;this.course=course;this.sourcePath=sourcePath;this.phase='extracting';this.startedAt=Date.now();this.receivedChars=0;this.tokenUsage=null;this.reasoningSummary='';this.reasoningIndex=null;this.reasoningRenderVersion=0;this.reasoningRenderTimer=null;this.reasoningRenderHost=null;this.reasoningQueuedSource='';this.draft=null;this.error='';this.running=false;this.closed=false;}
  onOpen(){this.modalEl.addClass('lh-course-initial-shell');this.contentEl.addClass('learning-hub-modal','lh-course-initial-modal');this.render();this.ticker=setInterval(()=>this.updateProgress(),1000);void this.start();}
  onClose(){this.closed=true;clearInterval(this.ticker);clearTimeout(this.reasoningRenderTimer);this.reasoningRenderVersion++;this.contentEl.empty();}
  updateProgress(){if(this.closed)return;const status=this.contentEl.querySelector('.lh-course-initial-status');if(status){const label={extracting:tr("正在提取文件文字"),queued:tr("等待 Codex"),connecting:tr("连接 Codex"),starting:tr("启动分析"),generating:tr("正在分析 Syllabus"),receiving:tr("正在接收结果"),complete:tr("解析完成"),failed:tr("解析失败")}[this.phase]||tr("正在处理");status.setText(tr("{0} · {1} 秒{2}", [label, Math.floor((Date.now()-this.startedAt)/1000), this.receivedChars?tr(" · 已接收 {0} 字符", [this.receivedChars]):'']));}const usage=this.contentEl.querySelector('.lh-course-initial-usage');if(usage)usage.setText(this.tokenUsage?formatCodexUsage(this.tokenUsage):'');this.renderReasoning();}
  renderReasoning(){
    const host=this.contentEl.querySelector('.lh-course-initial-reasoning');if(!host)return;
    if(host!==this.reasoningRenderHost){this.reasoningRenderHost=host;this.reasoningQueuedSource='';}
    const source=this.reasoningSummary.trim();
    if(!source){if(!host.childNodes.length)host.setText(tr("Codex 正在分析课程结构…"));return;}
    if(source===this.reasoningQueuedSource)return;
    this.reasoningQueuedSource=source;clearTimeout(this.reasoningRenderTimer);
    const version=++this.reasoningRenderVersion;
    this.reasoningRenderTimer=setTimeout(async()=>{
      let markdown=source;
      const strong=[...markdown.matchAll(/\*\*/g)];if(strong.length%2){const index=strong.at(-1).index;markdown=markdown.slice(0,index)+markdown.slice(index+2);}
      const staging=document.createElement('div');
      try{if(MarkdownRenderer?.render)await MarkdownRenderer.render(this.app,markdown,staging,this.plugin.courseOverviewPath(this.course),this);else if(MarkdownRenderer?.renderMarkdown)await MarkdownRenderer.renderMarkdown(markdown,staging,this.plugin.courseOverviewPath(this.course),this);else staging.textContent=markdown.replace(/\*\*/g,'');}
      catch(error){console.warn('Learning Hub syllabus reasoning Markdown:',error);staging.textContent=markdown.replace(/\*\*/g,'');}
      if(this.closed||version!==this.reasoningRenderVersion||host!==this.contentEl.querySelector('.lh-course-initial-reasoning'))return;
      host.replaceChildren(...staging.childNodes);
    },100);
  }
  async start(){if(this.running)return;this.running=true;this.error='';this.draft=null;this.tokenUsage=null;this.phase='extracting';this.startedAt=Date.now();this.receivedChars=0;this.reasoningSummary='';this.reasoningIndex=null;this.render();
    try{this.draft=await this.plugin.parseCourseSyllabus(this.course,this.sourcePath,{
      onStatus:phase=>{this.phase=phase;this.updateProgress();},
      onProgress:delta=>{this.receivedChars+=String(delta||'').length;this.phase='receiving';this.updateProgress();},
      onTokenUsage:usage=>{this.tokenUsage=usage;this.updateProgress();},
      onReasoningSummary:(delta,index)=>{if(typeof index==='number'&&this.reasoningIndex!==index)this.reasoningSummary='';if(typeof index==='number')this.reasoningIndex=index;this.reasoningSummary+=delta;this.updateProgress();},
    });this.phase='complete';}
    catch(error){console.error('Learning Hub syllabus analysis:',error);this.error=error.message||'解析失败';this.phase='failed';}
    finally{this.running=false;if(!this.closed)this.render();}
  }
  render(){if(this.closed)return;const root=this.contentEl;root.empty();
    const head=root.createDiv({cls:'lh-course-initial-head'});head.createSpan({text:tr("COURSE INITIALIZATION \u00b7 CODEX"),cls:'lh-course-initial-kicker'});head.createEl('h2',{text:this.draft?tr("核对课程概览"):tr("解析 Syllabus")});head.createEl('p',{text:this.course});
    const source=root.createDiv({cls:'lh-course-initial-source'});source.createSpan({text:tr("来源文件")});source.createEl('strong',{text:this.sourcePath.split('/').at(-1)});
    if(!this.draft){const loading=root.createDiv({cls:'lh-course-initial-loading'});loading.createEl('strong',{text:this.phase==='failed'?tr("解析没有完成"):tr("正在整理整门课的信息")});loading.createDiv({cls:'lh-course-initial-status'});loading.createDiv({cls:'lh-course-initial-usage'});if(this.error)loading.createEl('p',{text:this.error,cls:'lh-course-initial-error'});else loading.createEl('p',{text:tr("原文件已保存；确认前不会写入课程概览。")});loading.createDiv({cls:'lh-course-initial-reasoning markdown-rendered'});this.updateProgress();}
    else{const preview=root.createDiv({cls:'lh-course-initial-preview markdown-rendered'});const markdown=formatCourseInitial(this.course,this.draft,this.sourcePath);const notePath=this.plugin.courseOverviewPath(this.course);try{const rendered=MarkdownRenderer?.render?MarkdownRenderer.render(this.app,markdown,preview,notePath,this):MarkdownRenderer?.renderMarkdown?MarkdownRenderer.renderMarkdown(markdown,preview,notePath,this):null;if(rendered)void Promise.resolve(rendered).catch(error=>{console.warn('Learning Hub syllabus preview:',error);preview.setText(markdown);});else if(!MarkdownRenderer?.render&&!MarkdownRenderer?.renderMarkdown)preview.setText(markdown);}catch(error){console.warn('Learning Hub syllabus preview:',error);preview.setText(markdown);}if(this.tokenUsage)root.createDiv({text:formatCodexUsage(this.tokenUsage),cls:'lh-course-initial-usage lh-course-initial-result-usage'});}
    const footer=root.createDiv({cls:'lh-course-initial-footer'});const cancel=footer.createEl('button',{text:tr("关闭"),cls:'lh-secondary'});cancel.onclick=()=>this.close();
    if(this.phase==='failed'){const retry=footer.createEl('button',{text:tr("重新解析"),cls:'lh-primary'});retry.onclick=()=>void this.start();}
    if(this.draft){const apply=footer.createEl('button',{text:tr("确认写入课程概览"),cls:'lh-primary'});apply.onclick=async()=>{apply.disabled=true;try{await this.plugin.applyCourseInitial(this.course,this.sourcePath,this.draft);this.close();await this.plugin.openHub('course',this.course);new Notice(tr("Course Initial 已写入课程概览"));}catch(error){console.error('Learning Hub course initial save:',error);new Notice(tr("保存失败：{0}", [error.message]));apply.disabled=false;}};}
  }
}

class ConfirmModal extends Modal {
  constructor(app,title,description,action,done,options={}){super(app);this.title=title;this.description=description;this.action=action;this.done=done;this.options=options;}
  onOpen(){
    const el=this.contentEl;el.empty();el.addClass('learning-hub-modal');
    el.createEl('h2',{text:this.title});el.createEl('p',{text:this.description,cls:'lh-confirm-copy'});
    let dateInput;
    if(this.options.askDate){const field=el.createDiv({cls:'lh-form-row'});field.createEl('label',{text:tr("实际完成日期")});dateInput=field.createEl('input',{attr:{type:'date'}});configureDateInput(dateInput);dateInput.max=today();dateInput.required=true;dateInput.value=today();}
    const row=el.createDiv({cls:'lh-confirm-actions'});
    const cancel=row.createEl('button',{text:tr("再检查一下")});cancel.onclick=()=>this.close();
    const confirm=row.createEl('button',{text:this.action,cls:'mod-cta'});
    confirm.onclick=async()=>{if(!validateTemporalInputs(el))return;if(dateInput&&(!dateInput.value||dateInput.value>today())){new Notice(tr("请选择今天或更早的完成日期"));return;}confirm.disabled=true;try{await this.done({date:dateInput?.value});this.close();}catch(e){console.error('Learning Hub confirmation:',e);new Notice(tr("保存失败：{0}",[e?.message||tr("保存失败，请重试")]));confirm.disabled=false;}};
  }
}

class HomeworkModal extends Modal {
  constructor(app,plugin,course,files,existing,done){super(app);this.plugin=plugin;this.course=course;this.files=files;this.existing=existing;this.done=done;}
  onOpen(){
    const el=this.contentEl;el.empty();el.addClass('learning-hub-modal','lh-homework-modal');
    el.createEl('h2',{text:this.existing?tr("编辑作业信息"):tr("上传并存档作业")});
    if(this.files.length)el.createEl('p',{text:tr("已选择 {0} 个文件：{1}{2}", [this.files.length, this.files.map(f=>f.name).slice(0,3).join('、'), this.files.length>3?'…':'']),cls:'lh-confirm-copy'});
    const field=(name,type='text',value='')=>{const row=el.createDiv({cls:'lh-form-row'});row.createEl('label',{text:name});const input=row.createEl('input',{attr:{type}});configureDateInput(input);input.value=value;return input;};
    const title=field(tr("作业名称"),'text',this.existing?.title||this.files[0]?.name.replace(/\.[^.]+$/,'')||'');
    const due=field(tr("截止日期（可选）"),'date',this.existing?.due||'');
    el.createEl('p',{text:tr("设置截止日期后，会自动加入本课程待办并进入 7 天滚动日程；清除日期会取消联动。"),cls:'lh-confirm-copy'});
    let difficulty,topics;
    if(this.existing){
      const difficultyRow=el.createDiv({cls:'lh-form-row'});difficultyRow.createEl('label',{text:tr("难度（可修正 AI 结果）")});difficulty=difficultyRow.createEl('select');
      for(let n=1;n<=5;n++)difficulty.createEl('option',{text:`${n} · ${n<=2?tr("基础"):n===3?tr("中等"):tr("较难")}`,attr:{value:String(n)}});
      difficulty.value=String(this.existing.difficulty||3);
      const topicRow=el.createDiv({cls:'lh-form-row'});topicRow.createEl('label',{text:tr("涉及知识点（可修正 AI 结果）")});topics=topicRow.createEl('textarea',{attr:{placeholder:tr("例如：矩阵可逆、秩、特征值")}});topics.value=(this.existing.topics||[]).join('、');
    }else el.createEl('p',{text:tr("保存后会自动整理题目并分析难度与知识点。"),cls:'lh-confirm-copy'});
    const lessonRow=el.createDiv({cls:'lh-form-row'});lessonRow.createEl('label',{text:tr("关联讲次")});const lesson=lessonRow.createEl('select');lesson.createEl('option',{text:tr("整个课程 / 稍后选择"),attr:{value:''}});
    for(const file of this.plugin.lessons(this.course))lesson.createEl('option',{text:file.basename,attr:{value:file.path}});
    lesson.value=this.existing?.lessonPath||'';
    const actions=el.createDiv({cls:'lh-confirm-actions'});const cancel=actions.createEl('button',{text:tr("取消")});cancel.onclick=()=>this.close();
    const submit=actions.createEl('button',{text:this.existing?tr("保存信息"):tr("保存作业"),cls:'mod-cta'});
    submit.onclick=async()=>{
      if(!validateTemporalInputs(el))return;
      const values={title:title.value.trim(),due:due.value,lessonPath:lesson.value};
      if(this.existing){values.difficulty=Number(difficulty.value);values.topics=[...new Set(topics.value.split(/[，,、;；\n]/).map(s=>s.trim()).filter(Boolean))].slice(0,12);}
      if(!values.title){new Notice(tr("请填写作业名称"));return;}
      submit.disabled=true;
      try{await this.done(values);this.close();}catch(e){console.error('Learning Hub homework:',e);new Notice(tr("保存作业失败，请重试"));submit.disabled=false;}
    };
  }
}

class LabModal extends Modal {
  constructor(app,plugin,course,files,existing,done){super(app);this.plugin=plugin;this.course=course;this.files=files;this.existing=existing;this.done=done;}
  onOpen(){
    const el=this.contentEl;el.empty();el.addClass('learning-hub-modal','lh-homework-modal');
    el.createEl('h2',{text:this.existing?tr("编辑 Lab Session"):tr("上传 Lab Session 课件")});
    if(this.files.length)el.createEl('p',{text:tr("已选择 {0} 个文件：{1}", [this.files.length, this.files.map(file=>file.name).join('、')]),cls:'lh-confirm-copy'});
    const field=(label,type,value)=>{const row=el.createDiv({cls:'lh-form-row'});row.createEl('label',{text:label});const input=row.createEl('input',{attr:{type}});configureDateInput(input);input.value=value||'';return input;};
    const title=field(tr("Lab Session 名称"),'text',this.existing?.title||this.files[0]?.name.replace(/\.[^.]+$/,'')||'');
    const due=field(tr("截止日期（可选）"),'date',this.existing?.due);
    const row=el.createDiv({cls:'lh-form-row'});row.createEl('label',{text:tr("关联讲次（可选）")});
    const lesson=row.createEl('select');lesson.createEl('option',{text:tr("整个课程"),attr:{value:''}});
    for(const file of this.plugin.lessons(this.course))lesson.createEl('option',{text:file.basename,attr:{value:file.path}});
    lesson.value=this.existing?.lessonPath||'';
    const actions=el.createDiv({cls:'lh-confirm-actions'});
    const cancel=actions.createEl('button',{text:tr("取消")});cancel.onclick=()=>this.close();
    const save=actions.createEl('button',{text:this.existing?tr("保存信息"):tr("保存并解析"),cls:'mod-cta'});
    save.onclick=async()=>{
      if(!validateTemporalInputs(el))return;
      if(!title.value.trim()){new Notice(tr("请填写 Lab Session 名称"));return;}
      save.disabled=true;
      try{await this.done({title:title.value.trim(),due:due.value,lessonPath:lesson.value});this.close();}
      catch(error){console.error('Learning Hub lab:',error);new Notice(tr("Lab Session 保存失败：{0}", [error.message]));save.disabled=false;}
    };
  }
}

class LearningHubMain extends ItemView {
  constructor(leaf,plugin){super(leaf);this.plugin=plugin;this.page='home';this.course=null;this.lessonPath=null;this.round=0;}
  getViewType(){return MAIN;}
  getDisplayText(){return ['preview','recall','review'].includes(this.page)?`${this.page==='preview'?tr("预习"):this.page==='recall'?tr("回忆"):tr("复习 {0}", [this.round])} · ${this.course?.split(' - ')[0]||''}`:this.page==='assignments'?tr("作业与 Lab Session · {0}", [this.course?.split(' - ')[0]||'']):this.page==='lesson'?`${this.lessonPath?.split('/').at(-1)?.replace(/\.md$/,'')||tr("讲次")} · ${this.course?.split(' - ')[0]||''}`:this.page==='course'?tr("课程概览 · {0}", [this.course?.split(' - ')[0]||'']):this.page==='schedule'?tr("完整日程"):this.page==='tasks'?tr("待办事项"):this.page==='retrospect'?tr("学习复盘"):this.page===DRAFTS_PAGE?tr("草稿本"):tr("学习主页");}
  getIcon(){return 'layout-dashboard';}
  getState(){return {page:this.page,course:this.course,lessonPath:this.lessonPath,round:this.round};}
  async setState(state,result){this.page=state?.page||'home';this.course=state?.course||null;this.lessonPath=state?.lessonPath||null;this.round=state?.round||0;if(super.setState)await super.setState(state,result);if(this.contentEl?.children?.length)await this.render();}
  async onOpen(){this.contentEl.addClass('lh-main-view');await this.render();}
  async setPage(page,course,lessonPath=null,round=0){this.page=page;this.course=course;this.lessonPath=lessonPath;this.round=round;await this.render();this.leaf.updateHeader?.();}
  async render(){
    const host=this.contentEl;if(!host)return;
    const previousScroll=host.querySelector?.('.lh-page-scroll')?.scrollTop||0;
    host.empty();host.addClass('lh-main-view');
    const app=host.createDiv({cls:'lh-app'});
    const bar=app.createDiv({cls:'lh-app-bar'});
    const brand=bar.createDiv({cls:'lh-app-brand'});brand.createSpan({text:'◈',cls:'lh-app-mark'});brand.createSpan({text:tr("LEARNING SPACE")});
    const context=bar.createDiv({cls:'lh-app-context'});
    context.createSpan({text:this.course?this.course.split(' - ')[0]:this.page==='schedule'?tr("日程"):this.page==='tasks'?tr("待办"):this.page==='retrospect'?tr("复盘"):this.page===DRAFTS_PAGE?tr("草稿本"):tr("总览")});
    context.createSpan({text:today(),cls:'lh-app-date'});
    const scroll=app.createDiv({cls:'lh-page-scroll'});
    const page=scroll.createDiv({cls:'learning-hub'});
    if(this.page==='course'&&this.course)await this.plugin.renderCourse(page,{sourcePath:`${ROOT}/${this.course}/学习概览.md`});
    else if(this.page==='lesson'&&this.course)await this.plugin.renderLessonCourse(page,{sourcePath:`${ROOT}/${this.course}/学习概览.md`,lessonPath:this.lessonPath});
    else if(this.page==='assignments'&&this.course)await this.plugin.renderAssignments(page,this.course);
    else if(['preview','recall','review'].includes(this.page)&&this.lessonPath)await this.plugin.renderWorkflow(page,{page:this.page,course:this.course,lessonPath:this.lessonPath,round:this.round});
    else if(this.page==='schedule')this.plugin.renderSchedule(page);
    else if(this.page==='tasks')this.plugin.renderTasks(page);
    else if(this.page==='retrospect')this.plugin.renderRetrospect(page);
    else if(this.page===DRAFTS_PAGE)this.plugin.renderDrafts(page);
    else await this.plugin.renderHome(page);
    scroll.scrollTop=previousScroll;
    const nativeTitle=this.containerEl.querySelector('.view-header-title');if(nativeTitle)nativeTitle.setText(this.getDisplayText());
    this.plugin.refreshChatContext();
  }
}

class LearningNav extends ItemView {
  constructor(leaf,plugin){super(leaf);this.plugin=plugin;}
  getViewType(){return NAV;}
  getDisplayText(){return tr("学习空间");}
  getIcon(){return 'library';}
  async onOpen(){await this.render();}
  async render(){
    const p=this.plugin, root=this.contentEl;root.empty();root.addClass('lh-nav-root');
    const course=p.activeCourse(),sidebar=root.createDiv({cls:'lh-sidebar'});
    const header=sidebar.createDiv({cls:'lh-sidebar-header'});
    const identity=header.createDiv({cls:'lh-sidebar-identity'});
    identity.createDiv({text:course?tr("COURSE SPACE"):tr("PERSONAL SPACE"),cls:'lh-sidebar-kicker'});
    identity.createEl('h2',{text:course?course.split(' - ')[0]:tr("学习空间")});
    const home=header.createEl('button',{cls:'lh-sidebar-icon',attr:{'aria-label':tr("返回个人主页"),title:tr("返回个人主页")}});setIcon(home,'house');home.onclick=()=>p.open(HOME);
    if(course)header.createDiv({text:course.split(' - ').slice(1).join(' - '),cls:'lh-sidebar-subtitle'});
    const scroll=sidebar.createDiv({cls:'lh-sidebar-scroll'});
    const section=(title,count)=>{const row=scroll.createDiv({cls:'lh-nav-section'});row.createSpan({text:title});if(count!=null)row.createSpan({text:String(count),cls:'lh-nav-section-count'});return row;};
    const item=(text,icon,action,active=false,meta='',extraClass='')=>{
      const button=scroll.createEl('button',{cls:`lh-nav-item${active?' is-active':''}${extraClass?` ${extraClass}`:''}`});
      const glyph=button.createSpan({cls:'lh-nav-icon'});setIcon(glyph,icon);
      button.createSpan({text,cls:'lh-nav-label'});
      if(meta)button.createSpan({text:meta,cls:'lh-nav-meta'});
      button.onclick=action;
      return button;
    };
    if(course){
      const base=`${ROOT}/${course}`;
      const lessons=p.lessons(course),selected=p.selectedLesson(course);
      section(tr("课程"));
      item(tr("课程概览"),'layout-dashboard',()=>p.open(`${base}/学习概览.md`),p.lastMainLeaf?.view?.page==='course'&&p.lastMainLeaf?.view?.course===course);
      const syllabus=p.syllabus(course);
      if(syllabus)item(tr("课程大纲"),'book-open',()=>p.open(syllabus.path));
      item(tr("课程文件"),'folder-open',()=>p.open(`${base}/${course}.md`));
      item(tr("作业与 Lab Session"),'archive',()=>p.openHub('assignments',course),p.lastMainLeaf?.view?.page==='assignments');
      if(selected){const plan=p.reviewPlan(await p.readFlow(selected)),next=plan.find(r=>r.unlocked&&!r.completedAt)||plan.find(r=>!r.completedAt)||plan[2];item(tr("间隔复习"),'repeat-2',()=>p.showWorkflow('review',course,selected.path,next.round),p.lastMainLeaf?.view?.page==='review',plan.filter(r=>r.completedAt).length+'/3');}
      section(tr("讲次"),lessons.length);
      if(!lessons.length)item(tr("上传课件"),'upload',()=>p.createLessonFromSlides(course),false,'','lh-nav-first-lesson');
      for(const lesson of lessons){
        const short=lesson.basename.split('@')[0].trim();
        item(short,'file-text',()=>{void p.selectLesson(course,lesson.path);},['lesson','preview','recall','review'].includes(p.lastMainLeaf?.view?.page)&&p.lastMainLeaf?.view?.lessonPath===lesson.path);
      }
    }else{
      section(tr("工作台"));
      item(tr("个人主页"),'house',()=>p.open(HOME),p.currentPath()===HOME);
      item(tr("完整日程"),'calendar-days',()=>p.open(SCHEDULE),p.currentPath()===SCHEDULE);
      item(tr("待办事项"),'list-todo',()=>p.open(TASKS),p.currentPath()===TASKS);
      item(tr("学习复盘"),'chart-no-axes-combined',()=>p.open(RETROSPECT),p.currentPath()===RETROSPECT);
      const semester=p.currentSemester(),semesterCourses=p.coursesForSemester();
      section(tr("{0}课程", [semester?.name||tr("本学期")]),semesterCourses.length);
      if(!semesterCourses.length)scroll.createDiv({text:tr("这个学期还没有课程。"),cls:'lh-sidebar-empty'});
      for(const c of semesterCourses)item(c.split(' - ')[0],'book-open',()=>p.open(`${ROOT}/${c}/学习概览.md`));
      section(tr("其他空间"));
      item('Projects','bot',()=>p.open('Projects/Projects.md'));
      item(tr("课外学习"),'compass',()=>p.open(`${ROOT}/Self Study/Self Study.md`));
      item(tr("草稿本"),'file-clock',()=>p.openHub(DRAFTS_PAGE,null),p.lastMainLeaf?.view?.page===DRAFTS_PAGE);
    }
    const footer=sidebar.createDiv({cls:'lh-sidebar-footer'});
    footer.createSpan({text:course?tr("{0} 讲课程资料", [p.lessons(course).length]):tr("{0} 门课程", [p.coursesForSemester().length])});
    const settings=footer.createEl('button',{cls:'lh-sidebar-icon',attr:{'aria-label':tr('插件设置'),title:tr('插件设置')}});setIcon(settings,'settings');settings.onclick=()=>{p.app.setting.open();p.app.setting.openTabById(p.manifest.id);};
    const files=footer.createEl('button',{cls:'lh-sidebar-icon',attr:{'aria-label':tr("打开课程总目录"),title:tr("打开课程总目录")}});setIcon(files,'folder-open');files.onclick=()=>p.open(INDEX);
  }
}

module.exports=class LearningHub extends Plugin {
  onunload(){this.unloaded=true;clearTimeout(this.draftCloseTimer);clearTimeout(this.refreshTimer);for(const timer of this.courseIndexSyncTimers?.values?.()||[])clearTimeout(timer);for(const feature of this.integratedFeatures||[]){try{feature.onunload?.();}catch(error){console.warn('Learning Hub integrated feature cleanup:',error);}}this.aiClient?.close();}
  integratedFeaturePath(key){return normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}/${key}.json`);}
  async loadIntegratedData(key,legacyId){
    const adapter=this.app.vault.adapter,path=this.integratedFeaturePath(key);
    if(await adapter.exists(path))return JSON.parse(await adapter.read(path));
    const legacyPath=normalizePath(`${this.app.vault.configDir}/plugins/${legacyId}/data.json`);
    if(!await adapter.exists(legacyPath))return {};
    const value=JSON.parse(await adapter.read(legacyPath));
    await adapter.write(path,JSON.stringify(value,null,2));
    return value;
  }
  saveIntegratedData(key,value){
    const adapter=this.app.vault.adapter,path=this.integratedFeaturePath(key),snapshot=JSON.parse(JSON.stringify(value??{}));
    this.integratedFeatureQueues||=new Map();
    const previous=this.integratedFeatureQueues.get(key)||Promise.resolve();
    const job=previous.catch(()=>{}).then(()=>adapter.write(path,JSON.stringify(snapshot,null,2)));
    this.integratedFeatureQueues.set(key,job);
    return job;
  }
  async initializeIntegratedFeatures(){
    const {createFeature}=require('./modules/feature-bridge');
    const specs=[
      {property:'studyProgress',key:'study-progress',legacyId:'study-progress',label:'Study Progress',Feature:require('./modules/study-progress')},
      {property:'studyReader',key:'study-reader',legacyId:'study-reader',label:'Study Reader',Feature:require('./modules/study-reader')},
      {property:'vaultGuide',key:'vault-guide',legacyId:'vault-index',label:'Vault Guide',Feature:require('./modules/vault-guide')},
    ];
    this.integratedFeatures=[];
    for(const spec of specs){
      const feature=createFeature(this,spec.Feature,spec);
      this[spec.property]=feature;
      this.integratedFeatures.push(feature);
      await feature.onload();
    }
  }
  async onload(){
    await require('./modules/local-storage').initializeLocalStorage(this);
    this.state=Object.assign({tasks:[],slots:[],reminders:[],calendarChoices:{},eventOutcomes:{},completionHistory:[],dismissedClassEventIds:[],courseScope:{},lastLessonByCourse:{},semesters:[],activeSemester:''},await this.loadData());
    this.state.interfaceLanguage=normalizeInterfaceLanguage(this.state.interfaceLanguage);setInterfaceLanguage(this.state.interfaceLanguage);
    this.state.calendarChoices||={};this.state.eventOutcomes||={};this.state.completionHistory||=[];this.state.dismissedClassEventIds||=[];
    const {normalizeAiSettings,LearningHubSettings}=require('./modules/settings');
    this.state.ai=normalizeAiSettings(this.state.ai);
    const savedDeepseek=this.state.deepseek&&typeof this.state.deepseek==='object'?this.state.deepseek:{};
    const legacyDraftTitle=this.state.draftTitle&&typeof this.state.draftTitle==='object'?this.state.draftTitle:{};
    const migrateDraftApi=Boolean(legacyDraftTitle.endpoint||legacyDraftTitle.apiKey||legacyDraftTitle.model);
    this.state.deepseek={
      ...savedDeepseek,
      endpoint:String(savedDeepseek.endpoint||legacyDraftTitle.endpoint||DEEPSEEK_ENDPOINT).trim(),
      apiKey:String(savedDeepseek.apiKey||legacyDraftTitle.apiKey||'').trim(),
      model:String(savedDeepseek.model||legacyDraftTitle.model||'deepseek-flash').trim(),
      effort:savedDeepseek.effort||'none',
      language:normalizeInterfaceLanguage(savedDeepseek.language||this.state.interfaceLanguage),
      pricing:savedDeepseek.pricing||structuredClone(DEFAULT_PRICING),
    };
    this.state.draftTitle=normalizeDraftSettings(legacyDraftTitle);
    this.draftOpenPaths=new Set();this.draftNamingJobs=new Set();this.draftOpenTrackingReady=false;
    this.state.googleCalendar=normalizeGoogleState(this.state.googleCalendar);
    this.googleCalendarClient=createGoogleCalendarClient({requestUrl,openExternal:url=>require('electron').shell.openExternal(url)});
    if(!['deepseek-flash','deepseek-v4-pro'].includes(this.state.deepseek.model))this.state.deepseek.model='deepseek-flash';
    if(!['none','low','high','max'].includes(this.state.deepseek.effort))this.state.deepseek.effort='none';
    if(migrateDraftApi)await this.saveData(this.state);
    this.chatStore=createChatStore(this.app.vault.adapter);
    this.deepseekClient=createDeepSeekChatClient({requestUrl,pricing:()=>this.state.deepseek.pricing});
    this.addSettingTab(new LearningHubSettings(this.app,this));
    await this.ensureWorkspace();
    await this.initializeIntegratedFeatures();
    if(!this.state.lastLessonByCourse||typeof this.state.lastLessonByCourse!=='object')this.state.lastLessonByCourse={};
    this.selectedLessonByCourse={...this.state.lastLessonByCourse};
    this.navigationCourse=null;
    this.courses=DEFAULT_COURSES;
    await this.loadCourses();
    this.registerView(NAV,leaf=>new LearningNav(leaf,this));
    this.registerView(MAIN,leaf=>new LearningHubMain(leaf,this));
    this.registerView(CHAT_VIEW_TYPE,leaf=>new LearningChatView(leaf,this));
    this.uiRibbonLabels=[];this.uiCommandLabels=[];
    const addUiRibbon=(icon,label,callback)=>{const el=this.addRibbonIcon(icon,tr(label),callback);this.uiRibbonLabels.push({el,label});};
    const addUiCommand=options=>{this.uiCommandLabels.push({id:options.id,label:options.name});this.addCommand({...options,name:tr(options.name)});};
    addUiRibbon('layout-dashboard','打开学习空间',()=>this.open(HOME));
    addUiRibbon('feather','新建草稿',()=>this.createDraft());
    addUiRibbon('message-circle','打开学习助手',()=>this.openChat());
    addUiCommand({id:'open-personal-home',name:'打开学习主页',callback:()=>this.open(HOME)});
    addUiCommand({id:'create-draft',name:'新建时间草稿',callback:()=>this.createDraft()});
    addUiCommand({id:'name-current-draft',name:'为当前时间草稿生成标题',callback:()=>this.generateDraftTitle(this.app.workspace.getActiveFile(),true)});
    addUiCommand({id:'open-full-schedule',name:'打开完整日程',callback:()=>this.open(SCHEDULE)});
    addUiCommand({id:'open-learning-retrospect',name:'打开学习复盘',callback:()=>this.open(RETROSPECT)});
    addUiCommand({id:'open-learning-chat',name:'打开学习助手侧边栏',callback:()=>this.openChat()});
    this.registerEvent(this.app.workspace.on('file-open',file=>{void this.refreshNav();const target=this.pageForPath(file?.path);if(!target)return;window.setTimeout(()=>{const leaf=this.app.workspace.activeLeaf;if(leaf?.view?.file?.path===file.path)void this.openHub(target.page,target.course,leaf);},0);}));
    for(const event of ['layout-change','file-open'])this.registerEvent(this.app.workspace.on(event,()=>{clearTimeout(this.draftCloseTimer);this.draftCloseTimer=window.setTimeout(()=>this.checkClosedDrafts(),800);}));
    this.registerEvent(this.app.workspace.on('active-leaf-change',leaf=>{const type=leaf?.view?.getViewType?.();if(leaf&&![CHAT_VIEW_TYPE,NAV,ANNOTATION_VIEW].includes(type)){if(this.lastContentLeaf!==leaf){this.lastSelectedText='';this.lastSelectedPath='';}this.lastContentLeaf=leaf;}if(leaf?.view instanceof MarkdownView)this.lastMarkdownLeaf=leaf;if(type===MAIN){this.navigationCourse=leaf.view.course||null;this.lastMainLeaf=leaf;void this.refreshNav();}this.refreshChatContext();}));
    const rememberSelection=event=>{const leaf=this.app.workspace.activeLeaf;const type=leaf?.view?.getViewType?.();if(!leaf||[CHAT_VIEW_TYPE,NAV,ANNOTATION_VIEW].includes(type)||!leaf.view?.containerEl?.contains(event.target))return;this.lastSelectedText=this.selectedChatText(leaf);this.lastSelectedPath=this.chatContextKey(leaf);this.refreshChatContext();};
    this.registerDomEvent(document,'mouseup',rememberSelection);
    this.registerDomEvent(document,'keyup',rememberSelection);
    this.registerDomEvent(document,'selectionchange',()=>{const leaf=this.app.workspace.activeLeaf;const node=document.getSelection()?.anchorNode;if(node)rememberSelection({target:node});});
    this.registerEvent(this.app.workspace.on('editor-change',()=>{const leaf=this.app.workspace.activeLeaf;if(leaf?.view instanceof MarkdownView)rememberSelection({target:leaf.view.containerEl});}));
    this.registerEvent(this.app.metadataCache.on('changed',()=>{this.refreshBlocks();}));
    this.courseIndexSyncTimers=new Map();
    this.registerEvent(this.app.vault.on('create',file=>{this.refreshBlocks();void this.refreshNav();this.queueCourseIndexSync(file?.path);}));
    this.registerEvent(this.app.vault.on('delete',file=>{this.refreshBlocks();void this.refreshNav();this.queueCourseIndexSync(file?.path);}));
    this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{this.refreshBlocks();void this.refreshNav();this.queueCourseIndexSync(oldPath);this.queueCourseIndexSync(file?.path);}));
    this.registerEvent(this.app.vault.on('modify',file=>this.queueCourseIndexSync(file?.path)));
    this.registerInterval(window.setInterval(()=>{if(this.state.googleCalendar.tokens)void this.syncGoogleCalendar({quiet:true}).catch(error=>console.warn('Learning Hub calendar sync:',error));},15*60*1000));
    this.registerInterval(window.setInterval(()=>{if(this.state.lastPlannedDay!==today())void this.updateRollingSchedule().catch(error=>console.warn('Learning Hub daily plan:',error));},30*60*1000));
    let lastScheduleClock=localNow();
    this.registerInterval(window.setInterval(()=>{const current=localNow();if(lastScheduleClock.slice(0,10)!==current.slice(0,10)||this.allScheduleSlots().some(slot=>slot.end>=lastScheduleClock&&slot.end<current))this.refreshBlocks();lastScheduleClock=current;},60*1000));
    this.registerInterval(window.setInterval(()=>{if(this.syncCompletedClasses()){void this.saveData(this.state).then(()=>{this.refreshBlocks();for(const leaf of this.app.workspace.getLeavesOfType(MAIN))if(leaf.view?.page==='retrospect')void leaf.view.render();}).catch(error=>console.warn('Learning Hub class history:',error));}},60*1000));
    this.app.workspace.onLayoutReady(async()=>{this.draftOpenPaths=this.currentWorkspacePaths();this.draftOpenTrackingReady=true;await this.loadCourses();await this.syncAllCourseIndexes();const file=this.app.workspace.getActiveFile(),leaf=this.app.workspace.activeLeaf;const main=this.app.workspace.getLeavesOfType(MAIN)[0];if(main){this.lastMainLeaf=main;this.navigationCourse=main.view?.course||null;}await this.alignChatWithAnnotations();await this.ensureNav();const target=this.pageForPath(file?.path);if(target)await this.openHub(target.page,target.course,leaf?.view?.file?.path===file.path?leaf:null);else await this.refreshNav();if(this.syncCompletedClasses())await this.saveData(this.state);this.refreshBlocks();if(this.state.googleCalendar.tokens)void this.syncGoogleCalendar({quiet:true}).catch(error=>console.warn('Learning Hub calendar sync:',error));void this.updateRollingSchedule().catch(error=>console.warn('Learning Hub daily plan:',error));});
  }
  async setInterfaceLanguage(language){
    this.state.interfaceLanguage=normalizeInterfaceLanguage(language);
    setInterfaceLanguage(this.state.interfaceLanguage);
    await this.saveData(this.state);
    for(const {el,label} of this.uiRibbonLabels||[]){el.setAttribute('aria-label',tr(label));el.setAttribute('data-tooltip',tr(label));}
    for(const {id,label} of this.uiCommandLabels||[]){const command=this.app.commands?.commands?.[`${this.manifest.id}:${id}`];if(command)command.name=`${this.manifest.name}: ${tr(label)}`;}
    for(const type of [MAIN,NAV,CHAT_VIEW_TYPE])for(const leaf of this.app.workspace.getLeavesOfType(type)){if(leaf.view?.render)await leaf.view.render();leaf.updateHeader?.();}
    this.refreshBlocks();
  }
  async ensureWorkspace(){
    // First install: create only missing entries, preserving existing notes.
    for(const folder of [ROOT,'学习系统',DRAFT_FOLDER,'Projects',`${ROOT}/Self Study`])await this.ensureFolder(folder);
    const entries=[
      [HOME,'# Learning Hub\n\n打开 Learning Hub 功能区图标或命令，进入学习主页。\n'],
      [SCHEDULE,'# 完整日程\n\n由 Learning Hub 管理学习安排。\n'],
      [TASKS,'# 待办\n\n由 Learning Hub 管理待办事项。\n'],
      [RETROSPECT,'# 学习复盘\n\n由 Learning Hub 记录完成情况。\n'],
      ['Projects/Projects.md','# Projects\n\n在这里建立项目资料入口。\n'],
      [`${ROOT}/Self Study/Self Study.md`,'# Self Study\n\n在这里整理课外学习资料。\n'],
      [INDEX,'# Courses\n\n在 Learning Hub 设置中创建学期与课程。\n\n# All Courses\n'],
    ];
    for(const [file,content] of entries)if(!await this.app.vault.adapter.exists(file))await this.app.vault.create(file,content);
  }
  defaultSemesterName(){
    const date=new Date(),month=date.getMonth()+1;
    const season=month<=2?'Winter':month<=5?'Spring':month<=8?'Summer':'Fall';
    return `${String(date.getFullYear()).slice(-2)} ${season}`;
  }
  async loadCourses(){
    let markdown='';try{markdown=await this.app.vault.adapter.read(INDEX);}catch(_){}
    const before=JSON.stringify({semesters:this.state.semesters,activeSemester:this.state.activeSemester});
    const {currentCourses,catalogTerms}=parseSemesterCatalog(markdown,Array.isArray(this.state.semesters)&&this.state.semesters.length?[]:DEFAULT_COURSES);
    const semesters=[];
    for(const row of Array.isArray(this.state.semesters)?this.state.semesters:[]){
      const name=normalizeSemesterLabel(row?.name||row?.id||'');if(!name)continue;
      const id=String(row.id||semesterIdForName(name));
      const courses=Array.isArray(row.courses)?row.courses.filter(course=>typeof course==='string'&&/^[A-Z]{4}\s+\d{4}\b/.test(course)):[];
      const existing=semesters.find(item=>item.id===id);if(existing)existing.courses=[...new Set([...existing.courses,...courses])];else semesters.push({id,name,courses:[...new Set(courses)]});
    }
    const upsert=(name,courses)=>{
      name=normalizeSemesterLabel(name);const id=semesterIdForName(name);let existing=semesters.find(item=>item.id===id);
      if(!existing){existing={id,name,courses:[]};semesters.push(existing);}
      existing.courses=[...new Set([...existing.courses,...courses])];
    };
    for(const row of catalogTerms)if(row.courses.length)upsert(row.name,row.courses);
    const defaultTerm=this.defaultSemesterName();
    if(currentCourses.length)upsert(this.currentSemester()?.name||defaultTerm,currentCourses);
    if(!semesters.length)upsert(defaultTerm,[]);
    semesters.sort((a,b)=>semesterSortValue(b.name)-semesterSortValue(a.name));
    this.state.semesters=semesters;
    if(!semesters.some(row=>row.id===this.state.activeSemester))this.state.activeSemester=semesters[0].id;
    this.courses=[...new Set(semesters.flatMap(row=>row.courses))];
    if(!this.courses.length)this.courses=[...DEFAULT_COURSES];
    if(before!==JSON.stringify({semesters:this.state.semesters,activeSemester:this.state.activeSemester}))await this.saveData(this.state);
  }
  currentSemester(){return this.state.semesters?.find(row=>row.id===this.state.activeSemester)||this.state.semesters?.[0]||null;}
  coursesForSemester(id=this.state.activeSemester){return this.state.semesters?.find(row=>row.id===id)?.courses||[];}
  async setActiveSemester(id){
    const semester=this.state.semesters?.find(row=>row.id===id);if(!semester)return;
    this.state.activeSemester=id;this.state.aiSummary=null;await this.saveData(this.state);
    const view=this.lastMainLeaf?.view;
    if(view?.course&&!semester.courses.includes(view.course))await this.open(HOME);
    else if(view?.page==='home')await view.render();
    await this.refreshNav();
  }
  async createSemester(value){
    const name=normalizeSemesterLabel(value),id=semesterIdForName(name);
    if(!name||name==='Untitled'){new Notice(tr("请填写学期名称"));return false;}
    if(this.state.semesters.some(row=>row.id===id)){new Notice(tr("学期「{0}」已经存在", [name]));return false;}
    this.state.semesters.push({id,name,courses:[]});this.state.semesters.sort((a,b)=>semesterSortValue(b.name)-semesterSortValue(a.name));
    await this.setActiveSemester(id);
    const view=this.lastMainLeaf?.view;if(view?.page==='home')await view.render();
    new Notice(tr("已创建学期「{0}」", [name]));return true;
  }
  async createCourse(semesterId,values){
    const semester=this.state.semesters.find(row=>row.id===semesterId);if(!semester){new Notice(tr("请先选择学期"));return false;}
    const code=String(values.code||'').trim().replace(/\s+/g,' ').toUpperCase(),name=String(values.name||'').trim();
    if(!/^[A-Z]{4}\s+\d{4}(?:-[A-Z0-9]+)?$/.test(code)){new Notice(tr("课程代码格式示例：COMP 1002"));return false;}
    if(!name){new Notice(tr("请填写课程名称"));return false;}
    const existingCourse=this.courses.find(value=>value.split(' - ')[0].trim().toUpperCase()===code);
    const course=existingCourse||safeSegment(`${code} - ${name}`),folder=`${ROOT}/${course}`;
    if(semester.courses.includes(course)){new Notice(tr("「{0}」已经在{1}中", [course, semester.name]));return false;}
    const alreadyExists=!!existingCourse||!!this.app.vault.getAbstractFileByPath(folder);
    if(alreadyExists&&!this.courses.includes(course))this.courses.push(course);
    await this.ensureCourseFiles(course,name);
    semester.courses.push(course);if(!this.courses.includes(course))this.courses.push(course);
    await this.setActiveSemester(semester.id);
    const view=this.lastMainLeaf?.view;if(view?.page==='home')await view.render();
    new Notice(alreadyExists?tr("已将现有课程「{0}」加入{1}；原笔记与学习记录会继续共用。", [course, semester.name]):tr("已在{0}创建课程「{1}」", [semester.name, course]));return true;
  }
  async ensureCourseFiles(course,name){
    const folder=`${ROOT}/${course}`,existing=this.app.vault.getAbstractFileByPath(folder);
    if(existing&&!Array.isArray(existing.children))throw new Error(tr("课程路径已被同名文件占用：{0}", [folder]));
    await this.ensureFolder(ROOT);
    if(!existing)await this.app.vault.createFolder(folder);
    const overviewPath=`${folder}/学习概览.md`,indexPath=this.courseIndexPath(course),syllabusPath=`${folder}/Syllabus.md`;
    if(!this.app.vault.getAbstractFileByPath(overviewPath))await this.app.vault.create(overviewPath,`---\ncourse: ${JSON.stringify(course)}\n---\n\n# ${name} · 学习概览\n\n此笔记是课程空间的入口。打开后可管理讲次、预习、主笔记、作业与间隔复习。\n`);
    if(!this.app.vault.getAbstractFileByPath(indexPath))await this.app.vault.create(indexPath,`# ${course}\n\n[[学习概览|课程概览]] · [[Syllabus|课程大纲]] · [[Home|返回个人主页]]\n\n<!-- learning-hub:lessons:start -->\n<!-- learning-hub:lessons:end -->\n`);
    if(!this.syllabus(course))await this.app.vault.create(syllabusPath,`# ${course} · 课程大纲\n\n## 学习目标\n\n## 课程安排\n\n## 考核方式\n`);
  }
  courseOverviewPath(course){return `${ROOT}/${course}/00 Course Overview.md`;}
  courseInitialDataPath(course){return `${ROOT}/${course}/.learning-hub/course-initial.json`;}
  courseSyllabusFolder(course){return `${ROOT}/${course}/Syllabus Files`;}
  courseSyllabusFiles(course){const folder=this.courseSyllabusFolder(course);return this.app.vault.getFiles().filter(file=>file.parent?.path===folder&&['pdf','md','txt'].includes(file.extension.toLowerCase())).sort((a,b)=>(b.stat?.ctime||0)-(a.stat?.ctime||0));}
  async readCourseInitial(course){try{const file=this.courseInitialDataPath(course);return await this.app.vault.adapter.exists(file)?JSON.parse(await this.app.vault.adapter.read(file)):null;}catch(error){console.warn('Learning Hub course initial:',error);return null;}}
  async saveCourseSyllabusFile(course,file){
    const extension=String(file.name||'').split('.').at(-1).toLowerCase();
    if(!['pdf','md','txt'].includes(extension))throw new Error(tr("Syllabus 目前支持 PDF、Markdown 和 TXT。"));
    if(!this.courses.includes(course))throw new Error(tr("找不到这门课程。"));
    const folder=this.courseSyllabusFolder(course);await this.ensureFolder(folder);
    const stem=safeSegment(String(file.name).replace(/\.[^.]+$/,'')).replace(/[\[\]#^|]/g,'_');
    let target=`${folder}/${stem}.${extension}`,number=2;
    while(await this.app.vault.adapter.exists(target))target=`${folder}/${stem} (${number++}).${extension}`;
    await this.app.vault.createBinary(target,await file.arrayBuffer());
    this.refreshBlocks();return target;
  }
  uploadCourseSyllabus(course){
    const input=document.createElement('input');input.type='file';input.accept='.pdf,.md,.txt';
    input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{const sourcePath=await this.saveCourseSyllabusFile(course,file);new CourseInitialModal(this,course,sourcePath).open();}catch(error){console.error('Learning Hub syllabus upload:',error);new Notice(tr("Syllabus 上传失败：{0}", [error.message]),7000);}};
    input.click();
  }
  async parseCourseSyllabus(course,sourcePath,options={}){
    if(!sourcePath.startsWith(`${this.courseSyllabusFolder(course)}/`))throw new Error(tr("请选择通过课程页上传的 Syllabus。"));
    const file=asFile(this.app,sourcePath);if(!file)throw new Error(tr("找不到上传的 Syllabus 原文件。"));
    const extension=file.extension.toLowerCase();
    if(!['pdf','md','txt'].includes(extension))throw new Error(tr("不支持这种 Syllabus 文件格式。"));
    options.onStatus?.('extracting');
    const sourceText=extension==='pdf'?await extractPdfText(path.join(this.vaultPath(),sourcePath),this.state.ai.pdfExtractor):String(await this.app.vault.adapter.read(sourcePath));
    if(!sourceText.trim())throw new Error(tr("Syllabus 没有可读取的文字。扫描版 PDF 需要先 OCR。"));
    const result=await this.runAi(courseInitialPrompt({course,sourceName:file.name,text:sourceText,language:this.state.ai.language}),courseInitialSchema,{timeoutMs:8*60*1000,...options});
    return validateCourseInitial(result);
  }
  async applyCourseInitial(course,sourcePath,draft){
    if(!sourcePath.startsWith(`${this.courseSyllabusFolder(course)}/`)||!asFile(this.app,sourcePath))throw new Error(tr("Syllabus 原文件已不存在。"));
    const parsed=validateCourseInitial(draft),notePath=this.courseOverviewPath(course),existing=asFile(this.app,notePath);
    const content=mergeCourseInitialNote(existing?await this.app.vault.read(existing):'',course,parsed,sourcePath);
    if(existing)await this.app.vault.modify(existing,content);else await this.app.vault.create(notePath,content);
    await this.writeJson(this.courseInitialDataPath(course),{version:1,sourcePath,parsedAt:now(),draft:parsed});
    this.refreshBlocks();return notePath;
  }
  courseIndexPath(course){return `${ROOT}/${course}/${course}.md`;}
  courseLessonLabel(lesson){
    const match=lesson.basename.match(/^(L\d+) @([0-9]{4}) ([0-9]{2}) ([0-9]{2})(?: → ([0-9]{4}) ([0-9]{2}) ([0-9]{2}))?/);
    if(!match)return lesson.basename;
    const first=`${match[2]}/${match[3]}/${match[4]}`;
    return `${match[1]} ${first}${match[5]?` → ${match[5]}/${match[6]}/${match[7]}`:''}`;
  }
  isCourseLessonIndexPath(path){
    if(!path?.startsWith(`${ROOT}/`))return null;
    const remainder=path.slice(ROOT.length+1),slash=remainder.indexOf('/');
    if(slash<0)return null;
    const course=remainder.slice(0,slash),relative=remainder.slice(slash+1);
    if(!this.courses.includes(course))return null;
    const rootIndex=`${course}.md`;
    if(relative===rootIndex)return course;
    if(/^L\d+(?:\b|[-_])/.test(relative.split('/')[0]))return course;
    return null;
  }
  queueCourseIndexSync(path){
    const course=this.isCourseLessonIndexPath(path);if(!course)return;
    const previous=this.courseIndexSyncTimers?.get(course);if(previous)clearTimeout(previous);
    const timer=setTimeout(()=>{this.courseIndexSyncTimers?.delete(course);void this.syncCourseIndex(course).catch(error=>console.warn('Learning Hub course index sync:',error));},250);
    this.courseIndexSyncTimers?.set(course,timer);
  }
  async syncAllCourseIndexes(){
    for(const course of this.courses){
      try{await this.syncCourseIndex(course);}
      catch(error){console.warn(`Learning Hub could not sync the ${course} index:`,error);}
    }
  }
  async syncCourseIndex(course){
    const file=asFile(this.app,this.courseIndexPath(course));if(!file)return false;
    const lessons=this.lessons(course),start='<!-- learning-hub:lessons:start -->',end='<!-- learning-hub:lessons:end -->';
    const entries=lessons.map(lesson=>{
      const relative=lesson.path.slice(`${ROOT}/${course}/`.length);
      const target=relative.split('/').map(part=>encodeURIComponent(part)).join('/');
      return `- [${this.courseLessonLabel(lesson).replace(/\]/g,'\\]')}](${target})`;
    });
    const block=[start,...entries,end].join('\n');
    const original=await this.app.vault.read(file),lines=original.split('\n');
    const removeLegacyMarker=value=>value.split('\n').filter(line=>line!=='<!-- obsidian:auto-nav:start -->').join('\n');
    const startIndex=lines.indexOf(start),endIndex=lines.indexOf(end);
    if(startIndex>=0&&endIndex>startIndex){
      const next=removeLegacyMarker([...lines.slice(0,startIndex),...block.split('\n'),...lines.slice(endIndex+1)].join('\n'));
      if(next!==original)await this.app.vault.modify(file,next);
      return next!==original;
    }
    const lessonPaths=new Set(lessons.map(lesson=>lesson.path));
    const isLessonLink=line=>{
      const markdown=line.match(/^\s*(?:[-*+]\s+)?\[[^\]]*\]\(([^)]+)\)\s*$/);
      const wiki=line.match(/^\s*(?:[-*+]\s+)?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/);
      const raw=markdown?.[1]||wiki?.[1];if(!raw)return false;
      let target=raw.trim();try{target=decodeURIComponent(target);}catch(_){}
      target=target.split('#')[0];
      const resolved=path.posix.normalize(path.posix.isAbsolute(target)?target.slice(1):path.posix.join(`${ROOT}/${course}`,target));
      return lessonPaths.has(resolved);
    };
    const matches=[];for(let index=0;index<lines.length;index++)if(isLessonLink(lines[index]))matches.push(index);
    if(matches.length){
      const first=matches[0],last=matches.at(-1);
      const safeRun=lines.slice(first,last+1).every((line,index)=>!line.trim()||isLessonLink(line));
      if(safeRun){
        const next=removeLegacyMarker([...lines.slice(0,first),...block.split('\n'),...lines.slice(last+1)].join('\n'));
        if(next!==original)await this.app.vault.modify(file,next);
        return next!==original;
      }
    }
    const markerIndex=lines.indexOf('<!-- obsidian:auto-nav:start -->');
    const insertAt=markerIndex>=0?markerIndex:lines.length;
    const before=lines.slice(0,insertAt),after=lines.slice(insertAt);
    while(before.length&&before.at(-1)==='')before.pop();
    const next=removeLegacyMarker([...before,'',...block.split('\n'),'',...after].join('\n'));
    if(next!==original)await this.app.vault.modify(file,next);
    return next!==original;
  }
  pageForPath(path){
    if(path===HOME)return {page:'home',course:null};
    if(path===SCHEDULE)return {page:'schedule',course:null};
    if(path===TASKS)return {page:'tasks',course:null};
    if(path===RETROSPECT)return {page:'retrospect',course:null};
    const m=path?.match(/^Courses\/([^/]+)\/学习概览\.md$/);
    if(m&&this.courses.includes(m[1]))return {page:'course',course:m[1]};
    return null;
  }
  currentPath(){let view=this.app.workspace.activeLeaf?.view;if(view?.getViewType?.()===NAV)view=this.lastMainLeaf?.view;if(view?.getViewType?.()===MAIN){if(view.course)return `${ROOT}/${view.course}/学习概览.md`;return view.page==='schedule'?SCHEDULE:view.page==='tasks'?TASKS:view.page==='retrospect'?RETROSPECT:view.page===DRAFTS_PAGE?DRAFTS_PAGE:HOME;}return this.app.workspace.getActiveFile()?.path||'';}
  activeCourse(){
    const view=this.app.workspace.activeLeaf?.view;
    if(view?.getViewType?.()===MAIN)return view.course||null;
    if(view?.getViewType?.()===NAV)return this.navigationCourse;
    const path=this.app.workspace.getActiveFile()?.path||'';
    if(!path.startsWith(`${ROOT}/`))return null;
    const course=path.slice(ROOT.length+1).split('/')[0];
    return this.courses.includes(course)?course:null;
  }
  lessons(course){
    const prefix=`${ROOT}/${course}/`;
    return this.app.vault.getMarkdownFiles().filter(f=>{
      if(!f.path.startsWith(prefix))return false;
      const rel=f.path.slice(prefix.length).split('/');
      if(rel.length>2 || !/^L\d+(?:\b|[-_])/.test(f.basename))return false;
      return rel.length===1 || rel[0]===f.basename;
    }).sort((a,b)=>a.basename.localeCompare(b.basename,undefined,{numeric:true}));
  }
  selectedLesson(course){const all=this.lessons(course),saved=this.selectedLessonByCourse[course];return all.find(f=>f.path===saved)||all.find(f=>this.scope(f,course))||all[0]||null;}
  async selectLesson(course,path){if(!this.lessons(course).some(lesson=>lesson.path===path))return;this.selectedLessonByCourse[course]=path;this.state.lastLessonByCourse[course]=path;await this.saveData(this.state);await this.openHub('lesson',course,undefined,path);}
  syllabus(course){const base=`${ROOT}/${course}`;return asFile(this.app,`${base}/Syllabus.md`)||asFile(this.app,`${base}/Syllabus/Syllabus.md`);}
  scope(lesson,course){
    const manual=this.state.courseScope?.[course];
    if(Array.isArray(manual))return manual.includes(lesson.path);
    const m=lesson.basename.match(/@(\d{4}) (\d{2}) (\d{2})/);
    if(!m)return false;
    return `${m[1]}-${m[2]}-${m[3]}`<=today();
  }
  async stages(file){
    const fm=this.app.metadataCache.getFileCache(file)?.frontmatter||{};
    const folder=file.parent?.path||'';
    const hidden=`${folder}/.note-data/${file.basename}/progress.json`;
    let saved={};
    try{if(await this.app.vault.adapter.exists(hidden))saved=JSON.parse(await this.app.vault.adapter.read(hidden)).stages||{};}catch(e){console.warn('Learning Hub progress:',e);}
    const stage=Object.fromEntries(STAGES.map(([k])=>[k,bool(saved[k]??fm[k])]));
    const flow=await this.readFlow(file);
    stage.previewed=stage.previewed||!!flow.milestones.previewedAt;
    stage.learned=stage.learned||!!flow.milestones.learnedAt;
    stage.reviewed=flow.reviews.rounds.every(r=>!!r.completedAt);
    return stage;
  }
  flowFolder(file){return `${file.parent.path}/.note-data/${file.basename}`;}
  flowPath(file){return `${this.flowFolder(file)}/learning.json`;}
  errorPath(file){return `${this.flowFolder(file)}/errorlog.json`;}
  emptyFlow(file){return {version:1,lessonPath:file.path,preview:{description:'',summary:[],objectives:'',concepts:[]},recall:{questions:[],attempts:[],completedAt:null},milestones:{previewedAt:null,learnedAt:null},reviews:{rounds:[{questions:[],attempts:[],completedAt:null},{questions:[],attempts:[],completedAt:null},{questions:[],attempts:[],completedAt:null}]}};}
  async readFlow(file){
    const fallback=this.emptyFlow(file);let saved={};
    try{if(await this.app.vault.adapter.exists(this.flowPath(file)))saved=JSON.parse(await this.app.vault.adapter.read(this.flowPath(file)));}catch(e){console.warn('Learning Hub flow:',e);}
    const rounds=Array.from({length:3},(_,i)=>({...fallback.reviews.rounds[i],...saved.reviews?.rounds?.[i]}));
    const flow={...fallback,...saved,preview:{...fallback.preview,...saved.preview,concepts:Array.isArray(saved.preview?.concepts)?saved.preview.concepts:[]},recall:{...fallback.recall,...saved.recall,questions:Array.isArray(saved.recall?.questions)?saved.recall.questions:[],attempts:Array.isArray(saved.recall?.attempts)?saved.recall.attempts:[]},milestones:{...fallback.milestones,...saved.milestones},reviews:{rounds}};
    if(saved.previewDraft&&!flow.preview.concepts.length){flow.preview={...flow.preview,...legacyPreviewDraft(saved.previewDraft,()=>crypto.randomUUID())};delete flow.previewDraft;await this.writeJson(this.flowPath(file),flow);}
    return flow;
  }
  async writeJson(path,value){
    await this.ensureFolder(path.slice(0,path.lastIndexOf('/')));
    await this.app.vault.adapter.write(path,JSON.stringify(value,null,2)+'\n');
  }
  async ensureFolder(path){const adapter=this.app.vault.adapter,parts=path.split('/');for(let i=1;i<=parts.length;i++){const folder=parts.slice(0,i).join('/');if(!await adapter.exists(folder))await adapter.mkdir(folder);}}
  async saveFlow(file,flow,refresh=false){await this.writeJson(this.flowPath(file),flow);if(refresh){this.refreshBlocks();await this.refreshNav();}}
  reviewPlan(flow){
    return REVIEW_ROUNDS.map((meta,index)=>{
      const record=flow.reviews.rounds[index];
      const due=flow.milestones.learnedAt?addDays(flow.milestones.learnedAt,meta.day):null;
      const previousDone=index===0||!!flow.reviews.rounds[index-1].completedAt;
      const unlocked=!!due&&due<=today()&&previousDone&&!!flow.recall.completedAt;
      return {...meta,index,round:index+1,due,completedAt:record.completedAt,unlocked};
    });
  }
  async logError(file,entry){
    return this.appendError(this.errorPath(file),{lessonPath:file.path},entry);
  }
  courseErrorPath(course){return `${ROOT}/${course}/.learning-hub/errorlog.json`;}
  globalErrorPath(){return '.learning-hub/errorlog.json';}
  async appendError(filePath,scope,entry){
    let log={version:1,...scope,errors:[]};
    try{if(await this.app.vault.adapter.exists(filePath))log=JSON.parse(await this.app.vault.adapter.read(filePath));}catch(e){console.warn('Learning Hub error log:',e);}
    if(!Array.isArray(log.errors))log.errors=[];
    if(entry.sourceMessageId&&log.errors.some(item=>item.sourceMessageId===entry.sourceMessageId))return false;
    if(entry.sourceAssignmentId&&entry.questionId&&log.errors.some(item=>item.sourceAssignmentId===entry.sourceAssignmentId&&item.questionId===entry.questionId))return false;
    log.errors.push({id:crypto.randomUUID(),createdAt:now(),...entry});
    await this.writeJson(filePath,log);
    return true;
  }
  async filterErrorLog(filePath,predicate){
    if(!await this.app.vault.adapter.exists(filePath))return;
    const log=JSON.parse(await this.app.vault.adapter.read(filePath));
    if(!Array.isArray(log.errors))return;
    const kept=log.errors.filter(predicate);if(kept.length!==log.errors.length){log.errors=kept;await this.writeJson(filePath,log);}
  }
  async readErrorEntries(filePath){
    try{const log=JSON.parse(await this.app.vault.adapter.read(filePath));return Array.isArray(log.errors)?log.errors:[];}catch(_){return [];}
  }
  assignmentPath(course){return `${ROOT}/${course}/.learning-hub/assignments.json`;}
  homeworkDataFolder(course,id){return `${ROOT}/${course}/.learning-hub/assignments/${id}`;}
  homeworkContentPath(course,id){return `${this.homeworkDataFolder(course,id)}/content.md`;}
  homeworkAnalysisPath(course,id){return `${this.homeworkDataFolder(course,id)}/analysis.json`;}
  async readHomeworkAnalysis(course,id){try{return JSON.parse(await this.app.vault.adapter.read(this.homeworkAnalysisPath(course,id)));}catch(_){return null;}}
  async readAssignments(course){
    let saved={};const path=this.assignmentPath(course);
    try{if(await this.app.vault.adapter.exists(path))saved=JSON.parse(await this.app.vault.adapter.read(path));}catch(e){console.warn('Learning Hub assignments:',e);}
    return {version:1,course,assignments:Array.isArray(saved?.assignments)?saved.assignments:[]};
  }
  async saveAssignments(course,data){await this.writeJson(this.assignmentPath(course),data);this.refreshBlocks();await this.refreshNav();}
  labPath(course){return `${ROOT}/${course}/.learning-hub/labs.json`;}
  labDataFolder(course,id){return `${ROOT}/${course}/.learning-hub/labs/${id}`;}
  labContentPath(course,id){return `${this.labDataFolder(course,id)}/content.md`;}
  async readLabs(course){
    let saved={};
    try{if(await this.app.vault.adapter.exists(this.labPath(course)))saved=JSON.parse(await this.app.vault.adapter.read(this.labPath(course)));}
    catch(error){console.warn('Learning Hub labs:',error);}
    return {version:1,course,labs:Array.isArray(saved?.labs)?saved.labs:[]};
  }
  async saveLabs(course,data){await this.writeJson(this.labPath(course),data);this.refreshBlocks();await this.refreshNav();}
  async refreshLabView(course){for(const leaf of this.app?.workspace?.getLeavesOfType?.(MAIN)||[])if(leaf.view?.page==='assignments'&&leaf.view.course===course)await leaf.view.render();}
  async saveLabFiles(course,files,details){
    const store=await this.readLabs(course),id=crypto.randomUUID();
    const lab={id,title:details.title,due:details.due||'',lessonPath:details.lessonPath||'',files:[],topics:[],createdAt:now(),archivedAt:null,importStatus:'uploading',analysisStatus:'queued'};
    const folder=`${ROOT}/${course}/Lab Sessions/${safeSegment(lab.title)}-${id.slice(0,8)}`;
    lab.folder=folder;await this.ensureFolder(folder);store.labs.push(lab);await this.saveLabs(course,store);
    const failures=[];
    for(const file of files){
      const name=safeSegment(file.name),dot=name.lastIndexOf('.'),stem=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';
      if(!['.pdf','.md','.txt'].includes(ext.toLowerCase())){failures.push(file.name);continue;}
      let target=`${folder}/${name}`,suffix=2;
      while(await this.app.vault.adapter.exists(target))target=`${folder}/${stem} (${suffix++})${ext}`;
      try{await this.app.vault.createBinary(target,await file.arrayBuffer());lab.files.push({name:file.name,path:target,size:file.size||0});await this.saveLabs(course,store);}
      catch(error){console.error('Learning Hub lab upload:',error);failures.push(file.name);}
    }
    lab.importStatus=failures.length?'partial':'complete';lab.failedFiles=failures;
    if(!lab.files.length){lab.analysisStatus='failed';lab.analysisError='没有可解析的 PDF、Markdown 或 TXT 文件。';}
    await this.saveLabs(course,store);
    new Notice(lab.files.length?tr("已保存 {0} 份 Lab Session 课件{1}", [lab.files.length, failures.length?tr("，{0} 份未导入", [failures.length]):'']):tr("Lab Session 没有成功导入可解析文件"));
    return lab;
  }
  uploadLab(course){
    const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.pdf,.md,.txt';
    input.onchange=()=>{const files=Array.from(input.files||[]);if(!files.length)return;new LabModal(this.app,this,course,files,null,async details=>{
      const lab=await this.saveLabFiles(course,files,details);
      if(lab.files.length)void this.analyzeLab(course,lab.id).catch(error=>{console.error('Learning Hub lab AI:',error);new Notice(tr("Lab Session 已保存；解析失败：{0}", [error.message]),7000);});
      await this.refreshLabView(course);
    }).open();};input.click();
  }
  editLab(course,lab){new LabModal(this.app,this,course,[],lab,async details=>{const store=await this.readLabs(course),target=store.labs.find(item=>item.id===lab.id);if(!target)throw new Error(tr("Lab Session 不存在"));Object.assign(target,details);await this.saveLabs(course,store);await this.refreshLabView(course);}).open();}
  async labSourceText(lab){
    const sources=[];
    for(const file of lab.files||[]){
      const extension=file.path?.split('.').at(-1)?.toLowerCase();
      if(!['pdf','md','txt'].includes(extension))continue;
      try{
        const text=extension==='pdf'?await extractPdfText(path.join(this.vaultPath(),file.path),this.state.ai.pdfExtractor):String(await this.app.vault.adapter.read(file.path));
        if(text.trim())sources.push({name:file.name,text});
      }catch(error){throw new Error(tr("无法解析「{0}」：{1}", [file.name,error.message]));}
    }
    if(!sources.length)throw new Error(tr("Lab Session 没有可提取的文字；扫描版 PDF 需要先 OCR。"));
    return combineHomeworkTexts(sources);
  }
  async analyzeLab(course,id){
    this.labRunning||=new Set();if(this.labRunning.has(id))return;
    this.labRunning.add(id);
    try{
      let store=await this.readLabs(course),lab=store.labs.find(item=>item.id===id);if(!lab)return;
      lab.analysisStatus='extracting';lab.analysisError='';await this.saveLabs(course,store);await this.refreshLabView(course);
      const sourceText=await this.labSourceText(lab);
      store=await this.readLabs(course);lab=store.labs.find(item=>item.id===id);if(!lab)return;
      lab.analysisStatus='analyzing';await this.saveLabs(course,store);await this.refreshLabView(course);
      const result=validateLabDraft(await this.runAi(labPrompt({course,title:lab.title,sourceText,language:this.state.ai.language}),labSchema,{timeoutMs:8*60*1000}));
      store=await this.readLabs(course);lab=store.labs.find(item=>item.id===id);if(!lab)return;
      await this.ensureFolder(this.labDataFolder(course,id));
      await this.app.vault.adapter.write(this.labContentPath(course,id),result.markdown+'\n');
      lab.topics=result.topics;lab.analysisStatus='complete';lab.analysisError='';lab.analyzedAt=now();
      await this.saveLabs(course,store);await this.refreshLabView(course);
      new Notice(tr("《{0}》已解析完成。", [lab.title]));
    }catch(error){const store=await this.readLabs(course),lab=store.labs.find(item=>item.id===id);if(lab){lab.analysisStatus='failed';lab.analysisError=error.message;await this.saveLabs(course,store);await this.refreshLabView(course);}throw error;}
    finally{this.labRunning.delete(id);}
  }
  async toggleLabArchive(course,id){const store=await this.readLabs(course),lab=store.labs.find(item=>item.id===id);if(!lab)return;lab.archivedAt=lab.archivedAt?null:now();await this.saveLabs(course,store);await this.refreshLabView(course);}
  async deleteLab(course,id){
    const store=await this.readLabs(course),lab=store.labs.find(item=>item.id===id);if(!lab)return;
    if(lab.folder?.startsWith(`${ROOT}/${course}/Lab Sessions/`)){const folder=this.app.vault.getAbstractFileByPath(lab.folder);if(folder)await this.app.vault.trash(folder,false);}
    const hidden=this.labDataFolder(course,id);
    if(await this.app.vault.adapter.exists(hidden)){const deleted=`${ROOT}/${course}/.learning-hub/deleted-labs`;await this.ensureFolder(deleted);await this.app.vault.adapter.rename(hidden,`${deleted}/${id}-${Date.now()}`);}
    store.labs=store.labs.filter(item=>item.id!==id);await this.saveLabs(course,store);await this.refreshLabView(course);
    new Notice(tr("已删除《{0}》；原文件已移入 Obsidian 回收站。", [lab.title]));
  }
  async saveHomeworkFiles(course,files,details){
    const store=await this.readAssignments(course),id=crypto.randomUUID();
    const assignment={id,title:details.title,due:details.due||'',difficulty:null,topics:[],lessonPath:details.lessonPath||'',files:[],createdAt:now(),archivedAt:null,importStatus:'uploading',analysisStatus:'queued',wrongQuestionIds:[],wrongLogPaths:[]};
    const folder=`${ROOT}/${course}/Assignments/${safeSegment(assignment.title)}-${id.slice(0,8)}`;
    assignment.folder=folder;
    await this.ensureFolder(folder);
    store.assignments.push(assignment);await this.saveAssignments(course,store);
    const failures=[];
    for(const file of files){
      const name=safeSegment(file.name),dot=name.lastIndexOf('.'),stem=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';
      let path=`${folder}/${name}`,suffix=2;
      while(await this.app.vault.adapter.exists(path))path=`${folder}/${stem} (${suffix++})${ext}`;
      try{await this.app.vault.createBinary(path,await file.arrayBuffer());assignment.files.push({name:file.name,path,size:file.size||0});await this.saveAssignments(course,store);}
      catch(e){console.error('Learning Hub upload:',e);failures.push(file.name);}
    }
    assignment.importStatus=failures.length?'partial':'complete';assignment.failedFiles=failures;
    if(!assignment.files.length)assignment.analysisStatus='failed',assignment.analysisError='没有成功导入的作业文件。';
    const taskChanged=this.syncHomeworkTodo(course,assignment);
    await this.saveAssignments(course,store);
    if(taskChanged)await this.saveHomeworkTaskChanges();
    new Notice(failures.length?tr("已保存 {0} 个文件，{1} 个导入失败", [assignment.files.length, failures.length]):tr("已归档 {0} 个作业文件", [assignment.files.length]));
    return assignment;
  }
  uploadHomework(course){
    const input=document.createElement('input');input.type='file';input.multiple=true;
    input.onchange=()=>{const files=Array.from(input.files||[]);if(!files.length)return;new HomeworkModal(this.app,this,course,files,null,async details=>{const assignment=await this.saveHomeworkFiles(course,files,details);if(assignment.files.length)void this.analyzeHomework(course,assignment.id).catch(error=>{console.error('Learning Hub homework AI:',error);new Notice(tr("作业已保存；AI 分析失败：{0}", [error.message]),7000);});}).open();};
    input.click();
  }
  editHomework(course,assignment){new HomeworkModal(this.app,this,course,[],assignment,async details=>{const store=await this.readAssignments(course);const target=store.assignments.find(a=>a.id===assignment.id);if(!target)throw Error('Assignment missing');Object.assign(target,details,{metadataSource:'manual'});const taskChanged=this.syncHomeworkTodo(course,target);await this.saveAssignments(course,store);if(taskChanged)await this.saveHomeworkTaskChanges();}).open();}
  syncHomeworkTodo(course,assignment){
    const linked=this.state.tasks.find(task=>task.assignmentId===assignment.id||task.id===assignment.taskId);
    if(!assignment.due){assignment.taskId='';if(!linked)return false;this.state.tasks=this.state.tasks.filter(task=>task.id!==linked.id);this.state.slots=this.state.slots.filter(slot=>slot.taskId!==linked.id);return true;}
    if(!validDate(assignment.due))throw new Error(tr("作业截止日期无效。"));
    const title=`完成作业：${assignment.title}`;
    const taskValues={assignmentId:assignment.id,title,due:assignment.due,dueTime:'',course,lessonPath:assignment.lessonPath||'',kind:'task',minutes:estimateMinutes({title,kind:'task'},this.state.completionHistory),source:'作业'};
    if(linked){const changed=['title','due','course','lessonPath','minutes'].some(key=>linked[key]!==taskValues[key]);Object.assign(linked,taskValues);assignment.taskId=linked.id;return changed;}
    const task={...taskValues,id:crypto.randomUUID(),status:'unfinished',done:false,createdAt:now()};
    this.state.tasks.push(task);assignment.taskId=task.id;return true;
  }
  async saveHomeworkTaskChanges(){
    await this.save();
    try{await this.updateRollingSchedule();}
    catch(error){console.warn('Learning Hub homework schedule:',error);new Notice(tr("作业待办已更新，日程稍后可手动刷新。"));}
  }
  async setHomeworkAnalysisStatus(course,id,status,error=''){
    if(this.homeworkCancelled?.has(id))return null;
    const store=await this.readAssignments(course),assignment=store.assignments.find(item=>item.id===id);
    if(!assignment)return null;
    assignment.analysisStatus=status;assignment.analysisError=error;
    const progress=this.homeworkProgress?.get(id);
    if(progress){
      progress.status=status;
      if(status==='organizing'||status==='analyzing'){
        clearTimeout(progress.reasoningRenderTimer);progress.reasoningRenderVersion=(progress.reasoningRenderVersion||0)+1;
        progress.startedAt=Date.now();progress.codexPhase='queued';progress.receivedChars=0;progress.tokenUsage=null;progress.reasoningSummary='';progress.reasoningIndex=null;
      }else if(status==='extracting'){progress.startedAt=Date.now();progress.codexPhase='extracting';progress.receivedChars=0;}
    }
    await this.writeJson(this.assignmentPath(course),store);
    const statusEl=this.homeworkStatusEls?.get(id);
    if(statusEl){statusEl.empty();this.renderHomeworkStatus(statusEl,assignment);}
    if(progress)this.updateHomeworkProgress(progress);
    if(status==='failed')this.refreshBlocks();
    return assignment;
  }
  async homeworkSourceText(assignment){
    const sources=[],files=assignment.files||[];
    for(const item of files){
      const extension=item.path?.split('.').at(-1)?.toLowerCase();
      if(!['pdf','md','txt'].includes(extension))continue;
      try{
        const text=extension==='pdf'?await extractPdfText(path.join(this.vaultPath(),item.path),this.state.ai.pdfExtractor):String(await this.app.vault.adapter.read(item.path));
        if(text.trim())sources.push({name:item.name,text});
      }catch(error){throw new Error(tr("无法解析「{0}」：{1}", [item.name, error.message]));}
    }
    return combineHomeworkTexts(sources);
  }
  homeworkAiCallbacks(progress){
    return {
      onStatus:phase=>{progress.codexPhase=phase;this.updateHomeworkProgress(progress);},
      onProgress:delta=>{progress.receivedChars+=String(delta||'').length;progress.codexPhase='receiving';this.updateHomeworkProgress(progress);},
      onTokenUsage:usage=>{progress.tokenUsage=usage;this.updateHomeworkProgress(progress);},
      onReasoningSummary:(delta,index)=>{
        if(typeof index==='number'&&progress.reasoningIndex!==index)progress.reasoningSummary='';
        if(typeof index==='number')progress.reasoningIndex=index;
        progress.reasoningSummary+=String(delta||'');
        this.updateHomeworkProgress(progress);this.renderHomeworkReasoning(progress);
      },
    };
  }
  updateHomeworkProgress(progress){
    if(!progress)return;
    const labels={extracting:tr("正在提取作业文字"),queued:tr("等待 Codex"),connecting:tr("正在连接 Codex"),starting:tr("正在提交任务"),generating:tr("Codex 正在分析"),thinking:tr("Codex 正在思考"),receiving:tr("Codex 正在返回结果")};
    const seconds=Math.floor((Date.now()-progress.startedAt)/1000),duration=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    const received=progress.receivedChars?tr(" · 已接收 {0} 字符", [progress.receivedChars.toLocaleString()]):'';
    progress.elapsedEl?.setText(tr("{0} · 已用时 {1}{2}", [labels[progress.codexPhase]||labels.queued, duration, received]));
    progress.usageEl?.setText(progress.tokenUsage?formatCodexUsage(progress.tokenUsage):'');
  }
  renderHomeworkReasoning(progress){
    const host=progress?.reasoningEl;if(!host)return;
    clearTimeout(progress.reasoningRenderTimer);
    const source=formatPreviewMarkdown(progress.reasoningSummary||'').trim();
    if(!source){host.setText(tr("等待 Codex 提供思考摘要…"));return;}
    const version=(progress.reasoningRenderVersion||0)+1;progress.reasoningRenderVersion=version;
    progress.reasoningRenderTimer=setTimeout(async()=>{
      const staging=document.createElement('div');
      try{if(MarkdownRenderer?.render)await MarkdownRenderer.render(this.app,source,staging,progress.sourcePath||'',this);else if(MarkdownRenderer?.renderMarkdown)await MarkdownRenderer.renderMarkdown(source,staging,progress.sourcePath||'',this);else staging.textContent=source;}
      catch(error){console.warn('Learning Hub homework reasoning summary:',error);staging.textContent=source;}
      if(version!==progress.reasoningRenderVersion||host!==progress.reasoningEl)return;
      host.replaceChildren(...staging.childNodes);
    },100);
  }
  async analyzeHomework(course,id){
    this.homeworkRunning||=new Set();this.homeworkCancelled||=new Set();
    if(this.homeworkRunning.has(id))return;
    this.homeworkCancelled.delete(id);this.homeworkRunning.add(id);
    this.homeworkProgress||=new Map();
    const progress={status:'extracting',sourcePath:'',startedAt:Date.now(),codexPhase:'extracting',receivedChars:0,tokenUsage:null,reasoningSummary:'',reasoningIndex:null,reasoningRenderVersion:0};
    this.homeworkProgress.set(id,progress);progress.timer=setInterval(()=>this.updateHomeworkProgress(progress),1000);
    try{
      const assignment=await this.setHomeworkAnalysisStatus(course,id,'extracting');if(!assignment)return;
      progress.sourcePath=assignment.files?.[0]?.path||'';
      const sourceText=await this.homeworkSourceText(assignment);
      if(!await this.setHomeworkAnalysisStatus(course,id,'organizing'))return;
      const organized=validateOrganizedHomework(await this.runAi(organizeHomeworkPrompt({course,title:assignment.title,sourceText,language:this.state.ai.language}),organizeSchema,{timeoutMs:8*60*1000,...this.homeworkAiCallbacks(progress)}));
      if(this.homeworkCancelled.has(id))return;
      await this.ensureFolder(this.homeworkDataFolder(course,id));
      await this.app.vault.adapter.write(this.homeworkContentPath(course,id),organized.markdown+'\n');
      if(!await this.setHomeworkAnalysisStatus(course,id,'analyzing'))return;
      const analysis=validateHomeworkAnalysis(await this.runAi(analyzeHomeworkPrompt({course,title:assignment.title,markdown:organized.markdown,questions:organized.questions,language:this.state.ai.language}),analyzeSchema,{timeoutMs:8*60*1000,...this.homeworkAiCallbacks(progress)}),organized.questions);
      if(this.homeworkCancelled.has(id))return;
      await this.writeJson(this.homeworkAnalysisPath(course,id),{version:1,assignmentId:id,sourcePaths:assignment.files.map(file=>file.path),generatedAt:now(),difficulty:analysis.difficulty,topics:analysis.topics,questions:analysis.questions});
      const store=await this.readAssignments(course),target=store.assignments.find(item=>item.id===id);
      if(!target||this.homeworkCancelled.has(id))return;
      if(target.metadataSource!=='manual'){target.difficulty=analysis.difficulty;target.topics=analysis.topics;target.metadataSource='ai';}
      target.analysisStatus='complete';target.analysisError='';target.analyzedAt=now();
      await this.saveAssignments(course,store);
      new Notice(tr("《{0}》的题目、难度与知识点已整理完成。", [target.title]),6000);
    }catch(error){
      if(!this.homeworkCancelled.has(id))await this.setHomeworkAnalysisStatus(course,id,'failed',error.message);
      throw error;
    }finally{clearInterval(progress.timer);clearTimeout(progress.reasoningRenderTimer);progress.reasoningRenderVersion++;this.homeworkProgress.delete(id);this.homeworkRunning.delete(id);if(this.homeworkCancelled.has(id))await this.moveDeletedHomeworkData(course,id);this.refreshBlocks();}
  }
  async moveDeletedHomeworkData(course,id){
    const hidden=this.homeworkDataFolder(course,id);
    if(!await this.app.vault.adapter.exists(hidden))return;
    const deletedRoot=`${ROOT}/${course}/.learning-hub/deleted-assignments`;
    await this.ensureFolder(deletedRoot);
    await this.app.vault.adapter.rename(hidden,`${deletedRoot}/${id}-${Date.now()}`);
  }
  async toggleHomeworkArchive(course,id){const store=await this.readAssignments(course),item=store.assignments.find(a=>a.id===id);if(!item)return;item.archivedAt=item.archivedAt?null:now();await this.saveAssignments(course,store);}
  async setHomeworkWrongQuestion(course,id,questionId,wrong){
    const store=await this.readAssignments(course),assignment=store.assignments.find(item=>item.id===id);
    if(!assignment)throw new Error(tr("作业已不存在。"));
    const analysis=await this.readHomeworkAnalysis(course,id),question=analysis?.questions?.find(item=>item.id===questionId);
    if(!question)throw new Error(tr("找不到这道题。"));
    const marked=new Set(assignment.wrongQuestionIds||[]);
    if(marked.has(questionId)===wrong)return;
    const lesson=assignment.lessonPath?asFile(this.app,assignment.lessonPath):null;
    const logPath=lesson?this.errorPath(lesson):this.courseErrorPath(course);
    if(wrong){
      await this.appendError(logPath,lesson?{lessonPath:lesson.path}:{course},{questionId,sourceAssignmentId:id,sourceAssignmentTitle:assignment.title,sourceFilePaths:(assignment.files||[]).map(file=>file.path),sourceLessonPath:lesson?.path||'',mode:'homework',rating:'incorrect',prompt:question.markdown,answer:'',reference:'',topic:question.topics?.join('、')||assignment.topics?.[0]||''});
      marked.add(questionId);
      assignment.wrongLogPaths=[...new Set([...(assignment.wrongLogPaths||[]),logPath])];
    }else{
      for(const filePath of new Set([...(assignment.wrongLogPaths||[]),logPath]))await this.filterErrorLog(filePath,item=>!(item.sourceAssignmentId===id&&item.questionId===questionId&&item.mode==='homework'));
      marked.delete(questionId);
    }
    assignment.wrongQuestionIds=[...marked];
    await this.saveAssignments(course,store);
  }
  async deleteHomework(course,id){
    const store=await this.readAssignments(course),assignment=store.assignments.find(item=>item.id===id);if(!assignment)return;
    const taskChanged=this.syncHomeworkTodo(course,{...assignment,due:''});
    this.homeworkCancelled||=new Set();this.homeworkCancelled.add(id);
    const firstPath=assignment.files?.[0]?.path||'';
    const folder=assignment.folder||(firstPath?firstPath.slice(0,firstPath.lastIndexOf('/')):'');
    if(folder?.startsWith(`${ROOT}/${course}/Assignments/`)){
      const source=this.app.vault.getAbstractFileByPath(folder);
      if(source)await this.app.vault.trash(source,false);
    }
    await this.moveDeletedHomeworkData(course,id);
    store.assignments=store.assignments.filter(item=>item.id!==id);
    await this.saveAssignments(course,store);
    if(taskChanged)await this.saveHomeworkTaskChanges();
    for(const filePath of new Set([...(assignment.wrongLogPaths||[]),this.courseErrorPath(course)])){
      try{await this.filterErrorLog(filePath,item=>item.sourceAssignmentId!==id);}catch(error){console.warn('Learning Hub assignment error cleanup:',error);}
    }
    new Notice(tr("已删除《{0}》；原文件已移入 Obsidian 回收站。", [assignment.title]));
  }
  reviewQuestionsFromHomework(assignment,round,lessonPath){
    const difficulty=Number(assignment.difficulty)||3;
    return (assignment.topics||[]).slice(0,8).map(topic=>{
      const prompt=round===1?`不看《${assignment.title}》，解释「${topic}」的核心条件，并指出它在作业中解决了什么问题。`:round===2?difficulty<=2?`把《${assignment.title}》中涉及「${topic}」的一道题改变一个条件，独立求解并检查结果。`:`面对《${assignment.title}》中涉及「${topic}」的方法，先说明选择依据，再改变一个条件重新求解，解释哪一步最容易出错。`:`以「${topic}」为核心，结合本课程另一讲的知识设计并解答一道不同于《${assignment.title}》的综合题；说明成立前提和一个边界情况。`;
      return {id:crypto.randomUUID(),prompt,answer:'',type:round===1?'concept':round===2?'application':'mixed',sourceLessonPath:lessonPath,sourceAssignmentId:assignment.id,sourceAssignmentTitle:assignment.title,sourceFilePaths:(assignment.files||[]).map(f=>f.path),topic,difficulty,generatedBy:'rule-v1',createdAt:now()};
    });
  }
  async generateReviewFromHomework(course,file,assignment,round){
    if(!(assignment.topics||[]).length){new Notice(tr("先在作业档案中补充涉及的知识点"));return;}
    const flow=await this.readFlow(file),plan=this.reviewPlan(flow),target=flow.reviews.rounds[round-1];
    if(!plan[round-1]?.unlocked||target.completedAt){new Notice(tr("本轮尚未开放或已经完成"));return;}
    if(target.questions.some(q=>q.sourceAssignmentId===assignment.id)){new Notice(tr("这份作业已用于本轮复习题"));return;}
    await this.generateQuestionDraft(course,file,'review',round,assignment);
  }
  async stats(course){
    const all=this.lessons(course), scoped=all.filter(f=>this.scope(f,course));
    const pending={previewed:0,learned:0,reviewed:0};
    for(const f of scoped){const v=await this.stages(f);if(!v.previewed)pending.previewed++;if(!v.learned)pending.learned++;const plan=this.reviewPlan(await this.readFlow(f));if(plan.some(r=>r.unlocked&&!r.completedAt))pending.reviewed++;}
    return {all,scoped,pending,last:scoped.at(-1)};
  }
  async ensureNav(){
    for(const old of this.app.workspace.getLeavesOfType(NAV))old.detach();
    const leaf=this.app.workspace.getLeavesOfType('file-explorer')[0]||this.app.workspace.getLeftLeaf(false)||this.app.workspace.getLeftLeaf(true);
    if(!leaf)return;
    await leaf.setViewState({type:NAV,active:true});
    this.nav=leaf.view;
    await this.app.workspace.revealLeaf(leaf);
    await this.refreshNav();
  }
  async refreshNav(){if(this.nav?.render)await this.nav.render();}
  refreshBlocks(){clearTimeout(this.refreshTimer);this.refreshTimer=setTimeout(()=>{for(const leaf of this.app.workspace.getLeavesOfType(MAIN))if(!['preview','recall','review'].includes(leaf.view?.page))void leaf.view?.render?.();},350);}
  async openHub(page,course,preferredLeaf,lessonPath=null,round=0){
    const mains=this.app.workspace.getLeavesOfType(MAIN);
    let leaf=preferredLeaf||(this.lastMainLeaf&&mains.includes(this.lastMainLeaf)?this.lastMainLeaf:null)||mains[0];
    if(!leaf){try{leaf=this.app.workspace.getLeaf('tab');}catch(_){leaf=this.app.workspace.getLeaf(true);}}
    if(!leaf)return;
    await leaf.loadIfDeferred?.();
    if(leaf.view?.getViewType?.()!==MAIN)await leaf.setViewState({type:MAIN,active:true,state:{page,course,lessonPath,round}});
    const view=leaf.view;if(view?.getViewType?.()===MAIN&&(view.page!==page||view.course!==course||view.lessonPath!==lessonPath||view.round!==round))await view.setPage(page,course,lessonPath,round);
    this.navigationCourse=course||null;this.lastMainLeaf=leaf;
    await this.app.workspace.revealLeaf(leaf);
    this.lastContentLeaf=leaf;this.refreshChatContext();
    if(page!=='preview'&&this.pdfLeaf&&this.pdfLeaf!==leaf&&this.pdfLeaf.view?.file?.path===this.pdfPath){this.pdfLeaf.detach();this.pdfLeaf=null;this.pdfPath=null;}
    await this.refreshNav();
  }
  async open(path){const target=this.pageForPath(path);if(target){await this.openHub(target.page,target.course);return;}const f=asFile(this.app,path);if(!f){new Notice(tr("尚无此页面：")+path);return;}let leaf=this.app.workspace.getLeaf(false);if(leaf?.view?.getViewType?.()===NAV)leaf=this.app.workspace.getLeaf('tab');await leaf.openFile(f);}
  async alignChatWithAnnotations(){
    const workspace=this.app.workspace;
    const chat=workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
    const annotation=workspace.getLeavesOfType(ANNOTATION_VIEW)[0];
    if(!chat||!annotation||chat.parent===annotation.parent)return chat||null;
    const focused=workspace.activeLeaf===chat;
    const draft=chat.view?.draftText||'';
    chat.detach(); // Collapses the old lower split before creating the tab.
    const leaf=workspace.getRightLeaf(false);
    if(!leaf){new Notice(tr("学习助手侧边栏迁移失败，请重新打开。"));return null;}
    await leaf.setViewState({type:CHAT_VIEW_TYPE,active:focused});
    if(draft&&leaf.view instanceof LearningChatView){leaf.view.draftText=draft;await leaf.view.render();}
    if(focused)await workspace.revealLeaf(leaf);
    void workspace.requestSaveLayout?.();
    return leaf;
  }
  async openChat(){
    const current=this.app.workspace.activeLeaf;
    if(current&&![CHAT_VIEW_TYPE,NAV,ANNOTATION_VIEW].includes(current.view?.getViewType?.())){this.lastContentLeaf=current;const sourcePath=this.chatContextKey(current);this.lastSelectedText=this.selectedChatText(current)||(sourcePath&&this.lastSelectedPath===sourcePath?this.lastSelectedText:'')||'';this.lastSelectedPath=sourcePath;}
    let leaf=await this.alignChatWithAnnotations();
    if(!leaf){
      leaf=this.app.workspace.getRightLeaf(false);
      if(!leaf){new Notice(tr("无法打开右侧学习助手。"));return;}
      await leaf.setViewState({type:CHAT_VIEW_TYPE,active:true});
    }
    await this.app.workspace.revealLeaf(leaf);
  }
  chatContextKey(leaf){const v=leaf?.view;return v?.file?.path||v?.lessonPath||`${leaf?.id||''}:${v?.course||''}:${v?.page||''}`;}
  refreshChatContext(){for(const leaf of this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE))leaf.view.queueContextRefresh?.();}
  selectedChatText(leaf){
    const view=leaf?.view;
    if(view instanceof MarkdownView){const selected=view.editor?.getSelection?.();if(selected)return selected;}
    const selection=view?.containerEl?.ownerDocument?.getSelection?.();
    return selection?.anchorNode&&view?.containerEl?.contains(selection.anchorNode)?selection.toString().trim():'';
  }
  async chatFileText(file){
    if(!file)return '';
    if(file.extension==='md'||file.extension==='txt')return await this.app.vault.read(file);
    if(file.extension==='pdf'){
      this.chatPdfCache||=new Map();
      const cached=this.chatPdfCache.get(file.path);
      if(cached?.mtime===file.stat?.mtime)return cached.text;
      const text=await extractPdfText(path.join(this.vaultPath(),file.path),this.state.ai.pdfExtractor);
      this.chatPdfCache.set(file.path,{mtime:file.stat?.mtime,text});
      return text;
    }
    throw new Error(tr("暂不支持读取 {0} 文件作为对话上下文。", [file.extension]));
  }
  async captureChatContext({includeContent=false}={}){
    const active=this.app.workspace.activeLeaf;
    const type=active?.view?.getViewType?.();
    const leaf=[CHAT_VIEW_TYPE,NAV,ANNOTATION_VIEW].includes(type)?(this.lastContentLeaf||this.lastMainLeaf):active;
    await leaf?.loadIfDeferred?.();
    const view=leaf?.view,isMain=view?.getViewType?.()===MAIN;
    let course=isMain?view.course:null;
    let lessonPath=view?.getViewType?.()===MAIN?view.lessonPath:null;
    const pageFile=view?.file instanceof TFile?view.file:null;
    const selectedText=this.selectedChatText(leaf)||(this.lastSelectedPath===this.chatContextKey(leaf)?this.lastSelectedText:'')||'';
    if(!course){const candidate=pageFile?.path||'';const part=candidate.startsWith(`${ROOT}/`)?candidate.slice(ROOT.length+1).split('/')[0]:'';if(this.courses.includes(part))course=part;}
    if(!lessonPath&&course&&(!isMain||['lesson','preview','recall','review'].includes(view.page))){
      const candidate=pageFile?.path;
      const matching=this.lessons(course).find(file=>file.path===candidate||(candidate&&file.path!==candidate&&path.dirname(file.path)===path.dirname(candidate)));
      lessonPath=matching?.path||(!pageFile?this.selectedLesson(course)?.path:null)||null;
    }
    const lesson=lessonPath?asFile(this.app,lessonPath):null;
    const contextFile=pageFile||lesson||(isMain&&course?asFile(this.app,`${ROOT}/${course}/学习概览.md`):null);
    let note='',preview=null,errors=[],readError='';
    if(includeContent&&isMain&&!['lesson','preview','recall','review'].includes(view.page))note=view.contentEl.querySelector('.learning-hub')?.innerText||'';
    else if(includeContent&&contextFile){try{note=await this.chatFileText(contextFile);}catch(error){readError=error.message;}}
    let lessonTitle='';
    if(lesson){const flow=await this.readFlow(lesson);preview=includeContent?flow.preview:null;lessonTitle=flow.lessonTitle||lesson.basename;if(includeContent)errors=await this.readErrorEntries(this.errorPath(lesson));}
    if(includeContent&&course)errors.push(...await this.readErrorEntries(this.courseErrorPath(course)));
    const pageLabels={home:'学习主页',schedule:'完整日程',tasks:'待办事项',retrospect:'学习复盘',drafts:'草稿本',course:'课程概览 · {0}',assignments:'作业与 Lab Session · {0}'};
    const label=isMain&&!['lesson','preview','recall','review'].includes(view.page)?translate(this.state.deepseek?.language||this.state.interfaceLanguage,pageLabels[view.page]||'学习主页',[course?.split(' - ')[0]||'']):[course?.split(' - ')[0],contextFile?.basename||lessonTitle].filter(Boolean).join(' · ');
    const contextPath=contextFile?.path||(isMain?({home:HOME,schedule:SCHEDULE,tasks:TASKS,retrospect:RETROSPECT}[view.page]||''):'');
    return {course,lesson:lessonTitle,lessonPath:lesson?.path||'',selectedText,note,preview,errors,label,path:contextPath,readError};
  }
  async recordChatMisconception({question,answer,course,lessonPath,conversationId,messageId}){
    if(!this.state.deepseek.apiKey||String(question||'').trim().length<8)return false;
    const result=await this.callDeepSeek({user:misconceptionRequest(question,answer),systemPrompt:MISCONCEPTION_SYSTEM,model:'deepseek-flash',thinking:false,reasoningEffort:'none',maxTokens:500,languageScope:'assistant'});
    const finding=parseMisconception(result.content,question);if(!finding)return false;
    const lesson=lessonPath?asFile(this.app,lessonPath):null;
    const filePath=lesson?this.errorPath(lesson):course?this.courseErrorPath(course):this.globalErrorPath();
    const scope=lesson?{lessonPath:lesson.path}:course?{course}:{scope:'global'};
    return this.appendError(filePath,scope,{mode:'chat',rating:'misconception',prompt:question,answer:finding.evidence,reference:finding.correction,topic:finding.topic,misconception:finding.misconception,sourceConversationId:conversationId,sourceMessageId:messageId,sourceLessonPath:lesson?.path||''});
  }
  async save(){await this.saveData(this.state);this.refreshBlocks();await this.refreshNav();}
  async refreshDeepSeekPricing(force=false){
    const saved=this.state.deepseek.pricing;
    if(!force&&saved&&Date.now()-new Date(saved.verifiedAt).valueOf()<86400000)return saved;
    if(this.pricingRefresh)return this.pricingRefresh;
    this.pricingRefresh=(async()=>{const response=await requestUrl({url:PRICING_URL,method:'GET',throw:false});if(response.status!==200)throw new Error(tr('无法更新官方价格，请稍后重试。'));const pricing=parseOfficialPricing(response.text);this.state.deepseek.pricing=pricing;await this.saveData(this.state);return pricing;})().finally(()=>{this.pricingRefresh=null;});
    return this.pricingRefresh;
  }
  async setAssistantLanguage(value){this.state.deepseek.language=normalizeInterfaceLanguage(value);await this.saveData(this.state);for(const leaf of this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)){await leaf.loadIfDeferred?.();await leaf.view.render?.();leaf.updateHeader?.();}}
  async callDeepSeek(options={}){
    const {apiKey:_apiKey,endpoint:_endpoint,model,languageScope,...request}=options||{};
    const settings=this.state.deepseek||{};
    request.systemPrompt=`${request.systemPrompt||DEFAULT_SYSTEM_PROMPT}\n\n${generationLanguageInstruction(languageScope==='assistant'?settings.language:this.state.ai?.language)}`;
    if(languageScope==='assistant')try{let timer;try{await Promise.race([this.refreshDeepSeekPricing(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Pricing timeout')),6000);})]);}finally{clearTimeout(timer);}}catch{/* Keep the last verified price; every estimate records its verification date. */}
    return this.deepseekClient.chat({...request,apiKey:settings.apiKey,endpoint:settings.endpoint,model:model||settings.model||'deepseek-flash'});
  }
  allScheduleSlots({busyOnly=false}={}){
    const events=this.state.googleCalendar?.events||[];
    const pending=this.state.googleCalendar?.pendingEvents||[];
    return [...this.state.slots,...(busyOnly?calendarBlocks(events,this.state.calendarChoices):[...events,...pending])];
  }
  overdueScheduleSlots(){
    const currentTime=localNow();
    return this.allScheduleSlots().filter(s=>s.start.slice(0,10)<today()&&scheduleItemState(s,{choices:this.state.calendarChoices,outcomes:this.state.eventOutcomes,tasks:this.state.tasks,now:currentTime}).overdue).sort((a,b)=>a.end.localeCompare(b.end));
  }
  courseForCode(code){return this.courses.find(course=>course.toUpperCase().startsWith(`${code} -`))||null;}
  courseForEvent(event){
    return matchCalendarCourse(event,this.courses);
  }
  syncCompletedClasses(events=this.state.googleCalendar?.events||[]){
    const history=this.state.completionHistory||[],dismissed=new Set(this.state.dismissedClassEventIds||[]),nowStamp=localNow(),changed=new Set();
    for(const event of events){
      const current=history.findIndex(item=>item.kind==='class'&&item.id===event.id);
      if(dismissed.has(event.id)){if(current>=0){history.splice(current,1);changed.add(event.id);}continue;}
      const type=classifyCalendarEvent(event,this.state.calendarChoices).type;
      const included=type==='lec'||((type==='tut'||type==='lab')&&this.state.calendarChoices[event.id]?.attend===true);
      const shouldRecord=included&&event.end<=nowStamp;
      if(!shouldRecord){if(current>=0){history.splice(current,1);changed.add(event.id);}continue;}
      const duration=Math.max(0,Math.round((new Date(event.end)-new Date(event.start))/60000));
      const record={id:event.id,kind:'class',classType:type,title:event.title,status:'class',completedAt:event.end,start:event.start,end:event.end,actualMinutes:duration,course:this.courseForEvent(event)||'',source:'Google Calendar'};
      if(current<0){history.push(record);changed.add(event.id);}
      else if(JSON.stringify(history[current])!==JSON.stringify(record)){history[current]=record;changed.add(event.id);}
    }
    if(changed.size)this.state.completionHistory=history;
    return changed.size>0;
  }
  async previewScheduleTasks(){
    const tasks=[];
    const calendarEvents=this.state.googleCalendar?.events||[];
    const events=calendarEvents.filter(event=>event.start>=localNow()&&classifyCalendarEvent(event,this.state.calendarChoices).type==='lec').sort((a,b)=>a.start.localeCompare(b.start));
    const seen=new Set();
    for(const event of events){
      const course=this.courseForEvent(event),code=course?.split(' - ')[0]||'';
      if(!course||seen.has(course))continue;seen.add(course);
      const lessons=this.lessons(course),dated=await Promise.all(lessons.map(async file=>({file,date:(file.basename.match(/@(\d{4}) (\d{2}) (\d{2})/)||[]).slice(1).join('-'),flow:await this.readFlow(file)})));
      const previousIndex=dated.reduce((index,item,i)=>(item.date&&item.date<event.start.slice(0,10)&&item.date<=today()||item.flow.milestones.learnedAt)?i:index,-1);
      if(previousIndex<0)continue;
      const previous=dated[previousIndex],next=dated[previousIndex+1]||null;
      if(!previous.flow.milestones.learnedAt||next?.flow.milestones.previewedAt)continue;
      const latestPast=calendarEvents.filter(item=>item.end<=localNow()&&classifyCalendarEvent(item,this.state.calendarChoices).type==='lec'&&this.courseForEvent(item)===course).sort((a,b)=>a.end.localeCompare(b.end)).at(-1);
      if(latestPast&&localTimestamp(previous.flow.milestones.learnedAt,this.state.ai.timezone||'Asia/Shanghai')<latestPast.end)continue;
      tasks.push({id:`preview:${next?.file.path||event.id}`,title:`${code} ${next?.file.basename||'下一次 Lec'} · 预习`,minutes:estimateMinutes({title:'预习',kind:'preview'},this.state.completionHistory),due:event.start.slice(0,10),before:event.start,source:course,kind:'preview',lessonPath:next?.file.path||'',course});
    }
    return tasks;
  }
  async scheduleInputs(startDate=today(),days=7){
    const reviewTasks=await this.reviewScheduleTasks(),previewTasks=await this.previewScheduleTasks();
    const tasks=this.state.tasks.map(task=>({...task,before:task.due&&task.dueTime?`${task.due}T${task.dueTime}`:task.before||'',done:taskStatus(task)!=='unfinished',minutes:Number(task.minutes)||estimateMinutes(task,this.state.completionHistory)}));
    return buildScheduleRequest({settings:this.state.ai,tasks,reviewTasks:[...reviewTasks,...previewTasks],slots:this.allScheduleSlots({busyOnly:true}),startDate,days});
  }
  async updateRollingSchedule(){
    if(this.rollingPromise)return this.rollingPromise;
    this.rollingPromise=(async()=>{
      const request=await this.scheduleInputs();
      const current=localNow(),existing=this.state.slots.filter(slot=>slot.source!=='system-schedule'||slot.end>current);
      const result=planIncrementally({request,existing,now:current});
      if(result.added||JSON.stringify(result.slots)!==JSON.stringify(this.state.slots)||this.state.lastPlannedDay!==today()){
        this.state.slots=result.slots;this.state.lastPlannedDay=today();this.state.unscheduledTasks=result.unscheduled;
        await this.save();
      }
      return result;
    })();
    try{return await this.rollingPromise;}finally{this.rollingPromise=null;}
  }
  async connectGoogleCalendar(){
    const config=this.state.googleCalendar;
    const tokens=await this.googleCalendarClient.authorize(config.clientId,config.clientSecret);
    if(!tokens.refreshToken)throw new Error(tr("Google 未返回持续授权，请重新连接并允许离线访问。"));
    config.tokens=tokens;config.error='';await this.saveData(this.state);
    await this.syncGoogleCalendar({quiet:true});
    return config.calendars.length;
  }
  async syncGoogleCalendar({quiet=false}={}){
    const config=this.state.googleCalendar;
    if(!config?.tokens)return false;
    if(this.googleSyncPromise)return this.googleSyncPromise;
    this.googleSyncPromise=(async()=>{
      const saveTokens=async()=>this.saveData(this.state);
      try{
        const calendars=await this.googleCalendarClient.listCalendars(config,saveTokens);
        const available=new Set(calendars.map(item=>item.id));
        const selected=config.calendarIds.filter(id=>available.has(id));
        if(!selected.length){const primary=calendars.find(item=>item.primary);if(primary)selected.push(primary.id);}
        const start=new Date(Date.now()-86400000).toISOString();
        const end=new Date(Date.now()+35*86400000).toISOString();
        const events=await this.googleCalendarClient.listEvents({...config,calendars},selected,start,end,this.state.ai.timezone||'Asia/Shanghai',saveTokens);
        config.pendingEvents=retainPendingCalendarEvents(config.events,config.pendingEvents,events,{choices:this.state.calendarChoices,outcomes:this.state.eventOutcomes,now:localNow()});
        config.calendars=calendars;config.calendarIds=selected;config.events=events;config.syncedAt=new Date().toISOString();config.error='';
        await this.saveData(this.state);this.refreshBlocks();if(Array.isArray(this.courses))void this.updateRollingSchedule().catch(error=>console.warn('Learning Hub calendar replan:',error));
        if(!quiet)new Notice(tr("Google Calendar 已同步 {0} 项日程。", [events.length]));
        return true;
      }catch(error){config.error=error.message;await this.saveData(this.state);this.refreshBlocks();if(!quiet)new Notice(tr("Google Calendar 同步失败：{0}", [error.message]),7000);throw error;}
    })();
    try{return await this.googleSyncPromise;}finally{this.googleSyncPromise=null;}
  }
  async disconnectGoogleCalendar(){
    const config=this.state.googleCalendar;
    config.tokens=null;config.events=[];config.pendingEvents=[];config.calendars=[];config.syncedAt='';config.error='';
    await this.saveData(this.state);this.refreshBlocks();
  }
  vaultPath(){const base=this.app.vault.adapter.getBasePath?.();if(!base)throw new Error(tr("Codex 连接需要本地 Obsidian vault。"));return base;}
  getAiClient(){
    if(!this.aiClient)this.aiClient=new CodexClient({executable:this.state.ai.executable||'codex',cwd:this.vaultPath(),maxConcurrentTurns:this.state.ai.maxConcurrentTasks||2});
    return this.aiClient;
  }
  resetAiClient(){this.aiClient?.close();this.aiClient=null;this.modelCatalog=null;}
  async runAi(prompt,schema,options={}){
    const ai=this.state.ai;
    let tokenUsage=null,started=false;
    const onStatus=phase=>{if(phase==='generating'||phase==='thinking'||phase==='receiving')started=true;try{options.onStatus?.(phase);}catch(error){console.warn('Learning Hub Codex status callback:',error);}};
    const onTokenUsage=usage=>{tokenUsage=usage;try{options.onTokenUsage?.(usage);}catch(error){console.warn('Learning Hub Codex usage callback:',error);}};
    try{return await this.getAiClient().runStructured({prompt,schema,model:ai.model||undefined,effort:ai.effort||undefined,...options,onStatus,onTokenUsage});}
    finally{if(tokenUsage||started)new Notice(formatCodexUsage(tokenUsage),12000);}
  }
  navText(parent,text,path,cls){const a=parent.createEl('button',{text,cls:cls||'lh-text-link'});a.onclick=()=>this.open(path);return a;}
  header(el,kicker,title,subtitle){const h=el.createDiv({cls:'lh-head'});h.createDiv({text:kicker,cls:'lh-eyebrow'});h.createEl('h1',{text:title});if(subtitle)h.createEl('p',{text:subtitle});return h;}
  async renderHome(el){
    el.empty();el.addClass('learning-hub','lh-home');
    const semester=this.currentSemester(),semesterCourses=this.coursesForSemester();
    const all=await Promise.all(semesterCourses.map(c=>this.stats(c)));
    const total=all.reduce((n,s)=>n+s.pending.reviewed,0);
    const urgent=this.state.tasks.filter(t=>!t.done&&t.due&&t.due<=today()).length;
    let summary=tr("{0} · {1} 门课程。日程、待办和学习进度都在这里。", [semester?.name||tr("本学期"), semesterCourses.length]);
    if(total||urgent)summary=tr("{0}{1}从今天最重要的事开始。", [urgent?tr("{0} 项待办已到期。", [urgent]):'', total?tr("{0} 个讲次待复习。", [total]):'']);
    this.header(el,tr("PERSONAL SPACE"),tr("学习空间"),this.state.aiSummary?.date===today()?this.state.aiSummary.text:summary);
    const panel=(host,title,meta,cls)=>{const box=host.createDiv({cls:`lh-panel ${cls}`});const row=box.createDiv({cls:'lh-section-title'});row.createEl('h2',{text:title});if(meta)row.createSpan({text:meta});return box;};

    const priority=el.createDiv({cls:'lh-home-priority'});
    const currentTime=localNow();
    const weekSlots=this.allScheduleSlots({busyOnly:true}).filter(s=>{
      if(s.start.slice(0,10)<today()||s.start.slice(0,10)>=addDays(today(),7))return false;
      const state=scheduleItemState(s,{choices:this.state.calendarChoices,outcomes:this.state.eventOutcomes,tasks:this.state.tasks,now:currentTime});
      return !state.hidden&&(state.course||state.status==='unfinished');
    });
    const visibleSlots=[...this.overdueScheduleSlots(),...weekSlots].sort((a,b)=>a.start.localeCompare(b.start)).slice(0,3);
    const schedulePanel=panel(priority,tr("日程安排"),tr("最近 3 件"),'lh-schedule-panel');
    if(!visibleSlots.length)schedulePanel.createDiv({text:tr("近期没有需要处理的日程。"),cls:'lh-home-empty'});
    for(const s of visibleSlots)this.homeSlotRow(schedulePanel,s);
    const scheduleFoot=schedulePanel.createDiv({cls:'lh-home-panel-footer'});
    this.navText(scheduleFoot,tr("查看完整日程 →"),SCHEDULE);
    const plan=scheduleFoot.createEl('button',{text:this.scheduleAnalysis?tr("正在生成日程草案…"):tr("AI 安排 7 天"),cls:'lh-secondary'});plan.disabled=!!this.scheduleAnalysis;plan.onclick=()=>this.generateScheduleDraft(plan);
    const due=tasksForToday(this.state.tasks,this.state.slots,today());
    const tasksPanel=panel(priority,tr("今日待办"),tr("{0} 项", [due.length]),'lh-tasks-panel');
    if(!due.length)tasksPanel.createDiv({text:tr("今天没有需要完成的待办。"),cls:'lh-home-empty'});
    for(const t of due)this.homeTaskRow(tasksPanel,t);
    const taskFoot=tasksPanel.createDiv({cls:'lh-home-panel-footer'});
    this.navText(taskFoot,tr("查看全部待办 →"),TASKS);
    const taskBtn=taskFoot.createEl('button',{text:tr("＋ 添加待办"),cls:'lh-secondary'});taskBtn.onclick=()=>this.addTask();

    const secondary=el.createDiv({cls:'lh-home-secondary'});
    const coursesPanel=panel(secondary,tr("课程总览"),tr("{0} 门课程 · {1} · 点击进入", [semesterCourses.length, semester?.name||tr("学期")]),'lh-courses-panel');
    const table=coursesPanel.createDiv({cls:'lh-course-list'});
    const columns=table.createDiv({cls:'lh-course-columns'});
    columns.createSpan({text:tr("课程")});
    for(const [,name] of STAGES)columns.createSpan({text:tr(name)});
    semesterCourses.forEach((c,i)=>{
      const s=all[i],short=c.split(' - ')[0],max=Math.max(...STAGES.map(([key])=>s.pending[key]));
      const row=table.createDiv({cls:`lh-course-row${max>=5?' is-urgent':max>=3?' is-watch':''}`,attr:{role:'link',tabindex:'0','aria-label':tr("打开 {0}", [c])}});
      const title=row.createDiv({cls:'lh-course-row-name'});title.createEl('strong',{text:short});title.createEl('small',{text:c.slice(short.length+3)});
      for(const [key] of STAGES){const n=s.pending[key],cell=row.createSpan({cls:`lh-course-number ${n>=5?'is-high':n>=3?'is-medium':n===0?'is-zero':''}`});cell.createEl('strong',{text:s.scoped.length?String(n):'—'});}
      row.title=tr("{0} · {1} 讲纳入范围", [short, s.scoped.length]);
      row.onclick=()=>this.open(`${ROOT}/${c}/学习概览.md`);
      row.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();row.click();}};
    });
    if(!semesterCourses.length)table.createDiv({text:tr("当前学期还没有课程。可在插件设置中创建课程。"),cls:'lh-empty'});
    const foot=coursesPanel.createDiv({cls:'lh-course-list-foot'});
    foot.createSpan({text:tr("只统计已纳入范围的讲次；待复习为已解锁轮次。")});
    this.navText(foot,tr("查看课程总目录 ↗"),INDEX);
    const companion=secondary.createDiv({cls:'lh-home-companion'});
    const recent=recentDeadlineTasks(this.state.tasks,currentTime,5);
    const remindersPanel=panel(companion,tr("最近事项"),tr("{0} 项置顶 · 按 DDL 排序", [this.state.tasks.filter(t=>t.pinned).length]),'lh-reminders-panel');
    if(!recent.length)remindersPanel.createDiv({text:tr("暂无设置 DDL 或置顶的事项。"),cls:'lh-empty'});
    for(const task of recent){
      const item=remindersPanel.createDiv({cls:`lh-deadline-row${task.pinned?' is-pinned':''}${urgencyBand(task,currentTime)===0&&!completed(task)?' is-overdue':''}`});
      const body=item.createDiv({cls:'lh-deadline-body'});
      const title=body.createEl('button',{text:this.itemDisplayTitle(task),cls:'lh-deadline-title'});title.onclick=()=>{if(task.course||task.lessonPath||this.courses.includes(task.source))this.openTaskTarget(task);else this.open(TASKS);};
      body.createSpan({text:deadlineLabel(task,currentTime),cls:'lh-deadline-date'});
      if(task.pinned)item.createSpan({text:completed(task)?tr("已完成 · 置顶"):tr("置顶"),cls:'lh-deadline-pin'});
    }
    const projectsPanel=panel(companion,tr("项目与论文"),null,'lh-projects-panel');
    const projects=projectsPanel.createDiv({cls:'lh-projects'});
    this.navText(projects,'Projects →','Projects/Projects.md','lh-project');
    this.navText(projects,tr("课外学习 →"),`${ROOT}/Self Study/Self Study.md`,'lh-project');
    projects.createDiv({text:tr("论文阅读：尚未建立统一入口"),cls:'lh-project-muted'});
  }
  currentWorkspacePaths(){const paths=new Set();this.app.workspace.iterateAllLeaves(leaf=>{if(leaf.view?.file?.path)paths.add(leaf.view.file.path);});return paths;}
  checkClosedDrafts(){
    if(this.unloaded||!this.draftOpenTrackingReady)return;
    const current=this.currentWorkspacePaths(),closed=[...this.draftOpenPaths].filter(path=>!current.has(path));
    this.draftOpenPaths=current;
    if(!this.state.draftTitle?.autoTitle)return;
    for(const path of closed){const file=asFile(this.app,path);if(isTimestampDraft(path)&&file)void this.generateDraftTitle(file,false);}
  }
  async createDraft(){
    try{
      if(!this.app.vault.getAbstractFileByPath(DRAFT_FOLDER))await this.app.vault.createFolder(DRAFT_FOLDER);
      const path=uniqueDraftPath(DRAFT_FOLDER,draftTimestamp(new Date()),candidate=>Boolean(this.app.vault.getAbstractFileByPath(candidate)));
      const file=await this.app.vault.create(path,'');
      const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
      this.draftOpenPaths=this.currentWorkspacePaths();
      window.setTimeout(()=>leaf.view?.editor?.focus?.(),0);
    }catch(error){console.error('Learning Hub draft creation:',error);new Notice(tr("创建草稿失败：{0}", [error.message||error]));}
  }
  async generateDraftTitle(file,manual=false){
    if(!isTimestampDraft(file?.path)){if(manual)new Notice(tr("只为 Draft 文件夹中仍以时间命名的草稿生成标题"));return;}
    const originalPath=file.path;if(this.draftNamingJobs.has(originalPath))return;
    this.draftNamingJobs.add(originalPath);
    try{
      const content=await this.app.vault.read(file);if(!content.trim()){if(manual)new Notice(tr("空草稿保持时间标题；写入内容后再生成标题"));return;}
      if(!this.state.deepseek.apiKey){if(manual)new Notice(tr("请在 Learning Hub 设置中填写统一的 DeepSeek API Key"));return;}
      const titleRequest=draftTitleRequest(this.state.deepseek.model||'deepseek-flash',content);
      const titleMessage={user:titleRequest.messages.find(message=>message.role==='user')?.content||'',systemPrompt:titleRequest.messages.find(message=>message.role==='system')?.content||'',model:titleRequest.model,thinking:false,reasoningEffort:'none',maxTokens:titleRequest.max_tokens,responseFormat:titleRequest.response_format};
      let response;
      try{response=await this.callDeepSeek(titleMessage);}
      catch(error){if(error.code!=='TRUNCATED')throw error;response=await this.callDeepSeek({...titleMessage,maxTokens:4096});}
      const title=parseDraftTitle(response.content);
      if(!title)throw Error(tr("AI 未返回有效标题"));
      if(this.unloaded||file.path!==originalPath||!isTimestampDraft(file.path)||(!manual&&this.currentWorkspacePaths().has(originalPath)))return;
      if(await this.app.vault.read(file)!==content)return;
      const target=uniqueDraftPath(draftParentFolder(originalPath),title,candidate=>candidate!==originalPath&&Boolean(this.app.vault.getAbstractFileByPath(candidate)));
      await this.app.fileManager.renameFile(file,target);new Notice(tr("草稿已命名：{0}", [title]));
    }catch(error){console.error('Learning Hub draft title:',error);new Notice(tr("草稿命名失败：{0}，已保留原名", [error.message||tr("接口错误")]));}
    finally{this.draftNamingJobs.delete(originalPath);}
  }
  draftFiles(){return this.app.vault.getMarkdownFiles().filter(file=>file.path.startsWith(`${DRAFT_FOLDER}/`));}
  draftCreatedAt(file){
    const frontmatter=this.app.metadataCache.getFileCache(file)?.frontmatter||{};
    const explicit=['created','created_at','createdAt','创建时间','创建日期'].map(key=>frontmatter[key]).find(value=>value!=null&&String(value).trim());
    if(explicit!=null){
      const normalized=explicit instanceof Date?explicit:new Date(typeof explicit==='string'?explicit.trim().replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T'):explicit);
      if(Number.isFinite(normalized.getTime()))return normalized;
    }
    const fallback=Number(file.stat?.ctime||0);
    return new Date(Number.isFinite(fallback)?fallback:0);
  }
  renderDrafts(el){
    el.empty();el.addClass('learning-hub','lh-drafts-page');
    const drafts=this.draftFiles().map(file=>{
      const frontmatter=this.app.metadataCache.getFileCache(file)?.frontmatter||{};
      const title=typeof frontmatter.title==='string'&&frontmatter.title.trim()?frontmatter.title.trim():file.basename;
      return {file,title,createdAt:this.draftCreatedAt(file)};
    }).sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||a.title.localeCompare(b.title,'zh-CN'));
    const head=this.header(el,tr("DRAFTS / RECENT NOTES"),tr("草稿本"),drafts.length?tr("按创建时间倒序"):tr("Draft 文件夹目前还没有 Markdown 草稿。"));
    head.addClass('lh-drafts-head');
    const create=head.createEl('button',{text:tr("＋ 新建草稿"),cls:'lh-draft-create',attr:{type:'button','aria-label':tr("新建时间草稿")}});create.addClass('mod-cta');create.onclick=()=>this.createDraft();
    if(!drafts.length){el.createDiv({text:tr("草稿保存到 Draft 文件夹后，会自动出现在这里。"),cls:'lh-drafts-empty'});return;}
    const list=el.createDiv({cls:'lh-draft-list'});
    const columns=list.createDiv({cls:'lh-draft-list-head'});
    columns.createSpan({text:tr("标题")});columns.createSpan({text:tr("创建时间")});
    for(const {file,title,createdAt} of drafts){
      const row=list.createEl('button',{cls:'lh-draft-row',attr:{type:'button',title:tr("打开 {0}", [title]),'aria-label':tr("{0}，创建于 {1}", [title, createdAt.toLocaleString(uiLocale())])}});
      row.createSpan({text:title,cls:'lh-draft-title'});
      const stamp=row.createEl('time',{cls:'lh-draft-stamp',attr:{datetime:createdAt.toISOString()}});
      stamp.createSpan({text:`${createdAt.getFullYear()}.${pad(createdAt.getMonth()+1)}.${pad(createdAt.getDate())}`,cls:'lh-draft-date'});
      stamp.createSpan({text:`${pad(createdAt.getHours())}:${pad(createdAt.getMinutes())}`,cls:'lh-draft-clock'});
      row.onclick=()=>{void this.open(file.path);};
    }
  }
  openTaskTarget(t){
    if(t.assignmentId&&t.course){void this.openHub('assignments',t.course);return;}
    if(t.lessonPath){const course=t.course||this.courses.find(c=>t.lessonPath.startsWith(`${ROOT}/${c}/`));if(course){void this.showWorkflow(t.kind==='preview'?'preview':t.kind==='review'?'review':'recall',course,t.lessonPath,t.round||1);return;}}
    if(t.course){void this.open(`${ROOT}/${t.course}/学习概览.md`);return;}
    if(t.source&&this.courses.includes(t.source))void this.open(`${ROOT}/${t.source}/学习概览.md`);
  }
  itemDisplayTitle(item){
    const linked=item.taskId?this.state.tasks.find(task=>task.id===item.taskId):this.state.tasks.find(task=>task.id===item.id);
    const title=String(item.title||''),task=linked||item;
    if(task.assignmentId&&title.startsWith('完成作业：'))return tr('完成作业：{0}',[title.slice(5)]);
    if((item.taskId||item.id||'').startsWith('preview:')&&title.endsWith(' · 预习'))return tr('{0} · 预习',[title.slice(0,-5).replace(/下一次 Lec$/,tr('下一次 Lec'))]);
    if((item.taskId||item.id||'').startsWith('review:')){const match=title.match(/^(.*) · 第 (\d+) 轮复习$/);if(match)return tr('{0} · 第 {1} 轮复习',[match[1],match[2]]);}
    return title;
  }
  recordOutcome(item,kind){
    const estimated=Number(item.minutes)||Math.max(15,Math.round((new Date(item.end)-new Date(item.start))/60000));
    new OutcomeModal(this.app,this.itemDisplayTitle(item),estimated,async result=>{
      const outcome={...result,title:item.title,kind:item.kind||kind,estimatedMinutes:estimated,id:item.id,start:item.start||'',end:item.end||''};
      if(kind==='calendar'){this.state.eventOutcomes[item.id]=outcome;if(result.status!=='unfinished')this.state.googleCalendar.pendingEvents=this.state.googleCalendar.pendingEvents.filter(event=>event.id!==item.id);}
      else Object.assign(item,result,{done:result.status!=='unfinished'});
      this.state.completionHistory=this.state.completionHistory.filter(row=>!(row.id===item.id&&row.kind===outcome.kind));
      if(result.status!=='unfinished')this.state.completionHistory.push(outcome);
      for(const task of this.state.tasks)if(taskStatus(task)==='unfinished')task.minutes=estimateMinutes(task,this.state.completionHistory);
      await this.save();
      if(kind==='task'||kind==='slot')await this.updateRollingSchedule();
    },taskStatus(kind==='calendar'?this.state.eventOutcomes[item.id]:item)!=='unfinished'?taskStatus(kind==='calendar'?this.state.eventOutcomes[item.id]:item):(item.due&&item.due<today()||item.end&&item.end<localNow()?'late':'on-time')).open();
  }
  homeSlotRow(host,s){
    const display=scheduleItemState(s,{choices:this.state.calendarChoices,outcomes:this.state.eventOutcomes,tasks:this.state.tasks,now:localNow()});
    const system=s.source==='system-schedule';
    const row=host.createDiv({cls:`lh-home-slot${display.overdue?' is-overdue':''}${display.course?' is-course':''}${system?' is-system':''}`});
    const stamp=row.createDiv({cls:'lh-home-slot-stamp'});
    const day=s.start.slice(0,10);
    stamp.createSpan({text:day===today()?tr("今天"):day===addDays(today(),1)?tr("明天"):day===addDays(today(),-1)?tr("昨天"):s.start.slice(5,10),cls:'lh-home-slot-day'});
    stamp.createSpan({text:s.allDay?tr("全天"):s.start.slice(11,16),cls:'lh-home-slot-clock'});
    const body=row.createDiv({cls:'lh-home-slot-body'});
    const title=body.createEl('button',{text:this.itemDisplayTitle(s),cls:'lh-home-slot-title'});
    title.onclick=()=>{if(!this.openSlotTarget(s))this.open(SCHEDULE);};
    const calendar=s.source==='google-calendar';
    const type=system?tr("系统日程"):calendar?classifyCalendarEvent(s,this.state.calendarChoices).type.toUpperCase():s.fixed?tr("固定日程"):tr("学习安排");
    body.createSpan({text:type,cls:'lh-home-slot-kind'});
    if(!display.course&&!system){
      const status=display.status;
      const button=row.createEl('button',{text:display.overdue?tr("逾期未完成"):status==='on-time'?tr("按时完成"):status==='late'?tr("未按时完成"):tr("未完成"),cls:`lh-home-slot-status is-${status}`,attr:{type:'button','aria-label':tr("更新「{0}」的完成状态", [this.itemDisplayTitle(s)])}});
      button.onclick=()=>{const task=!calendar&&s.taskId?this.state.tasks.find(item=>item.id===s.taskId):null;this.recordOutcome(task||s,task?'task':calendar?'calendar':'slot');};
    }
  }
  homeTaskRow(host,t){
    const status=taskStatus(t),isDone=status!=='unfinished';
    const row=host.createDiv({cls:`lh-home-task${isDone?' is-done':''}`});
    const body=row.createDiv({cls:'lh-home-task-body'});
    const target=!!(t.course||t.lessonPath||this.courses.includes(t.source));
    if(target){const title=body.createEl('button',{text:this.itemDisplayTitle(t),cls:'lh-home-task-title'});title.onclick=()=>this.openTaskTarget(t);}
    else body.createEl('strong',{text:this.itemDisplayTitle(t),cls:'lh-home-task-title'});
    body.createSpan({text:[t.due?`${tr("截止")} ${t.due}${t.dueTime?` ${t.dueTime}`:''}`:tr("无 DDL"),tr("预计 {0} 分钟", [t.minutes||estimateMinutes(t,this.state.completionHistory)])].join(' · '),cls:'lh-home-task-meta'});
    const done=row.createEl('button',{text:status==='on-time'?tr("按时完成"):status==='late'?tr("未按时完成"):tr("未完成"),cls:'lh-home-task-done',attr:{'aria-label':tr("记录「{0}」的完成情况", [this.itemDisplayTitle(t)])}});
    done.onclick=()=>this.recordOutcome(t,'task');
  }
  taskRow(host,t){
    const row=host.createDiv({cls:`lh-task lh-status-${taskStatus(t)}`});
    const body=row.createDiv({cls:'lh-task-body'});
    const title=body.createEl('button',{text:this.itemDisplayTitle(t),cls:'lh-task-title'});title.onclick=()=>this.openTaskTarget(t);
    if(!t.course&&!t.lessonPath&&!this.courses.includes(t.source))title.disabled=true;
    if(t.description)body.createDiv({text:t.description,cls:'lh-task-description'});
    body.createSpan({text:[t.due?`${tr("截止")} ${t.due}${t.dueTime?` ${t.dueTime}`:''}`:tr("无 DDL"),tr("预计 {0} 分钟", [t.minutes||estimateMinutes(t,this.state.completionHistory)]),t.course?.split(' - ')[0]||(['作业','间隔复习','DeepSeek 对话'].includes(t.source)?tr(t.source):t.source)||tr("个人")].join(' · '),cls:'lh-task-meta'});
    const actions=row.createDiv({cls:'lh-task-actions'});actions.createSpan({text:taskStatus(t)==='on-time'?tr("按时完成"):taskStatus(t)==='late'?tr("未按时完成"):tr("未完成"),cls:'lh-status-label'});
    const status=actions.createEl('button',{text:tr("记录状态")});status.onclick=()=>this.recordOutcome(t,'task');
    const pin=actions.createEl('button',{text:t.pinned?tr("取消置顶"):tr("置顶此项"),cls:`lh-task-pin${t.pinned?' is-pinned':''}`,attr:{type:'button','aria-pressed':String(!!t.pinned),'aria-label':`${t.pinned?tr("取消置顶"):tr("置顶")}「${t.title}」`}});pin.onclick=async()=>{t.pinned=!t.pinned;await this.save();};
    const edit=actions.createEl('button',{text:tr("编辑")});edit.onclick=()=>this.addTask(t);
  }
  slotRow(host,s){
    const display=scheduleItemState(s,{choices:this.state.calendarChoices,outcomes:this.state.eventOutcomes,tasks:this.state.tasks,now:localNow()});
    const system=s.source==='system-schedule';
    const row=host.createDiv({cls:`lh-slot${display.overdue?' is-overdue':''}${display.course?' is-course':''}${system?' is-system':''}`});const end=s.start.slice(0,10)===s.end.slice(0,10)?s.end.slice(11,16):s.end.slice(5,16).replace('T',' ');
    row.createEl('time',{text:s.allDay?tr("{0} 全天", [s.start.slice(5,10)]):`${s.start.slice(5,16).replace('T',' ')}–${end}`});
    const body=row.createDiv({cls:'lh-slot-body'});
    const title=body.createEl('strong',{text:this.itemDisplayTitle(s)});
    const calendar=s.source==='google-calendar',category=calendar?classifyCalendarEvent(s,this.state.calendarChoices):null;
    body.createSpan({text:system?tr("系统日程"):calendar?`Google Calendar · ${category.type.toUpperCase()}`:s.fixed?tr("固定安排"):tr("可调整"),cls:'lh-slot-source'});
    const actions=row.createDiv({cls:'lh-slot-actions'});
    if(calendar&&['tut','lab'].includes(category.type)){
      const label=actions.createEl('label',{cls:'lh-attendance-toggle'});const check=label.createEl('input',{attr:{type:'checkbox'}});check.checked=this.state.calendarChoices[s.id]?.attend===true;label.createSpan({text:tr("参加")});
      check.onchange=async()=>{this.state.calendarChoices[s.id]={...(this.state.calendarChoices[s.id]||{}),attend:check.checked};await this.save();await this.updateRollingSchedule();};
    }
    if(!display.course&&!system){
      const button=actions.createEl('button',{text:display.overdue?tr("逾期未完成"):display.status==='on-time'?tr("按时完成"):display.status==='late'?tr("未按时完成"):tr("未完成"),cls:'lh-slot-status'});
      button.onclick=()=>{const task=!calendar&&s.taskId?this.state.tasks.find(item=>item.id===s.taskId):null;this.recordOutcome(task||s,task?'task':calendar?'calendar':'slot');};
    }
    if(s.taskId)title.onclick=()=>this.openSlotTarget(s);
  }
  openSlotTarget(s){
    if(s.taskId?.startsWith('preview:')){this.openTaskTarget({title:s.title,lessonPath:s.lessonPath||'',course:s.course||'',kind:'preview'});return true;}
    if(s.taskId?.startsWith('review:')){const rest=s.taskId.slice(7),split=rest.lastIndexOf(':'),lessonPath=rest.slice(0,split),round=Number(rest.slice(split+1));this.openTaskTarget({title:s.title,lessonPath,kind:'review',round});return true;}
    if(s.taskId){const task=this.state.tasks.find(item=>item.id===s.taskId);if(task){this.openTaskTarget(task);return true;}}
    return false;
  }
  addTask(existing=null){
    const courses=[{label:tr('不关联课程'),value:''},...this.coursesForSemester().map(course=>({label:course,value:course}))];
    const lessons=[{label:tr('不关联讲次'),value:''},...this.coursesForSemester().flatMap(course=>this.lessons(course).map(file=>({label:`${course.split(' - ')[0]} · ${file.basename}`,value:file.path})))];
    new EntryModal(this.app,existing?tr("编辑待办"):tr("添加待办"),[
      {key:'title',label:tr("需要完成的事项"),value:existing?.title||''},
      {key:'description',label:tr("详细说明（可选）"),multiline:true,value:existing?.description||''},
      {key:'due',label:tr("DDL（可选）"),type:'date',value:existing?.due||''},
      {key:'dueTime',label:tr("DDL 时间（可选）"),type:'time',value:existing?.dueTime||''},
      {key:'course',label:tr("关联课程（可选）"),options:courses,value:existing?.course||''},
      {key:'lessonPath',label:tr("关联讲次（可选）"),options:lessons,value:existing?.lessonPath||''}
    ],values=>this.saveTask(values,existing),existing?()=>this.deleteTask(existing):null).open();
  }
  async saveTask(values,existing=null){
    const title=String(values.title||'').trim();if(!title){new Notice(tr("请填写事项名称"));return false;}
    const due=String(values.due||'').trim(),dueTime=String(values.dueTime||'').trim();
    if(dueTime&&!due){new Notice(tr("填写 DDL 时间前，请先选择日期"));return false;}
    let course=this.courses.includes(values.course)?values.course:'';
    const lessonPath=String(values.lessonPath||'').trim();
    if(lessonPath){const linked=this.courses.find(item=>lessonPath.startsWith(`${ROOT}/${item}/`));if(linked)course=linked;}
    const task={title,description:String(values.description||'').trim(),due,dueTime:due?dueTime:'',course,lessonPath,minutes:estimateMinutes({...values,title,kind:'task'},this.state.completionHistory),source:course||values.source||existing?.source||'手动录入',pinned:values.pinned===undefined?!!existing?.pinned:!!values.pinned};
    if(existing)Object.assign(existing,task);else this.state.tasks.push({...task,id:crypto.randomUUID(),status:'unfinished',done:false,createdAt:now()});
    await this.save();await this.updateRollingSchedule();
    return true;
  }
  async deleteTask(existing){
    const task=this.state.tasks.find(item=>item.id===existing.id);if(!task)return;
    const previousTasks=this.state.tasks,previousSlots=this.state.slots;
    this.state.tasks=previousTasks.filter(item=>item.id!==task.id);
    this.state.slots=previousSlots.filter(slot=>slot.taskId!==task.id);
    try{await this.save();}
    catch(error){this.state.tasks=previousTasks;this.state.slots=previousSlots;throw error;}
    try{await this.updateRollingSchedule();}
    catch(error){console.warn('Learning Hub task deletion schedule refresh:',error);new Notice(tr('待办已删除，但日程更新失败，可稍后手动更新。'));}
    for(const leaf of this.app.workspace.getLeavesOfType(MAIN))if(['tasks','schedule'].includes(leaf.view?.page))await leaf.view.render();
    new Notice(tr('已删除待办《{0}》。',[task.title]));
  }
  async saveTasks(valuesList){
    if(!Array.isArray(valuesList)||!valuesList.length||valuesList.length>30){new Notice(tr("请选择 1–30 项待办"));return false;}
    const knownCourses=this.coursesForSemester();
    const knownLessons=new Set(knownCourses.flatMap(course=>this.lessons(course).map(file=>file.path)));
    const tasks=[];
    for(const [index,values] of valuesList.entries()){
      const title=String(values.title||'').trim(),due=String(values.due||'').trim(),dueTime=String(values.dueTime||'').trim();
      if(!title){new Notice(tr("请填写第 {0} 项的名称", [index+1]));return false;}
      if(due&&!validDate(due)){new Notice(tr("第 {0} 项的 DDL 日期无效", [index+1]));return false;}
      if(dueTime&&(!due||!/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime))){new Notice(tr("第 {0} 项的 DDL 时间无效", [index+1]));return false;}
      const lessonPath=knownLessons.has(values.lessonPath)?values.lessonPath:'';
      let course=knownCourses.includes(values.course)?values.course:'';
      if(lessonPath){const linked=knownCourses.find(item=>lessonPath.startsWith(`${ROOT}/${item}/`));if(linked)course=linked;}
      const task={title,description:String(values.description||'').trim(),due,dueTime,course,lessonPath,minutes:estimateMinutes({...values,title,kind:'task'},this.state.completionHistory),source:course||'DeepSeek 对话',pinned:!!values.pinned};
      tasks.push({...task,id:crypto.randomUUID(),status:'unfinished',done:false,createdAt:now()});
    }
    this.state.tasks.push(...tasks);
    try{await this.save();}
    catch(error){this.state.tasks=this.state.tasks.filter(task=>!tasks.includes(task));throw error;}
    try{await this.updateRollingSchedule();}catch(error){console.warn('Learning Hub task replan:',error);new Notice(tr("待办已添加，日程更新失败，可稍后手动更新。"));}
    return true;
  }
  addReminder(){new EntryModal(this.app,tr("添加提醒"),[{key:'title',label:tr("事项")},{key:'at',label:tr("时间"),type:'datetime-local'},{key:'source',label:tr("来源"),placeholder:tr("邮件标题 / 课程通知 / 手动")}],async v=>{this.state.reminders.push({...v,id:crypto.randomUUID(),done:false});await this.save();}).open();}
  addSlot(){new EntryModal(this.app,tr("安排时间段"),[{key:'title',label:tr("要做什么")},{key:'start',label:tr("开始"),type:'datetime-local'},{key:'end',label:tr("结束"),type:'datetime-local'}],async v=>{if(!v.start||!v.end||v.end<=v.start||v.start.slice(0,10)!==v.end.slice(0,10)){new Notice(tr("请选择同一天内有效的开始和结束时间"));return;}const date=v.start.slice(0,10),weekday=new Date(`${date}T12:00`).getDay();const rest=expandRestBlocks(this.state.ai.restBlocks||[],[date]).find(block=>v.start<block.end&&block.start<v.end);if(rest){new Notice(tr("该时段已标记为休息，不能安排内容"));return;}const weekly=(this.state.ai.fixedBlocks||[]).filter(row=>Number(row.day)===weekday).map(row=>({title:row.title,start:`${date}T${row.start}`,end:`${date}T${row.end}`}));const conflicts=[...this.allScheduleSlots({busyOnly:true}),...weekly].filter(s=>v.start<s.end&&s.start<v.end);if(conflicts.length){new Notice(tr("与「{0}」冲突，请换一个时间。", [conflicts[0].title]));return;}this.state.slots.push({...v,id:crypto.randomUUID(),fixed:false,source:'manual',status:'unfinished'});await this.save();await this.updateRollingSchedule();}).open();}
  async markStage(file,key,completedAt=now()){
    const flow=await this.readFlow(file);
    if(key==='previewed')flow.milestones.previewedAt=flow.milestones.previewedAt||completedAt;
    if(key==='learned')flow.milestones.learnedAt=flow.milestones.learnedAt||completedAt;
    await this.saveFlow(file,flow,true);
    try{await this.studyProgress?.setStage(file,key,true);}catch(e){console.warn('Learning Hub Study Progress sync:',e);}
    this.celebrateStage={path:file.path,key,until:Date.now()+1600};
    this.refreshBlocks();
    if(key==='learned'||key==='previewed')void this.updateRollingSchedule().catch(error=>console.warn('Learning Hub learning replan:',error));
  }
  async confirmLearning(file){
    const flow=await this.readFlow(file);
    if(flow.milestones.learnedAt){new Notice(tr("已确认完成课堂学习"));return;}
    new ConfirmModal(this.app,tr("确认课堂学习"),tr("确认你已经在唯一主笔记中完成本讲学习与课堂补充。复习日期将按实际完成日期计算。"),tr("确认完成"),async({date})=>{await this.markStage(file,'learned',new Date(`${date}T12:00:00`).toISOString());new Notice(tr("已安排第 1 / 7 / 21 天复习"));},{askDate:true}).open();
  }
  renderSchedule(el){
    el.empty();el.addClass('learning-hub','lh-schedule');
    this.header(el,tr("SCHEDULE"),tr("完整日程"),tr("显示接下来 7 天的日程；逾期未完成事项单独保留。Tut / Lab 默认不参加，可在下方选择。"));
    const top=el.createDiv({cls:'lh-schedule-actions'});
    const generate=top.createEl('button',{text:this.scheduleAnalysis?tr("正在生成日程草案…"):tr("AI 生成 7 天草案"),cls:'lh-primary'});generate.disabled=!!this.scheduleAnalysis;generate.onclick=()=>this.generateScheduleDraft(generate);
    const availability=top.createEl('button',{text:tr("设置可学习时间与休息安排"),cls:'lh-secondary'});availability.onclick=()=>new StudyAvailabilityModal(this).open();
    const refresh=top.createEl('button',{text:tr("更新滚动日程"),cls:'lh-secondary'});refresh.onclick=async()=>{refresh.disabled=true;try{const result=await this.updateRollingSchedule();new Notice(result.added?tr("已新增 {0} 个学习时段。", [result.added]):tr("现有安排已是最新。"));}catch(error){new Notice(tr("更新失败：{0}", [error.message]));}finally{refresh.disabled=false;}};
    const add=top.createEl('button',{text:tr("＋ 安排时间段"),cls:'lh-secondary'});add.onclick=()=>this.addSlot();
    if(this.state.googleCalendar.tokens){const sync=top.createEl('button',{text:tr("同步 Google Calendar"),cls:'lh-secondary'});sync.onclick=async()=>{sync.disabled=true;try{await this.syncGoogleCalendar();}catch(_){}finally{sync.disabled=false;}};}
    this.navText(top,tr("返回主页"),HOME);
    if(this.scheduleAnalysis)this.renderScheduleProgress(el,this.scheduleAnalysis);
    const calendar=this.state.googleCalendar;
    if(calendar.tokens)el.createDiv({text:calendar.error?tr("Google Calendar 上次同步失败：{0}；已显示缓存日程。", [calendar.error]):calendar.syncedAt?tr("Google Calendar · {0} 项 · 更新于 {1}", [calendar.events.length, new Date(calendar.syncedAt).toLocaleString(uiLocale())]):tr("Google Calendar 正在等待首次同步"),cls:'lh-calendar-status'});
    if(this.state.unscheduledTasks?.length)el.createDiv({text:tr("有 {0} 项任务尚未找到满足截止时间的空档，请检查可用时间或 DDL。", [this.state.unscheduledTasks.length]),cls:'lh-draft-conflict'});
    if(this.state.scheduleDraft)this.renderScheduleDraft(el);
    const endDay=addDays(today(),7);
    const currentTime=localNow();
    const all=this.allScheduleSlots().filter(s=>s.start>=`${today()}T00:00`&&s.start<`${endDay}T00:00`&&!scheduleItemState(s,{choices:this.state.calendarChoices,outcomes:this.state.eventOutcomes,tasks:this.state.tasks,now:currentTime}).hidden).sort((a,b)=>a.start.localeCompare(b.start));
    el.createDiv({text:tr("{0} — {1} · 共 {2} 项", [today(), addDays(endDay,-1), all.length]),cls:'lh-schedule-range'});
    const overdue=this.overdueScheduleSlots();
    if(overdue.length){const panel=el.createDiv({cls:'lh-panel lh-overdue-panel'});const head=panel.createDiv({cls:'lh-section-title'});head.createEl('h2',{text:tr("逾期未完成")});head.createSpan({text:tr("{0} 项 · 完成后自动移出", [overdue.length])});for(const item of overdue)this.slotRow(panel,item);}
    const agenda=el.createDiv({cls:'lh-panel lh-agenda'});
    if(!all.length)agenda.createDiv({text:tr("这 7 天没有已确定的日程。"),cls:'lh-empty'});
    const showGap=(from,to)=>{if(from>to)return;agenda.createDiv({text:from===to?tr("{0} · 暂无已确定日程", [from]):tr("{0} — {1} · 暂无已确定日程", [from, to]),cls:'lh-agenda-gap'});};
    let last=addDays(today(),-1),group;for(const s of all){const day=s.start.slice(0,10);if(day!==last){showGap(addDays(last,1),addDays(day,-1));group=agenda.createDiv({cls:'lh-agenda-day'});group.createEl('h2',{text:day,cls:'lh-day'});last=day;}this.slotRow(group,s);}
    if(all.length)showGap(addDays(last,1),addDays(endDay,-1));
  }
  async refreshScheduleViews(){
    for(const leaf of this.app.workspace.getLeavesOfType(MAIN))if(leaf.view?.page==='schedule')await leaf.view.render();
  }
  renderScheduleProgress(host,analysis){
    const progress=host.createDiv({cls:'lh-preview-generating lh-schedule-progress',attr:{role:'status','aria-live':'polite'}});
    progress.createSpan({cls:'lh-analysis-spinner'});progress.createDiv({text:tr("正在安排未来 7 天"),cls:'lh-preview-generating-title'});
    const steps=progress.createDiv({cls:'lh-preview-progress-steps'});analysis.stepEls=[tr("读取日程"),tr("AI 排程"),tr("检查冲突")].map(label=>steps.createSpan({text:label}));
    analysis.statusEl=progress.createEl('p',{cls:'lh-preview-stage'});analysis.elapsedEl=progress.createEl('p',{cls:'lh-preview-elapsed'});analysis.usageEl=progress.createEl('p',{cls:'lh-preview-usage'});
    const reasoning=progress.createDiv({cls:'lh-preview-reasoning'}),head=reasoning.createDiv({cls:'lh-preview-reasoning-head'});
    head.createDiv({text:tr("思考摘要"),cls:'lh-preview-reasoning-label'});
    const thinking=head.createDiv({cls:'lh-preview-thinking',attr:{'aria-label':tr("正在思考")}});thinking.createSpan({text:tr("思考中")});
    const dots=thinking.createSpan({cls:'lh-preview-thinking-dots',attr:{'aria-hidden':'true'}});for(let index=0;index<3;index++)dots.createSpan({cls:'lh-preview-thinking-dot'});
    analysis.reasoningEl=reasoning.createDiv({cls:'lh-preview-reasoning-text lh-preview-markdown lh-schedule-reasoning',text:tr("AI 的进度摘要会在生成过程中更新。"),attr:{'aria-live':'polite'}});
    this.updateScheduleProgress(analysis);
  }
  updateScheduleProgress(analysis){
    if(!analysis)return;
    const stages={
      syncing:tr("正在同步日历并读取忙碌时段…"),preparing:tr("正在整理任务与可用时间…"),queued:tr("等待 Codex 任务开始…"),
      connecting:tr("正在连接 Codex…"),starting:tr("正在提交日程规划…"),generating:tr("Codex 正在安排任务…"),
      thinking:tr("Codex 正在分析任务优先级…"),receiving:tr("Codex 正在返回日程草案…"),validating:tr("正在检查草案中的时间冲突…"),
    };
    analysis.statusEl?.setText(stages[analysis.phase]||stages.preparing);
    const step=analysis.phase==='syncing'||analysis.phase==='preparing'?0:analysis.phase==='validating'?2:1;
    for(const [index,element] of (analysis.stepEls||[]).entries()){
      element.classList.toggle('is-done',index<step);element.classList.toggle('is-active',index===step);
    }
    const seconds=Math.floor((Date.now()-analysis.startedAt)/1000),duration=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    const model=this.state.ai.model||tr("Codex 默认"),effort=this.state.ai.effort||tr("模型默认");
    const received=analysis.receivedChars?tr(" · 已接收 {0} 字符",[analysis.receivedChars.toLocaleString()]):'';
    analysis.elapsedEl?.setText(tr("已用时 {0}{1} · {2} / {3}",[duration,received,model,effort]));
    analysis.usageEl?.setText(analysis.tokenUsage?formatCodexUsage(analysis.tokenUsage):'');
    if(analysis.reasoningSummary)this.renderScheduleReasoning(analysis);
  }
  renderScheduleReasoning(analysis){
    const host=analysis?.reasoningEl;if(!host)return;
    let markdown=formatPreviewMarkdown(analysis.reasoningSummary||'').trim();
    if(!markdown)return;
    const strong=[...markdown.matchAll(/\*\*/g)];
    if(strong.length%2){const index=strong.at(-1).index;markdown=markdown.slice(0,index)+markdown.slice(index+2);}
    if(markdown===analysis.reasoningQueuedSource)return;
    analysis.reasoningQueuedSource=markdown;
    clearTimeout(analysis.reasoningRenderTimer);
    const version=(analysis.reasoningRenderVersion||0)+1;analysis.reasoningRenderVersion=version;
    analysis.reasoningRenderTimer=setTimeout(async()=>{
      const staging=document.createElement('div');
      try{
        if(MarkdownRenderer?.render)await MarkdownRenderer.render(this.app,markdown,staging,'',this);
        else if(MarkdownRenderer?.renderMarkdown)await MarkdownRenderer.renderMarkdown(markdown,staging,'',this);
        else staging.textContent=markdown.replace(/\*\*(.*?)\*\*/gs,'$1');
      }catch(error){console.warn('Learning Hub schedule reasoning summary:',error);staging.textContent=markdown.replace(/\*\*(.*?)\*\*/gs,'$1');}
      if(version!==analysis.reasoningRenderVersion||host!==analysis.reasoningEl)return;
      host.replaceChildren(...staging.childNodes);
    },100);
  }
  async reviewScheduleTasks(){
    const tasks=[];
    for(const course of this.courses)for(const lesson of this.lessons(course)){
      if(!this.scope(lesson,course))continue;
      const flow=await this.readFlow(lesson);
      for(const round of this.reviewPlan(flow))if(round.unlocked&&!round.completedAt)tasks.push({id:`review:${lesson.path}:${round.round}`,title:`${course.split(' - ')[0]} ${lesson.basename} · 第 ${round.round} 轮复习`,minutes:[10,15,20][round.round-1],due:round.due<today()?today():round.due,source:'间隔复习',kind:'review',lessonPath:lesson.path,course,round:round.round});
    }
    return tasks;
  }
  async generateScheduleDraft(button){
    if(this.scheduleAnalysis)return;
    const buttonLabel=button?.getText();
    if(button){button.disabled=true;button.setText(tr("正在生成日程草案…"));}
    const analysis=this.scheduleAnalysis={phase:'syncing',startedAt:Date.now(),receivedChars:0,tokenUsage:null,reasoningSummary:'',reasoningIndex:null};
    analysis.timer=setInterval(()=>this.updateScheduleProgress(analysis),1000);
    try{
      await this.refreshScheduleViews();
      if(this.state.googleCalendar.tokens)await this.syncGoogleCalendar({quiet:true});
      analysis.phase='preparing';this.updateScheduleProgress(analysis);
      const request=await this.scheduleInputs();
      if(!request.tasks.length&&!request.mealRequirements.length){new Notice(tr("请先添加待办或完成待复习讲次；当前没有可排的任务或用餐时间。"));return;}
      analysis.phase='queued';this.updateScheduleProgress(analysis);
      const raw=await this.runAi(request.prompt,request.schema,{
        onStatus:phase=>{analysis.phase=phase;this.updateScheduleProgress(analysis);},
        onProgress:delta=>{analysis.receivedChars+=String(delta||'').length;this.updateScheduleProgress(analysis);},
        onTokenUsage:usage=>{analysis.tokenUsage=usage;this.updateScheduleProgress(analysis);},
        onReasoningSummary:(delta,index)=>{if(typeof index==='number'&&analysis.reasoningIndex!==index)analysis.reasoningSummary='';if(typeof index==='number')analysis.reasoningIndex=index;analysis.reasoningSummary+=String(delta||'');this.updateScheduleProgress(analysis);},
      });
      analysis.phase='validating';this.updateScheduleProgress(analysis);
      const draft=validateScheduleDraft(raw,request);
      this.state.scheduleDraft={request:{...request,prompt:undefined,schema:undefined},draft,createdAt:now()};
      await this.saveData(this.state);
      clearInterval(analysis.timer);this.scheduleAnalysis=null;
      await this.open(SCHEDULE);
      for(const leaf of this.app.workspace.getLeavesOfType(MAIN))if(leaf.view?.page==='schedule')await leaf.view.render();
      new Notice(draft.valid?tr("AI 日程草案已生成，请核对后采用。"):tr("草案有时间冲突，请检查或重新生成。"));
    }catch(error){console.error('Learning Hub schedule AI:',error);new Notice(tr("日程草案未生成：{0}", [error.message]));}
    finally{clearInterval(analysis.timer);clearTimeout(analysis.reasoningRenderTimer);analysis.reasoningRenderVersion=(analysis.reasoningRenderVersion||0)+1;if(this.scheduleAnalysis===analysis)this.scheduleAnalysis=null;if(button?.isConnected){button.disabled=false;button.setText(buttonLabel||tr("AI 生成 7 天草案"));}await this.refreshScheduleViews();}
  }
  renderScheduleDraft(el){
    const saved=this.state.scheduleDraft,{draft,request}=saved;
    const panel=el.createDiv({cls:'lh-panel lh-schedule-draft'});
    const head=panel.createDiv({cls:'lh-section-title'});head.createEl('h2',{text:tr("待确认的 AI 日程")});head.createSpan({text:`${request.startDate} — ${request.endDate}`});
    const body=panel.createDiv({cls:'lh-schedule-draft-body'});
    body.createEl('p',{text:draft.summary||tr("AI 未提供安排摘要。"),cls:'lh-section-description'});
    const compatible=Array.isArray(draft.systemSlots);if(!compatible)body.createDiv({text:tr("此草案缺少系统用餐安排，请舍弃并重新生成。"),cls:'lh-draft-conflict'});
    for(const item of draft.conflicts||[])body.createDiv({text:tr("冲突：{0}", [item.message]),cls:'lh-draft-conflict'});
    for(const item of draft.warnings||[])body.createDiv({text:tr("提醒：{0}", [item.message]),cls:'lh-flow-muted'});
    if(draft.systemSlots?.length){body.createEl('strong',{text:tr("系统日程 · 用餐时间"),cls:'lh-schedule-system-heading'});for(const slot of draft.systemSlots){const row=body.createDiv({cls:'lh-draft-slot is-system'});row.createSpan({text:`${slot.start.slice(5).replace('T',' ')}–${slot.end.slice(11)}`});row.createEl('strong',{text:slot.title});row.createSpan({text:tr("系统用餐安排 · 无需标记完成")});}}
    for(const slot of draft.slots||[]){const row=body.createDiv({cls:'lh-draft-slot'});row.createSpan({text:`${slot.start.slice(5).replace('T',' ')}–${slot.end.slice(11)}`});row.createEl('strong',{text:slot.title});row.createSpan({text:slot.reason||''});}
    for(const item of draft.unscheduled||[])body.createDiv({text:tr("未安排：{0} · {1}", [item.title, item.reason]),cls:'lh-flow-muted'});
    const actions=body.createDiv({cls:'lh-confirm-actions'});
    const accept=actions.createEl('button',{text:tr("确认并应用日程"),cls:'lh-primary'});accept.disabled=!draft.valid||!compatible;
    accept.onclick=()=>new ConfirmModal(this.app,tr("确认 AI 日程"),tr("确认后将替换这 7 天内此前由 AI 安排的学习时段和系统用餐安排；手动录入的日程会保留。"),tr("确认应用"),async()=>{
      if(this.state.googleCalendar.tokens)await this.syncGoogleCalendar({quiet:true});
      const updated=await this.scheduleInputs(request.startDate,request.dates.length);
      const fresh=validateScheduleDraft({slots:draft.slots,systemSlots:draft.systemSlots,unscheduled:draft.unscheduled,summary:draft.summary},updated);
      if(!fresh.valid)throw new Error(tr("日程已变化：{0}", [fresh.conflicts[0].message]));
      this.state.slots=acceptScheduleDraft(this.state.slots,fresh,updated);
      this.state.aiSummary={text:draft.summary,date:today()};
      delete this.state.scheduleDraft;await this.save();
      for(const leaf of this.app.workspace.getLeavesOfType(MAIN))if(leaf.view?.page==='schedule')await leaf.view.render();
    }).open();
    const discard=actions.createEl('button',{text:tr("舍弃草案")});discard.onclick=async()=>{delete this.state.scheduleDraft;await this.saveData(this.state);for(const leaf of this.app.workspace.getLeavesOfType(MAIN))if(leaf.view?.page==='schedule')await leaf.view.render();};
  }
  renderTasks(el){
    el.empty();el.addClass('learning-hub','lh-tasks');this.header(el,tr("TO DO"),tr("待办事项"),tr("写下事项与可选说明、DDL；系统估算用时并纳入未来 7 天日程。"));
    const top=el.createDiv({cls:'lh-schedule-actions'});const add=top.createEl('button',{text:tr("＋ 添加待办"),cls:'lh-primary'});add.onclick=()=>this.addTask();const ai=top.createEl('button',{text:tr("和 AI 对话添加"),cls:'lh-secondary'});ai.onclick=()=>new TaskIntakeModal(this).open();this.navText(top,tr("查看完整日程 →"),SCHEDULE);this.navText(top,tr("查看复盘 →"),RETROSPECT);
    const all=[...this.state.tasks].sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
    for(const [label,items] of [[tr("待完成"),all.filter(t=>taskStatus(t)==='unfinished')],[tr("已完成"),all.filter(t=>taskStatus(t)!=='unfinished')]]){
      const list=el.createDiv({cls:'lh-panel lh-task-list'});const head=list.createDiv({cls:'lh-section-title'});head.createEl('h2',{text:label});head.createSpan({text:String(items.length)});
      if(!items.length)list.createDiv({text:label===tr("待完成")?tr("当前没有待办。"):tr("尚无完成记录。"),cls:'lh-empty'});
      for(const task of items)this.taskRow(list,task);
    }
  }
  renderRetrospect(el){
    el.empty();el.addClass('learning-hub','lh-retrospect');this.header(el,tr("LEARNING REVIEW"),tr("学习复盘"),tr("回看这一年的学习节奏，点选日期查看当天完成的事。"));
    const history=this.state.completionHistory||[],byDay=new Map();
    for(const item of history){const date=item.completedAt?.slice(0,10);if(!date)continue;const list=byDay.get(date)||[];list.push(item);byDay.set(date,list);}
    const selected=this.reviewSelectedDay||today(),items=byDay.get(selected)||[];
    const summary=el.createDiv({cls:'lh-review-summary'});
    const recent=history.filter(item=>item.completedAt?.slice(0,10)>=addDays(today(),-6));
    const activeDays=new Set(recent.map(item=>item.completedAt?.slice(0,10)).filter(Boolean)).size;
    for(const [label,value,note] of [[tr("近 7 天完成"),recent.length,tr("课程与事项")],[tr("活跃天数"),activeDays,tr("最近 7 天")],[tr("按时完成"),recent.filter(item=>item.kind!=='class'&&item.status==='on-time').length,tr("最近 7 天")],[tr("晚于计划"),recent.filter(item=>item.kind!=='class'&&item.status==='late').length,tr("用于校准用时")]]){
      const card=summary.createDiv({cls:'lh-review-stat'});card.createSpan({text:label,cls:'lh-review-stat-label'});card.createEl('strong',{text:String(value)});card.createSpan({text:note,cls:'lh-review-stat-note'});
    }
    const layout=el.createDiv({cls:'lh-review-layout'});
    const detail=layout.createDiv({cls:'lh-panel lh-review-day'});
    const detailHead=detail.createDiv({cls:'lh-review-panel-head'});detailHead.createSpan({text:tr("DAY IN REVIEW"),cls:'lh-review-kicker'});detailHead.createEl('h2',{text:selected===today()?tr("今天完成了什么"):selected});detailHead.createSpan({text:tr("{0} 项完成", [items.length]),cls:'lh-review-head-count'});
    if(!items.length){const empty=detail.createDiv({cls:'lh-review-empty'});empty.createSpan({text:'○',cls:'lh-review-empty-mark'});empty.createEl('strong',{text:tr("这一天还没有完成记录")});empty.createEl('p',{text:tr("课程结束或完成日程、待办后，记录会出现在这里。")});}
    for(const item of items){const isClass=item.kind==='class',status=isClass?'on-time':item.status,row=detail.createDiv({cls:'lh-review-entry'});row.createSpan({text:status==='late'?tr("未按时"):tr("按时"),cls:`lh-review-badge is-${status}`});const body=row.createDiv({cls:'lh-review-entry-body'});body.createEl('strong',{text:this.itemDisplayTitle(item)});const calendarEvent=isClass?item:item.kind==='calendar'?[...(this.state.googleCalendar?.events||[]),...(this.state.googleCalendar?.pendingEvents||[])].find(event=>event.id===item.id):item.kind==='slot'?(this.state.slots||[]).find(slot=>slot.id===item.id):null;const start=item.start||calendarEvent?.start||'',end=item.end||calendarEvent?.end||'';const duration=start&&end?Math.max(0,Math.round((new Date(end)-new Date(start))/60000)):0;const detailText=start&&end?tr("{0}–{1} · {2} 分钟", [start.slice(11,16), end.slice(11,16), duration]):item.actualMinutes?tr("实际 {0} 分钟{1}", [item.actualMinutes, item.estimatedMinutes?tr(" · 预计 {0} 分钟", [item.estimatedMinutes]):'']):tr("未记录实际用时");body.createSpan({text:detailText});}
    const detailFoot=detail.createDiv({cls:'lh-review-panel-foot'});this.navText(detailFoot,tr("查看待办事项 →"),TASKS);
    const activity=layout.createDiv({cls:'lh-panel lh-review-card'});
    const activityHead=activity.createDiv({cls:'lh-review-panel-head'});activityHead.createSpan({text:tr("ACTIVITY"),cls:'lh-review-kicker'});activityHead.createEl('h2',{text:tr("学习活动")});activityHead.createSpan({text:tr("按季度查看"),cls:'lh-review-head-count'});
    const quarters=activity.createDiv({cls:'lh-review-quarters'});
    const current=new Date(),currentQuarter=Math.floor(current.getMonth()/3),currentKey=`${current.getFullYear()}-${currentQuarter}`;
    const activeKey=this.reviewActiveQuarter??currentKey;
    for(let offset=0;offset<4;offset++){
      const qDate=new Date(current.getFullYear(),currentQuarter*3-offset*3,1),year=qDate.getFullYear(),quarter=Math.floor(qDate.getMonth()/3),key=`${year}-${quarter}`;
      const first=`${year}-${pad(quarter*3+1)}-01`,lastDate=new Date(year,quarter*3+3,0),last=`${year}-${pad(lastDate.getMonth()+1)}-${pad(lastDate.getDate())}`;
      let count=0,days=0;for(const [date,rows] of byDay)if(date>=first&&date<=last){count+=rows.length;days++;}
      const section=quarters.createDiv({cls:`lh-review-quarter${key===activeKey?' is-open':''}`});
      const toggle=section.createEl('button',{cls:'lh-review-quarter-toggle',attr:{type:'button','aria-expanded':String(key===activeKey)}});
      toggle.createSpan({text:`${year} · Q${quarter+1}`,cls:'lh-review-quarter-name'});
      toggle.createSpan({text:tr("{0} 天活跃 · {1} 项完成", [days, count]),cls:'lh-review-quarter-meta'});
      toggle.createSpan({text:key===activeKey?'⌃':'⌄',cls:'lh-review-quarter-chevron'});
      toggle.onclick=()=>{this.reviewActiveQuarter=key===activeKey?'':key;this.renderRetrospect(el);};
      if(key!==activeKey)continue;
      const panel=section.createDiv({cls:'lh-review-quarter-body'});
      const labels=panel.createDiv({cls:'lh-review-weekdays'});for(const day of [tr("一"),tr("二"),tr("三"),tr("四"),tr("五"),tr("六"),tr("日")])labels.createSpan({text:day});
      const grid=panel.createDiv({cls:'lh-review-grid'});
      const firstWeekday=(new Date(`${first}T12:00`).getDay()+6)%7;
      const from=addDays(first,-firstWeekday),lastWeekday=(new Date(`${last}T12:00`).getDay()+6)%7,to=addDays(last,6-lastWeekday);
      const weeks=Math.floor((new Date(`${to}T12:00`)-new Date(`${from}T12:00`))/86400000/7)+1;
      grid.style.setProperty('--lh-review-weeks',String(weeks));
      for(let index=0;index<weeks*7;index++){
        const date=addDays(from,index);
        if(date<first||date>last){grid.createSpan({cls:'lh-review-cell is-outside'});continue;}
        const dayCount=(byDay.get(date)||[]).length;
        const cell=grid.createEl('button',{cls:`lh-review-cell is-level-${Math.min(4,dayCount)}${date===selected?' is-selected':''}`,attr:{type:'button',title:tr("{0} · 完成 {1} 项", [date, dayCount]),'aria-label':tr("{0} 完成 {1} 项", [date, dayCount])}});
        if(date>today()){cell.disabled=true;cell.addClass('is-future');}
        else cell.onclick=()=>{this.reviewSelectedDay=date;this.renderRetrospect(el);};
      }
      const scale=panel.createDiv({cls:'lh-review-scale'});scale.createSpan({text:tr("少")});for(let level=0;level<=4;level++)scale.createSpan({cls:`lh-review-scale-cell is-level-${level}`});scale.createSpan({text:tr("多")});
    }
  }
  renderHomeworkStatus(el,assignment){
    const labels={queued:tr("等待 AI 分析"),extracting:tr("正在提取作业文字"),organizing:tr("正在整理完整题目"),analyzing:tr("正在分析难度与知识点")};
    const status=assignment.analysisStatus;
    if(labels[status]){
      const interrupted=!this.homeworkRunning?.has(assignment.id)&&status!=='queued';
      const progress=this.homeworkProgress?.get(assignment.id);
      if(!interrupted&&progress&&(status==='organizing'||status==='analyzing')){
        const line=el.createDiv({cls:'lh-homework-analysis-line'});line.createSpan({cls:'lh-analysis-spinner'});line.createSpan({text:labels[status],cls:'lh-analysis-label'});
        progress.elapsedEl=el.createDiv({cls:'lh-homework-progress-detail'});
        progress.usageEl=el.createDiv({cls:'lh-homework-progress-usage'});
        const reasoning=el.createDiv({cls:'lh-homework-reasoning'});reasoning.createDiv({text:tr("思考摘要"),cls:'lh-homework-reasoning-title'});
        progress.reasoningEl=reasoning.createDiv({cls:'lh-homework-reasoning-body markdown-rendered'});
        this.updateHomeworkProgress(progress);this.renderHomeworkReasoning(progress);
        return;
      }
      const line=el.createDiv({cls:'lh-homework-analysis-line'});
      if(!interrupted)line.createSpan({cls:'lh-analysis-spinner'});
      line.createSpan({text:interrupted?tr("上次分析已中断，可重新分析。"):labels[status],cls:'lh-analysis-label'});
      if(progress){progress.elapsedEl=el.createDiv({cls:'lh-homework-progress-detail'});this.updateHomeworkProgress(progress);}
      if(interrupted){const retry=el.createEl('button',{text:tr("重新分析")});retry.onclick=()=>void this.analyzeHomework(assignment.course,assignment.id).catch(error=>new Notice(error.message));}
    }else if(status==='failed'){
      el.createSpan({text:tr("分析失败：{0}", [assignment.analysisError||tr("未知原因")]),cls:'lh-assignment-warning'});
      const retry=el.createEl('button',{text:tr("重新分析")});retry.onclick=()=>void this.analyzeHomework(assignment.course,assignment.id).catch(error=>new Notice(error.message));
    }else if(status==='complete')el.createSpan({text:tr("题目与知识点已整理"),cls:'lh-analysis-done'});
    else{el.createSpan({text:tr("尚未进行 AI 分析")});const retry=el.createEl('button',{text:tr("分析作业")});retry.onclick=()=>void this.analyzeHomework(assignment.course,assignment.id).catch(error=>new Notice(error.message));}
  }
  async renderHomeworkQuestions(card,course,assignment){
    if(assignment.analysisStatus!=='complete')return;
    const analysis=await this.readHomeworkAnalysis(course,assignment.id);
    if(!analysis?.questions?.length){card.createDiv({text:tr("整理结果暂不可用，请重新分析。"),cls:'lh-assignment-warning'});return;}
    this.homeworkOpenDetails||=new Set();
    const section=card.createEl('details',{cls:'lh-homework-questions'});
    section.open=this.homeworkOpenDetails.has(assignment.id);
    const summary=section.createEl('summary');
    summary.createSpan({text:tr("查看详情")});
    summary.createSpan({text:tr("{0} 道题", [analysis.questions.length]),cls:'lh-homework-question-count'});
    let rendered=false;
    const render=()=>{if(!section.open){this.homeworkOpenDetails.delete(assignment.id);return;}this.homeworkOpenDetails.add(assignment.id);if(rendered)return;rendered=true;void this.renderHomeworkQuestionList(section,course,assignment,analysis.questions).catch(error=>{console.error('Learning Hub homework rendering:',error);section.createDiv({text:tr("题目显示失败，请关闭详情后重试。"),cls:'lh-assignment-warning'});rendered=false;});};
    section.addEventListener('toggle',render);
    if(section.open)render();
  }
  async renderHomeworkQuestionList(section,course,assignment,questions){
    const list=section.createDiv({cls:'lh-homework-question-list'});
    for(const question of questions){
      const row=list.createDiv({cls:'lh-homework-question'});
      const head=row.createDiv({cls:'lh-homework-question-head'});head.createEl('strong',{text:question.label});
      const selected=(assignment.wrongQuestionIds||[]).includes(question.id);
      const mark=head.createEl('button',{text:selected?tr("已标记错题 · 取消"):tr("标记为错题"),cls:selected?'is-wrong':''});
      mark.onclick=async()=>{mark.disabled=true;try{await this.setHomeworkWrongQuestion(course,assignment.id,question.id,!selected);}catch(error){new Notice(error.message);mark.disabled=false;}};
      const body=row.createDiv({cls:'lh-homework-question-body markdown-rendered'});
      try{if(MarkdownRenderer?.render)await MarkdownRenderer.render(this.app,question.markdown,body,this.homeworkContentPath(course,assignment.id),this);else if(MarkdownRenderer?.renderMarkdown)await MarkdownRenderer.renderMarkdown(question.markdown,body,this.homeworkContentPath(course,assignment.id),this);else body.setText(question.markdown);}
      catch(error){console.warn('Learning Hub homework Markdown:',error);body.setText(question.markdown);}
      if(question.topics?.length)row.createDiv({text:question.topics.join(' · '),cls:'lh-homework-question-topics'});
    }
  }
  async renderLabSection(el,course){
    const store=await this.readLabs(course),sorted=[...store.labs].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    const section=el.createDiv({cls:'lh-assignment-section'});
    const heading=section.createDiv({cls:'lh-assignment-section-head'});heading.createEl('h2',{text:tr("Lab Sessions · 可选")});heading.createSpan({text:tr("{0} 份", [sorted.length])});
    const introduction=section.createDiv({cls:'lh-assignment-section-intro'});
    introduction.createEl('p',{text:tr("上传 PDF、Markdown 或 TXT 课件，AI 整理实验目标、步骤和提交要求；这里不记录错题。"),cls:'lh-section-description'});
    if(!sorted.length){introduction.createDiv({text:tr("这门课程还没有 Lab Session；没有实验课可以留空。"),cls:'lh-section-empty'});return;}
    const list=section.createDiv({cls:'lh-assignment-list'});
    for(const lab of sorted){
      const card=list.createDiv({cls:'lh-assignment-card'});
      const top=card.createDiv({cls:'lh-assignment-card-head'}),identity=top.createDiv({cls:'lh-assignment-identity'});
      identity.createEl('h3',{text:lab.title});
      identity.createSpan({text:tr("{0} · {1} 个文件{2}{3}", [lab.lessonPath?.split('/').at(-1)?.replace(/\.md$/,'')||tr("整个课程"), lab.files?.length||0, lab.due?tr(" · 截止 {0}", [lab.due]):'', lab.archivedAt?tr(" · 已归档"):''])});
      const status=card.createDiv({cls:'lh-homework-analysis-status'});
      const state=lab.analysisStatus;
      if(state==='extracting'||state==='analyzing'){
        if(this.labRunning?.has(lab.id))status.createSpan({cls:'lh-analysis-spinner'});
        status.createSpan({text:this.labRunning?.has(lab.id)?state==='extracting'?tr("正在提取课件文字"):tr("正在解析 Lab Session"):tr("上次解析已中断"),cls:'lh-analysis-label'});
      }else if(state==='complete')status.createSpan({text:tr("课件已解析"),cls:'lh-analysis-done'});
      else if(state==='failed')status.createSpan({text:tr("解析失败：{0}", [lab.analysisError||tr("未知原因")]),cls:'lh-assignment-warning'});
      else status.createSpan({text:tr("等待解析"),cls:'lh-analysis-label'});
      const topics=card.createDiv({cls:'lh-assignment-topics'});for(const topic of lab.topics||[])topics.createSpan({text:topic});
      const files=card.createDiv({cls:'lh-assignment-files'});for(const file of lab.files||[]){const link=files.createEl('button',{text:file.name,cls:'lh-assignment-file'});link.onclick=()=>this.open(file.path);}
      if(lab.importStatus==='partial')files.createSpan({text:tr("未导入：{0}", [(lab.failedFiles||[]).join('、')]),cls:'lh-assignment-warning'});
      if(state==='complete'){
        const details=card.createEl('details',{cls:'lh-homework-questions'}),summary=details.createEl('summary');summary.createSpan({text:tr("查看解析内容")});
        details.addEventListener('toggle',()=>{if(!details.open||details.dataset.loaded)return;details.dataset.loaded='1';void (async()=>{
          try{const markdown=await this.app.vault.adapter.read(this.labContentPath(course,lab.id));const body=details.createDiv({cls:'lh-homework-question-body markdown-rendered'});
            if(MarkdownRenderer?.render)await MarkdownRenderer.render(this.app,markdown,body,this.labContentPath(course,lab.id),this);
            else if(MarkdownRenderer?.renderMarkdown)await MarkdownRenderer.renderMarkdown(markdown,body,this.labContentPath(course,lab.id),this);
            else body.setText(markdown);
          }catch(error){details.createDiv({text:tr("无法显示解析内容：{0}", [error.message]),cls:'lh-assignment-warning'});delete details.dataset.loaded;}
        })();});
      }
      const controls=card.createDiv({cls:'lh-assignment-controls'});
      const edit=controls.createEl('button',{text:tr("编辑信息")});edit.onclick=()=>this.editLab(course,lab);
      const retry=controls.createEl('button',{text:state==='complete'?tr("重新解析"):tr("解析课件")});retry.disabled=!lab.files?.length||this.labRunning?.has(lab.id);retry.onclick=()=>void this.analyzeLab(course,lab.id).catch(error=>new Notice(error.message));
      const archive=controls.createEl('button',{text:lab.archivedAt?tr("移出归档"):tr("归档")});archive.onclick=()=>this.toggleLabArchive(course,lab.id);
      const remove=controls.createEl('button',{text:tr("删除 Lab Session"),cls:'lh-assignment-delete'});
      remove.onclick=()=>new ConfirmModal(this.app,tr("删除这份 Lab Session？"),tr("《{0}》的原文件会移入 Obsidian 回收站，解析内容转入隐藏的恢复目录。", [lab.title]),tr("确认删除"),()=>this.deleteLab(course,lab.id)).open();
    }
  }
  async renderAssignments(el,course){
    el.empty();el.addClass('learning-hub','lh-assignments');
    const short=course.split(' - ')[0],store=await this.readAssignments(course);
    this.header(el,tr("{0} / MATERIALS", [short]),tr("作业与 Lab Session"),tr("作业可整理题目并记录错题；Lab Session 可选，只解析课件。"));
    const actions=el.createDiv({cls:'lh-assignment-toolbar'});
    const upload=actions.createEl('button',{text:tr("＋ 上传作业"),cls:'lh-primary'});upload.onclick=()=>this.uploadHomework(course);
    const uploadLab=actions.createEl('button',{text:tr("＋ 上传 Lab Session"),cls:'lh-secondary'});uploadLab.onclick=()=>this.uploadLab(course);
    const back=actions.createEl('button',{text:tr("← 返回课程概览"),cls:'lh-text-link'});back.onclick=()=>this.openHub('course',course);
    const sorted=[...store.assignments].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    const sections=[[tr("在用作业"),sorted.filter(a=>!a.archivedAt)],[tr("已归档"),sorted.filter(a=>!!a.archivedAt)]];
    this.homeworkStatusEls=new Map();
    for(const [label,items] of sections){
      const section=el.createDiv({cls:'lh-assignment-section'});
      const heading=section.createDiv({cls:'lh-assignment-section-head'});heading.createEl('h2',{text:label});heading.createSpan({text:tr("{0} 份", [items.length])});
      if(!items.length){section.createDiv({text:label===tr("在用作业")?tr("还没有作业。上传后会保留原文件，复习时可按知识点选用。"):tr("暂无已归档的作业。"),cls:'lh-empty'});continue;}
      const list=section.createDiv({cls:'lh-assignment-list'});
      for(const assignment of items){
        const card=list.createDiv({cls:'lh-assignment-card'});
        const top=card.createDiv({cls:'lh-assignment-card-head'});
        const identity=top.createDiv({cls:'lh-assignment-identity'});identity.createEl('h3',{text:assignment.title});
        const linkedTask=this.state.tasks.find(task=>task.assignmentId===assignment.id||task.id===assignment.taskId);
        identity.createSpan({text:[tr("{0} · {1} 个文件", [assignment.lessonPath?.split('/').at(-1)?.replace(/\.md$/,'')||tr("整个课程"), assignment.files?.length||0]),assignment.due?tr("截止 {0}", [assignment.due]):'',linkedTask?tr("已同步到待办"):''].filter(Boolean).join(' · ')});
        if(assignment.difficulty)top.createSpan({text:tr("难度 {0}/5", [assignment.difficulty]),cls:'lh-assignment-difficulty'});
        assignment.course=course;
        const status=card.createDiv({cls:'lh-homework-analysis-status'});this.homeworkStatusEls.set(assignment.id,status);this.renderHomeworkStatus(status,assignment);
        const topics=card.createDiv({cls:'lh-assignment-topics'});
        for(const topic of assignment.topics||[])topics.createSpan({text:topic});
        if(!assignment.topics?.length)topics.createSpan({text:assignment.analysisStatus==='complete'?tr("暂无知识点"):tr("分析完成后显示知识点"),cls:'is-muted'});
        const files=card.createDiv({cls:'lh-assignment-files'});
        for(const file of assignment.files||[]){const link=files.createEl('button',{text:file.name,cls:'lh-assignment-file'});link.onclick=()=>this.open(file.path);}
        if(assignment.importStatus==='partial'||assignment.importStatus==='uploading')files.createSpan({text:assignment.importStatus==='partial'?tr("部分文件导入失败：{0}", [(assignment.failedFiles||[]).join('、')]):tr("文件导入中…"),cls:'lh-assignment-warning'});
        await this.renderHomeworkQuestions(card,course,assignment);
        const controls=card.createDiv({cls:'lh-assignment-controls'});
        const edit=controls.createEl('button',{text:tr("编辑信息")});edit.onclick=()=>this.editHomework(course,assignment);
        const archive=controls.createEl('button',{text:assignment.archivedAt?tr("移出归档"):tr("归档")});archive.onclick=()=>this.toggleHomeworkArchive(course,assignment.id);
        const remove=controls.createEl('button',{text:tr("删除作业"),cls:'lh-assignment-delete'});
        remove.onclick=()=>new ConfirmModal(this.app,tr("删除这份作业？"),tr("《{0}》的原文件会移入 Obsidian 回收站，整理结果转入隐藏的恢复目录，关联待办和未完成的日程安排也会移除，已标记的错题记录也会移除。", [assignment.title]),tr("确认删除"),()=>this.deleteHomework(course,assignment.id)).open();
      }
    }
    await this.renderLabSection(el,course);
  }
  async renderCourse(el,ctx){
    el.empty();el.addClass('learning-hub','lh-course-overview');
    const course=ctx.sourcePath?.slice(ROOT.length+1).split('/')[0];
    if(!course||!this.courses.includes(course)){el.createDiv({text:tr("无法识别课程。"),cls:'lh-empty'});return;}
    const short=course.split(' - ')[0],name=course.slice(short.length+3),record=await this.readCourseInitial(course);
    let draft=null;
    try{if(record?.draft)draft=validateCourseInitial(record.draft);}catch(error){console.warn('Learning Hub course overview:',error);}
    const sourceFile=record?.sourcePath?asFile(this.app,record.sourcePath):null;
    const head=el.createDiv({cls:'lh-ci-heading'});const title=head.createDiv({cls:'lh-ci-heading-copy'});
    title.createDiv({text:tr("COURSE OVERVIEW / {0}", [short]),cls:'lh-eyebrow'});title.createEl('h1',{text:name});
    title.createEl('p',{text:draft?tr("根据你确认的 Syllabus 解析结果整理。考核与日期请以原文件为准。"):tr("上传 Syllabus 后，这里会展示课程简介、考核、日期、学习目标和知识结构。")});
    const actions=head.createDiv({cls:'lh-ci-actions'});const upload=actions.createEl('button',{text:draft?tr("↑ 更新 Syllabus"):tr("↑ 上传 Syllabus"),cls:'lh-primary'});upload.onclick=()=>this.uploadCourseSyllabus(course);
    if(sourceFile){const original=actions.createEl('button',{text:tr("查看原文件"),cls:'lh-secondary'});original.onclick=()=>this.open(sourceFile.path);}
    if(draft&&asFile(this.app,this.courseOverviewPath(course))){const note=actions.createEl('button',{text:tr("打开整理笔记"),cls:'lh-secondary'});note.onclick=()=>this.open(this.courseOverviewPath(course));}
    if(!draft){
      const empty=el.createDiv({cls:'lh-ci-empty'});empty.createDiv({text:tr('01 / COURSE INITIALIZATION'),cls:'lh-eyebrow'});empty.createEl('h2',{text:tr("从 Syllabus 开始认识这门课")});empty.createEl('p',{text:tr("只会解析你通过上方入口新上传的文件；已有 Syllabus 笔记和左侧手写讲次不会被扫描或修改。")});
      const start=empty.createEl('button',{text:tr("上传并用 Codex 解析"),cls:'lh-primary'});start.onclick=()=>this.uploadCourseSyllabus(course);
    }else{
      const summary=el.createDiv({cls:'lh-ci-summary'});
      for(const [count,label] of [[draft.assessmentStructure.length,tr("项考核")],[draft.importantDates.length,tr("个重要日期")],[draft.knowledgeMap.length,tr("个知识主题")]]){const metric=summary.createDiv({cls:'lh-ci-metric'});metric.createEl('strong',{text:String(count)});metric.createSpan({text:label});}
      const intro=el.createDiv({cls:'lh-ci-intro'});
      const description=intro.createDiv({cls:'lh-ci-card lh-ci-description'});description.createDiv({text:tr("课程简介"),cls:'lh-ci-kicker'});description.createEl('h2',{text:tr("这门课学什么")});description.createEl('p',{text:draft.syllabusSummary||tr("Syllabus 未提供课程内容简介。")});
      if(draft.knowledgeMap.length){const topics=description.createDiv({cls:'lh-ci-theme-preview'});topics.createSpan({text:tr("课程主题")});const tags=topics.createDiv({cls:'lh-ci-theme-tags'});for(const item of draft.knowledgeMap)tags.createSpan({text:item.topic});}
      const two=el.createDiv({cls:'lh-ci-two-column'});
      const assessment=two.createDiv({cls:'lh-ci-card'});const aHead=assessment.createDiv({cls:'lh-ci-section-head'});aHead.createDiv({text:tr("成绩组成"),cls:'lh-ci-kicker'});aHead.createEl('h2',{text:tr("考核结构")});
      if(!draft.assessmentStructure.length)assessment.createEl('p',{text:tr("Syllabus 未明确说明考核结构。"),cls:'lh-ci-muted'});
      for(const item of draft.assessmentStructure){const card=assessment.createDiv({cls:'lh-ci-assessment'});const row=card.createDiv({cls:'lh-ci-assessment-title'});row.createEl('strong',{text:item.name});if(item.weight)row.createSpan({text:item.weight,cls:'lh-ci-weight'});const exact=item.weight.match(/^(\d+(?:\.\d+)?)%$/);if(exact&&Number(exact[1])<=100){const track=card.createDiv({cls:'lh-ci-weight-track'});const fill=track.createDiv({cls:'lh-ci-weight-fill'});fill.style.width=`${Number(exact[1])}%`;}if(item.details){const details=card.createEl('details',{cls:'lh-ci-assessment-details'});details.createEl('summary',{text:tr("查看要求与评分细则")});details.createEl('p',{text:item.details});}}
      const dates=two.createDiv({cls:'lh-ci-card'});const dHead=dates.createDiv({cls:'lh-ci-section-head'});dHead.createDiv({text:tr("学期安排"),cls:'lh-ci-kicker'});dHead.createEl('h2',{text:tr("重要日期")});
      if(!draft.importantDates.length)dates.createEl('p',{text:tr("Syllabus 未明确列出重要日期。"),cls:'lh-ci-muted'});
      for(const item of draft.importantDates){const row=dates.createDiv({cls:'lh-ci-date'});row.createSpan({text:item.date||tr("未注明"),cls:`lh-ci-date-stamp${!item.date||/\bTBD\b|待定/i.test(item.date)?' is-tbd':''}`});const body=row.createDiv({cls:'lh-ci-date-copy'});body.createEl('strong',{text:item.label});if(item.details)body.createEl('p',{text:item.details});}
      const knowledge=el.createDiv({cls:'lh-ci-card lh-ci-knowledge'});knowledge.createDiv({text:tr("课程脉络"),cls:'lh-ci-kicker'});knowledge.createEl('h2',{text:tr("课程知识结构")});
      if(!draft.knowledgeMap.length)knowledge.createEl('p',{text:tr("Syllabus 未列出可整理的知识主题。"),cls:'lh-ci-muted'});
      else{const grid=knowledge.createDiv({cls:'lh-ci-knowledge-grid'});draft.knowledgeMap.forEach((item,index)=>{const node=grid.createDiv({cls:'lh-ci-topic'});node.createSpan({text:String(index+1).padStart(2,'0'),cls:'lh-ci-topic-index'});node.createEl('h3',{text:item.topic});if(item.subtopics.length){const list=node.createEl('ul');for(const topic of item.subtopics)list.createEl('li',{text:topic});}});}
      const bottom=el.createDiv({cls:'lh-ci-two-column'});
      const outcomes=bottom.createDiv({cls:'lh-ci-card'});outcomes.createDiv({text:tr("课程目标"),cls:'lh-ci-kicker'});outcomes.createEl('h2',{text:tr("学习目标")});if(draft.learningOutcomes.length){const list=outcomes.createEl('ol',{cls:'lh-ci-outcome-list'});for(const outcome of draft.learningOutcomes)list.createEl('li',{text:outcome});}else outcomes.createEl('p',{text:tr("Syllabus 未列出学习目标。"),cls:'lh-ci-muted'});
      const exam=bottom.createDiv({cls:'lh-ci-card'});exam.createDiv({text:tr("复习参考"),cls:'lh-ci-kicker'});exam.createEl('h2',{text:tr("考试范围")});exam.createEl('p',{text:draft.examScope||tr("Syllabus 未明确说明考试范围。")});
    }
    const sources=this.courseSyllabusFiles(course);if(sources.length){const files=el.createDiv({cls:'lh-ci-sources'});files.createEl('h2',{text:tr("上传过的 Syllabus")});for(const file of sources){const row=files.createDiv({cls:'lh-ci-source-row'});const open=row.createEl('button',{text:file.name});open.onclick=()=>this.open(file.path);const retry=row.createEl('button',{text:tr("重新解析"),cls:'lh-text-link'});retry.onclick=()=>new CourseInitialModal(this,course,file.path).open();}}
    el.createEl('p',{text:tr("讲次由你在左侧单独维护；这里不会根据 Syllabus 生成或改写讲次。"),cls:'lh-ci-footnote'});
  }
  async renderLessonCourse(el,ctx){
    el.empty();el.addClass('learning-hub','lh-course');el.dataset.sourcePath=ctx.sourcePath;
    const course=ctx.sourcePath?.slice(ROOT.length+1).split('/')[0];
    if(!course||!this.courses.includes(course)){el.createDiv({text:tr("无法识别课程。"),cls:'lh-empty'});return;}
    const s=await this.stats(course),short=course.split(' - ')[0],selected=ctx.lessonPath?this.lessons(course).find(lesson=>lesson.path===ctx.lessonPath):this.selectedLesson(course);
    const heading=el.createDiv({cls:'lh-course-heading'});
    const returnOverview=heading.createEl('button',{text:tr("← 课程概览"),cls:'lh-text-link lh-course-return'});returnOverview.onclick=()=>this.openHub('course',course);
    heading.createDiv({text:tr("LECTURE SPACE / {0}", [short]),cls:'lh-eyebrow'});
    heading.createEl('h1',{text:course.slice(short.length+3)});
    heading.createEl('p',{text:tr("{0} 讲纳入学习范围 · 共 {1} 讲", [s.scoped.length, s.all.length])});
    const headingActions=heading.createDiv({cls:'lh-course-heading-actions'});
    const newLesson=headingActions.createEl('button',{text:tr("＋ 上传新讲课件"),cls:'lh-primary'});newLesson.onclick=()=>this.createLessonFromSlides(course);
    const metrics=heading.createDiv({cls:'lh-course-statline'});
    for(const [key,name] of STAGES){const metric=metrics.createDiv({cls:'lh-course-stat'});metric.createEl('strong',{text:s.scoped.length?String(s.pending[key]):'—'});metric.createSpan({text:tr(name)});}
    const workspace=el.createDiv({cls:'lh-course-workspace'});
    const main=workspace.createDiv({cls:'lh-lesson-surface'});
    const aside=workspace.createDiv({cls:'lh-course-aside'});
    if(selected){
      const current=await this.stages(selected),flow=await this.readFlow(selected),plan=this.reviewPlan(flow),inScope=this.scope(selected,course);
      const title=main.createDiv({cls:'lh-lesson-heading'});
      title.createDiv({text:tr("当前讲次"),cls:'lh-eyebrow'});
      title.createEl('h2',{text:flow.lessonTitle?`${selected.basename.split('@')[0].trim()} · ${flow.lessonTitle}`:selected.basename});
      title.createSpan({text:inScope?tr("已纳入学习范围"):tr("未纳入学习范围"),cls:'lh-lesson-subtitle'});
      const legacyDescription=(Array.isArray(flow.preview.summary)?flow.preview.summary:[]).slice(0,2).map(item=>String(item||'').replace(/\*\*(.*?)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/\$([^$]+)\$/g,'$1')).join(' ');
      const description=String(flow.preview.description||legacyDescription).trim();
      title.createEl('p',{text:description||tr("上传课件并完成 Codex 分析后，这里会显示本讲简介。"),cls:`lh-lesson-description${description?'':' is-pending'}`});
      const steps=main.createDiv({cls:'lh-learning-steps'});
      const journey=[
        {name:tr("预习"),state:current.previewed?tr("已确认"):tr("待完成"),done:current.previewed,action:()=>this.showWorkflow('preview',course,selected.path)},
        {name:tr("课堂学习"),state:flow.milestones.learnedAt?tr("已确认"):current.learned?tr("确认日期"):tr("待确认"),done:!!flow.milestones.learnedAt,action:()=>this.confirmLearning(selected)},
        {name:tr("间隔复习"),state:plan.filter(r=>r.completedAt).length+tr("/3 轮"),done:plan.every(r=>r.completedAt),action:()=>this.showWorkflow('review',course,selected.path,Math.max(1,plan.find(r=>r.unlocked&&!r.completedAt)?.round||plan.find(r=>!r.completedAt)?.round||3))}
      ];
      journey.forEach((stage,index)=>{
        const celebrated=this.celebrateStage?.path===selected.path&&this.celebrateStage?.key===['previewed','learned','reviewed'][index]&&this.celebrateStage.until>Date.now();
        const step=steps.createEl('button',{cls:`lh-learning-step${stage.done?' is-done':''}${celebrated?' is-celebrating':''}`,attr:{title:tr("进入{0}", [tr(stage.name)])}});
        step.createSpan({text:stage.done?'✓':String(index+1).padStart(2,'0'),cls:'lh-step-index'});
        step.createSpan({text:stage.name,cls:'lh-step-name'});
        step.createSpan({text:stage.state,cls:'lh-step-state'});
        step.onclick=stage.action;
      });
      const actions=main.createDiv({cls:'lh-learning-actions'});
      actions.createEl('h3',{text:tr("学习入口")});
      const actionGrid=actions.createDiv({cls:'lh-action-grid'});
      const action=(title,detail,icon,handler,primary=false)=>{
        const button=actionGrid.createEl('button',{cls:`lh-action-tile${primary?' is-primary':''}`});
        setIcon(button.createSpan({cls:'lh-action-icon'}),icon);
        const copy=button.createSpan({cls:'lh-action-copy'});copy.createEl('strong',{text:title});copy.createEl('small',{text:detail});
        button.onclick=handler;
      };
      action(tr("双窗格预习"),tr("课件与交互式预习并排"),'columns-2',()=>this.showWorkflow('preview',course,selected.path),true);
      action(tr("主笔记"),tr("打开本讲知识笔记"),'file-text',()=>this.open(selected.path));
      action(tr("引导式回忆"),tr("先作答，再揭示与自评"),'brain',()=>this.showWorkflow('recall',course,selected.path));
      const review=main.createDiv({cls:'lh-review-strip'});
      const reviewHead=review.createDiv({cls:'lh-review-strip-head'});reviewHead.createEl('h3',{text:tr("间隔复习")});reviewHead.createSpan({text:tr("三轮递进 · 按日期解锁")});
      const reviewCards=review.createDiv({cls:'lh-review-rounds'});
      for(const round of plan){
        const card=reviewCards.createEl('button',{cls:`lh-review-round${round.completedAt?' is-done':round.unlocked?' is-ready':' is-locked'}`});
        card.createSpan({text:tr(round.title),cls:'lh-review-round-title'});
        card.createSpan({text:round.completedAt?tr("已完成"):round.unlocked?tr("现在可以复习"):round.due?tr("预计 {0} 解锁", [round.due]):tr("学习完成后排期"),cls:'lh-review-round-status'});
        card.onclick=()=>this.showWorkflow('review',course,selected.path,round.round);
      }
      const resources=main.createDiv({cls:'lh-lesson-resources'});
      const resourceHead=resources.createDiv({cls:'lh-lesson-section-head'});resourceHead.createEl('h3',{text:tr("本讲课件")});
      const upload=resourceHead.createEl('button',{text:tr("＋ 上传课件"),cls:'lh-inline-action'});upload.onclick=()=>this.upload(selected);
      const pdfs=this.pdfs(selected);
      if(pdfs.length){for(const pdf of pdfs){const row=resources.createEl('button',{cls:'lh-resource-row'});setIcon(row.createSpan({cls:'lh-resource-icon'}),'file-text');row.createSpan({text:pdf.name});setIcon(row.createSpan({cls:'lh-resource-open'}),'arrow-up-right');row.onclick=()=>this.open(pdf.path);}}
      else resources.createDiv({text:tr("还没有本讲课件。上传 PDF 后可直接用于双窗格预习。"),cls:'lh-resource-empty'});
      const details=main.createEl('details',{cls:'lh-lesson-manage'});
      details.createEl('summary',{text:tr("管理当前讲次")});
      const manage=details.createDiv({cls:'lh-manage-controls'});
      const scope=manage.createEl('button',{text:inScope?tr("移出学习范围"):tr("纳入学习范围")});
      scope.onclick=async()=>{if(!Array.isArray(this.state.courseScope[course]))this.state.courseScope[course]=s.scoped.map(x=>x.path);const list=this.state.courseScope[course];this.state.courseScope[course]=inScope?list.filter(p=>p!==selected.path):[...list,selected.path];await this.save();};
      const setTitle=manage.createEl('button',{text:tr("修改本讲标题")});
      setTitle.onclick=()=>new EntryModal(this.app,tr("修改本讲标题"),[{key:'title',label:tr("标题"),value:flow.lessonTitle||selected.basename,placeholder:tr("例如 动态规划与状态转移")}],async v=>{flow.lessonTitle=v.title;flow.lessonTitleSource='manual';await this.saveFlow(selected,flow,true);for(const leaf of this.app.workspace.getLeavesOfType(MAIN))if(leaf.view?.page==='lesson'&&leaf.view.course===course)await leaf.view.render();await this.rerenderLesson(selected);}).open();
    }else main.createDiv({text:tr("从上传这一讲的 PDF 课件开始。课件导入后会建立主笔记与预习工作区。"),cls:'lh-empty'});
    const overviewHead=aside.createDiv({cls:'lh-aside-heading'});overviewHead.createEl('h2',{text:tr("讲次导航")});
    const links=aside.createDiv({cls:'lh-aside-links'});
    const overview=links.createEl('button',{text:tr("返回课程概览"),cls:'lh-aside-link'});overview.onclick=()=>this.openHub('course',course);
    const syllabus=this.syllabus(course);
    if(syllabus)this.navText(links,tr("原有 Syllabus 笔记"),syllabus.path,'lh-aside-link');
    const assignmentLink=links.createEl('button',{text:tr("作业与 Lab Session"),cls:'lh-aside-link'});assignmentLink.onclick=()=>this.openHub('assignments',course);
    this.navText(links,tr("原有课程目录"),`${ROOT}/${course}/${course}.md`,'lh-aside-link');
    const scopeSection=aside.createDiv({cls:'lh-aside-section'});scopeSection.createEl('h3',{text:tr("学习范围")});
    const facts=scopeSection.createDiv({cls:'lh-aside-facts'});
    [[tr("讲次总数"),s.all.length],[tr("已纳入"),s.scoped.length],[tr("待复习"),s.pending.reviewed]].forEach(([name,value])=>{const row=facts.createDiv();row.createSpan({text:name});row.createEl('strong',{text:String(value)});});
    el.createDiv({text:tr("学习范围暂按讲次日期推定；三轮复习会在确认课堂学习和完成回忆后依次开放。"),cls:'lh-course-footnote'});
  }
  pdfs(lesson){const folder=lesson.parent?.path;return this.app.vault.getFiles().filter(f=>f.parent?.path===folder&&f.extension.toLowerCase()==='pdf').sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));}
  async importLessonFiles(folder,files){
    const imported=[],failed=[];
    for(const file of files){
      const name=safeSegment(file.name),dot=name.lastIndexOf('.'),base=dot>=0?name.slice(0,dot):name,ext=dot>=0?name.slice(dot):'';
      let target=`${folder}/${name}`,number=2;
      while(await this.app.vault.adapter.exists(target))target=`${folder}/${base} (${number++})${ext}`;
      try{await this.app.vault.createBinary(target,await file.arrayBuffer());imported.push({path:target,name:target.slice(folder.length+1),isPdf:ext.toLowerCase()==='.pdf'});}
      catch(error){console.error('Learning Hub lecture import:',error);failed.push(file.name);}
    }
    return {imported,failed};
  }
  async extractLessonSlides(lesson,onFile){
    const pdfs=this.pdfs(lesson);if(!pdfs.length)throw new Error(tr("本讲尚无 PDF 课件。"));
    const sources=[];
    for(const [index,pdf] of pdfs.entries()){
      onFile?.(pdf,index,pdfs.length);
      try{sources.push({name:pdf.name,text:await extractPdfText(path.join(this.vaultPath(),pdf.path),this.state.ai.pdfExtractor)});}
      catch(error){throw new Error(tr("课件「{0}」解析失败：{1}", [pdf.name,error.message]));}
    }
    return {pdfs,...combineLectureSlides(sources)};
  }
  async createLessonFromSlides(course){
    const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.pdf,.ppt,.pptx';
    input.onchange=()=>{
      const files=Array.from(input.files||[]);if(!files.length)return;
      const existing=this.lessons(course).map(lesson=>Number(lesson.basename.match(/^L(\d+)/)?.[1]||0));
      const code=`L${String(Math.max(0,...existing)+1).padStart(2,'0')}`;
      new EntryModal(this.app,tr("新建讲次并导入课件"),[
        {key:'title',label:tr("讲次编号或名称"),value:code,placeholder:tr("例如 L08")}
      ],async value=>{
        const name=safeSegment(value.title);
        if(!/^L\d+(?:\b|[-_])/.test(name)){new Notice(tr("讲次名称请以 L01、L02 等编号开头"));return;}
        const folder=`${ROOT}/${course}/${name}`,notePath=`${folder}/${name}.md`;
        if(await this.app.vault.adapter.exists(notePath)){new Notice(tr("该讲次已存在，请改用“上传课件”"));return;}
        await this.ensureFolder(folder);
        try{
          const {imported,failed}=await this.importLessonFiles(folder,files);
          if(!imported.length){new Notice(tr("课件导入失败：{0}", [failed.join('、')]),7000);return;}
          const note=`---\ncourse: ${JSON.stringify(course)}\nlesson: ${JSON.stringify(name)}\n---\n\n课件： ${imported.map(item=>`[[${item.name}]]`).join(' · ')}\n\n## 主笔记\n\n`;
          const lesson=await this.app.vault.create(notePath,note);
          if(!Array.isArray(this.state.courseScope[course]))this.state.courseScope[course]=this.lessons(course).filter(item=>this.scope(item,course)).map(item=>item.path);
          this.state.courseScope[course].push(lesson.path);
          await this.saveData(this.state);
          await this.selectLesson(course,lesson.path);
          await this.showWorkflow('preview',course,lesson.path);
          new Notice(tr("已导入 {0} 份课件{1}", [imported.length, failed.length?tr("；{0} 份失败：{1}", [failed.length, failed.join('、')]):'']),7000);
          if(imported.some(item=>item.isPdf))void this.generatePreviewDraft(lesson).catch(error=>{console.error('Learning Hub preview AI:',error);new Notice(tr("课件已保存；预习内容未生成：{0}", [error.message]),7000);});
          else new Notice(tr("课件已导入；AI 预习内容目前支持文字版 PDF。"));
        }catch(error){console.error('Learning Hub lecture import:',error);new Notice(tr("课件已选择，但导入或草案生成未完成：{0}", [error.message]));}
      }).open();
    };input.click();
  }
  async rerenderLesson(file){
    for(const leaf of this.app.workspace.getLeavesOfType(MAIN))if(leaf.view?.lessonPath===file.path)await leaf.view.render();
  }
  async showWorkflow(page,course,lessonPath,round=0,preferredPdfPath=''){
    const lesson=asFile(this.app,lessonPath);if(!lesson){new Notice(tr("找不到当前讲次"));return;}
    this.selectedLessonByCourse[course]=lessonPath;
    this.state.lastLessonByCourse[course]=lessonPath;await this.saveData(this.state);
    if(page==='preview'){
      const sourcePath=preferredPdfPath||(this.pdfs(lesson).some(pdf=>pdf.path===this.pdfPath)?this.pdfPath:'')||(await this.readFlow(lesson)).preview.sourcePath;
      const pdf=this.pdfs(lesson).find(file=>file.path===sourcePath)||this.pdfs(lesson)[0];
      if(pdf){
        let right=this.lastMainLeaf?.view?.getViewType?.()===MAIN?this.lastMainLeaf:this.app.workspace.getLeavesOfType(MAIN)[0];
        const pdfLeaves=this.app.workspace.getLeavesOfType('pdf');
        let left=pdfLeaves.includes(this.pdfLeaf)?this.pdfLeaf:pdfLeaves.find(leaf=>this.pdfs(lesson).some(file=>file.path===(leaf.view?.file?.path||leaf.getViewState()?.state?.file)))||null;
        if(left){await left.openFile(pdf);await left.loadIfDeferred?.();if(!right)right=this.app.workspace.createLeafBySplit(left,'vertical');}
        else{left=right||this.app.workspace.getLeaf('tab');await left.openFile(pdf);right=this.app.workspace.createLeafBySplit(left,'vertical');}
        this.pdfLeaf=left;this.pdfPath=pdf.path;
        await this.openHub(page,course,right,lessonPath,round);
        return;
      }
      if(this.pdfLeaf?.view?.file?.path===this.pdfPath)this.pdfLeaf.detach();
      this.pdfLeaf=null;this.pdfPath=null;
      new Notice(tr("当前讲次暂无 PDF；可先在课程概览上传。"));
    }
    await this.openHub(page,course,undefined,lessonPath,round);
  }
  workflowField(host,label,value,changed,placeholder=''){
    const field=host.createDiv({cls:'lh-flow-field'});field.createEl('label',{text:label});
    const textarea=field.createEl('textarea',{attr:{placeholder}});textarea.value=value||'';
    textarea.onchange=()=>changed(textarea.value.trim());return textarea;
  }
  renderPreviewSources(el,file,course){
    const pdfs=this.pdfs(file);if(!pdfs.length)return;
    const bar=el.createDiv({cls:'lh-preview-source-bar'}),header=bar.createDiv({cls:'lh-preview-source-header'});
    header.createEl('strong',{text:tr('本讲课件')});const count=header.createSpan({cls:'lh-preview-source-count'});
    const row=bar.createDiv({cls:'lh-preview-source-row'}),previous=row.createEl('button',{cls:'lh-preview-source-arrow',attr:{'aria-label':tr('上一份课件'),title:tr('上一份课件')}});setIcon(previous,'chevron-left');
    const select=row.createEl('select',{attr:{'aria-label':tr('切换左侧 PDF 课件')}});
    pdfs.forEach((pdf,index)=>select.createEl('option',{text:`${String(index+1).padStart(2,'0')} · ${pdf.name}`,attr:{value:pdf.path}}));
    const next=row.createEl('button',{cls:'lh-preview-source-arrow',attr:{'aria-label':tr('下一份课件'),title:tr('下一份课件')}});setIcon(next,'chevron-right');
    select.value=pdfs.some(pdf=>pdf.path===this.pdfPath)?this.pdfPath:pdfs[0].path;
    const update=()=>{const index=pdfs.findIndex(pdf=>pdf.path===select.value);count.setText(tr('第 {0} / {1} 份',[index+1,pdfs.length]));select.title=pdfs[index].name;previous.disabled=index===0;next.disabled=index===pdfs.length-1;};
    const choose=async value=>{select.disabled=true;previous.disabled=true;next.disabled=true;try{const pdf=pdfs.find(pdf=>pdf.path===value);if(!pdf)return;if(this.pdfLeaf&&this.app.workspace.getLeavesOfType('pdf').includes(this.pdfLeaf)){await this.pdfLeaf.openFile(pdf);this.pdfPath=pdf.path;}else await this.showWorkflow('preview',course,file.path,0,pdf.path);select.value=pdf.path;this.refreshChatContext();}catch(error){new Notice(tr('无法打开课件：{0}',[error.message]));}finally{select.disabled=false;update();}};
    select.onchange=()=>void choose(select.value);previous.onclick=()=>void choose(pdfs[Math.max(0,select.selectedIndex-1)].path);next.onclick=()=>void choose(pdfs[Math.min(pdfs.length-1,select.selectedIndex+1)].path);update();
    bar.createEl('p',{text:tr('切换左侧阅读的课件；预习内容综合本讲全部课件。')});
    return bar;
  }
  async renderWorkflow(el,ctx){
    el.empty();el.addClass('learning-hub','lh-workflow');
    const file=asFile(this.app,ctx.lessonPath);
    if(!file){el.createDiv({text:tr("讲次笔记不存在。"),cls:'lh-empty'});return;}
    const flow=await this.readFlow(file),title=ctx.page==='preview'?tr("课前预习"):ctx.page==='recall'?tr("引导式回忆"):tr("第 {0} 轮复习", [ctx.round]);
    const head=el.createDiv({cls:'lh-flow-head'});
    const back=head.createEl('button',{text:tr("← 返回当前讲次"),cls:'lh-flow-back'});back.onclick=()=>this.openHub('lesson',ctx.course,undefined,file.path);
    head.createDiv({text:`${ctx.course?.split(' - ')[0]||''}  /  ${file.basename}${flow.lessonTitle?` · ${flow.lessonTitle}`:''}`,cls:'lh-eyebrow'});
    head.createEl('h1',{text:title});
    head.createEl('p',{text:ctx.page==='preview'?tr("左侧查看 PDF，右侧逐项确认理解；过程仅保存在隐藏 JSON 中。"):ctx.page==='recall'?tr("先写出自己的答案，再揭示参考内容并自评。"):tr("复习题先作答后揭示；本轮结果会用于后续复习与错误记录。")});
    if(ctx.page==='preview'){this.renderPreviewSources(el,file,ctx.course);await this.renderPreview(el,file,flow,ctx.course);}
    if(ctx.page==='recall')this.renderQuestionSession(el,file,flow,'recall',0,ctx.course);
    if(ctx.page==='review')await this.renderReview(el,file,flow,ctx.round,ctx.course);
  }
  async renderPreviewMarkdown(host,markdown,file){
    const content=formatPreviewMarkdown(markdown).trim();
    if(!content)return;
    try{
      if(MarkdownRenderer?.render)await MarkdownRenderer.render(this.app,content,host,file.path,this);
      else if(MarkdownRenderer?.renderMarkdown)await MarkdownRenderer.renderMarkdown(content,host,file.path,this);
      else host.setText(content);
    }catch(error){console.warn('Learning Hub preview Markdown:',error);host.setText(content);}
  }
  renderPreviewReasoning(analysis){
    if(!analysis)return;
    clearTimeout(analysis.reasoningRenderTimer);
    const renderVersion=(analysis.reasoningRenderVersion||0)+1;
    analysis.reasoningRenderVersion=renderVersion;
    analysis.reasoningRenderTimer=setTimeout(async()=>{
      const host=analysis.reasoningEl;
      if(!host)return;
      let markdown=formatPreviewMarkdown(analysis.reasoningSummary||'').trim();
      if(!markdown){host.setText(tr("摘要会在生成过程中更新"));return;}
      const strong=[...markdown.matchAll(/\*\*/g)];
      if(strong.length%2){const index=strong.at(-1).index;markdown=markdown.slice(0,index)+markdown.slice(index+2);}
      const staging=document.createElement('div');
      try{
        if(MarkdownRenderer?.render)await MarkdownRenderer.render(this.app,markdown,staging,analysis.lessonPath||'',this);
        else if(MarkdownRenderer?.renderMarkdown)await MarkdownRenderer.renderMarkdown(markdown,staging,analysis.lessonPath||'',this);
        else staging.textContent=markdown.replace(/\*\*/g,'');
      }catch(error){console.warn('Learning Hub reasoning summary Markdown:',error);staging.textContent=markdown.replace(/\*\*/g,'');}
      if(renderVersion!==analysis.reasoningRenderVersion||host!==analysis.reasoningEl)return;
      host.replaceChildren(...staging.childNodes);
    },100);
  }
  updatePreviewProgress(analysis){
    if(!analysis)return;
    const pages=analysis.pages?tr("{0} 份 PDF、{1} 页课件", [analysis.fileCount, analysis.pages]):tr("{0} 份 PDF 课件", [analysis.fileCount||1]);
    const stages={
      extract:analysis.currentFile?tr("正在读取第 {0}/{1} 份：{2}", [analysis.filesProcessed, analysis.fileCount, analysis.currentFile]):tr("正在提取 PDF 文字…"),
      queued:tr("已读取 {0}，等待 Codex 任务开始…", [pages]),
      connecting:tr("已读取 {0}，正在连接 Codex…", [pages]),
      starting:tr("已读取 {0}，正在提交生成任务…", [pages]),
      generating:tr("Codex 正在整理知识点、导图和分层知识块…"),
      thinking:tr("Codex 正在分析课件；思考摘要持续更新…"),
      receiving:tr("Codex 正在返回生成结果…"),
      saving:tr("正在校验并保存预习内容…"),
    };
    analysis.statusEl?.setText(stages[analysis.phase]||stages.generating);
    const step=analysis.phase==='extract'?0:analysis.phase==='saving'?2:1;
    for(const [index,element] of (analysis.stepEls||[]).entries()){
      element.classList.toggle('is-done',index<step);
      element.classList.toggle('is-active',index===step);
    }
    const seconds=Math.floor((Date.now()-analysis.startedAt)/1000);
    const duration=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    const amount=analysis.receivedChars?tr(" · 已接收 {0} 字符", [analysis.receivedChars.toLocaleString()]):
      analysis.inputChars?tr(" · 已送入 {0} 字符", [analysis.inputChars.toLocaleString()]):'';
    analysis.elapsedEl?.setText(tr("已用时 {0}{1} · {2} / {3}", [duration, amount, analysis.model, analysis.effort]));
    analysis.usageEl?.setText(analysis.tokenUsage?formatCodexUsage(analysis.tokenUsage):'');
  }
  updateNoteProgress(analysis){
    if(!analysis)return;
    const files=analysis.fileCount===1?tr("1 份 PDF"):tr("{0} 份 PDF", [analysis.fileCount||0]);
    const stages={extract:analysis.currentFile?tr("正在读取第 {0}/{1} 份：{2}", [analysis.filesProcessed, analysis.fileCount, analysis.currentFile]):tr("正在提取课件文字…"),queued:tr("已读取 {0}，等待 Codex 任务开始…", [files]),connecting:tr("正在连接 Codex…"),starting:tr("正在提交主笔记整理任务…"),generating:tr("Codex 正在整理主笔记内容…"),thinking:tr("Codex 正在分析课件；思考摘要持续更新…"),receiving:tr("Codex 正在返回主笔记草案…"),saving:tr("正在校验并保存主笔记草案…")};
    analysis.statusEl?.setText(stages[analysis.phase]||stages.generating);
    const step=analysis.phase==='extract'?0:analysis.phase==='saving'?2:1;
    for(const [index,element] of (analysis.stepEls||[]).entries()){element.classList.toggle('is-done',index<step);element.classList.toggle('is-active',index===step);}
    const seconds=Math.floor((Date.now()-analysis.startedAt)/1000),duration=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    const amount=analysis.receivedChars?tr(" · 已接收 {0} 字符", [analysis.receivedChars.toLocaleString()]):analysis.inputChars?tr(" · 已送入 {0} 字符", [analysis.inputChars.toLocaleString()]):'';
    analysis.elapsedEl?.setText(tr("已用时 {0}{1} · {2} / {3}", [duration, amount, analysis.model, analysis.effort]));
    analysis.usageEl?.setText(analysis.tokenUsage?formatCodexUsage(analysis.tokenUsage):'');
  }
  renderNoteReasoning(analysis){
    if(!analysis)return;
    clearTimeout(analysis.reasoningRenderTimer);
    const version=(analysis.reasoningRenderVersion||0)+1;analysis.reasoningRenderVersion=version;
    analysis.reasoningRenderTimer=setTimeout(async()=>{
      const host=analysis.reasoningEl;if(!host)return;
      let markdown=formatPreviewMarkdown(analysis.reasoningSummary||'').trim();
      if(!markdown){host.setText(tr("摘要会在生成过程中更新"));return;}
      const strong=[...markdown.matchAll(/\*\*/g)];if(strong.length%2){const index=strong.at(-1).index;markdown=markdown.slice(0,index)+markdown.slice(index+2);}
      const staging=document.createElement('div');
      try{if(MarkdownRenderer?.render)await MarkdownRenderer.render(this.app,markdown,staging,analysis.lessonPath||'',this);else if(MarkdownRenderer?.renderMarkdown)await MarkdownRenderer.renderMarkdown(markdown,staging,analysis.lessonPath||'',this);else staging.textContent=markdown.replace(/\*\*/g,'');}
      catch(error){console.warn('Learning Hub note reasoning summary Markdown:',error);staging.textContent=markdown.replace(/\*\*/g,'');}
      if(version!==analysis.reasoningRenderVersion||host!==analysis.reasoningEl)return;host.replaceChildren(...staging.childNodes);
    },100);
  }
  renderNoteGenerationProgress(host,file,analysis){
    const progress=host.createDiv({cls:'lh-preview-generating lh-note-generating',attr:{role:'status','aria-live':'polite'}});
    progress.createSpan({cls:'lh-analysis-spinner'});progress.createDiv({text:tr("正在整理主笔记草案"),cls:'lh-preview-generating-title'});
    const steps=progress.createDiv({cls:'lh-preview-progress-steps'});analysis.stepEls=[tr("读取课件"),tr("AI 整理"),tr("保存草案")].map(label=>steps.createSpan({text:label}));
    analysis.statusEl=progress.createEl('p',{cls:'lh-preview-stage'});analysis.elapsedEl=progress.createEl('p',{cls:'lh-preview-elapsed'});analysis.usageEl=progress.createEl('p',{cls:'lh-preview-usage'});
    const reasoning=progress.createDiv({cls:'lh-preview-reasoning'}),head=reasoning.createDiv({cls:'lh-preview-reasoning-head'});
    head.createDiv({text:tr("思考摘要"),cls:'lh-preview-reasoning-label'});const thinking=head.createDiv({cls:'lh-preview-thinking',attr:{'aria-label':tr("正在思考")}});thinking.createSpan({text:tr("思考中")});
    const dots=thinking.createSpan({cls:'lh-preview-thinking-dots',attr:{'aria-hidden':'true'}});for(let index=0;index<3;index++)dots.createSpan({cls:'lh-preview-thinking-dot'});
    analysis.reasoningEl=reasoning.createDiv({cls:'lh-preview-reasoning-text lh-preview-markdown'});
    this.updateNoteProgress(analysis);this.renderNoteReasoning(analysis);
  }
  async renderPreview(el,file,flow,course){
    const body=el.createDiv({cls:'lh-flow-body lh-preview-layout'}),main=body.createDiv({cls:'lh-flow-main'});
    const analysis=this.analysisByLesson?.get(file.path),hasContent=!!flow.preview.concepts.length;
    if(analysis){
      const progress=main.createDiv({cls:'lh-preview-generating',attr:{role:'status','aria-live':'polite'}});
      progress.createSpan({cls:'lh-analysis-spinner'});
      progress.createDiv({text:tr("正在生成这讲的预习内容"),cls:'lh-preview-generating-title'});
      const steps=progress.createDiv({cls:'lh-preview-progress-steps'});
      analysis.stepEls=[tr("读取课件"),tr("AI 生成"),tr("保存结果")].map(label=>steps.createSpan({text:label}));
      analysis.statusEl=progress.createEl('p',{cls:'lh-preview-stage'});
      analysis.elapsedEl=progress.createEl('p',{cls:'lh-preview-elapsed'});
      analysis.usageEl=progress.createEl('p',{cls:'lh-preview-usage'});
      const reasoning=progress.createDiv({cls:'lh-preview-reasoning'});
      const reasoningHead=reasoning.createDiv({cls:'lh-preview-reasoning-head'});
      reasoningHead.createDiv({text:tr("思考摘要"),cls:'lh-preview-reasoning-label'});
      const thinking=reasoningHead.createDiv({cls:'lh-preview-thinking',attr:{'aria-label':tr("正在思考")}});
      thinking.createSpan({text:tr("思考中")});
      const dots=thinking.createSpan({cls:'lh-preview-thinking-dots',attr:{'aria-hidden':'true'}});
      for(let i=0;i<3;i++)dots.createSpan({cls:'lh-preview-thinking-dot'});
      analysis.reasoningEl=reasoning.createDiv({cls:'lh-preview-reasoning-text lh-preview-markdown'});
      this.updatePreviewProgress(analysis);
      this.renderPreviewReasoning(analysis);
      const skeleton=progress.createDiv({cls:'lh-preview-skeleton'});for(let i=0;i<4;i++)skeleton.createSpan();
      return;
    }
    if(!hasContent){
      const empty=main.createDiv({cls:'lh-preview-empty'});
      empty.createDiv({text:tr("预习内容还没有生成"),cls:'lh-preview-empty-title'});
      empty.createEl('p',{text:this.previewErrors?.get(file.path)||tr("上传文字版 PDF 后会自动分析并在这里显示总结、知识导图和知识块。")});
      if(this.pdfs(file).length){const retry=empty.createEl('button',{text:tr("重新生成"),cls:'lh-primary'});retry.onclick=async()=>{retry.disabled=true;try{await this.generatePreviewDraft(file);}catch(error){new Notice(error.message,7000);}finally{retry.disabled=false;}};}
      return;
    }
    const groups=previewGroups(flow.preview.concepts),pending=[],nodes=new Map();
    const intro=main.createDiv({cls:'lh-flow-panel lh-preview-summary'});
    const introHead=intro.createDiv({cls:'lh-flow-section-head'});introHead.createEl('h2',{text:tr("快速看懂这一讲")});
    const regenerate=introHead.createEl('button',{text:tr("重新分析课件"),cls:'lh-inline-action'});
    regenerate.onclick=async()=>{regenerate.disabled=true;try{await this.generatePreviewDraft(file);}catch(error){new Notice(error.message,7000);}finally{regenerate.disabled=false;}};
    const summary=Array.isArray(flow.preview.summary)&&flow.preview.summary.length?flow.preview.summary:String(flow.preview.objectives||'').split(/\n+/).filter(Boolean);
    const summaryList=intro.createDiv({cls:'lh-preview-summary-list'});
    for(const [index,item] of summary.entries()){const row=summaryList.createDiv({cls:'lh-preview-summary-item'});row.createSpan({text:String(index+1).padStart(2,'0')});const prose=row.createDiv({cls:'markdown-rendered lh-preview-markdown'});pending.push(this.renderPreviewMarkdown(prose,item,file));}
    const map=main.createDiv({cls:'lh-flow-panel lh-preview-map'});
    const mapHead=map.createDiv({cls:'lh-flow-section-head'});mapHead.createEl('h2',{text:tr("知识导图")});mapHead.createSpan({text:tr("{0} 个主题 · {1} 个知识点", [groups.length, flow.preview.concepts.length]),cls:'lh-preview-count'});
    const mapRoot=map.createDiv({cls:'lh-map-root markdown-rendered'});pending.push(this.renderPreviewMarkdown(mapRoot,flow.lessonTitle||file.basename,file));
    const branches=map.createDiv({cls:'lh-map-branches'});
    for(const group of groups){const branch=branches.createDiv({cls:'lh-map-branch'});const groupTitle=branch.createDiv({cls:'lh-map-group markdown-rendered'});pending.push(this.renderPreviewMarkdown(groupTitle,group.title,file));const topics=branch.createDiv({cls:'lh-map-topics'});for(const concept of group.items){const topic=topics.createDiv({cls:'lh-map-topic markdown-rendered',attr:{role:'button',tabindex:'0','aria-label':concept.title}});pending.push(this.renderPreviewMarkdown(topic,concept.title,file));const jump=()=>nodes.get(concept.id)?.scrollIntoView?.({behavior:'smooth',block:'center'});topic.onclick=jump;topic.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();jump();}};}}
    const section=main.createDiv({cls:'lh-flow-panel lh-preview-blocks'}),heading=section.createDiv({cls:'lh-flow-section-head'});
    heading.createEl('h2',{text:tr("分层知识块")});const controls=heading.createDiv({cls:'lh-preview-block-controls'});const progress=controls.createSpan({cls:'lh-preview-count'});
    const add=controls.createEl('button',{text:tr("＋ 补充"),cls:'lh-inline-action'});
    add.onclick=()=>new EntryModal(this.app,tr("补充知识块"),[{key:'group',label:tr("所属主题"),value:groups[0]?.title||tr('本讲要点')},{key:'title',label:tr("知识点名称")},{key:'summary',label:tr("解释（支持 Markdown）"),multiline:true}],async value=>{flow.preview.concepts.push({id:crypto.randomUUID(),group:value.group||tr("本讲要点"),title:value.title,summary:value.summary,status:null,note:''});await this.saveFlow(file,flow);await this.rerenderLesson(file);}).open();
    const updateProgress=()=>progress.setText(tr("{0} / {1} 已检查", [flow.preview.concepts.filter(item=>item.status).length, flow.preview.concepts.length]));
    updateProgress();
    for(const group of groups){
      const groupSection=section.createDiv({cls:'lh-preview-group'});groupSection.createEl('h3',{text:group.title,cls:'lh-preview-group-title'});
      for(const concept of group.items){
        const index=flow.preview.concepts.indexOf(concept)+1;
        const card=groupSection.createDiv({cls:`lh-concept lh-preview-concept${concept.status?' is-'+concept.status:''}`});nodes.set(concept.id,card);
        const row=card.createDiv({cls:'lh-concept-heading'});row.createSpan({text:String(index).padStart(2,'0'),cls:'lh-concept-index'});row.createEl('h4',{text:concept.title});
        const edit=row.createEl('button',{text:tr("编辑"),cls:'lh-preview-edit'});
        edit.onclick=()=>new EntryModal(this.app,tr("编辑知识块"),[{key:'group',label:tr("所属主题"),value:concept.group||tr('本讲要点')},{key:'title',label:tr("知识点名称"),value:concept.title},{key:'summary',label:tr("解释（支持 Markdown）"),value:concept.summary,multiline:true}],async value=>{concept.group=value.group||tr("本讲要点");concept.title=value.title;concept.summary=value.summary;await this.saveFlow(file,flow);await this.rerenderLesson(file);}).open();
        const explanation=card.createDiv({cls:'markdown-rendered lh-preview-markdown'});pending.push(this.renderPreviewMarkdown(explanation,concept.summary,file));
        const actions=card.createDiv({cls:'lh-concept-actions lh-preview-decision'}),buttons=[];
        const questionBox=card.createDiv({cls:'lh-preview-question'});questionBox.hidden=concept.status!=='question';
        questionBox.createEl('label',{text:tr("哪里还不理解？写下疑问，后续复习会参考。")});
        const question=questionBox.createEl('textarea',{attr:{placeholder:tr("例如：这个公式为什么需要这个条件？")}});question.value=concept.note||'';
        question.onchange=async()=>{concept.note=question.value.trim();await this.saveFlow(file,flow);};
        for(const [status,name,icon] of [['pass',tr("理解了"),'check'],['question',tr("没理解"),'help-circle']]){
          const button=actions.createEl('button',{cls:`lh-choice lh-decision is-${status}${concept.status===status?' is-selected':''}`,attr:{'aria-pressed':String(concept.status===status),'aria-label':name}});
          const glyph=button.createSpan({cls:'lh-decision-icon'});setIcon(glyph,icon);
          button.createSpan({text:name,cls:'lh-decision-label'});
          buttons.push([status,button]);
          button.onclick=async()=>{
            const previous=concept.status;concept.status=status;
            const update=()=>{card.classList?.toggle('is-pass',concept.status==='pass');card.classList?.toggle('is-question',concept.status==='question');for(const [key,item] of buttons){item.classList?.toggle('is-selected',concept.status===key);item.setAttribute?.('aria-pressed',String(concept.status===key));}questionBox.hidden=concept.status!=='question';updateProgress();};
            update();card.classList?.remove('is-marked');void card.offsetWidth;card.classList?.add('is-marked');
            if(status==='question')question.focus?.();
            for(const [,item] of buttons)item.disabled=true;
            try{await this.saveFlow(file,flow);}catch(error){concept.status=previous;update();new Notice(tr("保存理解状态失败，请重试。"));}
            finally{for(const [,item] of buttons)item.disabled=false;}
          };
        }
      }
    }
    await Promise.all(pending);
    const previewCelebration=this.celebrateStage?.path===file.path&&this.celebrateStage.key==='previewed'&&this.celebrateStage.until>Date.now();
    const finish=main.createDiv({cls:`lh-flow-finish${previewCelebration?' is-celebrating':''}`});finish.createEl('strong',{text:flow.milestones.previewedAt?tr("预习已确认完成"):tr("完成理解检查")});
    finish.createEl('p',{text:tr("确认后仍可继续修改这里的过程记录；主笔记始终是本讲唯一的正式 Markdown。")});
    const done=finish.createEl('button',{text:flow.milestones.previewedAt?tr("已确认预习"):tr("确认完成预习"),cls:'lh-primary'});done.disabled=!!flow.milestones.previewedAt;
    done.onclick=()=>{if(!flow.preview.concepts.length||flow.preview.concepts.some(c=>!c.status)){new Notice(tr("请先为每个知识块标记理解或疑问"));return;}new ConfirmModal(this.app,tr("确认预习完成"),tr("已逐项检查本讲知识块，并记录不理解的地方。确认后会更新课程进度。"),tr("确认预习完成"),async()=>{await this.markStage(file,'previewed');await this.rerenderLesson(file);}).open();};
    if(flow.milestones.previewedAt){
      const notePanel=main.createDiv({cls:'lh-flow-panel lh-ai-draft'});
      const noteHead=notePanel.createDiv({cls:'lh-flow-section-head'});noteHead.createEl('h2',{text:tr("唯一主笔记")});
      const noteAnalysis=this.noteAnalysisByLesson?.get(file.path);
      if(noteAnalysis)this.renderNoteGenerationProgress(notePanel,file,noteAnalysis);
      else if(this.noteErrors?.has(file.path))notePanel.createDiv({text:this.noteErrors.get(file.path),cls:'lh-note-generation-error'});
      if(!flow.noteAppliedAt){
        const noteButton=noteHead.createEl('button',{text:flow.noteDraft?tr("重新生成草案"):tr("AI 整理主笔记草案"),cls:'lh-inline-action'});
        noteButton.disabled=!!noteAnalysis;
        noteButton.onclick=async()=>{noteButton.disabled=true;noteButton.setText(tr("正在整理主笔记…"));try{await this.generateNoteDraft(file);}catch(error){console.error('Learning Hub note AI:',error);new Notice(error.message);}finally{noteButton.disabled=false;noteButton.setText(tr("AI 整理主笔记草案"));}};
      }
      if(flow.noteDraft){
        notePanel.createEl('p',{text:tr("先检查草案，再追加到唯一主笔记；现有课堂批注不会被覆盖。"),cls:'lh-flow-muted'});
        const preview=notePanel.createEl('textarea',{cls:'lh-note-draft-preview',attr:{readonly:'true'}});preview.value=flow.noteDraft.markdown;
        const controls=notePanel.createDiv({cls:'lh-confirm-actions'});
        const apply=controls.createEl('button',{text:tr("追加到主笔记"),cls:'lh-primary'});
        apply.onclick=()=>new ConfirmModal(this.app,tr("写入主笔记"),tr("草案将直接写入现有「主笔记」部分；已有内容与批注会保留。"),tr("确认写入"),async()=>{const current=await this.app.vault.read(file);const body=flow.noteDraft.markdown.trim();const mainHeading=/^## 主笔记\s*$/m;const updated=mainHeading.test(current)?`${current.trimEnd()}\n\n${body}\n`:`${current.trimEnd()}\n\n## 主笔记\n\n${body}\n`;await this.app.vault.modify(file,updated);flow.noteAppliedAt=now();delete flow.noteDraft;await this.saveFlow(file,flow);await this.rerenderLesson(file);}).open();
        const discard=controls.createEl('button',{text:tr("舍弃草案")});discard.onclick=async()=>{delete flow.noteDraft;await this.saveFlow(file,flow);await this.rerenderLesson(file);};
      }else notePanel.createEl('p',{text:flow.noteAppliedAt?tr("主笔记已建立。接下来可以在 Markdown 中继续批注与补充课堂内容。"):tr("确认预习后，可从课件与疑问整理一份主笔记草案。"),cls:'lh-flow-muted'});
    }
    const resources=main.createDiv({cls:'lh-preview-resources'});
    const pdfs=this.pdfs(file);resources.createSpan({text:pdfs.length?tr("本讲 PDF 课件 · {0} 份", [pdfs.length]):tr("尚未上传 PDF 课件")});

    const note=resources.createEl('button',{text:tr("打开主笔记 ↗"),cls:'lh-inline-action'});note.onclick=()=>this.open(file.path);
  }
  sessionQuestions(flow,mode,round){
    if(mode==='recall')return flow.recall.questions;
    const record=flow.reviews.rounds[round-1];
    return round===1?[...flow.recall.questions,...record.questions]:record.questions;
  }
  renderQuestionSession(el,file,flow,mode,round,course){
    const record=mode==='recall'?flow.recall:flow.reviews.rounds[round-1],questions=this.sessionQuestions(flow,mode,round);
    const panel=el.createDiv({cls:'lh-flow-panel lh-question-panel'});
    const head=panel.createDiv({cls:'lh-flow-section-head'});head.createEl('h2',{text:mode==='recall'?tr("引导问题"):round===1?tr("核心提取与薄弱点"):round===2?tr("方法选择与应用"):tr("跨讲次混合练习")});
    const ai=head.createEl('button',{text:tr("AI 生成问题草案"),cls:'lh-inline-action'});
    ai.onclick=async()=>{ai.disabled=true;ai.setText(tr("正在生成问题…"));try{await this.generateQuestionDraft(course,file,mode,round);}catch(error){console.error('Learning Hub question AI:',error);new Notice(error.message);}finally{ai.disabled=false;ai.setText(tr("AI 生成问题草案"));}};
    const add=head.createEl('button',{text:tr("＋ 添加问题"),cls:'lh-inline-action'});
    add.onclick=()=>new EntryModal(this.app,tr("添加复习问题"),[{key:'title',label:tr("问题"),multiline:true},{key:'answer',label:tr("参考答案（可稍后补充）"),multiline:true},{key:'source',label:tr("对应讲次（可选）"),placeholder:tr("当前讲次或其他讲次路径")}],async value=>{record.questions.push({id:crypto.randomUUID(),prompt:value.title,answer:value.answer,sourceLessonPath:value.source||file.path});await this.saveFlow(file,flow);await this.rerenderLesson(file);}).open();
    if(record.questionDraft){
      const draft=panel.createDiv({cls:'lh-ai-draft lh-question-draft'});
      draft.createEl('h3',{text:tr("待确认的 AI 问题 · {0} 道", [record.questionDraft.questions.length])});
      for(const q of record.questionDraft.questions){const row=draft.createDiv({cls:'lh-question-draft-item'});row.createEl('strong',{text:q.prompt});row.createEl('p',{text:tr("参考：{0}", [q.answer])});}
      const actions=draft.createDiv({cls:'lh-confirm-actions'});
      const apply=actions.createEl('button',{text:tr("采用这些问题"),cls:'lh-primary'});
      apply.onclick=()=>new ConfirmModal(this.app,tr("采用 AI 问题"),tr("将这些问题加入当前回忆或复习；作答前参考答案仍会隐藏。"),tr("确认采用"),async()=>{const fresh=await this.readFlow(file);const target=mode==='recall'?fresh.recall:fresh.reviews.rounds[round-1];for(const q of target.questionDraft.questions)target.questions.push({id:crypto.randomUUID(),...q,sourceLessonPath:file.path,sourceAssignmentId:target.questionDraft.assignment?.id||null,sourceAssignmentTitle:target.questionDraft.assignment?.title||'',sourceFilePaths:target.questionDraft.assignment?.files?.map(f=>f.path)||[],generatedBy:'codex',createdAt:now()});delete target.questionDraft;await this.saveFlow(file,fresh);await this.rerenderLesson(file);}).open();
      const discard=actions.createEl('button',{text:tr("舍弃草案")});discard.onclick=async()=>{delete record.questionDraft;await this.saveFlow(file,flow);await this.rerenderLesson(file);};
    }
    if(!questions.length)panel.createDiv({text:tr("还没有问题。可以让 AI 生成草案，或手动添加。"),cls:'lh-flow-empty'});
    record.drafts=record.drafts||{};
    for(const [index,question] of questions.entries()){
      const card=panel.createDiv({cls:'lh-question'});card.createDiv({text:tr("QUESTION {0}", [String(index+1).padStart(2,'0')]),cls:'lh-eyebrow'});card.createEl('h3',{text:question.prompt});
      if(question.sourceAssignmentId){const source=card.createDiv({cls:'lh-question-source'});source.createSpan({text:tr("参考作业 · {0} · {1}", [question.sourceAssignmentTitle||tr("作业"), question.topic||tr("知识点")])});for(const path of question.sourceFilePaths||[]){const file=source.createEl('button',{text:path.split('/').at(-1)});file.onclick=()=>this.open(path);}}
      const latest=record.attempts.filter(a=>a.questionId===question.id).at(-1),draft=record.drafts[question.id]||{};
      if(latest){card.createDiv({text:tr("已记录 · {0}", [latest.rating==='know'?tr("会"):latest.rating==='unsure'?tr("不确定"):tr("不会")]),cls:`lh-question-result is-${latest.rating}`});continue;}
      const answer=this.workflowField(card,tr("先写下自己的答案"),draft.answer||'',async value=>{record.drafts[question.id]={...record.drafts[question.id],answer:value};await this.saveFlow(file,flow);},tr("先独立回忆，不要查看主笔记。"));
      if(draft.revealedAt){answer.disabled=true;const reference=card.createDiv({cls:'lh-reference'});reference.createDiv({text:tr("参考内容"),cls:'lh-eyebrow'});reference.createEl('p',{text:question.answer||tr("参考答案尚未准备；先根据自己的理解自评，AI 内容接入后再补充。")});
        const ratings=card.createDiv({cls:'lh-rating-actions'});
        for(const [rating,label] of [['know',tr("会")],['unsure',tr("不确定")],['dont-know',tr("不会")]]){const button=ratings.createEl('button',{text:label,cls:'lh-choice'});button.onclick=async()=>{const attempt={questionId:question.id,answer:draft.answer||'',rating,at:now(),mode,round:round||null};record.attempts.push(attempt);delete record.drafts[question.id];await this.saveFlow(file,flow);if(rating!=='know')await this.logError(file,{questionId:question.id,prompt:question.prompt,answer:attempt.answer,reference:question.answer||'',rating,mode,round:round||null,sourceLessonPath:question.sourceLessonPath||file.path,sourceAssignmentId:question.sourceAssignmentId||null,sourceAssignmentTitle:question.sourceAssignmentTitle||'',topic:question.topic||''});await this.rerenderLesson(file);};}
      }else{const reveal=card.createEl('button',{text:tr("我已作答 · 查看参考内容"),cls:'lh-secondary'});reveal.onclick=async()=>{const value=answer.value.trim();if(!value){new Notice(tr("请先写下自己的答案"));return;}record.drafts[question.id]={answer:value,revealedAt:now()};await this.saveFlow(file,flow);await this.rerenderLesson(file);};}
    }
    const celebration=this.celebrateFlow?.path===file.path&&this.celebrateFlow.mode===mode&&this.celebrateFlow.round===round&&this.celebrateFlow.until>Date.now();
    const finish=el.createDiv({cls:`lh-flow-finish${celebration?' is-celebrating':''}`});
    const completed=!!record.completedAt;finish.createEl('strong',{text:completed?tr("本轮已完成"):mode==='recall'?tr("完成引导式回忆"):tr("完成第 {0} 轮复习", [round])});
    finish.createEl('p',{text:completed?tr("结果已保存在隐藏 JSON 中。"):tr("所有题目都完成自评后，才可以确认结束。")});
    const done=finish.createEl('button',{text:completed?tr("已完成"):tr("确认本轮完成"),cls:'lh-primary'});done.disabled=completed;
    done.onclick=()=>{if(!questions.length||questions.some(q=>!record.attempts.some(a=>a.questionId===q.id))){new Notice(tr("请先完成每道题的作答与自评"));return;}new ConfirmModal(this.app,mode==='recall'?tr("确认回忆完成"):tr("确认第 {0} 轮复习", [round]),tr("确认所有题目已经先作答、再查看参考内容并完成自评。薄弱点会保存在 Error Log 中。"),tr("确认完成"),async()=>{record.completedAt=now();this.celebrateFlow={path:file.path,mode,round,until:Date.now()+1600};await this.saveFlow(file,flow,true);if(mode==='review'&&round===3)await this.markStage(file,'reviewed');await this.rerenderLesson(file);}).open();};
  }
  async renderReview(el,file,flow,round,course){
    const plan=this.reviewPlan(flow),current=plan[round-1];
    if(!current){el.createDiv({text:tr("复习轮次无效。"),cls:'lh-empty'});return;}
    const rail=el.createDiv({cls:'lh-review-plan'});
    for(const entry of plan){const item=rail.createEl('button',{cls:`lh-review-plan-item${entry.round===round?' is-current':''}${entry.completedAt?' is-done':''}`});item.createEl('strong',{text:tr(entry.title)});item.createSpan({text:entry.completedAt?tr("已完成"):entry.due||tr("待排期")});item.onclick=()=>this.showWorkflow('review',course,file.path,entry.round);}
    if(!current.unlocked&&!current.completedAt){const lock=el.createDiv({cls:'lh-review-locked'});setIcon(lock.createSpan(),'lock-keyhole');lock.createEl('h2',{text:tr("本轮尚未解锁")});lock.createEl('p',{text:!flow.milestones.learnedAt?tr("先确认课堂学习，才能建立复习日期。"):!flow.recall.completedAt?tr("先完成引导式回忆，再开始间隔复习。"):plan[round-2]&&!plan[round-2].completedAt?tr("先完成上一轮复习。"):tr("预计 {0} 解锁。", [current.due])});return;}
    const brief=el.createDiv({cls:'lh-review-brief'});brief.createEl('strong',{text:tr(current.subtitle)});brief.createSpan({text:tr("建议 {0} · {1} 到期", [tr(current.minutes), current.due])});
    const source=el.createDiv({cls:'lh-review-homework'});
    const sourceHead=source.createDiv({cls:'lh-review-homework-head'});sourceHead.createEl('h2',{text:tr("参考作业")});sourceHead.createSpan({text:tr("按标注知识点出引导题 · 原件可打开")});
    const assignments=(await this.readAssignments(course)).assignments.filter(a=>a.importStatus!=='uploading');
    if(!assignments.length){const empty=source.createDiv({cls:'lh-review-homework-empty'});empty.createSpan({text:tr("还没有可参考的作业。")});const link=empty.createEl('button',{text:tr("打开作业档案 →")});link.onclick=()=>this.openHub('assignments',course);}
    else{
      const choices=source.createDiv({cls:'lh-review-homework-list'});
      for(const assignment of assignments){
        const row=choices.createDiv({cls:'lh-review-homework-row'});
        const details=row.createDiv();details.createEl('strong',{text:assignment.title});details.createSpan({text:tr("难度 {0}/5 · {1}{2}", [assignment.difficulty||3, (assignment.topics||[]).slice(0,3).join('、')||tr("未标注知识点"), assignment.archivedAt?tr(" · 已归档"):''])});
        const added=flow.reviews.rounds[round-1].questions.some(q=>q.sourceAssignmentId===assignment.id);
        const action=row.createEl('button',{text:added?tr("已用于本轮"):current.completedAt?tr("本轮已完成"):tr("AI 根据作业出题"),cls:'lh-secondary'});
        action.disabled=!!current.completedAt||!assignment.topics?.length;
        action.onclick=()=>this.generateReviewFromHomework(course,file,assignment,round);
      }
    }
    this.renderQuestionSession(el,file,flow,'review',round,course);
  }
  async upload(lesson){
    const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.pdf,.ppt,.pptx';
    input.onchange=async()=>{
      const files=Array.from(input.files||[]);if(!files.length)return;
      const {imported,failed}=await this.importLessonFiles(lesson.parent.path,files);
      if(!imported.length){new Notice(tr("课件导入失败：{0}", [failed.join('、')]),7000);return;}
      new Notice(tr("已导入 {0} 份课件到 {1}{2}", [imported.length, lesson.basename, failed.length?tr("；{0} 份失败：{1}", [failed.length, failed.join('、')]):'']),7000);this.refreshBlocks();
      const firstPdf=imported.find(item=>item.isPdf);
      if(firstPdf){const course=lesson.path.slice(ROOT.length+1).split('/')[0];await this.showWorkflow('preview',course,lesson.path,0,firstPdf.path);void this.generatePreviewDraft(lesson).catch(error=>{console.error('Learning Hub preview AI:',error);new Notice(tr("课件已保存；预习内容未生成：{0}", [error.message]),7000);});}
    };input.click();
  }
  async generatePreviewDraft(lesson){
    this.analysisByLesson=this.analysisByLesson||new Map();
    if(this.analysisByLesson.has(lesson.path))throw new Error(tr("这讲课件正在解析，请稍候。"));
    this.previewErrors=this.previewErrors||new Map();this.previewErrors.delete(lesson.path);
    const analysis={phase:'extract',startedAt:Date.now(),lessonPath:lesson.path,inputChars:0,receivedChars:0,tokenUsage:null,reasoningSummary:'',reasoningIndex:null,filesProcessed:0,fileCount:this.pdfs(lesson).length,model:this.state.ai.model||tr('默认模型'),effort:this.state.ai.effort||tr('默认强度')};
    const setPhase=async phase=>{analysis.phase=phase;this.analysisByLesson.set(lesson.path,analysis);await this.rerenderLesson(lesson);this.updatePreviewProgress(analysis);};
    const ticker=setInterval(()=>this.updatePreviewProgress(analysis),1000);
    await setPhase('extract');
    try{
      const {pdfs,text:slides}=await this.extractLessonSlides(lesson,(pdf,index,count)=>{analysis.currentFile=pdf.name;analysis.filesProcessed=index+1;analysis.fileCount=count;this.updatePreviewProgress(analysis);});
      analysis.inputChars=slides.length;
      analysis.pages=(slides.match(/\[第 \d+ 页\]/g)||[]).length;
      await setPhase('queued');
      const course=lesson.path.slice(ROOT.length+1).split('/')[0];
      const result=validatePreviewDraft(await this.runAi(previewPrompt(course,lesson.basename,pdfs.map(pdf=>pdf.name),slides,this.state.ai.language),previewSchema,{
        timeoutMs:PREVIEW_TIMEOUT_MS,
        onStatus:phase=>{analysis.phase=phase;this.updatePreviewProgress(analysis);},
        onProgress:delta=>{analysis.receivedChars+=String(delta||'').length;analysis.phase='receiving';this.updatePreviewProgress(analysis);},
        onTokenUsage:usage=>{analysis.tokenUsage=usage;this.updatePreviewProgress(analysis);},
        onReasoningSummary:(delta,index)=>{
          if(typeof index==='number'&&analysis.reasoningIndex!==index)analysis.reasoningSummary='';
          if(typeof index==='number')analysis.reasoningIndex=index;
          analysis.reasoningSummary+=delta;
          this.updatePreviewProgress(analysis);
          this.renderPreviewReasoning(analysis);
        },
      }));
      analysis.phase='saving';this.updatePreviewProgress(analysis);
      const flow=await this.readFlow(lesson);
      flow.preview={...mergeGeneratedPreview(flow.preview,result,()=>crypto.randomUUID()),sourcePath:pdfs[0].path,sourceName:pdfs[0].name,sourcePaths:pdfs.map(pdf=>pdf.path),sourceNames:pdfs.map(pdf=>pdf.name),generatedAt:now()};
      delete flow.previewDraft;
      if(flow.lessonTitleSource!=='manual'){flow.lessonTitle=result.title;flow.lessonTitleSource='ai';}
      await this.saveFlow(lesson,flow);
      await this.refreshNav();
      for(const leaf of this.app.workspace.getLeavesOfType(MAIN))if(leaf.view?.page==='lesson'&&leaf.view.course===course)await leaf.view.render();
      new Notice(tr("《{0}》预习内容已生成。", [flow.lessonTitle||result.title]),7000);
    }catch(error){
      const hint=/生成超过.*分钟|generation exceeded.*min/i.test(error.message)?tr('这份课件较长；可降低 Codex 思考强度后重试。'):tr('请检查 PDF 文字或 AI 设置后重试。');
      this.previewErrors.set(lesson.path,tr("生成失败：{0}。{1}", [error.message,hint]));
      throw error;
    }finally{clearInterval(ticker);clearTimeout(analysis.reasoningRenderTimer);this.analysisByLesson.delete(lesson.path);await this.rerenderLesson(lesson);}
  }
  async generateNoteDraft(lesson){
    this.noteAnalysisByLesson||=new Map();this.noteErrors||=new Map();
    if(this.noteAnalysisByLesson.has(lesson.path))throw new Error(tr("主笔记正在整理，请稍候。"));
    const flow=await this.readFlow(lesson);
    if(!flow.milestones.previewedAt)throw new Error(tr("先完成预习理解检查，再整理主笔记。"));
    if(flow.noteAppliedAt)throw new Error(tr("主笔记已经生成，请直接在原 Markdown 中继续完善。"));
    this.noteErrors.delete(lesson.path);
    const analysis={phase:'extract',startedAt:Date.now(),lessonPath:lesson.path,inputChars:0,receivedChars:0,tokenUsage:null,reasoningSummary:'',reasoningIndex:null,filesProcessed:0,fileCount:this.pdfs(lesson).length,model:this.state.ai.model||tr('默认模型'),effort:this.state.ai.effort||tr('默认强度')};
    this.noteAnalysisByLesson.set(lesson.path,analysis);
    const ticker=setInterval(()=>this.updateNoteProgress(analysis),1000);
    await this.rerenderLesson(lesson);
    try{
      const {pdfs,text:slides}=await this.extractLessonSlides(lesson,(pdf,index,count)=>{analysis.currentFile=pdf.name;analysis.filesProcessed=index+1;analysis.fileCount=count;this.updateNoteProgress(analysis);});
      analysis.inputChars=slides.length;analysis.phase='queued';this.updateNoteProgress(analysis);
      const course=lesson.path.slice(ROOT.length+1).split('/')[0];
      const raw=await this.runAi(notePrompt({course,lesson:lesson.basename,slides,preview:flow.preview,language:this.state.ai.language}),noteSchema,{
        timeoutMs:PREVIEW_TIMEOUT_MS,
        onStatus:phase=>{analysis.phase=phase;this.updateNoteProgress(analysis);},
        onProgress:delta=>{analysis.receivedChars+=String(delta||'').length;analysis.phase='receiving';this.updateNoteProgress(analysis);},
        onReasoningSummary:(delta,index)=>{if(typeof index==='number'&&analysis.reasoningIndex!==index)analysis.reasoningSummary='';if(typeof index==='number')analysis.reasoningIndex=index;analysis.reasoningSummary+=delta;this.updateNoteProgress(analysis);this.renderNoteReasoning(analysis);},
        onTokenUsage:usage=>{analysis.tokenUsage=usage;this.updateNoteProgress(analysis);},
      });
      analysis.phase='saving';this.updateNoteProgress(analysis);
      const markdown=validateNoteDraft(raw);
      flow.noteDraft={markdown,sourcePath:pdfs[0].path,sourcePaths:pdfs.map(pdf=>pdf.path),createdAt:now()};
      await this.saveFlow(lesson,flow);new Notice(tr("主笔记草案已生成，请核对后写入。"));
    }catch(error){this.noteErrors.set(lesson.path,tr("生成失败：{0}", [error.message]));throw error;}
    finally{clearInterval(ticker);clearTimeout(analysis.reasoningRenderTimer);this.noteAnalysisByLesson.delete(lesson.path);await this.rerenderLesson(lesson);}
  }
  async generateQuestionDraft(course,lesson,mode,round=0,assignment=null){
    const flow=await this.readFlow(lesson);
    if(mode==='review'&&!this.reviewPlan(flow)[round-1]?.unlocked)throw new Error(tr("本轮复习尚未解锁。"));
    const note=await this.app.vault.read(lesson);
    const errors=[...await this.readErrorEntries(this.errorPath(lesson)),...await this.readErrorEntries(this.courseErrorPath(course))];
    let assignmentText='';
    if(assignment){try{assignmentText=await this.app.vault.adapter.read(this.homeworkContentPath(course,assignment.id));}catch(_){/* Older assignment; use source PDF below. */}}
    const sourcePdf=assignment?.files?.find(file=>file.path?.toLowerCase().endsWith('.pdf'));
    if(sourcePdf&&!assignmentText){try{assignmentText=await extractPdfText(path.join(this.vaultPath(),sourcePdf.path),this.state.ai.pdfExtractor);}catch(error){console.warn('Learning Hub homework text:',error);}}
    const otherLessons=[];
    if(mode==='review'&&round===3){
      for(const other of this.lessons(course)){
        if(other.path===lesson.path||!this.scope(other,course))continue;
        const otherFlow=await this.readFlow(other);
        if(!otherFlow.milestones.learnedAt)continue;
        otherLessons.push({lesson:other.basename,note:await this.app.vault.read(other)});
      }
    }
    const raw=await this.runAi(questionsPrompt({course,lesson:lesson.basename,mode,round,note,preview:flow.preview,errors,assignment:assignment?{title:assignment.title,difficulty:assignment.difficulty,topics:assignment.topics}:null,assignmentText,otherLessons,language:this.state.ai.language}),questionsSchema);
    const questions=validateQuestions(raw);
    const fresh=await this.readFlow(lesson),record=mode==='recall'?fresh.recall:fresh.reviews.rounds[round-1];
    record.questionDraft={questions,assignment:assignment?{id:assignment.id,title:assignment.title,files:assignment.files}:null,createdAt:now()};
    await this.saveFlow(lesson,fresh);await this.rerenderLesson(lesson);
    new Notice(tr("问题草案已生成，请核对后采用。"));
  }
};
