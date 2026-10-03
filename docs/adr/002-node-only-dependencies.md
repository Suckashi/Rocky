# ADR-002: Reproducible Node-only dependency path

Accepted 2026-10-03.

Node 24.12.0 and npm 11.6.4 are the baseline. The host npm 11.6.2 is too old for Promptfoo 0.120.0's declared npm range; validation invokes npm 11.6.4 through npx without changing the host global installation.

Use omit=optional to exclude optional provider SDKs, downloaded browsers, transformer models and LGPL image libraries. These remain visible in lockfile inventory as omitted, not approved distribution dependencies.

Vite 7.3.6 avoids Vite 8's required MPL Lightning CSS. Rollup resolves to the official MIT WASM implementation 4.64.0 through an explicit npm alias override. TypeScript 5.9.3 uses the JS compiler; TypeScript 7's optional native compiler is incompatible with blanket optional omission.

Esbuild's own install script fetches its fixed platform executable when omitted optional platform packages are absent. This is a native binary download, not source compilation. Official SqliteSaver uses better-sqlite3 with a prebuilt binary. Clean-copy tests constrain PATH and force Python resolution to a failing guard; compiler guard invocations fail the gate. This is measured per platform; Windows results do not establish Ubuntu compatibility.

Promptfoo 0.123.1 worked in the initial spike but uses optional libsql platform binaries; 0.120.0 provides the verified better-sqlite3 path. Its public evaluate API takes a trusted bound provider function. No runtime source patches or ignored engine/peer checks.

Additional permissive license families inventoried: MIT-0, ISC, BSD, 0BSD, BlueOak, Unlicense, Artistic-2.0 and Python-2.0 (a license identifier, not a Python runtime dependency). For dual licenses select the permissive branch. caniuse-lite is separately attributed CC-BY-4.0 browser-support data, not mislabeled program code. Missing package metadata for khroma/xmlhttprequest-ssl was resolved against installed MIT license texts; url-template's installed text is BSD-3-Clause. Exact reviewed versions are recorded by the license checker. Release packaging/notices still require P8 review.
