# Security scope

This is a recovery utility that can authorize real asset transfers. It is not independently audited. Review the full source and pinned deployment policy before using it with funds. The code does not access or request private keys, seed phrases, browser password storage, or credential exports.

Supported deployments are the exact Barz v1 P-256 verifier, account facet, wallet runtime and EntryPoint v0.6 hashes in the codec. Source addresses are user supplied, but matching public keys alone are insufficient: runtime, facets, restrictions, lock state and active selector must also pass. Unsupported deployments and recipient contracts for native transfers fail closed. RPC results are trusted; provider compromise and chain reorganizations remain external risks. Twelve confirmations are a practical waiting policy, not a mathematical finality proof.

The browser passkey dialog does not provide a trusted display of transfer details. Review the local page before signing. A signature is a live authorization without a contract-level expiry. No operation is submitted merely by loading balances, preparing or signing; submission is a separate user-approved step.

The application uses no arbitrary RPC URLs, remote code, content scripts, broad host permissions, telemetry or automatic sending. It cannot control networking performed internally by Chrome or the credential provider. PublicNode receives reads and unsigned simulations. Pimlico receives estimation data after consent, and the signed operation only after send consent. It is impossible to recall a signature after disclosure.

The journal and Web Locks cover one installed extension profile, not other applications, profiles or devices. Never clear the journal or reinstall to bypass an uncertain submission. First inspect the operation/transaction on-chain. Failed receipt verification is not proof that funds were not transferred. A malformed or adversarial token can lie about its symbol, balances or logs; arbitrary-token support is not a token safety guarantee.

Tests use synthetic keys and mocked RPC calls and do not establish live-network availability. Native transfer logic has not been exercised by a real transfer as part of this release preparation. Keep test assertions, operation exports, private account data and secrets out of issues and pull requests. If reporting a suspected vulnerability publicly, omit executable signatures and private recovery data; coordinate a private disclosure with the repository maintainer when available.
