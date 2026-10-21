import { formatMessageTime } from './time.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// 1. Test standard timestamps formatting
const fixedDate = new Date('2026-10-21T14:30:25');
const res = formatMessageTime(fixedDate);
assert(res.hm === '14:30', `Expected hm to be 14:30, got ${res.hm}`);
assert(res.sec === ':25', `Expected sec to be :25, got ${res.sec}`);
assert(res.full === '14:30:25', `Expected full to be 14:30:25, got ${res.full}`);

// 2. Test timestamp string and number
const ms = fixedDate.getTime();
const resNum = formatMessageTime(ms);
assert(resNum.hm === '14:30' && resNum.sec === ':25', 'Number timestamp should format correctly');

const resStr = formatMessageTime('2026-10-21T09:05:07');
assert(resStr.hm === '09:05' && resStr.sec === ':07' && resStr.full === '09:05:07', 'Leading zero should be padded correctly');

// 3. Test invalid date
const resInvalid = formatMessageTime('invalid-time');
assert(resInvalid.hm === '' && resInvalid.sec === '' && resInvalid.full === '', 'Invalid date should return empty strings');

console.log('time.test.ts: all assertions passed');
