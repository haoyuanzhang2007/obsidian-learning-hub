const https=require('https');
const {StringDecoder}=require('string_decoder');
// SSE frames may span TCP chunks and UTF-8 characters. Never expose reasoning_content.
function createSseParser(onPayload){
 let buffer='',done=false;
 const frame=text=>{const data=text.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)return;if(data.trim()==='[DONE]'){done=true;return;}onPayload(JSON.parse(data));};
 return {push(text){buffer+=text;let match;while((match=/\r?\n\r?\n/.exec(buffer))){frame(buffer.slice(0,match.index));buffer=buffer.slice(match.index+match[0].length);}},end(){if(buffer.trim())frame(buffer);return done;},get done(){return done;}};
}
function streamDeepSeekRequest({url,headers,body,onPayload,signal,request=https.request}){
 return new Promise((resolve,reject)=>{
  let settled=false,response;
  const finish=(error,result)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);if(error){response?.destroy();req.destroy();reject(error);}else resolve(result);};
  const abort=()=>{const error=new Error('Cancelled');error.code='CANCELLED';finish(error);};
  const req=request(url,{method:'POST',headers:{...headers,'Content-Type':'application/json',Accept:'text/event-stream'}},res=>{
   response=res;
   if(res.statusCode<200||res.statusCode>=300){res.resume();finish(null,{status:res.statusCode});return;}
   const decoder=new StringDecoder('utf8'),parser=createSseParser(onPayload);
   res.on('data',chunk=>{try{parser.push(decoder.write(chunk));}catch{const e=new Error('Invalid stream');e.code='INVALID_STREAM';finish(e);}});
   res.on('end',()=>{try{parser.push(decoder.end());if(!parser.end()){const e=new Error('Stream interrupted');e.code='INTERRUPTED';finish(e);}else finish(null,{status:res.statusCode});}catch{const e=new Error('Invalid stream');e.code='INVALID_STREAM';finish(e);}});
   res.on('aborted',()=>{const e=new Error('Stream interrupted');e.code='INTERRUPTED';finish(e);});
   res.on('error',()=>finish(new Error('Network error')));
  });
  req.on('error',()=>finish(new Error('Network error')));
  req.setTimeout(180000,()=>{const e=new Error('Stream timeout');e.code='TIMEOUT';finish(e);});
  if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
  req.end(body);
 });
}
module.exports={createSseParser,streamDeepSeekRequest};
