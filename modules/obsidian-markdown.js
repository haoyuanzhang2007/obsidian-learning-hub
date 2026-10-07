// Convert alternate AI math delimiters while leaving authored code untouched.
function normalizeProse(text) {
  let result='',i=0;
  while(i<text.length) {
    if(text[i]==='`') {
      const run=text.slice(i).match(/^`+/)[0];
      let end=i+run.length;
      while((end=text.indexOf(run,end))!==-1) {
        if(text[end-1]!=='`'&&text[end+run.length]!=='`')break;
        end+=run.length;
      }
      if(end!==-1){result+=text.slice(i,end+run.length);i=end+run.length;continue;}
    }
    // Already-valid math can contain literal delimiter examples; retain it.
    if(text[i]==='$'&&text[i-1]!=='\\') {
      const delimiter=text[i+1]==='$'?'$$':'$';
      let end=i+delimiter.length;
      while((end=text.indexOf(delimiter,end))!==-1&&text[end-1]==='\\')end+=delimiter.length;
      if(end!==-1&&(delimiter==='$$'||!text.slice(i,end).includes('\n'))) {
        result+=text.slice(i,end+delimiter.length);i=end+delimiter.length;continue;
      }
    }
    if(text[i]==='\\'&&text[i-1]!=='\\'&&(text[i+1]==='('||text[i+1]==='[')) {
      const display=text[i+1]==='[',delimiter=display?'\\]':'\\)';
      let end=i+2;
      while((end=text.indexOf(delimiter,end))!==-1&&text[end-1]==='\\')end+=2;
      const body=end===-1?'':text.slice(i+2,end);
      if(end!==-1&&body.trim()&&!body.includes('`')&&(display||!body.includes('\n'))) {
        result+=display?'$$\n'+body.trim()+'\n$$':'$'+body.trim()+'$';
        i=end+2;continue;
      }
    }
    result+=text[i++];
  }
  return result;
}

function normalizeObsidianMath(markdown) {
  const lines=String(markdown||'').split(/(?<=\n)/);
  let result='',prose='',fence=null;
  const flush=()=>{result+=normalizeProse(prose);prose='';};
  for(const line of lines) {
    if(fence) {
      result+=line;
      const closing=line.match(/^ {0,3}(`+|~+)[ \t]*(?:\r?\n)?$/);
      if(closing&&closing[1][0]===fence.char&&closing[1].length>=fence.length)fence=null;
      continue;
    }
    const opening=line.match(/^ {0,3}(`{3,}|~{3,})/);
    if(opening) {flush();fence={char:opening[1][0],length:opening[1].length};result+=line;}
    else if(/^(?: {4}|\t)/.test(line)){flush();result+=line;}
    else prose+=line;
  }
  flush();return result;
}

module.exports={normalizeObsidianMath};
