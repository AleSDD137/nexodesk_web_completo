/** Bounded RFC4180-style CSV support; no macros, Excel execution or dependencies. */
export class CsvError extends Error {}
export const REQUIRED_COLUMNS=['kind','brand','serial','owner','location','state'] as const;
export const OPTIONAL_COLUMNS=['ticketId','ownerUserId'] as const;
export const CSV_MAX_BYTES=24_000;
export const CSV_MAX_ROWS=200;

export function parseCsv(text:string):string[][] {
  if(Buffer.byteLength(text,'utf8')>CSV_MAX_BYTES)throw new CsvError('El CSV supera 24 KB. Dividí el archivo.');
  text=text.replace(/^\uFEFF/,'');
  const rows:string[][]=[];let row:string[]=[],value='',quoted=false,closed=false;
  const field=()=>{row.push(value);value='';closed=false;};
  const line=()=>{field();if(row.some(cell=>cell!==''))rows.push(row);row=[];};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='\0')throw new CsvError('El CSV contiene caracteres no permitidos.');
    if(quoted){
      if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}
      else value+=c;
    }else if(c==='"'){
      if(value!==''||closed)throw new CsvError('Comillas inválidas en CSV.');quoted=true;
    }else if(c===',')field();
    else if(c==='\n'||c==='\r'){line();if(c==='\r'&&text[i+1]==='\n')i++;}
    else {if(closed)throw new CsvError('Hay texto después de una celda entre comillas.');value+=c;}
    if(rows.length>CSV_MAX_ROWS+1)throw new CsvError('Máximo 200 filas por importación.');
  }
  if(quoted)throw new CsvError('Una celda entre comillas no está cerrada.');
  if(row.length||value!==''||closed)line();
  if(!rows.length)throw new CsvError('El CSV está vacío.');
  if(rows.length>CSV_MAX_ROWS+1)throw new CsvError('Máximo 200 filas por importación.');
  return rows;
}

export function csvCell(value:unknown):string {
  let text=String(value??'');
  // Spreadsheet formula injection, including leading control/space characters.
  if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function csvDocument(columns:readonly string[],rows:Record<string,unknown>[]):string {
  return '\uFEFF'+[columns.map(csvCell).join(','),...rows.map(row=>columns.map(key=>csvCell(row[key])).join(','))].join('\r\n');
}

export type CsvInput={line:number;value:Record<string,string>;errors:string[]};
export function csvInputs(text:string):CsvInput[] {
  const [header,...rows]=parseCsv(text),columns=header.map(h=>h.trim());
  const allowed=new Set<string>([...REQUIRED_COLUMNS,...OPTIONAL_COLUMNS]);
  if(columns.length!==new Set(columns).size)throw new CsvError('Hay columnas duplicadas.');
  if(columns.some(c=>!allowed.has(c)))throw new CsvError('Columnas desconocidas: '+columns.filter(c=>!allowed.has(c)).join(', '));
  const missing=REQUIRED_COLUMNS.filter(c=>!columns.includes(c));
  if(missing.length)throw new CsvError('Faltan columnas: '+missing.join(', '));
  if(!rows.length)throw new CsvError('El CSV no contiene activos.');
  const seen=new Set<string>();
  return rows.map((row,index)=>{
    const value=Object.fromEntries(columns.map((name,i)=>[name,(row[i]??'').trim()]));
    const errors:string[]=[];
    if(row.length!==columns.length)errors.push('Cantidad de celdas diferente a la cabecera.');
    const serial=value.serial.toLocaleLowerCase('es');
    if(seen.has(serial))errors.push('Serie duplicada dentro del archivo.');
    seen.add(serial);
    return {line:index+2,value,errors};
  });
}
