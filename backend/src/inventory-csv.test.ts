import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, csvInputs, csvCell, csvDocument, CSV_MAX_BYTES } from './inventory-csv.ts';

test('CSV preserves quoted commas, newlines, escaped quotes and BOM',()=>{
  assert.deepEqual(parseCsv('\uFEFFbrand,serial\r\n"Equipo, \"\"IT\"\"","SER\n123"\r\n'),
    [['brand','serial'],['Equipo, "IT"','SER\n123']]);
});
test('CSV rejects malformed quoting, NUL, missing and duplicate columns',()=>{
  for(const value of ['a\n"unfinished','a\npre"quote','a\n"closed"text','a\n\0'])assert.throws(()=>parseCsv(value));
  assert.throws(()=>csvInputs('serial\nABC'),'Missing required columns');
  assert.throws(()=>csvInputs('kind,brand,serial,owner,location,state,state\nNotebook,Equipo,S1,Persona,Oficina,Disponible,Disponible'));
});
test('CSV marks per-row duplicates and unequal columns without dropping rows',()=>{
  const result=csvInputs('kind,brand,serial,owner,location,state\nNotebook,Equipo,SER-1,Persona,Oficina,Disponible\nNotebook,Equipo,ser-1,Persona,Oficina');
  assert.equal(result.length,2);assert.deepEqual(result[0].errors,[]);
  assert.equal(result[1].errors.length,2);assert.equal(result[1].line,3);
});
test('CSV limits bytes rather than characters and enforces at most200 rows',()=>{
  assert.throws(()=>parseCsv('á'.repeat(CSV_MAX_BYTES)));
  assert.throws(()=>parseCsv('serial\n'+Array(201).fill('ABC').join('\n')));
});
test('CSV export neutralizes spreadsheet formulas including controls and spaces',()=>{
  for(const value of ['=1+1',' +SUM(A1:A2)','-2','@cell','\t=IMPORTDATA()','\r=1','\n+2']){
    assert.ok(csvCell(value).startsWith('"\''));
  }
  assert.equal(csvCell('normal'), '"normal"');
  assert.equal(csvDocument(['serial'],[{serial:'A"B'}]),'\uFEFF"serial"\r\n"A""B"');
});
