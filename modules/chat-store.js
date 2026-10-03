const { normalizeDeepSeekUsage } = require('./token-usage');
const STORE_PATH='.learning-hub/conversations.json';

function emptyStore(){return {version:1,activeId:null,sessions:[]};}

function hasConversationContent(session){
  return Array.isArray(session?.messages)&&session.messages.some(message=>(message?.role==='user'||message?.role==='assistant')&&typeof message.content==='string'&&message.content.trim());
}

function normalizeStore(value){
  const saved=value&&typeof value==='object'?value:{};
  const sessions=Array.isArray(saved.sessions)?saved.sessions.filter(session=>session&&typeof session.id==='string'&&hasConversationContent(session)).slice(-100).map(session=>({
    id:session.id,
    title:String(session.title||'新对话'),
    createdAt:String(session.createdAt||''),
    updatedAt:String(session.updatedAt||''),
    model:String(session.model||'deepseek-flash'),
    effort:['none','low','high','max'].includes(session.effort)?session.effort:'none',
    messages:Array.isArray(session.messages)?session.messages.filter(message=>message&&(message.role==='user'||message.role==='assistant')&&typeof message.content==='string').slice(-200).map(message=>({id:String(message.id||''),...(message.billing&&Number.isFinite(message.billing.amount)?{billing:message.billing}:{}),...(message.requestedAt?{requestedAt:String(message.requestedAt)}:{}),role:message.role,content:message.content,...(message.role==='assistant'&&typeof message.reasoningContent==='string'?{reasoningContent:message.reasoningContent}:{}),at:String(message.at||''),model:String(message.model||''),selectedText:String(message.selectedText||''),sourcePath:String(message.sourcePath||''),references:Array.isArray(message.references)?message.references.filter(path=>typeof path==='string').slice(0,4):[],...(message.role==='assistant'&&Object.prototype.hasOwnProperty.call(message,'usage')?{usage:normalizeDeepSeekUsage(message.usage)}:{})})):[],
  })):[];
  return {version:1,activeId:sessions.some(session=>session.id===saved.activeId)?saved.activeId:null,sessions};
}

function createChatStore(adapter,path=STORE_PATH){
  if(!adapter||typeof adapter.read!=='function'||typeof adapter.write!=='function')throw new TypeError('Missing vault adapter');
  return {
    async load(){
      let saved;
      try{if(await adapter.exists(path))saved=JSON.parse(await adapter.read(path));}
      catch(error){console.warn('Learning Hub chat history could not be read:',error);return emptyStore();}
      if(!saved)return emptyStore();
      const normalized=normalizeStore(saved);
      const sessions=Array.isArray(saved.sessions)?saved.sessions:[];
      const hasEmptySessions=sessions.some(session=>session&&typeof session.id==='string'&&!hasConversationContent(session));
      if(hasEmptySessions){
        const cleaned={...saved,sessions:sessions.filter(hasConversationContent)};
        if(!cleaned.sessions.some(session=>session?.id===cleaned.activeId))cleaned.activeId=null;
        try{await adapter.write(path,JSON.stringify(cleaned,null,2)+'\n');}
        catch(error){console.warn('Learning Hub empty chat history could not be cleaned:',error);}
      }
      return normalized;
    },
    async save(store){
      const normalized=normalizeStore(store);
      const folder=path.slice(0,path.lastIndexOf('/'));
      if(folder&&!await adapter.exists(folder))await adapter.mkdir(folder);
      await adapter.write(path,JSON.stringify(normalized,null,2)+'\n');
      return normalized;
    },
  };
}

module.exports={STORE_PATH,emptyStore,normalizeStore,createChatStore};
