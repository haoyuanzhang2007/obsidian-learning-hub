const { t: tr, uiLocale } = require('./i18n');
const { PluginSettingTab, Setting, Notice, Modal } = require('obsidian');
const { normalizeGenerationLanguage } = require('./generation-language');
const { normalizeDraftSettings } = require('./drafts');
const { normalizeRestBlocks } = require('./study-availability');
const { DEEPSEEK_ENDPOINT, DEEPSEEK_MODELS } = require('./deepseek-chat');

const DEFAULT_AI = {
  executable: 'codex',
  model: '',
  effort: '',
  maxConcurrentTasks: 2,
  language: 'zh-CN',
  pdfExtractor: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  availability: [1, 2, 3, 4, 5, 6, 0].map(day => ({ day, start: '08:00', end: '22:00' })),
  restBlocks: [],
  fixedBlocks: [],
};
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

function normalizeAiSettings(value = {}) {
  let restBlocks=[];
  try{restBlocks=normalizeRestBlocks(Array.isArray(value.restBlocks)?value.restBlocks:[]);}catch(error){console.warn('Learning Hub rest settings were invalid and have been ignored:',error);}
  return {
    ...DEFAULT_AI, ...value,
    language: normalizeGenerationLanguage(value.language),
    maxConcurrentTasks: [1, 2, 3, 4].includes(Number(value.maxConcurrentTasks)) ? Number(value.maxConcurrentTasks) : DEFAULT_AI.maxConcurrentTasks,
    availability: Array.isArray(value.availability) ? value.availability.filter(row => Number.isInteger(Number(row.day)) && Number(row.day) >= 0 && Number(row.day) <= 6 && validTime(row.start) && validTime(row.end) && row.start < row.end).map(row => ({ day: Number(row.day), start: row.start, end: row.end })) : DEFAULT_AI.availability.map(row => ({ ...row })),
    restBlocks,
    fixedBlocks: Array.isArray(value.fixedBlocks) ? value.fixedBlocks.filter(row => Number.isInteger(Number(row.day)) && Number(row.day) >= 0 && Number(row.day) <= 6 && validTime(row.start) && validTime(row.end) && row.start < row.end && String(row.title || '').trim()).map(row => ({ day: Number(row.day), start: row.start, end: row.end, title: String(row.title).trim() })) : [],
  };
}

class CreateSemesterModal extends Modal {
  constructor(app, plugin, refresh) { super(app); this.plugin=plugin; this.refresh=refresh; }
  onOpen() {
    const el=this.contentEl;el.empty();el.addClass('learning-hub-modal');
    el.createEl('h2',{text:tr("创建学期")});
    const row=el.createDiv({cls:'lh-form-row'});row.createEl('label',{text:tr("学期名称")});
    const input=row.createEl('input',{attr:{type:'text',placeholder:tr("例如：26 Fall 或 2027 Spring")}});
    const actions=el.createDiv({cls:'lh-confirm-actions'});
    const cancel=actions.createEl('button',{text:tr("取消")});cancel.onclick=()=>this.close();
    const save=actions.createEl('button',{text:tr("创建学期"),cls:'mod-cta'});
    save.onclick=async()=>{save.disabled=true;try{if(await this.plugin.createSemester(input.value)){this.close();this.refresh();}else save.disabled=false;}catch(error){console.error('Learning Hub semester:',error);new Notice(tr("创建学期失败，请重试"));save.disabled=false;}};
    input.focus();
  }
}

class CreateCourseModal extends Modal {
  constructor(app, plugin, refresh) { super(app); this.plugin=plugin; this.refresh=refresh; }
  onOpen() {
    const el=this.contentEl;el.empty();el.addClass('learning-hub-modal');
    el.createEl('h2',{text:tr("为学期创建课程")});
    const semesterRow=el.createDiv({cls:'lh-form-row'});semesterRow.createEl('label',{text:tr("所属学期")});
    const semester=semesterRow.createEl('select');
    for(const row of this.plugin.state.semesters||[])semester.createEl('option',{text:row.name,attr:{value:row.id}});
    semester.value=this.plugin.state.activeSemester||this.plugin.state.semesters?.[0]?.id||'';
    const codeRow=el.createDiv({cls:'lh-form-row'});codeRow.createEl('label',{text:tr("课程代码")});
    const code=codeRow.createEl('input',{attr:{type:'text',placeholder:tr("例如：COMP 1002")}});
    const nameRow=el.createDiv({cls:'lh-form-row'});nameRow.createEl('label',{text:tr("课程名称")});
    const name=nameRow.createEl('input',{attr:{type:'text',placeholder:tr("例如：Machine Learning")}});
    el.createEl('p',{text:tr("若相同课程已存在于其他学期，会复用原课程文件与学习记录。"),cls:'lh-confirm-copy'});
    const actions=el.createDiv({cls:'lh-confirm-actions'});
    const cancel=actions.createEl('button',{text:tr("取消")});cancel.onclick=()=>this.close();
    const save=actions.createEl('button',{text:tr("创建课程"),cls:'mod-cta'});
    save.onclick=async()=>{save.disabled=true;try{if(await this.plugin.createCourse(semester.value,{code:code.value,name:name.value})){this.close();this.refresh();}else save.disabled=false;}catch(error){console.error('Learning Hub course creation:',error);new Notice(tr("创建课程失败：{0}", [error.message]));save.disabled=false;}};
    code.focus();
  }
}

class LearningHubSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl: root, plugin } = this;
    root.empty(); root.addClass('learning-hub-settings');
    root.createEl('h2', { text: tr("Learning Hub · AI 与日程") });
    root.createEl('p', { text: tr("Codex 在本机以只读方式生成草案。预习和日程只有在你确认后才写入学习数据。") });
    const ai = plugin.state.ai;
    const save = async () => { await plugin.saveData(plugin.state); };
    const group = title => {const card=root.createEl('section',{cls:'lh-settings-section'});card.createEl('h3',{text:title});return card;};
    let section=group(tr('界面与语言'));
    section.createEl('p',{text:tr('选择界面语言，页面和设置会立即更新。笔记与已有 AI 内容保留原文。')});
    new Setting(section).setName(tr('界面语言')).setDesc(tr('中文或 English；切换后立即生效。')).addDropdown(dropdown=>dropdown.addOption('zh-CN','中文').addOption('en','English').setValue(plugin.state.interfaceLanguage).onChange(async value=>{await plugin.setInterfaceLanguage(value);this.display();}));
    new Setting(section).setName(tr('学习助手语言')).setDesc(tr('用于助手侧边栏与 AI 解释，可与资料生成语言分别设置；已有回答保留原文。')).addDropdown(dropdown=>dropdown.addOption('zh-CN','中文').addOption('en','English').setValue(plugin.state.deepseek.language).onChange(async value=>{await plugin.setAssistantLanguage(value);}));
    new Setting(section).setName(tr("资料生成语言")).setDesc(tr("用于预习、主笔记、回忆与复习问题、Lab Session 解析及 AI 日程摘要；已有内容不会自动翻译。")).addDropdown(dropdown => dropdown.addOption('zh-CN',tr("中文（默认）")).addOption('en','English').setValue(ai.language).onChange(async value => { ai.language = normalizeGenerationLanguage(value); await save(); }));
    section=group(tr('Codex · 本地生成'));
    new Setting(section).setName(tr("Codex 程序")).setDesc(tr("本机 codex 可执行文件的绝对路径。")).addText(input => input.setPlaceholder('/path/to/codex').setValue(ai.executable).onChange(async value => { ai.executable = value.trim(); plugin.resetAiClient(); await save(); }));
    new Setting(section).setName(tr("连接与模型列表")).setDesc(tr("读取本机 Codex 可用模型，不会发起模型推理。")).addButton(button => button.setButtonText(tr("读取可用模型")).onClick(async () => {
      button.setDisabled(true);
      try { plugin.modelCatalog = await plugin.getAiClient().listModels(); new Notice(tr("已读取 {0} 个模型", [plugin.modelCatalog.length])); this.display(); }
      catch (error) { new Notice(tr("Codex 连接失败：{0}", [error.message])); button.setDisabled(false); }
    }));
    const models = plugin.modelCatalog || [];
    new Setting(section).setName(tr("模型")).setDesc(tr("留空使用 Codex 当前默认模型。实际测试建议选 Luna 轻量模型。")).addDropdown(dropdown => {
      dropdown.addOption('', tr("Codex 默认"));
      for (const model of models) dropdown.addOption(model.id, model.name);
      if (ai.model && !models.some(model => model.id === ai.model)) dropdown.addOption(ai.model, tr("{0}（已保存）", [ai.model]));
      dropdown.setValue(ai.model).onChange(async value => { ai.model = value; ai.effort = ''; await save(); this.display(); });
    });
    const selected = models.find(model => model.id === ai.model);
    new Setting(section).setName(tr("思考强度")).setDesc(tr("选项由所选模型提供；留空使用该模型默认值。")).addDropdown(dropdown => {
      dropdown.addOption('', tr("模型默认"));
      for (const effort of selected?.efforts || []) dropdown.addOption(effort, effort);
      if (ai.effort && !selected?.efforts?.includes(ai.effort)) dropdown.addOption(ai.effort, tr("{0}（已保存）", [ai.effort]));
      dropdown.setValue(ai.effort).onChange(async value => { ai.effort = value; await save(); });
    });
    new Setting(section).setName(tr("Codex 并行任务数")).setDesc(tr("同时运行独立的 Codex 生成任务；默认 2，最多 4，超出的任务会排队。")).addDropdown(dropdown => {
      for (const count of [1, 2, 3, 4]) dropdown.addOption(String(count), tr("{0} 个任务", [count]));
      dropdown.setValue(String(ai.maxConcurrentTasks)).onChange(async value => { ai.maxConcurrentTasks = Number(value); plugin.aiClient?.setMaxConcurrentTurns(ai.maxConcurrentTasks); await save(); });
    });
    new Setting(section).setName(tr("PDF 文本工具")).setDesc(tr("可选。留空时自动查找 pdftotext；扫描版 PDF 需先 OCR。")).addText(input => input.setPlaceholder(tr("自动查找")).setValue(ai.pdfExtractor).onChange(async value => { ai.pdfExtractor = value.trim(); await save(); }));
    section=group(tr("DeepSeek API · 全插件共用"));
    section.createEl('p', { text: tr("所有 DeepSeek 功能共用此 API Key；接口地址和默认模型供学习助手、待办对话与日程等通用功能使用。") });
    const deepseek = plugin.state.deepseek;
    new Setting(section).setName(tr("API 地址")).setDesc(tr("填写完整的 HTTPS chat/completions 地址；默认使用 DeepSeek 官方接口。")).addText(input => input.setPlaceholder(DEEPSEEK_ENDPOINT).setValue(deepseek.endpoint || DEEPSEEK_ENDPOINT).onChange(async value => { deepseek.endpoint = value.trim(); await save(); }));
    new Setting(section).setName('API Key').setDesc(tr("由本插件的 DeepSeek 功能共用；只在你主动使用相关 AI 功能时发送。")).addText(input => { input.inputEl.type = 'password'; input.setPlaceholder('sk-…').setValue(deepseek.apiKey || '').onChange(async value => { deepseek.apiKey = value.trim(); await save(); }); });
    new Setting(section).setName(tr("默认模型")).addDropdown(dropdown => {
      for (const model of DEEPSEEK_MODELS) dropdown.addOption(model.id, model.label);
      dropdown.setValue(deepseek.model).onChange(async value => { deepseek.model = value; await save(); });
    });
    new Setting(section).setName(tr("默认思考强度")).setDesc(tr("快速模式适合基础解释；复杂问题可在侧边栏随时切换到思考模式。")).addDropdown(dropdown => dropdown.addOption('none',tr("关闭 · 快速")).addOption('low',tr("低")).addOption('high',tr("高")).addOption('max',tr("最大")).setValue(deepseek.effort).onChange(async value => { deepseek.effort=value; await save(); }));
    new Setting(section).setName(tr('人民币费用')).setDesc(tr('按官方人民币价格、缓存用量与高峰/空闲时段估算；每次调用保存当时的价格。')).addButton(button=>button.setButtonText(tr('更新官方价格')).onClick(async()=>{button.setDisabled(true);try{await plugin.refreshDeepSeekPricing(true);new Notice(tr('官方价格已更新。'));this.display();}catch(error){new Notice(error.message);}finally{button.setDisabled(false);}}));
    section=group(tr("草稿本 · Instant Draft"));
    section.createEl('p', { text: tr("新建时间草稿后立即在 Obsidian 中打开。关闭草稿时，可使用上方统一的 DeepSeek 配置自动生成标题；空草稿保持时间标题。") });
    const drafts = plugin.state.draftTitle = normalizeDraftSettings(plugin.state.draftTitle);
    new Setting(section).setName(tr("关闭草稿后自动命名")).setDesc(tr("只处理 Draft 文件夹中仍以时间命名且有正文的草稿。")).addToggle(toggle => toggle.setValue(drafts.autoTitle).onChange(async value => { drafts.autoTitle = value; await save(); }));
    section=group(tr("学期与课程"));
    section.createEl('p',{text:tr("左侧课程列表和主页课程总览会显示所选学期。现有课程资料和学习记录保持原路径。")});
    const selectedSemester=plugin.currentSemester();
    new Setting(section).setName(tr("当前学期")).setDesc(tr("切换左侧课程分组与主页课程总览显示的范围。")).addDropdown(dropdown=>{
      for(const semester of plugin.state.semesters||[])dropdown.addOption(semester.id,tr("{0} · {1} 门课程", [semester.name, semester.courses.length]));
      dropdown.setValue(plugin.state.activeSemester||'').onChange(async value=>{await plugin.setActiveSemester(value);this.display();});
    });
    new Setting(section).setName(tr("新建学期")).setDesc(tr("例如 26 Fall、27 Spring；新学期会自动切换为当前学期。")).addButton(button=>button.setButtonText(tr("＋ 创建学期")).onClick(()=>new CreateSemesterModal(this.app,plugin,()=>this.display()).open()));
    new Setting(section).setName(tr("为 {0} 创建课程", [selectedSemester?.name||tr("学期")])).setDesc(tr("输入课程代码和名称；可在弹窗中选择要归属的学期。")).addButton(button=>button.setButtonText(tr("＋ 创建课程")).onClick(()=>new CreateCourseModal(this.app,plugin,()=>this.display()).open()));
    section=group('Google Calendar');
    section.createEl('p', { text: tr("只读同步日历事件，用于主页、完整日程和 AI 排程冲突检查。授权凭证保存在本 vault 的插件数据中；若同步 vault，凭证也会同步。") });
    const guide=section.createEl('p');guide.createSpan({text:tr("没有 Client ID？按照 ")});guide.createEl('a',{text:tr("Google 官方桌面应用设置说明"),href:'https://developers.google.com/workspace/calendar/api/quickstart/nodejs'});guide.createSpan({text:tr(" 创建即可。") });
    const google=plugin.state.googleCalendar;
    new Setting(section).setName(tr("桌面应用 Client ID")).setDesc(tr("先在 Google Cloud 为自己的项目启用 Calendar API，并创建「桌面应用」OAuth 客户端。")).addText(input=>input.setPlaceholder('…apps.googleusercontent.com').setValue(google.clientId).onChange(async value=>{if(value.trim()!==google.clientId){google.clientId=value.trim();google.tokens=null;google.events=[];google.error='';await save();}}));
    new Setting(section).setName(tr("Client Secret（按客户端要求）")).setDesc(tr("部分桌面客户端会要求此项；若授权报 client_secret is missing，请填写创建客户端时提供的 Secret。")).addText(input=>{input.inputEl.type='password';input.setValue(google.clientSecret).onChange(async value=>{google.clientSecret=value.trim();google.error='';await save();});});
    const status=google.tokens?google.error?tr("已连接 · 同步失败：{0}", [google.error]):google.syncedAt?tr("已连接 · 上次同步 {0}", [new Date(google.syncedAt).toLocaleString(uiLocale())]):tr("已连接 · 尚未同步"):google.error?tr("连接失败：{0}", [google.error]):tr("尚未连接");
    const connection=new Setting(section).setName(tr("连接状态")).setDesc(status);
    if(!google.tokens)connection.addButton(button=>button.setButtonText(tr("连接 Google Calendar")).setCta().onClick(async()=>{button.setDisabled(true);try{const count=await plugin.connectGoogleCalendar();new Notice(tr("Google Calendar 已连接，找到 {0} 个日历。", [count]));this.display();}catch(error){google.error=error.message;await save();new Notice(tr("Google Calendar 连接失败：{0}", [error.message]),8000);this.display();}}));
    else{
      connection.addButton(button=>button.setButtonText(tr("立即同步")).onClick(async()=>{button.setDisabled(true);try{await plugin.syncGoogleCalendar();this.display();}catch(_){button.setDisabled(false);}}));
      connection.addButton(button=>button.setButtonText(tr("断开")).onClick(async()=>{await plugin.disconnectGoogleCalendar();this.display();}));
      for(const calendar of google.calendars)new Setting(section).setName(calendar.title).setDesc(calendar.primary?tr("主日历"):'').addToggle(toggle=>toggle.setValue(google.calendarIds.includes(calendar.id)).onChange(async enabled=>{const next=enabled?[...new Set([...google.calendarIds,calendar.id])]:google.calendarIds.filter(id=>id!==calendar.id);if(!next.length){new Notice(tr("请至少保留一个日历。"));this.display();return;}google.calendarIds=next;await save();try{await plugin.syncGoogleCalendar({quiet:true});}catch(error){new Notice(tr("日历同步失败：{0}", [error.message]));}this.display();}));
    }
    section=group(tr("固定安排"));
    section.createEl('p', { text: tr("手动录入课程、会议等固定时段；AI 排程会避开它们。") });
    this.rows(section, ai.fixedBlocks, save);
    new Setting(section).addButton(button => button.setButtonText(tr("＋ 添加固定安排")).onClick(async () => { ai.fixedBlocks.push({ day: 1, start: '09:00', end: '10:00', title: tr("课程") }); await save(); this.display(); }));
    for (const entry of plugin.integratedSettingTabs || []) {
      const section = root.createEl('section', { cls: 'lh-settings-section lh-settings-integrated-settings' });
      entry.tab.containerEl = section.createDiv({ cls: 'lh-settings-integrated-body' });
      entry.tab.display();
    }
  }
  rows(root, rows, save) {
    rows.forEach((row, index) => {
      const setting = new Setting(root).setName(row.title || tr("固定安排"));
      setting.settingEl.addClass('lh-settings-time-row');
      setting.settingEl.addClass('is-fixed');
      setting.addText(input => input.setPlaceholder(tr("安排名称")).setValue(row.title).onChange(async value => { row.title = value.trim(); await save(); }));
      setting.addDropdown(input => {input.selectEl.setAttribute('aria-label',tr('星期')); WEEKDAYS.forEach((name, day) => input.addOption(String(day), tr(name))); input.setValue(String(row.day)).onChange(async value => { row.day = Number(value); await save(); }); });
      setting.addText(input => { input.inputEl.type='time';input.inputEl.setAttribute('aria-label',tr('开始时间'));input.setPlaceholder('09:00').setValue(row.start).onChange(async value => { if (validTime(value)) { if(value>=row.end){new Notice(tr('结束时间应晚于开始时间'));this.display();return;}row.start = value; await save(); } }); });
      setting.addText(input => { input.inputEl.type='time';input.inputEl.setAttribute('aria-label',tr('结束时间'));input.setPlaceholder('12:00').setValue(row.end).onChange(async value => { if (validTime(value)) { if(value<=row.start){new Notice(tr('结束时间应晚于开始时间'));this.display();return;}row.end = value; await save(); } }); });
      setting.addButton(button => button.setIcon('trash').setTooltip(tr("删除")).onClick(async () => { rows.splice(index, 1); await save(); this.display(); }));
    });
  }
}

module.exports = { DEFAULT_AI, normalizeAiSettings, LearningHubSettings };
