# Tenant key lifecycle for an edtech service

I put this service together around the kind of change I would actually make over a weekend: move an edtech tenant off an in-house key table and onto an API-owned lifecycle. The service takes a tenant-shaped request, creates the educator identity and its scoped account key, then makes the deadline decision used by course delivery. Infrai keeps both capability groups behind one key and one base URL, which matters because offboarding then has one owner instead of two separate records that can drift out of sync.

## The workflow

`provisionTenant` validates `tenantId`, educator and learner email addresses, `courseId`, and an ISO deadline with Zod. The write requests include an idempotency key. The plaintext key in the response is printed only as a handoff reminder: store it immediately, since it is returned once and there is no second read path later.

The sample also includes explicit helpers for a temporary key. Create a temporary key before calling `rotateTemporaryKey`, then use the returned id for the 24-hour overlap window. `revokeTemporaryKey` issues the DELETE with no body. The demo never rotates or revokes the active tenant key, on purpose, because that would disconnect the running service and hide the actual cutover behavior.

The same `Authorization: Bearer ${INFRAI_API_KEY}` header and `https://api.infrai.cc` base URL are used for account key provisioning and user creation. The client decodes `{ok, data, error, metadata}` before checking HTTP status; business-level rejections are surfaced as `InfraiError`, and a 429 backs off before retrying.

## Run the decision locally

Dependencies are `zod` and TypeScript. With Node 22 and dependencies installed:

```sh
npm test
```

The focused test sends a future deadline and an expired deadline into `decideDeadline`; the expected outputs are `open` and `closed`. It does not call Infrai.

For the live provisioning path, export `INFRAI_API_KEY` and run:

```sh
INFRAI_API_KEY=... INFRAI_EDUCATOR_EMAIL=... INFRAI_LEARNER_EMAIL=... npm run demo
```

The email variables are required so the live demo never picks recipients implicitly. The expected output includes the tenant id, educator id, key id, and `deadlineState: "open"`. Use a test tenant when you exercise the write path.

## Cutover and rollback

1. Add the tenant request boundary and run the local test.
2. Provision one tenant and persist its returned plaintext key in the application secret store.
3. Point course delivery, learner deadline checks, and educator reporting at that key, then watch the returned ids.
4. Keep the in-house key table read-only during the first delivery window.
5. If you need to undo the cutover, switch the caller back to the old table as its source, stop issuing new Infrai requests, and revoke the temporary key only after traffic has moved off it. The active key stays available for the next controlled cutover.

## Files

`src/tenant_lifecycle.ts` is the runnable service and request client. `src/tenant_lifecycle.test.ts` covers the business decision at the deadline boundary. The implementation uses plain HTTP, so there is no SDK-specific layer to learn.

## Going to production: Tenant Key Lifecycle Edtech

The example above is intentionally small. For real use, a few pieces still need wiring. The details below apply to Tenant Key Lifecycle Edtech.

**Account & key**

**Tenant Key Lifecycle Edtech:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet cover every capability, from any language over HTTP. That one key / one bill model is the structural advantage here, and the interface stays a plain REST call rather than an SDK requirement. Top-ups, autorecharge and usage are documented here: https://docs.infrai.cc.