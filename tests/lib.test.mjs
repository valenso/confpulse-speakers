import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isId, ownerLineFor, parseCodeowners, validateSpeaker } from '../scripts/lib.mjs';

const example = () => JSON.parse(readFileSync(new URL('../examples/janedoe.json', import.meta.url), 'utf8'));

test('the example profile is valid', () => {
  assert.deepEqual(validateSpeaker(example(), 'janedoe'), []);
});

test('a minimal profile is valid', () => {
  const doc = { '@context': 'https://schema.org', '@type': 'Person', identifier: 'a', name: 'A' };
  assert.deepEqual(validateSpeaker(doc, 'a'), []);
});

test('identifier must match the file name', () => {
  assert.match(validateSpeaker(example(), 'someone-else').join(), /identifier/);
});

test('rejects non-https links and bad shapes', () => {
  const doc = { ...example(), url: 'javascript:alert(1)', sameAs: ['http://x.example'], image: 'ftp://x' };
  const errors = validateSpeaker(doc, 'janedoe').join('\n');
  assert.match(errors, /"url"/);
  assert.match(errors, /"sameAs"/);
  assert.match(errors, /"image"/);
});

test('worksFor and newsletter are checked when present', () => {
  const doc = { ...example(), worksFor: { name: 'No type' }, 'cp:newsletter': { platform: 'mailchimp', url: 'https://x.example' } };
  const errors = validateSpeaker(doc, 'janedoe').join('\n');
  assert.match(errors, /worksFor/);
  assert.match(errors, /cp:newsletter/);
});

test('cp:verified cannot be set by a speaker', () => {
  assert.match(validateSpeaker({ ...example(), 'cp:verified': true }, 'janedoe').join(), /cp:verified/);
});

test('ids are lowercase GitHub logins', () => {
  assert.ok(isId('jane-doe'));
  assert.ok(!isId('Jane'));
  assert.ok(!isId('-jane'));
  assert.ok(!isId('a--b'));
  assert.ok(!isId('a'.repeat(40)));
});

test('CODEOWNERS parsing', () => {
  const { maintainer, owners } = parseCodeowners(`# c\n*  @Valenso\n${ownerLineFor('janedoe')}\n/other.md @x\n`);
  assert.equal(maintainer, 'valenso');
  assert.deepEqual([...owners], [['janedoe', 'janedoe']]);
});
