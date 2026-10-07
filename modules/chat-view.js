const {translate} = require('./i18n');
const {ItemView,MarkdownRenderer,Notice,setIcon}=require('obsidian');
const {randomUUID}=require('crypto');
const {DEEPSEEK_MODELS,studyContext}=require('./deepseek-chat');
const {normalizeDeepSeekUsage,renderTokenUsage}=require('./token-usage');
const {estimateDeepSeekCost}=require('./deepseek-pricing');
const {mentionAt,searchContextFiles}=require('./chat-context');

const CHAT_VIEW_TYPE='learning-hub-chat';
const EFFORTS=[['none','快速'],['low','思考 · 低'],['high','思考 · 高'],['max','思考 · 最大']];
const ERROR_COPY={AUTH:'DeepSeek API Key 无效或没有访问权限。',BALANCE:'DeepSeek 账户余额不足。',RATE_LIMIT:'DeepSeek 请求过于频繁，请稍后重试。',SERVER:'DeepSeek 服务暂时不可用，请稍后重试。',HTTP:'DeepSeek 请求失败（HTTP {0}）。',CANCELLED:'已停止生成。',INTERRUPTED:'连接中断，回答尚未完成，请重试。',TIMEOUT:'响应超时，请重试。',NETWORK:'无法连接 DeepSeek，请检查网络连接。',TRUNCATED:'生成达到模型服务的长度上限，回答未完成。',EMPTY_RESPONSE:'DeepSeek 未返回可显示的回答。',INCOMPLETE:'回答尚未完成，请重试。',MISSING_KEY:'请先在设置中填写 DeepSeek API Key。'};
const stamp=()=>new Date().toISOString();

class LearningChatView extends ItemView{
  constructor(leaf,plugin){super(leaf);this.plugin=plugin;this.store=null;this.draftConversation=null;this.busy=false;this.draftText='';this.pendingMessage='';this.showHistory=false;this.attachments=[];}
  tr(key,values=[]){return translate(this.plugin.state?.deepseek?.language||this.plugin.state?.interfaceLanguage,key,values);}
  locale(){return this.plugin.state?.deepseek?.language==='en'?'en-US':'zh-CN';}
  getViewType(){return CHAT_VIEW_TYPE;}
  getDisplayText(){return this.tr("学习助手");}
  getIcon(){return 'message-circle';}
  async onOpen(){
    this.contentEl.addClass('lh-chat-root');this.store=await this.plugin.chatStore.load();
    for(const event of ['active-leaf-change','file-open','layout-change'])this.registerEvent(this.app.workspace.on(event,()=>this.queueContextRefresh()));
    const doc=this.contentEl.ownerDocument,win=doc.defaultView;
    this.registerDomEvent(win,'resize',()=>this.syncBottomInset());
    this.insetObserver=new win.ResizeObserver(()=>this.syncBottomInset());this.insetObserver.observe(this.contentEl);
    const status=doc.querySelector('.status-bar');if(status)this.insetObserver.observe(status);
    await this.render();
  }
  async onClose(){this.closed=true;clearTimeout(this.streamTimer);this.abortController?.abort();clearTimeout(this.contextTimer);this.contextVersion=(this.contextVersion||0)+1;this.insetObserver?.disconnect();}
  queueContextRefresh(){clearTimeout(this.contextTimer);this.contextTimer=setTimeout(()=>void this.refreshContext(),80);}
  syncBottomInset(){
    const root=this.contentEl,bar=root.ownerDocument.querySelector('.status-bar'),r=root.getBoundingClientRect(),b=bar?.getBoundingClientRect();
    const overlap=b&&b.width&&b.height&&r.right>b.left&&r.left<b.right&&r.bottom>b.top&&r.top<b.bottom?Math.min(b.height,r.bottom-b.top):0;
    root.style.setProperty('--lh-chat-bottom-inset',`${Math.ceil(overlap)}px`);
  }
  async refreshContext(){
    const version=this.contextVersion=(this.contextVersion||0)+1;
    const context=await this.plugin.captureChatContext();
    if(version!==this.contextVersion||!this.contextBar?.isConnected)return;
    this.contextSnapshot=context;const bar=this.contextBar;bar.empty();
    setIcon(bar.createSpan({cls:'lh-chat-context-icon'}),'paperclip');
    const copy=bar.createDiv({cls:'lh-chat-context-copy'});
    copy.createSpan({text:context.label||this.tr('未关联页面'),cls:'lh-chat-context-title'});
    copy.createSpan({text:context.path?this.tr('当前页面自动附上'):this.tr('打开笔记或课件后自动附上'),cls:'lh-chat-context-subtitle'});
    if(context.selectedText){
      const selected=bar.createDiv({cls:'lh-chat-selection',attr:{title:context.selectedText}});
      selected.createSpan({text:this.tr('选中 {0} 字',[context.selectedText.length]),cls:'lh-chat-context-badge'});
      selected.createSpan({text:context.selectedText,cls:'lh-chat-selection-text'});
    }
    this.syncBottomInset();
  }
  sessionTitle(session){return session.title==='新对话'&&!session.messages?.length?this.tr('新对话'):session.title;}
  active(){return this.draftConversation||this.store?.sessions.find(session=>session.id===this.store.activeId)||null;}
  async persist(){this.store=await this.plugin.chatStore.save(this.store);}
  async newConversation(){
    if(this.busy)return;
    this.failedReply=null;this.interruptedStream='';
    const session={id:randomUUID(),title:'新对话',createdAt:stamp(),updatedAt:stamp(),model:this.plugin.state.deepseek.model,effort:this.plugin.state.deepseek.effort,messages:[]};
    this.draftConversation=session;this.showHistory=false;await this.render();
  }
  async selectConversation(id){if(this.busy||!this.store.sessions.some(session=>session.id===id))return;this.draftConversation=null;this.store.activeId=id;this.showHistory=false;this.failedReply=null;this.interruptedStream='';await this.persist();await this.render();}
  async updateSelection(key,value){
    const session=this.active();
    if(session){session[key]=value;session.updatedAt=stamp();await this.persist();}
    this.plugin.state.deepseek[key]=value;await this.plugin.saveData(this.plugin.state);
    await this.render();
  }
  async render(){
    const root=this.contentEl;root.empty();root.addClass('lh-chat-root');
    const shell=root.createDiv({cls:'lh-chat-shell'});
    const head=shell.createDiv({cls:'lh-chat-head'});
    const identity=head.createDiv({cls:'lh-chat-identity'});identity.createEl('h2',{text:this.tr("学习助手")});
    const headerActions=head.createDiv({cls:'lh-chat-head-actions'});
    const languageButton=headerActions.createEl('button',{text:this.plugin.state.deepseek.language==='en'?'EN':'中文',cls:'lh-chat-language',attr:{title:this.tr('学习助手语言'),'aria-label':this.tr('切换学习助手语言')}});languageButton.disabled=this.busy;languageButton.onclick=()=>this.plugin.setAssistantLanguage(this.plugin.state.deepseek.language==='en'?'zh-CN':'en');
    const historyButton=headerActions.createEl('button',{cls:'lh-chat-icon',attr:{title:this.tr("历史对话"),'aria-label':this.tr("历史对话")}});setIcon(historyButton,'history');historyButton.disabled=this.busy;historyButton.onclick=()=>{this.showHistory=!this.showHistory;void this.render();};
    const newButton=headerActions.createEl('button',{cls:'lh-chat-icon',attr:{title:this.tr("新对话"),'aria-label':this.tr("新对话")}});setIcon(newButton,'square-pen');newButton.disabled=this.busy;newButton.onclick=()=>this.newConversation();
    const conversation=this.active();
    if(this.showHistory){
      const drawer=shell.createDiv({cls:'lh-chat-history'});const drawerHead=drawer.createDiv({cls:'lh-chat-history-head'});drawerHead.createEl('strong',{text:this.tr("历史对话")});drawerHead.createSpan({text:this.tr("{0} 条", [this.store.sessions.length])});
      if(!this.store.sessions.length)drawer.createDiv({text:this.tr("还没有历史对话。"),cls:'lh-chat-history-empty'});
      for(const session of [...this.store.sessions].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))){
        const entry=drawer.createEl('button',{cls:`lh-chat-history-item${session.id===conversation?.id?' is-current':''}`});
        entry.createEl('strong',{text:this.sessionTitle(session)});entry.createSpan({text:session.updatedAt?new Date(session.updatedAt).toLocaleString(this.locale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):this.tr("未开始")});
        entry.onclick=()=>this.selectConversation(session.id);
      }
    }
    const controls=shell.createDiv({cls:'lh-chat-controls'});
    const mode=controls.createDiv({cls:'lh-chat-mode'});
    const modelField=mode.createEl('label',{cls:'lh-chat-picker'});setIcon(modelField.createSpan(),'cpu');
    const model=modelField.createEl('select',{attr:{'aria-label':this.tr("DeepSeek 模型")}});
    for(const option of DEEPSEEK_MODELS)model.createEl('option',{text:option.label,attr:{value:option.id}});
    model.value=conversation?.model||this.plugin.state.deepseek.model;model.disabled=this.busy;model.onchange=()=>this.updateSelection('model',model.value);
    const effortField=mode.createEl('label',{cls:'lh-chat-picker'});setIcon(effortField.createSpan(),'sparkles');
    const effort=effortField.createEl('select',{attr:{'aria-label':this.tr("思考强度")}});
    for(const [id,label] of EFFORTS)effort.createEl('option',{text:this.tr(label),attr:{value:id}});
    effort.value=conversation?.effort||this.plugin.state.deepseek.effort;effort.disabled=this.busy;effort.onchange=()=>this.updateSelection('effort',effort.value);
    this.contextBar=shell.createDiv({cls:'lh-chat-context'});await this.refreshContext();
    const context=this.contextSnapshot||{};
    const messages=shell.createDiv({cls:'lh-chat-messages'});
    if(!conversation?.messages.length&&!this.pendingMessage&&!this.failedReply&&!this.interruptedStream){const empty=messages.createDiv({cls:'lh-chat-empty'});setIcon(empty.createSpan(),'sparkles');empty.createEl('strong',{text:this.tr("从当前内容开始提问")});empty.createEl('p',{text:this.tr("解释选文、梳理概念，或继续追问。")});}
    for(const message of conversation?.messages||[])await this.renderMessage(messages,message,context.path);
    if(this.pendingMessage){await this.renderMessage(messages,{role:'user',content:this.pendingMessage,selectedText:this.pendingSelection},context.path);
      const streaming=messages.createDiv({cls:'lh-chat-message is-assistant'});streaming.createDiv({text:this.tr('学习助手'),cls:'lh-chat-message-role'});const reasoning=this.renderReasoning(streaming,this.streamReasoning||'',true);this.reasoningBox=reasoning.box;this.reasoningBody=reasoning.body;this.reasoningStatus=reasoning.status;this.streamHost=streaming.createDiv({cls:'lh-chat-message-content markdown-rendered'});this.streamStatus=streaming.createDiv({cls:'lh-chat-stream-status'});this.streamStatus.setText(this.tr('正在思考并整理回答…'));if(this.streamText||this.streamReasoning)await this.paintStream();}
    this.messagesEl=messages;
    if(this.failedReply||this.interruptedStream){await this.renderMessage(messages,this.failedReply||{role:'assistant',content:this.interruptedStream},context.path);messages.lastElementChild.createDiv({text:this.tr('回答未完成'),cls:'lh-chat-stream-status'});}
    const composer=shell.createDiv({cls:'lh-chat-composer'});
    if(this.attachments.length){const attached=composer.createDiv({cls:'lh-chat-attachments'});for(const path of this.attachments){const chip=attached.createEl('button',{cls:'lh-chat-attachment',attr:{title:path,'aria-label':this.tr("移除 {0}", [path])}});setIcon(chip, 'file-text');chip.createSpan({text:path.split('/').at(-1)});setIcon(chip.createSpan({cls:'lh-chat-remove'}),'x');chip.onclick=()=>{this.attachments=this.attachments.filter(item=>item!==path);void this.render();};}}
    const input=composer.createEl('textarea',{attr:{placeholder:this.plugin.state.deepseek.apiKey?this.tr("提问，输入 @ 引用文件…"):this.tr("先在插件设置中填写 DeepSeek API Key…"),'aria-label':this.tr("向学习助手提问")}});input.value=this.draftText;input.disabled=this.busy;
    const mentionMenu=composer.createDiv({cls:'lh-chat-mention-menu'});mentionMenu.hidden=true;
    const updateMentions=()=>{
      this.draftText=input.value;mentionMenu.empty();
      const token=mentionAt(input.value,input.selectionStart);if(!token||this.attachments.length>=4){mentionMenu.hidden=true;return;}
      const matches=searchContextFiles(this.app.vault.getFiles(),token.query).filter(file=>!this.attachments.includes(file.path));
      mentionMenu.hidden=!matches.length;
      for(const file of matches){const option=mentionMenu.createEl('button',{cls:'lh-chat-mention-item',attr:{type:'button'}});option.createSpan({text:file.basename});option.createEl('small',{text:file.path});option.onmousedown=event=>event.preventDefault();option.onclick=()=>{this.attachments.push(file.path);input.value=input.value.slice(0,token.start)+input.value.slice(token.end);this.draftText=input.value;void this.render();};}
    };
    input.oninput=updateMentions;
    input.onkeyup=event=>{if(event.key!=='Enter')updateMentions();};
    input.onkeydown=event=>{if(event.key==='Escape'&&!mentionMenu.hidden){event.preventDefault();mentionMenu.hidden=true;return;}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(!mentionMenu.hidden){mentionMenu.querySelector('button')?.click();return;}void this.send(input.value);}};
    const bottom=composer.createDiv({cls:'lh-chat-composer-bottom'});
    bottom.createSpan({text:this.tr("当前页面 · 选中内容 · @文件")});
    const send=bottom.createEl('button',{text:this.busy?this.tr('停止'):this.tr('发送'),cls:'lh-chat-send'});send.onclick=()=>this.busy?this.abortController?.abort():this.send(input.value);
    if(!this.plugin.state.deepseek.apiKey){const hint=composer.createEl('button',{text:this.tr("前往设置添加 API Key →"),cls:'lh-chat-settings-link'});hint.onclick=()=>{this.app.setting?.open?.();this.app.setting?.openTabById?.(this.plugin.manifest.id);};}
    messages.scrollTop=messages.scrollHeight;this.syncBottomInset();
  }
  async renderMessage(host,message,sourcePath=''){
    const row=host.createDiv({cls:`lh-chat-message ${message.role==='user'?'is-user':'is-assistant'}`});
    row.createDiv({text:message.role==='user'?this.tr("你"):this.tr("学习助手"),cls:'lh-chat-message-role'});
    if(message.role==='assistant'&&message.reasoningContent)this.renderReasoning(row,message.reasoningContent);
    const content=row.createDiv({cls:message.role==='assistant'?'lh-chat-message-content markdown-rendered':'lh-chat-message-content'});
    if(message.role==='assistant'&&MarkdownRenderer?.renderMarkdown){try{await MarkdownRenderer.renderMarkdown(message.content,content,sourcePath||'',this);}catch(_){content.setText(message.content);}}
    else content.setText(message.content);
    if(message.selectedText){const quote=row.createDiv({cls:'lh-chat-message-selection'});quote.createEl('strong',{text:this.tr('选文附件')});quote.createDiv({text:message.selectedText});}
    if(message.references?.length){const refs=row.createDiv({cls:'lh-chat-message-references'});for(const path of message.references)refs.createSpan({text:`@${path.split('/').at(-1)}`,attr:{title:path}});}
    if(message.at)row.createDiv({text:new Date(message.at).toLocaleTimeString(this.locale(),{hour:'2-digit',minute:'2-digit'}),cls:'lh-chat-message-time'});
    if(message.role==='assistant')this.renderUsage(row,message);
  }
  renderReasoning(row,text='',streaming=false){
    const box=row.createEl('details',{cls:'lh-chat-reasoning'}),summary=box.createEl('summary');
    summary.createSpan({text:this.tr('思考过程')});const status=summary.createSpan({cls:'lh-chat-reasoning-status',text:streaming?this.tr('思考中…'):this.tr('已结束')});
    const body=box.createDiv({cls:'lh-chat-reasoning-content',text});box.hidden=!text;box.open=streaming&&!!text;
    return {box,body,status};
  }
  renderUsage(row,message){
    const usage=normalizeDeepSeekUsage(message.usage);if(!usage)return;
    const billing=message.billing||estimateDeepSeekCost({usage,model:message.model,at:new Date().toISOString(),pricing:this.plugin.state.deepseek.pricing,endpoint:this.plugin.state.deepseek.endpoint});
    const historicalEstimate=!message.billing&&billing;
    const rendered=renderTokenUsage(row.createDiv({cls:'lh-chat-usage'}),message.usage,{provider:'DeepSeek',billing,historicalEstimate,translate:this.tr.bind(this)});
    const details=rendered.body;
    if(billing){details.createEl('p',{text:this.tr('{0} · 价格更新于 {1}',[this.tr(billing.band==='peak'?'高峰价格':'空闲价格'),new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(billing.verifiedAt))])});details.createEl('p',{text:this.tr('每百万 tokens：命中 ¥{0} · 未命中 ¥{1} · 输出 ¥{2}',[billing.rates.hit,billing.rates.miss,billing.rates.output])});const source=details.createEl('a',{text:this.tr('官方价格'),attr:{href:billing.source,target:'_blank',rel:'noopener'}});details.createEl('p',{text:this.tr('按 API 用量估算，实际扣费以 DeepSeek 账单为准。')});}
    else details.createEl('p',{text:this.tr('缺少用量、历史价格或自定义接口的价格，无法准确计算。')});
  }
  async paintStream(){
    const host=this.streamHost;if(!host?.isConnected)return;
    const nearBottom=this.messagesEl&&this.messagesEl.scrollHeight-this.messagesEl.scrollTop-this.messagesEl.clientHeight<60;
    const reasoning=this.streamReasoning||'';
    if(reasoning&&this.reasoningBody?.isConnected){const body=this.reasoningBody,follow=body.scrollHeight-body.scrollTop-body.clientHeight<40;if(this.reasoningBox.hidden){this.reasoningBox.hidden=false;this.reasoningBox.open=true;}body.setText(reasoning);this.reasoningStatus.setText(this.tr(this.streamText?'已结束':'思考中…'));if(follow)body.scrollTop=body.scrollHeight;}
    const text=this.streamText||'';host.empty();
    try{await MarkdownRenderer.renderMarkdown(text,host,this.contextSnapshot?.path||'',this);}catch{host.setText(text);}
    if(this.streamStatus?.isConnected)this.streamStatus.setText(this.tr(text?'正在生成…':'正在思考并整理回答…'));
    if(nearBottom&&this.messagesEl)this.messagesEl.scrollTop=this.messagesEl.scrollHeight;
  }
  queueStreamPaint(){if(this.streamTimer)return;this.streamTimer=setTimeout(async()=>{this.streamTimer=null;await this.paintStream();if(this.busy&&this.streamPainted!==`${this.streamReasoning?.length||0}:${this.streamText?.length||0}`){this.streamPainted=`${this.streamReasoning?.length||0}:${this.streamText?.length||0}`;this.queueStreamPaint();}},100);}

  async send(raw){
    const question=String(raw||'').trim();if(this.busy||!question)return;
    if(/(^|[\s，。：；（(])@[^\s，。：；）)]+/.test(question)){new Notice(this.tr("请从 @ 搜索结果中选中文件后再发送。"));return;}
    if(!this.plugin.state.deepseek.apiKey){new Notice(this.tr("请先在 Learning Hub 设置中填写 DeepSeek API Key。"));return;}
    if(!this.active())await this.newConversation();
    const session=this.active(),history=session.messages.map(({role,content})=>({role,content}));
    const attachedPaths=[...this.attachments];
    this.busy=true;
    try{
      const snapshot=await this.plugin.captureChatContext({includeContent:true});
      this.pendingMessage=question;this.pendingSelection=snapshot.selectedText;this.streamText='';this.streamReasoning='';this.failedReply=null;this.interruptedStream='';this.draftText='';this.abortController=new AbortController();await this.render();
      if(snapshot.readError)new Notice(this.tr("当前页面未附上：{0}", [snapshot.readError]),5000);
      snapshot.references=[];
      for(const filePath of attachedPaths){const file=this.app.vault.getAbstractFileByPath(filePath);if(!file)throw new Error(this.tr("引用文件已不存在：{0}", [filePath]));snapshot.references.push({path:filePath,content:await this.plugin.chatFileText(file)});}
      const context=studyContext(snapshot);
      const result=await this.plugin.callDeepSeek({user:question,context,history,model:session.model,thinking:session.effort!=='none',reasoningEffort:session.effort,languageScope:'assistant',signal:this.abortController.signal,onReasoningDelta:delta=>{this.streamReasoning+=delta;this.queueStreamPaint();},onContentDelta:delta=>{this.streamText+=delta;this.queueStreamPaint();},onStreamActivity:()=>{if(!this.streamText)this.streamStatus?.setText(this.tr('正在思考并整理回答…'));}});
      const messageId=randomUUID();
      session.messages.push({id:messageId,role:'user',content:question,at:stamp(),references:attachedPaths,selectedText:snapshot.selectedText,sourcePath:snapshot.path},{role:'assistant',content:result.content,reasoningContent:result.reasoningContent||this.streamReasoning,at:stamp(),model:result.model,usage:result.usage,billing:result.billing,requestedAt:result.requestedAt});
      if(session.title==='新对话')session.title=question.replace(/\s+/g,' ');
      session.updatedAt=stamp();
      if(this.draftConversation?.id===session.id){this.store.sessions.push(session);this.draftConversation=null;}
      this.store.activeId=session.id;await this.persist();this.attachments=[];
      if(this.plugin.recordChatMisconception)void this.plugin.recordChatMisconception({question,answer:result.content,course:snapshot.course,lessonPath:snapshot.lessonPath,conversationId:session.id,messageId}).then(saved=>{if(saved)new Notice(this.tr("已将明确的理解错误加入 Error Log。"));}).catch(error=>console.warn('Learning Hub chat error review:',error));
    }catch(error){this.draftText=question;if(this.streamText)this.interruptedStream=this.streamText;if(error.code==='TRUNCATED'||this.streamReasoning)this.failedReply={role:'assistant',content:error.content||this.streamText||this.tr('本次生成尚未输出正文。'),reasoningContent:error.reasoningContent||this.streamReasoning,usage:error.usage,billing:error.billing,model:error.model||session.model,at:stamp()};const message=ERROR_COPY[error.code]?this.tr(ERROR_COPY[error.code],[error.status]):error.message;new Notice(this.tr("学习助手：{0}", [message]),7000);}
    finally{clearTimeout(this.streamTimer);this.streamTimer=null;this.busy=false;this.pendingMessage='';this.abortController=null;if(!this.closed)await this.render();}
  }
}

module.exports={CHAT_VIEW_TYPE,LearningChatView};
