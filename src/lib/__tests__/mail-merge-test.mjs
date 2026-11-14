import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMailMerge, findUnknownPlaceholders, parseRecipients } from '../mail-merge.ts';

test('header row: every column becomes a placeholder', () => {
  const { recipients, columns, skipped } = parseRecipients('Name, E-mail, Company Name\nAnanya, ananya@example.com, Acme\n"Verma, Rahul",rahul@example.com,"Globex ""India"""');
  assert.deepEqual(columns, ['name', 'email', 'company_name']);
  assert.equal(skipped.length, 0);
  assert.equal(recipients.length, 2);
  assert.deepEqual(recipients[1], { email: 'rahul@example.com', fields: { name: 'Verma, Rahul', email: 'rahul@example.com', company_name: 'Globex "India"' } });
});

test('no header: bare addresses, "name, email" in either order, and "Name <email>"', () => {
  assert.deepEqual(parseRecipients('a@x.com\nb@x.com').recipients.map((r) => r.email), ['a@x.com', 'b@x.com']);
  assert.equal(parseRecipients('Ananya Sharma, ananya@example.com').recipients[0].fields.name, 'Ananya Sharma');
  assert.equal(parseRecipients('ananya@example.com, Ananya Sharma').recipients[0].fields.name, 'Ananya Sharma');
  assert.deepEqual(parseRecipients('Ananya Sharma <ananya@example.com>').recipients[0].fields, { name: 'Ananya Sharma', email: 'ananya@example.com' });
});

test('tab-separated rows pasted from a spreadsheet', () => {
  const { recipients } = parseRecipients('email\tname\nx@y.org\tX Y');
  assert.deepEqual(recipients[0].fields, { email: 'x@y.org', name: 'X Y' });
});

test('invalid and duplicate rows are reported, not silently dropped', () => {
  const { recipients, skipped } = parseRecipients('name,email\nA,a@x.com\nB,not-an-address\nC,A@X.com\nD,');
  assert.equal(recipients.length, 1);
  assert.deepEqual(skipped.map((s) => s.line), [3, 4, 5]);
});

test('placeholders: case/space-insensitive, unknown ones left as typed', () => {
  const fields = { name: 'Ananya', company_name: 'Acme', email: 'a@x.com' };
  assert.equal(applyMailMerge('Hi {{ Name }} of {{Company Name}} — {{missing}}', fields), 'Hi Ananya of Acme — {{missing}}');
  assert.deepEqual(findUnknownPlaceholders('{{name}} {{missing}} {{ Company Name }}', Object.keys(fields)), ['missing']);
});

test('a value containing braces is not expanded a second time', () => {
  assert.equal(applyMailMerge('{{name}}', { name: '{{email}}', email: 'a@x.com' }), '{{email}}');
});
