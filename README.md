# SWIFT Passkey Transfer

A small, source-only Chrome Manifest V3 extension for compatible **Barz v1 SWIFT wallets** on **Polygon PoS (137)** and **BNB Smart Chain (56)**. Transfer an ERC-20 token or native POL / BNB using the existing `trustwallet.com` passkey. The interface is English.

This is an independent recovery tool, not an official Trust Wallet product. It has not received an independent security audit. Support is intentionally limited to the exact wallet, verifier, account facet and EntryPoint v0.6 runtime hashes pinned in `extension/remainder-codec.mjs`. An arbitrary SWIFT address is accepted as input, but incompatible deployments fail the full pre-signing check.

## Install

1. Download or clone this repository. No installation or build step is needed.
2. Open `chrome://extensions` in Chrome 122 or newer, enable Developer mode and choose **Load unpacked**.
3. Select the `extension` directory. Allow the four declared hosts. Click the extension icon to open its page.
4. Use the Chrome profile/password manager containing the existing wallet passkey. Creating a new passkey does not recover an existing wallet.

Chrome extension pages can claim an external WebAuthn RP ID only with the corresponding host permission. This extension explicitly declares `https://trustwallet.com/*`; it does not inject scripts into that site. See [Chromium implementation](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/webauthn/chrome_web_authentication_delegate.cc) and [Chrome M122 announcement](https://lists.w3.org/Archives/Public/public-webauthn/2023Dec/0078.html). Browser policies and credential providers can still prevent access.

## Transfer flow

1. Choose **Polygon PoS** or **BNB Smart Chain** at the top.
2. Choose **Token (ERC-20)** or **Native currency**. For tokens, USDT is selected by default; replace its contract address if needed.
3. Enter the source SWIFT address and click **Update balance**. ERC-20 symbol, decimals and balance are read from the contract. Contract edits cause no network requests until this button is clicked. After settings are loaded, balances refresh every 15 seconds while the tab is visible.
4. Enter the recipient address, click **Update balance** again, and enter an amount or click **Max**.
5. Approve disclosure of the unsigned draft for gas estimation, then click **Prepare transfer**. Review the amount, network, full recipient and maximum fee.
6. Approve signing and click **Sign transfer**. Select the existing owner passkey in Chrome. The assertion is verified locally against the on-chain public key.
7. Separately approve submission, then click **Submit signed transfer**. Wait for receipt verification and 12 confirmations before repeating.

Changing any field invalidates the prepared operation and signature. To make another transfer after confirmation, refresh the balance, enter a new amount, and repeat preparation/signing/submission. No automatic signing, submission, fee bump or resubmission exists. Native transfer support has offline tests; validate it with a small live amount before using Max.

## Assets and fees

| Network | Default token | Decimals | Native asset | Default maximum fee per operation |
| --- | --- | --- | --- | --- |
| Polygon PoS | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` (USDT0) | 6 | POL | 0.825 POL |
| BNB Smart Chain | `0x55d398326f99059fF775485246999027B3197955` (USDT) | 18 | BNB | 0.00033 BNB |

The displayed fee is a ceiling, not a price prediction. Fixed gas limits are 300,000 call gas, 1,200,000 verification gas and 150,000 pre-verification gas; default fee ceilings are 500 Gwei on Polygon and 0.2 Gwei on BSC. The **Gas price ceiling** field allows an explicit choice: 500 / 1,000 / 2,000 / 5,000 Gwei on Polygon (maximum 0.825 / 1.65 / 3.3 / 8.25 POL), or 0.2 / 0.5 / 1 Gwei on BSC (maximum 0.00033 / 0.000825 / 0.00165 BNB). These are worst-case ceilings, not expected costs. Changing this field erases the draft and signature; click **Update balance** and then **Max** again before preparing. The default does not silently increase. Preparation uses the fast quote plus 25%, bounded by the ceiling. An over-cap quote displays its required buffered Gwei alongside the selected ceiling. If the network or estimate exceeds a limit, the operation stops and must be prepared again. Higher gas limits cannot guarantee timely inclusion.

For **native Max**, the spendable amount is:

`max(0, wallet native balance - max(0, maximum fee - EntryPoint deposit))`

The EntryPoint deposit is shown separately. Unused prefund can remain in that deposit after execution. This tool does not withdraw the deposit and does not guarantee an exactly empty wallet. Native recipients must have no contract code. Simulation uses the pinned [Multicall3](https://github.com/mds1/multicall3/blob/main/src/Multicall3.sol) `getEthBalance` probe to check the recipient balance after execution. Native receipt verification checks the exact `handleOps` operation calldata/hash, successful execution, recipient code and pinned wallet runtime.

ERC-20 contracts must expose `balanceOf` and `decimals` (0–36 supported). The symbol is untrusted display text. Exact recipient gain must pass unsigned simulation; the receipt must contain the expected exact Transfer event. Fee-on-transfer, rebasing and other unusual contracts may be rejected. Anyone can deploy a token with a familiar symbol; verify the contract address independently. Token simulation is not an audit of its contract.

## Privacy and signing

- No seed phrases or private keys are requested, exported or stored. No telemetry, remote scripts, analytics or dependencies loaded from CDNs.
- Fixed PublicNode RPC hosts receive public balance/state queries and unsigned simulation calls. The `trustwallet.com` host permission enables WebAuthn; application code does not fetch that domain.
- Pimlico receives public draft parameters only after estimation consent. The real signature is sent only after separate submission consent. See [Pimlico receipt API](https://docs.pimlico.io/references/bundler/endpoints/eth_getUserOperationReceipt).
- Local verification uses P-256 ECDSA/SHA-256 over `authenticatorData || SHA256(clientDataJSON)`, and checks challenge, extension origin, RP hash and user presence/verification flags.
- A transfer assertion signs the operation hash, not a random test challenge. It authorizes a real transaction and has no on-chain expiry. Closing the tab clears its in-memory copy, but cannot revoke disclosed copies.
- Only public attempt metadata persists in localStorage. Signatures and assertion bodies are excluded. The local journal plus Web Locks prevent duplicate submissions in the same extension profile. Other profiles, browsers or wallet applications are outside that lock.
- An uncertain or rejected submission stays locked for status checking; public read retries never retry a submission. Do not clear the journal to work around this: establish the on-chain outcome first. Receipts and state depend on the configured public RPC provider; this is not a light client or hardware-wallet display.

## Development and GitHub

Requires Node 22+ for checks/tests, Python 3 for packaging. No npm dependencies or package installation are required.

```sh
npm run check
npm test
npm run package
```

`dist/swift-passkey-transfer-extension.zip` contains only installable extension files. The tests run offline with synthetic keys and mocked transport; no real passkey prompt or blockchain submission occurs. ABI fixtures were independently generated with ethers 5.7.2; tests need no ethers installation. The wallet runtime fixture is public contract code, without account storage or owner data.

This repository has blank address defaults and contains no personal assertion exports, operation history, RPC keys or wallet public keys. Keep it that way: `.gitignore` excludes local settings, exports, journals and build products. To customize local defaults, copy `extension/defaults.mjs` to `extension/defaults.local.mjs`, edit the copy and change the import locally; do not commit that import change. Alternatively, enter addresses in the page. Review staged files before pushing. CI runs checks/tests and builds the extension ZIP. Add your GitHub repository remote and push this directory after review; no repository has been created or published by this preparation.

## Source map

- `remainder.mjs/html/css`: controlled local UI and explicit user actions.
- `remainder-codec.mjs`: integer arithmetic, context binding, minimal ABI, operation hashing and fixed policy.
- `remainder-network.mjs`: allowlisted transport, pinned state checks, simulation and receipt verification.
- `remainder-controller.mjs`: consent gates, cancellation and state transitions.
- `remainder-journal.mjs`: public-only duplicate-submission journal.
- `verify.mjs`: strict DER decoding and Web Crypto assertion verification.
- `vendor/noble`: vendored Keccak implementation, provenance and upstream MIT license.

MIT licensed; see LICENSE. See SECURITY.md for the review scope and limitations.
