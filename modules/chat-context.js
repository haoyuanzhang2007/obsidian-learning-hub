const SUPPORTED_CONTEXT_EXTENSIONS=new Set(['md','txt','pdf']);

function mentionAt(text,caret){
  const before=String(text||'').slice(0,caret);
  const match=/(^|[\s，。：；（(])@([^\n@]*)$/.exec(before);
  if(!match)return null;
  return {start:before.length-match[2].length-1,end:caret,query:match[2].trim()};
}

function searchContextFiles(files,query,limit=8){
  const needle=String(query||'').trim().toLocaleLowerCase();
  return (files||[]).filter(file=>SUPPORTED_CONTEXT_EXTENSIONS.has(file.extension)&&(!needle||file.path.toLocaleLowerCase().includes(needle)))
    .sort((a,b)=>{
      const score=file=>file.basename.toLocaleLowerCase().startsWith(needle)?0:file.basename.toLocaleLowerCase().includes(needle)?1:2;
      return score(a)-score(b)||a.path.localeCompare(b.path);
    }).slice(0,limit);
}

module.exports={mentionAt,searchContextFiles,SUPPORTED_CONTEXT_EXTENSIONS};
