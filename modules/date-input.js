const {t:tr}=require('./i18n');
function validCalendarDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;
 const [year,month,day]=value.split('-').map(Number);if(year<1||month<1||month>12||day<1||day>31)return false;
 const date=new Date(0);date.setUTCFullYear(year,month-1,day);return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}
function validTemporalValue(value,type='date'){
 if(type==='date')return validCalendarDate(value);
 const match=/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?$/.exec(value||'');return !!match&&validCalendarDate(match[1]);
}
function configureDateInput(input){
 if(!input||!['date','datetime-local'].includes(input.type)||input.dataset.lhDateBound)return input;
 const time=input.type==='datetime-local';input.min=time?'0001-01-01T00:00':'0001-01-01';input.max=time?'9999-12-31T23:59':'9999-12-31';
 if(!input.dataset.lhDateBound){input.dataset.lhDateBound='true';input.addEventListener('input',()=>{input.setCustomValidity('');input.classList.remove('is-invalid');});}
 return input;
}
function validateTemporalInputs(root){
 for(const input of root.querySelectorAll('input[type=date],input[type=datetime-local]')){
  input.setCustomValidity('');
  const value=input.value,invalid=input.validity.badInput||(value&&!validTemporalValue(value,input.type))||!input.checkValidity();
  if(invalid){input.classList.add('is-invalid');input.setCustomValidity(tr('请填写有效日期，年份须为四位数，并补全月份和日期。'));input.focus();input.reportValidity();return false;}
 }
 return true;
}
module.exports={validCalendarDate,validTemporalValue,configureDateInput,validateTemporalInputs};
