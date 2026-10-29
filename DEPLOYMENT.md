# Build and release Page Copilot

## Verify the source

```powershell
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

The extension version is set in `src/manifest.config.ts`. Keep the package
version in `package.json` consistent when preparing a new version.

Never commit API keys, environment files, `node_modules`, `dist`, or release
ZIPs. Review both current files and Git history before publishing source.

## Make the installable archive

```powershell
Compress-Archive -Path dist\* -DestinationPath page-copilot.zip -Force
```

The archive must contain `manifest.json` at its root, together with the
compiled scripts, HTML, styles, and icons. Attach the ZIP to a GitHub release;
the automatically generated source archive is not the built extension.

## Install from a GitHub release

1. Download `page-copilot.zip` from the repository's Releases page.
2. Extract it into a permanent folder; keep that folder after installation.
3. In Chrome, open `chrome://extensions`; in Edge, open `edge://extensions`.
4. Enable Developer mode, choose Load unpacked, and select the extracted
   folder containing `manifest.json`.
5. Open Page Copilot, then select local mode or enter your own cloud API key.

Manual installation does not provide automatic updates. To update, download
the new release, replace the extracted files, and reload the extension.
Browser or organization policies may prevent manual installation.

Local mode requires a llama.cpp server on each user's computer. Cloud mode
requires each user's provider account and key; provider quotas and charges
apply. No API key or AI model is bundled in the release.

## Publish a release

Confirm the repository's visibility and the release contents with its owner
before making public changes. For the existing repository, push `main` and
create a release tagged `v<version>` with the verified ZIP attached. Do not
create a duplicate repository or force-push.

## Publish the privacy policy

Keep `PRIVACY.md` and `docs/index.md` identical. Set GitHub Pages to deploy
from branch `main`, folder `/docs`. The expected policy address is:

https://burhan610.github.io/page-copilot/

Verify the address after deployment before using it in a store submission.
GitHub Pages hosts the policy document; it does not install the extension or
host an AI server. Public source and release distribution through GitHub do
not publish the extension in the Chrome Web Store or Microsoft Edge Add-ons.

## Manual release checks

Test the built extension in Chrome and Edge with regular pages, restricted
pages, selection actions, tab changes, stopping a response, and settings.
Test real provider requests separately from the mocked regression tests.
