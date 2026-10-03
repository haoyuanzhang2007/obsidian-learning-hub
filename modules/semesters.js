const normalizeSemesterLabel = value => {
  const raw=String(value||'').trim().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
  let match=raw.match(/^(?:20)?(\d{2})\s*(Spring|Summer|Fall|Winter)$/i);
  if(match)return `${match[1]} ${match[2][0].toUpperCase()}${match[2].slice(1).toLowerCase()}`;
  match=raw.match(/^(Spring|Summer|Fall|Winter)\s*(?:20)?(\d{2})$/i);
  if(match)return `${match[2]} ${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}`;
  return raw;
};

const semesterIdForName = value => {
  const label=normalizeSemesterLabel(value),compact=label.replace(/[^a-z0-9]/gi,'');
  const match=compact.match(/^(?:20)?(\d{2})(spring|summer|fall|winter)$/i);
  if(match)return `20${match[1]}-${match[2].toLowerCase()}`;
  return String(label||'semester').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g,'-').replace(/^-|-$/g,'')||'semester';
};

const semesterSortValue = value => {
  const label=normalizeSemesterLabel(value),match=label.match(/^(\d{2,4})\s+(Spring|Summer|Fall|Winter)$/i);
  if(!match)return Number.NEGATIVE_INFINITY;
  const year=Number(match[1].length===2?`20${match[1]}`:match[1]),season={spring:1,summer:2,fall:3,winter:4}[match[2].toLowerCase()];
  return year*10+season;
};

function parseSemesterCatalog(markdown, fallbackCourses=[]) {
  const courseFromHref=href=>{
    let target=String(href||'');try{target=decodeURIComponent(target);}catch(_){}
    const course=target.split('/')[0].trim();return /^[A-Z]{4}\s+\d{4}\b/.test(course)?course:null;
  };
  const currentText=String(markdown||'').split(/^#\s+All Courses\s*$/m)[0],currentCourses=[];
  for(const match of currentText.matchAll(/\]\(([^)]+)\)/g)){const course=courseFromHref(match[1]);if(course&&!currentCourses.includes(course))currentCourses.push(course);}
  if(!currentCourses.length)currentCourses.push(...fallbackCourses);
  const catalogTerms=[];let term=null;
  const archive=String(markdown||'').split(/^#\s+All Courses\s*$/m)[1]||'';
  for(const line of archive.split('\n')){
    const heading=line.match(/^\s*-\s+\*\*(.+?)\*\*\s*$/);
    if(heading){term={name:normalizeSemesterLabel(heading[1]),courses:[]};catalogTerms.push(term);continue;}
    if(!term)continue;
    const match=line.match(/\]\(([^)]+)\)/);if(match){const course=courseFromHref(match[1]);if(course&&!term.courses.includes(course))term.courses.push(course);}
  }
  return {currentCourses,catalogTerms};
}

module.exports={normalizeSemesterLabel,semesterIdForName,semesterSortValue,parseSemesterCatalog};
