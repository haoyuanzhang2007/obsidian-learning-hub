const { t: tr } = require('./i18n');
'use strict';

const http=require('http');
const {randomBytes,createHash}=require('crypto');

const SCOPE='https://www.googleapis.com/auth/calendar.readonly';
const AUTH_URL='https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL='https://oauth2.googleapis.com/token';
const API_URL='https://www.googleapis.com/calendar/v3';

function normalizeGoogleState(value={}){
  const data=value&&typeof value==='object'?value:{};
  return {
    clientId:String(data.clientId||'').trim(),
    clientSecret:String(data.clientSecret||'').trim(),
    tokens:data.tokens&&typeof data.tokens==='object'?data.tokens:null,
    calendarIds:Array.isArray(data.calendarIds)?data.calendarIds.filter(id=>typeof id==='string'&&id).slice(0,20):['primary'],
    calendars:Array.isArray(data.calendars)?data.calendars:[],
    events:Array.isArray(data.events)?data.events:[],
    pendingEvents:Array.isArray(data.pendingEvents)?data.pendingEvents:[],
    syncedAt:String(data.syncedAt||''),
    error:String(data.error||''),
  };
}

function localTimestamp(value,timeZone){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return '';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function normalizeEvent(event,calendar,timeZone){
  if(!event?.id||event.status==='cancelled')return null;
  const allDay=!!event.start?.date;
  const start=allDay?`${event.start.date}T00:00`:localTimestamp(event.start?.dateTime,timeZone);
  const end=allDay?`${event.end?.date}T00:00`:localTimestamp(event.end?.dateTime,timeZone);
  if(!start||!end||end<=start)return null;
  return {
    id:`google:${calendar.id}:${event.id}`,googleId:event.id,calendarId:calendar.id,
    title:String(event.summary||'未命名日程'),start,end,allDay,
    location:String(event.location||''),url:String(event.htmlLink||''),
    busy:event.transparency!=='transparent'&&event.attendees?.find(x=>x.self)?.responseStatus!=='declined',
    fixed:true,source:'google-calendar',
  };
}

function responseJson(response){
  if(response?.json&&typeof response.json==='object')return response.json;
  try{return JSON.parse(response?.text||'');}catch(_){return {};}
}

function tokenError(response,data,{refresh=false}={}){
  const code=String(data?.error||'').replace(/[^a-zA-Z0-9_]/g,'').slice(0,60);
  const detail=String(data?.error_description||'').replace(/[\r\n\t]+/g,' ').trim().slice(0,180);
  if(code==='invalid_grant')return new Error(refresh?tr("Google 授权已失效，请重新连接。"):tr("Google 拒绝了本次授权码（invalid_grant），请重新连接。"));
  if(code==='invalid_request'&&/client_secret is missing/i.test(detail))return new Error(tr("此 OAuth 客户端要求 Client Secret，请在 Learning Hub 设置中填写后重试（HTTP 400 · invalid_request）。"));
  const reason=[code,detail].filter(Boolean).join('：');
  return new Error(tr("Google 授权失败（HTTP {0}{1}）。", [response?.status||'未知', reason?` · ${reason}`:'']));
}

function createGoogleCalendarClient({requestUrl,openExternal,httpServer=http.createServer,clock=()=>Date.now()}={}){
  if(typeof requestUrl!=='function'||typeof openExternal!=='function')throw new TypeError(tr("Google Calendar 连接缺少请求或浏览器接口"));
  async function tokenRequest(fields){
    const response=await requestUrl({url:TOKEN_URL,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields).toString(),throw:false});
    const data=responseJson(response);
    if(response.status<200||response.status>=300||!data.access_token)throw tokenError(response,data,{refresh:fields.grant_type==='refresh_token'});
    return data;
  }
  async function authorize(clientId,clientSecret=''){
    if(!/\.apps\.googleusercontent\.com$/.test(clientId))throw new Error(tr("请填写 Google Cloud 桌面应用的 OAuth Client ID。"));
    const verifier=randomBytes(48).toString('base64url');
    const state=randomBytes(24).toString('base64url');
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    let server,timer;
    const result=new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);server?.close();error?reject(error):resolve(value);};
      server=httpServer(async(req,res)=>{
        const url=new URL(req.url,'http://127.0.0.1');
        if(url.pathname!=='/oauth2callback'){res.writeHead(404);res.end();return;}
        res.setHeader('Content-Type','text/html; charset=utf-8');
        if(url.searchParams.get('state')!==state){res.writeHead(400);res.end('授权状态不匹配。');finish(new Error(tr("Google 授权状态不匹配。")));return;}
        const oauthError=url.searchParams.get('error');
        const code=url.searchParams.get('code');
        if(!code){const message=oauthError?`Google 未授权（${oauthError.replace(/[^a-zA-Z0-9_]/g,'').slice(0,60)}）。`:'Google 授权未完成。';res.writeHead(400);res.end(message);finish(new Error(message));return;}
        try{
          const fields={client_id:clientId,code,code_verifier:verifier,grant_type:'authorization_code',redirect_uri:`http://127.0.0.1:${server.address().port}/oauth2callback`};
          if(clientSecret)fields.client_secret=clientSecret;
          const token=await tokenRequest(fields);
          res.end('<!doctype html><meta charset="utf-8"><title>Learning Hub</title><p>Google Calendar 已连接，可以返回 Obsidian。</p>');
          finish(null,{accessToken:token.access_token,refreshToken:token.refresh_token||'',expiresAt:clock()+(Number(token.expires_in)||3600)*1000});
        }catch(error){res.writeHead(400);res.end('<!doctype html><meta charset="utf-8"><title>Learning Hub</title><p>Google Calendar 连接失败，请返回 Obsidian 查看具体错误。</p>');finish(error);}
      });
      server.once('error',error=>finish(new Error(tr("无法启动本机授权回调：{0}", [error.message]))));
      timer=setTimeout(()=>finish(new Error(tr("Google 授权等待超时，请重试。"))),180000);
      server.listen(0,'127.0.0.1',()=>{
        const redirect=`http://127.0.0.1:${server.address().port}/oauth2callback`;
        const url=new URL(AUTH_URL);
        for(const [key,value] of Object.entries({client_id:clientId,redirect_uri:redirect,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent',code_challenge:challenge,code_challenge_method:'S256',state}))url.searchParams.set(key,value);
        Promise.resolve(openExternal(url.toString())).catch(error=>finish(new Error(tr("无法打开系统浏览器：{0}", [error.message]))));
      });
    });
    return result;
  }
  async function accessToken(config,onTokens){
    const tokens=config.tokens;
    if(!tokens?.refreshToken&&!tokens?.accessToken)throw new Error(tr("请先连接 Google Calendar。"));
    if(tokens.accessToken&&Number(tokens.expiresAt)>clock()+60000)return tokens.accessToken;
    if(!tokens.refreshToken)throw new Error(tr("Google 授权缺少刷新凭证，请重新连接。"));
    const fields={client_id:config.clientId,refresh_token:tokens.refreshToken,grant_type:'refresh_token'};
    if(config.clientSecret)fields.client_secret=config.clientSecret;
    const refreshed=await tokenRequest(fields);
    config.tokens={accessToken:refreshed.access_token,refreshToken:refreshed.refresh_token||tokens.refreshToken,expiresAt:clock()+(Number(refreshed.expires_in)||3600)*1000};
    await onTokens?.(config.tokens);
    return config.tokens.accessToken;
  }
  async function get(url,config,onTokens){
    const token=await accessToken(config,onTokens);
    const response=await requestUrl({url,method:'GET',headers:{Authorization:`Bearer ${token}`},throw:false});
    if(response.status===401)throw new Error(tr("Google 授权已失效，请重新连接。"));
    if(response.status<200||response.status>=300)throw new Error(tr("Google Calendar 读取失败（HTTP {0}）。", [response.status]));
    return responseJson(response);
  }
  async function listCalendars(config,onTokens){
    const calendars=[];let pageToken='';
    do{
      const url=new URL(`${API_URL}/users/me/calendarList`);url.searchParams.set('maxResults','250');if(pageToken)url.searchParams.set('pageToken',pageToken);
      const data=await get(url.toString(),config,onTokens);
      calendars.push(...(data.items||[]).filter(item=>!item.deleted).map(item=>({id:item.id,title:item.summaryOverride||item.summary||item.id,primary:!!item.primary,selected:item.selected!==false})).filter(item=>item.id));
      pageToken=data.nextPageToken||'';
    }while(pageToken&&calendars.length<500);
    return calendars;
  }
  async function listEvents(config,calendarIds,startIso,endIso,timeZone,onTokens){
    const calendars=new Map((config.calendars||[]).map(item=>[item.id,item]));
    const events=[];
    for(const calendarId of calendarIds){
      let pageToken='';
      do{
        const url=new URL(`${API_URL}/calendars/${encodeURIComponent(calendarId)}/events`);
        for(const [key,value] of Object.entries({timeMin:startIso,timeMax:endIso,singleEvents:'true',showDeleted:'false',maxResults:'250',orderBy:'startTime'}))url.searchParams.set(key,value);
        if(pageToken)url.searchParams.set('pageToken',pageToken);
        const data=await get(url.toString(),config,onTokens);
        for(const event of data.items||[]){const normalized=normalizeEvent(event,calendars.get(calendarId)||{id:calendarId},timeZone);if(normalized)events.push(normalized);}
        pageToken=data.nextPageToken||'';
      }while(pageToken&&events.length<3000);
    }
    return events.sort((a,b)=>a.start.localeCompare(b.start));
  }
  return {authorize,listCalendars,listEvents};
}

module.exports={SCOPE,normalizeGoogleState,localTimestamp,normalizeEvent,createGoogleCalendarClient};
