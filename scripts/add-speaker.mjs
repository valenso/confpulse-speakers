#!/usr/bin/env node
// Creates an unclaimed profile for a speaker found in a conference programme whose GitHub login
// is not known:
//
//   node scripts/add-speaker.mjs "Luca Trușcă" [--title "Principal Engineer"] [--company "Acme"]
//
// The id is a slug of the name, not a GitHub login. Prints the id to put in a session's
// `performer`. If the profile already exists nothing is written, and the id is printed anyway,
// so the command can be run for every name in a programme. Matching a name to a speaker who
// already has a claimed profile is a human call: look in speakers/ first.
import { existsSync, writeFileSync } from 'node:fs';
import { idFromName, isId, validateSpeaker } from './lib.mjs';

const [name, ...flags] = process.argv.slice(2);
if (!name) {
  console.error('usage: node scripts/add-speaker.mjs "Full Name" [--title "..."] [--company "..."]');
  process.exit(2);
}

const option = (flag) => {
  const at = flags.indexOf(flag);
  return at >= 0 ? flags[at + 1] : undefined;
};

const id = idFromName(name);
if (!isId(id)) {
  console.error(`"${name}" does not make a usable id`);
  process.exit(1);
}

const file = `speakers/${id}.json`;
if (existsSync(file)) {
  console.log(`${id} (exists)`);
  process.exit(0);
}

const profile = { '@context': 'https://schema.org', '@type': 'Person', identifier: id, name: name.trim() };
if (option('--title')) profile.jobTitle = option('--title');
if (option('--company')) profile.worksFor = { '@type': 'Organization', name: option('--company') };

const problems = validateSpeaker(profile, id);
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
writeFileSync(file, JSON.stringify(profile, null, 2) + '\n');
console.log(`${id} (created)`);
