const {normalizeDeepSeekUsage}=require('./token-usage');
const PRICING_URL='https://api-docs.deepseek.com/zh-cn/quick_start/pricing/';
// Official CNY rates per million tokens, verified 2026-10-03. Save a snapshot per call.
const DEFAULT_PRICING={version:'2026-10-03',verifiedAt:'2026-10-03T00:00:00+08:00',validFrom:'2026-10-02T16:00:00Z',source:PRICING_URL,currency:'CNY',models:{'deepseek-flash':{offPeak:{hit:.02,miss:1,output:4},peak:{hit:.04,miss:2,output:8}},'deepseek-v4-pro':{offPeak:{hit:.15,miss:4.5,output:13.5},peak:{hit:.30,miss:9,output:27}}}};
const HOLIDAYS_2026=[['01-01','01-03'],['02-15','02-23'],['04-04','04-06'],['05-01','05-05'],['06-19','06-21'],['09-25','09-27'],['10-01','10-07']];
function pricingBand(at){
 const date=new Date(at),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(date),get=t=>parts.find(p=>p.type===t)?.value;
 const day=`${get('month')}-${get('day')}`,year=get('year'),weekend=['Sat','Sun'].includes(get('weekday')),holiday=year==='2026'&&HOLIDAYS_2026.some(([a,b])=>day>=a&&day<=b),hour=Number(get('hour'));
 return {band:!weekend&&!holiday&&((hour>=9&&hour<12)||(hour>=14&&hour<18))?'peak':'offPeak',holidayCalendarKnown:year==='2026'};
}
function estimateDeepSeekCost({usage,model,at,pricing=DEFAULT_PRICING,endpoint='https://api.deepseek.com/chat/completions'}){
 const u=normalizeDeepSeekUsage(usage);if(!u||!at||Number.isNaN(new Date(at).valueOf()))return null;
 try{if(new URL(endpoint).hostname!=='api.deepseek.com')return null;}catch{return null;}
 if(new Date(at)<new Date(pricing.validFrom))return null;
 const {band,holidayCalendarKnown}=pricingBand(at),rates=pricing.models?.[model]?.[band];
 if(!holidayCalendarKnown&&band==='peak')return null;
 if(!rates||u.cachedInputTokens===null||u.cacheWriteInputTokens===null||u.outputTokens===null)return null;
 const amount=(u.cachedInputTokens*rates.hit+u.cacheWriteInputTokens*rates.miss+u.outputTokens*rates.output)/1e6;
 return {amount,currency:'CNY',band,model,requestedAt:at,rates:{...rates},priceVersion:pricing.version,verifiedAt:pricing.verifiedAt,source:pricing.source,holidayCalendarKnown};
}
function parseOfficialPricing(html,at=new Date().toISOString()){
 // Expand rowspans/colspans before reading the two model columns; fail closed on schema changes.
 const table=/<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1];if(!table)throw new Error('Pricing table missing');
 const rows=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)],grid=[];
 for(let r=0;r<rows.length;r++){grid[r]||=[];let c=0;for(const cell of rows[r][1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)){
  while(grid[r][c]!==undefined)c++;
  const span=(name)=>Number(new RegExp(name+'=["\\\']?(\\d+)','i').exec(cell[1])?.[1]||1),text=cell[2].replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
  for(let y=0;y<span('rowspan');y++){grid[r+y]||=[];for(let x=0;x<span('colspan');x++)grid[r+y][c+x]=text;}c+=span('colspan');
 }}
 const result=structuredClone(DEFAULT_PRICING);result.version=at.slice(0,10);result.verifiedAt=at;result.validFrom=at;let count=0;
 for(const row of grid){const joined=row.join(' ');if(!/元/.test(joined)||!/空闲时段|高峰时段/.test(joined))continue;
  const type=joined.includes('缓存命中')?'hit':joined.includes('缓存未命中')?'miss':joined.includes('输出')?'output':null;if(!type)continue;
  const band=joined.includes('空闲时段')?'offPeak':'peak',numbers=row.filter(v=>/^[\d.]+\s*元$/.test(v)).map(v=>Number.parseFloat(v));
  if(numbers.length!==2||numbers.some(n=>!Number.isFinite(n)||n<0))throw new Error('Pricing values invalid');
  ['deepseek-flash','deepseek-v4-pro'].forEach((model,i)=>result.models[model][band][type]=numbers[i]);count++;
 }
 if(count!==6||!grid[0]?.join(' ').includes('deepseek-flash')||!grid[0]?.join(' ').includes('deepseek-v4-pro'))throw new Error('Pricing table changed');
 return result;
}
module.exports={DEFAULT_PRICING,PRICING_URL,pricingBand,estimateDeepSeekCost,parseOfficialPricing};
