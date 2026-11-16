import test from 'node:test';
import assert from 'node:assert/strict';
import {addBusinessMinutes,validTimezone} from './sla-clock.ts';
const ba={timezone:'America/Argentina/Buenos_Aires',weekdays:[1,2,3,4,5],startMinute:540,endMinute:1080};
test('business SLA skips weekends and outside hours',()=>{
 assert.equal(addBusinessMinutes('2026-11-13T20:30:00Z',60,ba).toISOString(),'2026-11-16T12:30:00.000Z');
});
test('24h calendar and exact boundary retain elapsed duration',()=>{
 const c={timezone:'UTC',weekdays:[0,1,2,3,4,5,6],startMinute:0,endMinute:1440};
 assert.equal(addBusinessMinutes('2026-01-01T23:30:00Z',60,c).toISOString(),'2026-01-02T00:30:00.000Z');
});
test('DST repeated and skipped work minutes use actual elapsed time',()=>{
 const c={timezone:'America/New_York',weekdays:[0],startMinute:60,endMinute:240};
 assert.equal(addBusinessMinutes('2026-03-08T06:00:00Z',120,c).toISOString(),'2026-03-08T08:00:00.000Z');
 assert.equal(addBusinessMinutes('2026-11-01T05:00:00Z',180,c).toISOString(),'2026-11-01T08:00:00.000Z');
});
test('invalid calendars and excessive work budgets are rejected',()=>{
 assert.equal(validTimezone('Invented/Zone'),false);
 assert.throws(()=>addBusinessMinutes('2026-01-01T00:00:00Z',1,{...ba,weekdays:[]}));
 assert.throws(()=>addBusinessMinutes('2026-01-01T00:00:00Z',10081,ba));
});
