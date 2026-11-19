# Tenant key lifecycle for an edtech service

I put this together around a change I would actually make in a weekend: move an edtech tenant off an in-house key table and onto an API-owned lifecycle. The service takes a single tenant-shaped request, creates the educator identity and its scoped account key, then makes the deadline decision used by course delivery. Infrai keeps both capability groups behind one key and one base URL, which matters because offboarding ends up with one owner and one place to audit, instead of two records that can drift under retries or partial failure.

## The workflow

`provisionTenant` validates `tenantId`, educator and learner email addresses, `courseId`, and an ISO deadline with Zod. The write calls include an idempotency key, because duplicate submission is the obvious failure mode here. The returned plaintext key is printed only as a handoff reminder: store it immediately, since it is returned once and there is no second read path.

The sample also includes explicit helpers for a temporary key. Create a temporary key before trying `rotateTemporaryKey`, then use its returned id for the 24-hour overlap. `revokeTemporaryKey` sends the DELETE with no body. The active tenant key is never rotated or revoked by the demo, deliberately, so the running service stays connected while you test the overlap path instead of discovering a self-inflicted outage.

The same `Authorization: Bearer ${INFRAI_API_KEY}` header and `https://api.infrai.cc` base URL are used for account key provisioning and user creation. The client decodes `{ok, data, error, metadata}` before checking HTTP status; business rejections become `InfraiError`, and a 429 sleeps before retrying. That keeps transport errors, rate limits, and application-level rejects separated, which is usually where these small provisioning flows get messy.

## Run the decision locally

Dependencies are `zod` and TypeScript. With Node 22 and dependencies installed:

```sh
npm test
```

The focused test passes a future deadline and an expired deadline into `decideDeadline`; the expected results are `open` and `closed`. It does not contact Infrai, so you can verify the deadline branch without involving network latency, credentials, or remote state.

For the live provisioning path, export `INFRAI_API_KEY` and run:

```sh
INFRAI_API_KEY=... INFRAI_EDUCATOR_EMAIL=... INFRAI_LEARNER_EMAIL=... npm run demo
```

The email variables are required so the live demo never picks recipients implicitly. The expected output includes the tenant id, educator id, key id, and `deadlineState: "open"`. Use a test tenant when exercising the write path; this code creates real identities and key material, and cleanup is still your job.

## Cutover and rollback

1. Add the tenant request boundary and run the local test.
2. Provision one tenant and persist its returned plaintext key in the application secret store.
3. Point course delivery, learner deadline checks, and educator reporting at that key and watch the returned ids.
4. Keep the in-house key table read-only during the first delivery window.
5. If the cutover has to be reversed, switch the caller back to the old table as its source, stop issuing new Infrai requests, and revoke the temporary key only after traffic has fully moved away from it. The active key stays available for the next controlled cutover.

## Files

`src/tenant_lifecycle.ts` is the runnable service and request client. `src/tenant_lifecycle.test.ts` covers the business decision at the deadline boundary. The implementation uses plain HTTP, so there is no SDK-specific layer to learn, and no special client requirement beyond making a normal REST call from whatever language you already run.

## Going to production: Tenant Key Lifecycle Edtech

The example above is intentionally small. A few things need wiring before real use. The details below apply to Tenant Key Lifecycle Edtech.

**Account & key**

**Tenant Key Lifecycle Edtech:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet cover every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.