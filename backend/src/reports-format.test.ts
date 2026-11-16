import test from 'node:test';
import assert from 'node:assert/strict';
import {reportCsvCell} from './reports-format.ts';

test('CSV trata fórmulas, controles y comillas como texto, sin truncar valores',()=>{
  for(const value of ['=HYPERLINK("https://example.test")',' \t+SUM(A1)','\r@SUM(A1)','-1+1','\n=1'])
    assert.ok(reportCsvCell(value).startsWith('"\''));
  assert.equal(reportCsvCell('A,"B"\nC'),'"A,""B""\nC"');
  assert.equal(reportCsvCell(null),'""');
  assert.equal(reportCsvCell(225),'"225"');
  assert.equal(reportCsvCell('á'.repeat(5000)).length,5002);
});
