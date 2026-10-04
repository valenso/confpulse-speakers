# ConfPulse speakers

Public speaker profiles for the [ConfPulse](https://github.com/valenso/ConfPulse) app. Each speaker keeps one file, and only they can change it.

## Claim your profile

A profile is yours once it is **claimed**: your GitHub login is its id, and only you can change it. There are two ways to get there.

**Your name is already in [`speakers/`](speakers/).** It was created from a conference programme, as an [unclaimed profile](#unclaimed-profiles). [Open an issue](https://github.com/valenso/confpulse-speakers/issues/new) with your GitHub login. A maintainer renames the file to your login, keeps the old id in `cp:aliases` so sessions that name the old id still find you, and adds your CODEOWNERS line.

**There is no profile for you yet.** Claim your id by creating the profile:

1. Fork this repo.
2. Copy [`examples/janedoe.json`](examples/janedoe.json) to `speakers/<your-github-login>.json`, **lowercase**, and fill it in.
3. Add one line to `.github/CODEOWNERS`:
   ```
   /speakers/<your-github-login>.json  @<your-github-login>
   ```
4. Open a pull request. It waits for one review from the maintainer.

The file name is your id. It must be your GitHub login in lowercase, the same string as `identifier` inside the file, and the PR has to come from that account.

## Update your profile

Once it is claimed, fork the repo, edit your file and open a pull request. Edits to your own profile merge automatically once the `guard` check passes.

## Profile format

A [schema.org `Person`](https://schema.org/Person):

| Field | Required | Notes |
|---|---|---|
| `@context` | yes | `"https://schema.org"` |
| `@type` | yes | `"Person"` |
| `identifier` | yes | your lowercase GitHub login, same as the file name |
| `name` | yes | up to 100 characters |
| `image` | no | https URL of your photo; the app falls back to your GitHub avatar |
| `description` | no | your bio, up to 2000 characters |
| `jobTitle` | no | your current position |
| `worksFor` | no | `{"@type": "Organization", "name": "...", "url": "https://..."}`, your current company (`url` optional) |
| `url` | no | your website, https |
| `sameAs` | no | https links to your profiles: GitHub, X, LinkedIn, ... |
| `cp:newsletter` | no | `{"platform": "substack", "url": "https://you.substack.com"}`; the app then offers a subscribe form |
| `cp:githubId` | no | your numeric GitHub id, used to follow a login change |
| `cp:aliases` | no | your previous GitHub logins |

All links must be `https`. `cp:verified` is added by the publisher and cannot be set in your file.

## Unclaimed profiles

A speaker found in a conference programme with no profile here gets one made for them, so their sessions can name them: `node scripts/add-speaker.mjs "Full Name"` writes `speakers/<name-slug>.json` with just the name (and optionally `--title` / `--company`, only when the official site says so). Its id is a slug of the name, **not a GitHub login**, because the login is not known. Nothing else is filled in.

The published index marks such a profile `"cp:claimed": false`, and the app then shows no GitHub photo or link for it, since the slug could belong to an unrelated GitHub account. A profile is claimed once CODEOWNERS gives its file to the speaker's own login.

To take one over, see [Claim your profile](#claim-your-profile).

## How access works

- `.github/CODEOWNERS` lists the owner of every profile, and the maintainer owns everything else.
- The `guard` workflow is the required check. A PR passes only if every file in it is a profile owned by its author, or whose owner approved the change, and each file is valid. A new profile must be named after its author and approved once by the maintainer. A speaker may add only their own CODEOWNERS line.
- CODEOWNERS alone can't do this: it requests reviews, and GitHub ignores an author's approval of their own PR.

## Published index

On every merge, `publish` builds `speakers.json` and deploys it to GitHub Pages; that is what the app reads. It adds `cp:verified: true` to a profile the speaker added themselves.

## Maintainer setup (one time)

- Settings > Pages: source **GitHub Actions**.
- Settings > General: allow **auto-merge**; allow squash merging.
- Branch protection (or a ruleset) on `main`: require a pull request, require the **guard** status check, block force pushes. Do **not** require code owner review; the guard applies that rule itself.
- Settings > Actions > General: workflow permissions can stay read-only (the workflows request what they need).

## Renaming a login

A maintainer renames the file, updates `identifier` and the CODEOWNERS line, and adds the old login to `cp:aliases`.

## Development

```
node --test tests/
node scripts/build-index.mjs _site
```
