// Required check on every pull request: a speaker may change only their own profile.
//
// Runs from the base branch under `pull_request_target`; it reads the pull request's files
// through the API and never executes anything from the fork.
import { appendFileSync, readFileSync } from 'node:fs';
import { ownerLineFor, parseCodeowners, validateSpeaker } from './lib.mjs';

const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, PR_NUMBER: number, GITHUB_OUTPUT: outputFile } = process.env;
// Actions sets this; the tests point it at a local stand-in for the API.
const apiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com';

async function api(path, { raw = false } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`);
  return raw ? response.text() : response.json();
}

const problems = [];
const fail = (message) => problems.push(message);

const pr = await api(`/repos/${repo}/pulls/${number}`);
const files = await api(`/repos/${repo}/pulls/${number}/files?per_page=100`);
if (files.length >= 100) fail('too many changed files: a profile PR touches one file');

const author = pr.user.login.toLowerCase();
const headSha = pr.head.sha;
const headRepo = pr.head.repo.full_name;

// An approval only counts while it is on the current head commit.
const reviews = await api(`/repos/${repo}/pulls/${number}/reviews?per_page=100`);
const latest = new Map();
for (const review of reviews) {
  if (review.state === 'COMMENTED' || review.commit_id !== headSha) continue;
  latest.set(review.user.login.toLowerCase(), review.state);
}
const approvedBy = new Set([...latest].filter(([, state]) => state === 'APPROVED').map(([login]) => login));

const { maintainer, owners } = parseCodeowners(readFileSync('.github/CODEOWNERS', 'utf8'));
if (!maintainer) throw new Error('CODEOWNERS has no "* @maintainer" line');
const isMaintainer = author === maintainer;

const profileFiles = files.filter((file) => /^speakers\/[a-z0-9-]+\.json$/.test(file.filename));
const addsOwnProfile = profileFiles.some(
  (file) => file.status === 'added' && file.filename === `speakers/${author}.json`,
);

for (const file of files) {
  const match = /^speakers\/([a-z0-9-]+)\.json$/.exec(file.filename);

  if (!match) {
    if (isMaintainer) continue;
    if (file.filename === '.github/CODEOWNERS' && addsOwnProfile) {
      // Onboarding: the new speaker adds exactly their own ownership line, nothing else.
      const added = (file.patch ?? '').split('\n').filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
      if (added.length !== 1 || added[0] !== `+${ownerLineFor(author)}`) {
        fail(`CODEOWNERS: a new speaker may only add the line "${ownerLineFor(author)}"`);
      }
      continue;
    }
    fail(`${file.filename}: only the maintainer (@${maintainer}) may change files outside speakers/`);
    continue;
  }

  const id = match[1];
  const owner = owners.get(id);

  if (file.status === 'renamed' && !isMaintainer) {
    fail(`${file.filename}: renames are done by the maintainer`);
    continue;
  }

  if (!owner) {
    // A new profile: it must be named after its author and the maintainer approves it once.
    if (!isMaintainer && id !== author) fail(`${file.filename}: a new profile must be named after its author, "${author}"`);
    if (!isMaintainer && !approvedBy.has(maintainer)) fail(`${file.filename}: a new profile needs approval from @${maintainer}`);
  } else if (owner !== author && !approvedBy.has(owner)) {
    fail(`${file.filename}: owned by @${owner}, who has to approve changes made by anyone else`);
  }

  if (file.status !== 'removed') {
    const text = await api(`/repos/${headRepo}/contents/${file.filename}?ref=${headSha}`, { raw: true });
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (error) {
      fail(`${file.filename}: not valid JSON (${error.message})`);
      continue;
    }
    for (const error of validateSpeaker(doc, id)) fail(`${file.filename}: ${error}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}

console.log(`Guard passed for @${author}: ${files.length} file(s).`);
// A PR that got through is legitimate by construction, so a speaker's own can merge unattended.
if (outputFile) appendFileSync(outputFile, `automerge=${isMaintainer ? 'false' : 'true'}\n`);
