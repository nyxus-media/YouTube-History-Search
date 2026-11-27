# Firefox sandbox regression reproduction

This optional test launches a separate headless Firefox profile with a temporary MV2 userscript extension. It reproduces FireMonkey's onBeforeScript/defineGlobals/exportFunction boundary and extension-backed asynchronous storage, including the original permission-denied failures. It does not install into or modify the user's Firefox profile. It is not a full FireMonkey extension test.

The fixture page uses a strict script-src 'none' Content Security Policy. No page eval or injected inline scripts are needed by the working adapter.

Install marionette_driver in a separate Python virtual environment. With that environment active, run from the repository root:

```powershell
python tests/browser/firefox-sandbox.py
node node_modules/esbuild/bin/esbuild tests/browser/storage-integration.ts --bundle --format=iife --platform=browser --outfile=dist/storage-integration.js
python tests/browser/firefox-sandbox.py dist/storage-integration.js
npm run build
python tests/browser/firefox-sandbox.py dist/youtube-history-search.user.js
```

The first command compares failing and working callback variants; the working variant is exportedAllowWindow. The integration fixture checks lock lifetime, error propagation, recovery, and concurrent library saves through extension storage. The full build must show the Search Local History button. The runner prints observations for manual inspection; diagnostic failures are visible in its output.

Requires Firefox with the MV2 userScripts API. The default binary path is the Windows Firefox installation; set FIREFOX_BINARY for a different path. The runner uses localhost port 2837 for Marionette and a randomly assigned HTTP port. Test profiles are created in the OS temp directory and retained for inspection. The runner's storage listeners are stubs, so automatic remote refresh still requires the documented FireMonkey smoke test.
