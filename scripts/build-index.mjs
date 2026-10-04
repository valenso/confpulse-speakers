// Builds the index the app reads: every speaker file in one schema.org `@graph`.
//
// Adds `cp:verified` to a profile whose file was first added by a commit authored by the
// matching GitHub login, i.e. the speaker onboarded themselves. The flag exists only in the
// published index, so a speaker cannot set it from their own file.
//
// Adds `cp:claimed` to every profile: true when CODEOWNERS gives the file to the speaker whose
// GitHub login is its id. An unclaimed profile was created from a conference programme for a
// speaker whose login is not known, so its id is only a slug of their name and the app must not
// treat it as a GitHub account (no GitHub avatar, no GitHub link).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { claimedIds, isId, validateSpeaker } from './lib.mjs';

const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
const outDir = process.argv[2] ?? '_site';

async function commitAuthorLogin(sha) {
  if (!token || !repo) return null;
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) return null;
  return (await response.json()).author?.login?.toLowerCase() ?? null;
}

function addingCommit(file) {
  const output = execFileSync('git', ['log', '--diff-filter=A', '--format=%H', '--', file], { encoding: 'utf8' });
  return output.trim().split('\n').filter(Boolean).pop() ?? null;
}

const claimed = claimedIds(readFileSync('.github/CODEOWNERS', 'utf8'));
const graph = [];
const errors = [];
for (const name of readdirSync('speakers').filter((entry) => entry.endsWith('.json')).sort()) {
  const id = name.slice(0, -'.json'.length);
  const file = `speakers/${name}`;
  if (!isId(id)) {
    errors.push(`${file}: the file name must be a lowercase GitHub login`);
    continue;
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${file}: not valid JSON (${error.message})`);
    continue;
  }
  const problems = validateSpeaker(doc, id);
  if (problems.length > 0) {
    errors.push(...problems.map((problem) => `${file}: ${problem}`));
    continue;
  }

  const sha = addingCommit(file);
  const verified = sha !== null && (await commitAuthorLogin(sha)) === id;
  const { '@context': _context, ...person } = doc;
  graph.push({ ...person, 'cp:claimed': claimed.has(id), ...(verified ? { 'cp:verified': true } : {}) });
}

if (errors.length > 0) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/speakers.json`, JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2) + '\n');
console.log(`Wrote ${graph.length} speaker(s) to ${outDir}/speakers.json`);
