# Bounded Linux runtime delivery

The CI job now runs the completed Next and tsup builds on Ubuntu 24.04, using Node
20.20.2 to match the deployed runtime and pnpm 9 with the unchanged lockfile.
Only the three existing public build values enter that build. Production
credentials, SMS sessions, model configuration and user documents stay on the
server. No deployment SSH credentials are needed by GitHub Actions.

The repository contains six provider/feedback files absent from the deployed
303-file runtime source profile. Before building, `--prepare` moves only those
verified clean Git files into the disposable runner's temporary directory. The
checkout must be a GitHub CI workspace; a modified file is refused. The manifest
records these exclusions. Local/source checkouts and production are not altered,
and CI does not silently enable the repository-only provider endpoint. Reconcile
that profile explicitly before any later authorized provider rollout.

The private Actions artifact contains `ci-runtime.tar.gz` and its file manifest.
It is tied to the checked-out commit/tree, BUILD_ID, exact file hashes, Node and
public build configuration. The tar includes tracked runtime source/Skills and
compiled output. It excludes dependencies, production env files, uploads,
runtime cache and source maps. Existing `package:linux` remains available for
other deployments; do not run it on the capacity-constrained production host.

After CI succeeds, download the artifact for that exact PR head. Check the PR's
merged source tree against the artifact's source files before a release. Do not
reuse an old success receipt. Inspect and hash the downloaded manifest locally;
pass that trusted SHA to the importer, which reads the tar from stdin:

```sh
python3 deploy/linux/import-ci-runtime.py \
  --current /opt/knowtrail/current \
  --candidate /opt/knowtrail/releases/knowtrail-<verified-release> \
  --manifest-sha <sha256-of-downloaded-manifest> < ci-runtime.tar.gz
```

For remote delivery, stream the local tar through SSH stdin rather than copying
an additional archive onto the production disk. The importer checks the full
manifest first, requires the current lockfile/package and Node/public config to
match, and bounds new allocation before creating the candidate. It preserves the
32,000,000,000-byte readiness floor plus a 20 MB concurrent-write reserve. A
refusal leaves no candidate. A changed dependency needs its own verified rollout;
the importer never installs or upgrades packages.

Only identical immutable code/static assets may share inodes with the retained
current release. HTML/RSC/runtime cache stays separate. Node dependencies are a
runtime-only reference to the retained, verified current tree; production never
runs Turbopack against that reference. Hashed external package aliases are local
to the new candidate, so the existing dependency directory is not modified.
Every streamed file is checked against its manifest. Failure removes only the
new candidate created by that invocation, after sibling/ownership checks.

Import does not copy credentials, wire shared data, run a build, change a release
pointer, start a process or reload PM2. Complete the existing server-only env/data
wiring and final compiled HTTP/browser/file QA for that BUILD_ID before the
existing standby/atomic promotion/rollback procedure. Keep production health,
shared-data hashes, actual process/port and rollback checks; a successful CI build
or import alone is not product acceptance.
