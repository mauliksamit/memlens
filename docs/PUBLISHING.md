# Publishing MemLens

Publisher: **mauliksamit** (extension ID `mauliksamit.memlens`), managed at
<https://marketplace.visualstudio.com/manage/publishers/mauliksamit>.

## Every release

```sh
npm install
npm run build && npm run test        # all green
# bump "version" in packages/extension/package.json and add a CHANGELOG entry
npm run package                      # → packages/extension/memlens-<version>.vsix
code --install-extension packages/extension/memlens-<version>.vsix   # smoke test
```

Then publish the `.vsix` one of two ways.

### Upload by hand (no token needed)

On the publisher page: **New extension → Visual Studio Code** for the first
release, or **… → Update** on the existing extension for later ones, and drop in
the `.vsix`.

### From the command line

Needs a Personal Access Token from an Azure DevOps organization
(<https://dev.azure.com>, *User settings → Personal access tokens*,
organization **All accessible organizations**, scope **Marketplace → Manage**).

```sh
cd packages/extension
npx @vscode/vsce login mauliksamit
npx @vscode/vsce publish --no-dependencies
```

`--no-dependencies` is required: esbuild bundles everything, and the
`@memlens/*` workspace packages are not on npm.

## Optional: Open VSX (Cursor, VSCodium, Gitpod)

1. Sign in at <https://open-vsx.org> with GitHub, sign the publisher agreement,
   and create an access token.
2. `npx ovsx create-namespace mauliksamit -p <token>` (once).
3. `npx ovsx publish packages/extension/memlens-<version>.vsix -p <token>`.

## Notes

- Screenshots live in `packages/extension/resources/screenshots/` and the README
  references them by absolute `raw.githubusercontent.com` URLs, so they must be
  pushed to `main` before publishing.
- Regenerate the icon only if you change it: `npm run build:icon -w memlens`.
