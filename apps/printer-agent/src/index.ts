// Not wired to @print-automated/api-client yet, unlike customer-web and
// shop-mobile: the package's two AuthStrategy implementations (cookie,
// bearer-token-with-refresh-token) both model a *user* session, but the
// agent's identity is an Ed25519 device keypair with challenge/response
// authentication (§41) -- there is no refresh token to hold. Phase 9.3
// adds a real agent-specific AuthStrategy once device registration and
// authentication actually exist to implement it against; forcing the
// wrong shape in now would just be next phase's work to undo.
export {};
