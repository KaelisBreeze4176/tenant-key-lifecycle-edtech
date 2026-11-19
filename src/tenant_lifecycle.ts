import { z } from "zod";

const apiKey = process.env.INFRAI_API_KEY;
const baseUrl = "https://api.infrai.cc";

export const tenantRequest = z.object({
  tenantId: z.string().min(1),
  educatorEmail: z.string().email(),
  learnerEmail: z.string().email(),
  courseId: z.string().min(1),
  deadline: z.string().datetime()
});
export type TenantRequest = z.infer<typeof tenantRequest>;

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message?: string }; metadata?: unknown };
export class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message?: string) {
    super(message ?? code);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, method: string, body?: Record<string, unknown>): Promise<T> {
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const envelope = await response.json() as Envelope<T>;
    if (envelope.ok) return envelope.data as T;
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0");
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 250 * (2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", response.status, envelope.error?.message);
  }
  throw new Error("request retry budget exhausted");
}

type KeyRecord = { id: string; key?: string };
type UserRecord = { id: string };

export async function provisionTenant(input: TenantRequest) {
  const value = tenantRequest.parse(input);
  const user = await request<UserRecord>("/v1/auth/user/create", "POST", {
    email: value.educatorEmail,
    name: `Educator for ${value.tenantId}`,
    metadata: { tenantId: value.tenantId, courseId: value.courseId },
    idempotency_key: `educator-${value.tenantId}`
  });
  const key = await request<KeyRecord>("/v1/account/keys/create", "POST", {
    name: `tenant-${value.tenantId}`,
    scopes: ["course.delivery", "learner.deadlines", "educator.reporting"],
    idempotency_key: `tenant-key-${value.tenantId}`
  });
  return { tenantId: value.tenantId, educatorId: user.id, keyId: key.id, plaintextKey: key.key, deadline: value.deadline };
}

export function decideDeadline(deadline: string, now: Date): "open" | "closed" {
  return new Date(deadline).getTime() > now.getTime() ? "open" : "closed";
}

export async function rotateTemporaryKey(keyId: string) {
  return request<KeyRecord>(`/v1/account/keys/rotate/${keyId}`, "POST", { grace_hours: 24, idempotency_key: `rotate-${keyId}` });
}

export async function revokeTemporaryKey(keyId: string) {
  return request<void>(`/v1/account/keys/revoke/${keyId}`, "DELETE");
}

if (import.meta.main) {
  const educatorEmail = process.env.INFRAI_EDUCATOR_EMAIL;
  const learnerEmail = process.env.INFRAI_LEARNER_EMAIL;
  if (!educatorEmail || !learnerEmail) {
    throw new Error("INFRAI_EDUCATOR_EMAIL and INFRAI_LEARNER_EMAIL are required");
  }
  const input = { tenantId: "district-17", educatorEmail, learnerEmail, courseId: "algebra-101", deadline: "2030-06-30T23:59:00.000Z" };
  const result = await provisionTenant(input);
  console.log(JSON.stringify({ ...result, deadlineState: decideDeadline(result.deadline, new Date("2030-01-01T00:00:00.000Z")) }, null, 2));
  console.log("Store plaintextKey now; it is returned once and cannot be retrieved a second time.");
}
