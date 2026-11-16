/** Business minutes are elapsed minutes inside a configured local work window.
 * UTC iteration preserves repeated/skipped DST minutes without guessing offsets.
 * Minute precision rounds a fractional starting minute upwards, never shortening SLA. */
export interface WorkCalendar { timezone:string; weekdays:number[]; startMinute:number; endMinute:number; }
const formatters=new Map<string,Intl.DateTimeFormat>();
function formatter(zone:string){
  if(!formatters.has(zone))formatters.set(zone,new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
  return formatters.get(zone)!;
}
export function validTimezone(zone:string):boolean {try{new Intl.DateTimeFormat('en',{timeZone:zone});return true;}catch{return false;}}
const deadlines=new Map<string,number>();
const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export function isBusinessMinute(time:number,calendar:WorkCalendar):boolean {
  const parts=formatter(calendar.timezone).formatToParts(time);
  const value=(kind:string)=>parts.find(p=>p.type===kind)?.value??'';
  const minute=Number(value('hour'))*60+Number(value('minute'));
  return calendar.weekdays.includes(weekdays.indexOf(value('weekday')))&&minute>=calendar.startMinute&&minute<calendar.endMinute;
}
export function addBusinessMinutes(start:Date|string,minutes:number,calendar:WorkCalendar):Date {
  if(!validTimezone(calendar.timezone)||!calendar.weekdays.length||calendar.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)||
    !Number.isInteger(calendar.startMinute)||!Number.isInteger(calendar.endMinute)||calendar.startMinute<0||calendar.endMinute>1440||calendar.startMinute>=calendar.endMinute)
    throw Error('Calendario laboral inválido');
  if(!Number.isInteger(minutes)||minutes<0||minutes>10080)throw Error('Duración SLA inválida (máximo 10080 minutos laborables)');
  const begin=new Date(start).getTime();if(!Number.isFinite(begin))throw Error('Fecha SLA inválida');
  if(minutes===0)return new Date(begin);
  let time=Math.ceil(begin/60000)*60000,remaining=minutes;
  const key=JSON.stringify([time,minutes,calendar.timezone,calendar.weekdays,calendar.startMinute,calendar.endMinute]);
  const cached=deadlines.get(key);if(cached!==undefined)return new Date(cached);
  // A one-minute weekly window can take years; reject that impractical policy
  // in the route, while still bounding the pure clock calculation.
  const end=time+366*24*60*60000;
  for(;remaining>0&&time<end;time+=60000)if(isBusinessMinute(time,calendar))remaining--;
  if(remaining>0)throw Error('El objetivo SLA excede un año de calendario');
  if(deadlines.size>=1000)deadlines.clear();deadlines.set(key,time);
  return new Date(time);
}
