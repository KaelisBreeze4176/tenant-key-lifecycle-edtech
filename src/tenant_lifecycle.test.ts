import test from "node:test";
import assert from "node:assert/strict";
import { decideDeadline, tenantRequest } from "./tenant_lifecycle.ts";

test("a learner with a future deadline remains open, while an expired course is closed", () => {
  const request = tenantRequest.parse({ tenantId: "t-1", educatorEmail: "educator@example.com", learnerEmail: "learner@example.com", courseId: "course-1", deadline: "2030-06-30T23:59:00.000Z" });
  const now = new Date("2030-01-01T00:00:00.000Z");
  assert.equal(decideDeadline(request.deadline, now), "open");
  assert.equal(decideDeadline("2029-12-31T23:59:00.000Z", now), "closed");
});
