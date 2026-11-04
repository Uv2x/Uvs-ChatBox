# Releasing a new version

Uv's Chat Box updates itself from **GitHub Releases** on
[github.com/Uv2x/uvs-chatbox](https://github.com/Uv2x/uvs-chatbox/releases).

Every installed copy checks 20 seconds after launch and then every 4 hours.
When a newer release exists, a banner offers **Download → Restart to update**.
If you skip the restart, the update installs the next time you quit.

## How it works

- `package.json` → `build.publish` names the repo (`Uv2x/uvs-chatbox`).
  electron-builder bakes that into `resources/app-update.yml` inside every
  installer it builds.
- Each release carries a small `latest.yml` that lists the newest version, the
  installer's file name, and its SHA-512. The app reads that file, compares
  versions, and verifies the download before installing.
- The repo must be **public**. A private repo would need a token inside the
  app, and that token would ship to everyone who installs it.

## Shipping an update

### 1. Bump the version

Every release needs a **higher** version than the last one. Pick one:

```powershell
npm version patch --no-git-tag-version   # 1.1.0 → 1.1.1  (bug fixes)
npm version minor --no-git-tag-version   # 1.1.0 → 1.2.0  (new features)
```

### 2. Build the installer

```powershell
npm run package
```

This creates three files in `release/` that matter:

| File                                    | What it is                                |
| --------------------------------------- | ----------------------------------------- |
| `Uvs-Chat-Box-Setup-X.Y.Z.exe`          | the installer                             |
| `Uvs-Chat-Box-Setup-X.Y.Z.exe.blockmap` | lets updates download only what changed   |
| `latest.yml`                            | tells installed apps a new version exists |

### 3. Publish on GitHub

1. Go to **github.com/Uv2x/uvs-chatbox → Releases → Draft a new release**.
2. **Choose a tag**: type `vX.Y.Z` (e.g. `v1.2.0`) and click _Create new tag_.
3. Title it the same, and write what changed.
4. Drag in **all three files** from step 2. `latest.yml` is the one that makes
   auto-update work, so don't skip it.
5. Leave _Set as a pre-release_ **unticked**, then click **Publish release**.

Within 4 hours every running copy shows the update banner. Restarting the app
makes it show sooner.

### Optional: one command instead of steps 2–3

If you have a GitHub token, `npm run release` builds and uploads everything
itself. Create a fine-grained token at _GitHub → Settings → Developer settings →
Personal access tokens_, limited to this repo with **Contents: Read and write**.
Then put it **only in your own terminal** for that session:

```powershell
$env:GH_TOKEN = "github_pat_..."
npm run release
```

Never commit the token, paste it into the app, or share it.

## Rules that break updates if ignored

- **Never reuse a version number.** Installed apps only update to a _higher_
  version.
- **Don't rename the files.** `latest.yml` points at the installer by its exact
  name.
- **Drafts and pre-releases are invisible** to the updater. Publish it.
- **Keep the repo public** (see above).

## Checking it worked

Open the app → **🩺 System Check** → _App updates_ row:

| Shows                              | Meaning                                    |
| ---------------------------------- | ------------------------------------------ |
| Up to date                         | the feed works and you have the newest     |
| vX.Y.Z is available                | the update banner should be showing        |
| No release published on GitHub yet | no _published_ release with a `latest.yml` |
| Can't reach GitHub                 | internet / firewall problem                |
| Not set up for this build          | a dev build, or one built before 1.1.0     |

**Settings → Updates** shows the same state, with _Check now_.

## First install

Copies built before **1.1.0** have no update feed, so they can't find updates.
Install 1.1.0 (or newer) once by hand from the Releases page. Every release
after that arrives on its own.
