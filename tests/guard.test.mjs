// Runs scripts/guard.mjs against a local stand-in for the GitHub API, one pull request per case.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('../scripts/guard.mjs', import.meta.url));
const HEAD = 'abc123';

const profile = (id, extra = {}) => JSON.stringify({ '@context': 'https://schema.org', '@type': 'Person', identifier: id, name: id, ...extra });

let server;
let scenario;
let workdir;

before(async () => {
  workdir = mkdtempSync(join(tmpdir(), 'guard-'));
  mkdirSync(join(workdir, '.github'));
  writeFileSync(join(workdir, '.github/CODEOWNERS'), '* @valenso\n/speakers/janedoe.json @janedoe\n/speakers/johnsmith.json @johnsmith\n');

  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://x');
    const send = (body, type = 'application/json') => {
      response.writeHead(200, { 'content-type': type });
      response.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (url.pathname === '/repos/o/r/pulls/1') {
      return send({ user: { login: scenario.author }, head: { sha: HEAD, repo: { full_name: 'fork/r' } } });
    }
    if (url.pathname === '/repos/o/r/pulls/1/files') return send(scenario.files);
    if (url.pathname === '/repos/o/r/pulls/1/reviews') return send(scenario.reviews ?? []);
    const match = /^\/repos\/fork\/r\/contents\/(.+)$/.exec(url.pathname);
    if (match && scenario.contents?.[match[1]] !== undefined) return send(scenario.contents[match[1]], 'text/plain');
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

after(() => server.close());

/** Runs the guard for a scenario and returns its exit code, its output and the automerge flag. */
async function run(next) {
  scenario = next;
  const outputFile = join(workdir, 'output');
  writeFileSync(outputFile, '');
  const child = spawn(process.execPath, [guard], {
    cwd: workdir,
    env: {
      PATH: process.env.PATH,
      GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
      GITHUB_TOKEN: 'token',
      GITHUB_REPOSITORY: 'o/r',
      PR_NUMBER: '1',
      GITHUB_OUTPUT: outputFile,
    },
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  const code = await new Promise((resolve) => child.on('close', resolve));
  return { code, log, automerge: /automerge=(\w+)/.exec(readFileSync(outputFile, 'utf8'))?.[1] };
}

const modified = (filename) => ({ filename, status: 'modified' });
const approval = (login, commit = HEAD) => ({ user: { login }, state: 'APPROVED', commit_id: commit });

test('a speaker editing their own profile passes and merges unattended', async () => {
  const result = await run({ author: 'JaneDoe', files: [modified('speakers/janedoe.json')], contents: { 'speakers/janedoe.json': profile('janedoe', { jobTitle: 'Engineer' }) } });
  assert.equal(result.code, 0, result.log);
  assert.equal(result.automerge, 'true');
});

test("editing someone else's profile fails without their approval", async () => {
  const result = await run({ author: 'janedoe', files: [modified('speakers/johnsmith.json')], contents: { 'speakers/johnsmith.json': profile('johnsmith') } });
  assert.equal(result.code, 1);
  assert.match(result.log, /owned by @johnsmith/);
});

test("the owner's approval lets someone else's edit through", async () => {
  const result = await run({ author: 'valenso', files: [modified('speakers/johnsmith.json')], reviews: [approval('johnsmith')], contents: { 'speakers/johnsmith.json': profile('johnsmith') } });
  assert.equal(result.code, 0, result.log);
  assert.equal(result.automerge, 'false');
});

test('an approval of an earlier commit does not count', async () => {
  const result = await run({ author: 'janedoe', files: [modified('speakers/johnsmith.json')], reviews: [approval('johnsmith', 'old')], contents: { 'speakers/johnsmith.json': profile('johnsmith') } });
  assert.equal(result.code, 1);
});

test('an approval that was later changed to a rejection does not count', async () => {
  const reviews = [approval('johnsmith'), { user: { login: 'johnsmith' }, state: 'CHANGES_REQUESTED', commit_id: HEAD }];
  const result = await run({ author: 'janedoe', files: [modified('speakers/johnsmith.json')], reviews, contents: { 'speakers/johnsmith.json': profile('johnsmith') } });
  assert.equal(result.code, 1);
});

test('a speaker cannot change files outside speakers/', async () => {
  for (const filename of ['scripts/guard.mjs', '.github/workflows/guard.yml', 'README.md', '.github/CODEOWNERS']) {
    const result = await run({ author: 'janedoe', files: [modified('speakers/janedoe.json'), { ...modified(filename), patch: '+x' }], contents: { 'speakers/janedoe.json': profile('janedoe') } });
    assert.equal(result.code, 1, filename);
  }
});

test('a new profile named after its author needs the maintainer', async () => {
  const files = [{ filename: 'speakers/newperson.json', status: 'added' }, { filename: '.github/CODEOWNERS', status: 'modified', patch: '@@\n+/speakers/newperson.json @newperson' }];
  const contents = { 'speakers/newperson.json': profile('newperson') };

  const without = await run({ author: 'newperson', files, contents });
  assert.equal(without.code, 1);
  assert.match(without.log, /needs approval from @valenso/);

  const approved = await run({ author: 'newperson', files, contents, reviews: [approval('valenso')] });
  assert.equal(approved.code, 0, approved.log);
});

test('a new profile must be named after its author', async () => {
  const result = await run({ author: 'mallory', files: [{ filename: 'speakers/janedoe2.json', status: 'added' }], reviews: [approval('valenso')], contents: { 'speakers/janedoe2.json': profile('janedoe2') } });
  assert.equal(result.code, 1);
  assert.match(result.log, /named after its author/);
});

test('a new speaker cannot add any CODEOWNERS line but their own', async () => {
  const files = (line) => [{ filename: 'speakers/newperson.json', status: 'added' }, { filename: '.github/CODEOWNERS', status: 'modified', patch: `@@\n${line}` }];
  const base = { author: 'newperson', reviews: [approval('valenso')], contents: { 'speakers/newperson.json': profile('newperson') } };
  assert.equal((await run({ ...base, files: files('+/speakers/janedoe.json @newperson') })).code, 1);
  assert.equal((await run({ ...base, files: files('+* @newperson') })).code, 1);
  assert.equal((await run({ ...base, files: files('-* @valenso\n+/speakers/newperson.json @newperson') })).code, 1);
});

test('an invalid profile fails even for its owner', async () => {
  const mismatched = await run({ author: 'janedoe', files: [modified('speakers/janedoe.json')], contents: { 'speakers/janedoe.json': profile('someone-else') } });
  assert.equal(mismatched.code, 1);
  const broken = await run({ author: 'janedoe', files: [modified('speakers/janedoe.json')], contents: { 'speakers/janedoe.json': '{not json' } });
  assert.equal(broken.code, 1);
  const verified = await run({ author: 'janedoe', files: [modified('speakers/janedoe.json')], contents: { 'speakers/janedoe.json': profile('janedoe', { 'cp:verified': true }) } });
  assert.equal(verified.code, 1);
});

test('only the maintainer may rename a profile', async () => {
  const renamed = { filename: 'speakers/janedoe.json', status: 'renamed' };
  const result = await run({ author: 'janedoe', files: [renamed], contents: { 'speakers/janedoe.json': profile('janedoe') } });
  assert.equal(result.code, 1);
});

test("a speaker can remove their own profile, not someone else's", async () => {
  assert.equal((await run({ author: 'janedoe', files: [{ filename: 'speakers/janedoe.json', status: 'removed' }] })).code, 0);
  assert.equal((await run({ author: 'janedoe', files: [{ filename: 'speakers/johnsmith.json', status: 'removed' }] })).code, 1);
});

test('the maintainer can change anything outside profiles, without auto-merge', async () => {
  const result = await run({ author: 'Valenso', files: [modified('README.md'), modified('scripts/lib.mjs')] });
  assert.equal(result.code, 0, result.log);
  assert.equal(result.automerge, 'false');
});
