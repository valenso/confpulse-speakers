// Shared by the PR guard and the publish job. No dependencies: the workflows run these
// straight from the base branch, never code from a pull request.

/** A GitHub login, lowercased: letters, digits and single hyphens, at most 39 characters. */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isId = (value) => typeof value === 'string' && value.length <= 39 && ID_PATTERN.test(value);

const isHttpsUrl = (value) => {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const isText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** Keys a speaker may never set: the publish job adds them to the index. */
const RESERVED_KEYS = ['cp:verified', 'cp:claimed'];

/**
 * Checks one speaker file, a schema.org `Person`. Returns a list of problems, empty when valid.
 * schema.org has no official JSON Schema, so this covers the fields the app reads.
 */
export function validateSpeaker(doc, id) {
  const errors = [];
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['the file must contain a JSON object'];
  }

  if (doc['@context'] !== 'https://schema.org') errors.push('"@context" must be "https://schema.org"');
  if (doc['@type'] !== 'Person') errors.push('"@type" must be "Person"');
  if (doc.identifier !== id) errors.push(`"identifier" must be "${id}", the file name`);
  if (!isText(doc.name, 100)) errors.push('"name" is required (up to 100 characters)');

  if (doc.image !== undefined && !isHttpsUrl(doc.image)) errors.push('"image" must be an https URL');
  if (doc.description !== undefined && !isText(doc.description, 2000)) {
    errors.push('"description" must be text of up to 2000 characters');
  }
  if (doc.jobTitle !== undefined && !isText(doc.jobTitle, 100)) {
    errors.push('"jobTitle" must be text of up to 100 characters');
  }
  if (doc.worksFor !== undefined) {
    const org = doc.worksFor;
    if (org === null || typeof org !== 'object' || org['@type'] !== 'Organization' || !isText(org.name, 100)) {
      errors.push('"worksFor" must be {"@type": "Organization", "name": "..."}');
    } else if (org.url !== undefined && !isHttpsUrl(org.url)) {
      errors.push('"worksFor.url" must be an https URL');
    }
  }
  if (doc.url !== undefined && !isHttpsUrl(doc.url)) errors.push('"url" must be an https URL');
  if (doc.sameAs !== undefined) {
    if (!Array.isArray(doc.sameAs) || doc.sameAs.length > 20 || !doc.sameAs.every(isHttpsUrl)) {
      errors.push('"sameAs" must be a list of up to 20 https URLs');
    }
  }

  const newsletter = doc['cp:newsletter'];
  if (newsletter !== undefined) {
    if (
      newsletter === null ||
      typeof newsletter !== 'object' ||
      newsletter.platform !== 'substack' ||
      !isHttpsUrl(newsletter.url)
    ) {
      errors.push('"cp:newsletter" must be {"platform": "substack", "url": "https://..."}');
    }
  }
  if (doc['cp:githubId'] !== undefined && !(Number.isInteger(doc['cp:githubId']) && doc['cp:githubId'] > 0)) {
    errors.push('"cp:githubId" must be a positive integer');
  }
  if (doc['cp:aliases'] !== undefined) {
    const aliases = doc['cp:aliases'];
    if (!Array.isArray(aliases) || aliases.length > 10 || !aliases.every(isId)) {
      errors.push('"cp:aliases" must be a list of lowercase GitHub logins');
    }
  }
  for (const key of RESERVED_KEYS) {
    if (key in doc) errors.push(`"${key}" is set by the publish job and cannot be edited`);
  }
  return errors;
}

/**
 * Reads CODEOWNERS: `* @maintainer` is the maintainer, `/speakers/<id>.json @owner` lines map a
 * profile to its owner. Logins come back lowercased.
 */
export function parseCodeowners(text) {
  let maintainer = null;
  const owners = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [pattern, ...handles] = line.split(/\s+/);
    const owner = handles[0]?.replace(/^@/, '').toLowerCase();
    if (!owner) continue;
    if (pattern === '*') {
      maintainer = owner;
      continue;
    }
    const match = /^\/speakers\/([a-z0-9-]+)\.json$/.exec(pattern);
    if (match) owners.set(match[1], owner);
  }
  return { maintainer, owners };
}

/** The one CODEOWNERS line a speaker may add for their own profile. */
export const ownerLineFor = (login) => `/speakers/${login}.json @${login}`;

/**
 * The id a new profile gets from a name, for a speaker whose GitHub login is not known:
 * "Luca Trușcă" -> "luca-trusca". Lowercase ASCII, single hyphens, at most 39 characters.
 */
export function idFromName(name) {
  const id = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id.length <= 39 ? id : id.slice(0, 39).replace(/-[^-]*$/, '');
}

/** Ids of profiles their own speaker has claimed: the ones CODEOWNERS gives to that same login. */
export function claimedIds(codeownersText) {
  const { owners } = parseCodeowners(codeownersText);
  return new Set([...owners].filter(([id, owner]) => id === owner).map(([id]) => id));
}
