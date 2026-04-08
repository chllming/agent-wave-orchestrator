import { describe, expect, it } from "vitest";
import {
  buildAccessSummary,
  getPendingAccessUsers,
} from "../../services/wave-control-web/src/access-summary";

describe("wave-control web access summary", () => {
  const users = [
    {
      id: "pending-1",
      email: "pending@example.com",
      accessState: "pending",
      role: "member",
    },
    {
      id: "approved-1",
      email: "approved@example.com",
      accessState: "approved",
      role: "member",
    },
    {
      id: "approved-2",
      email: "super@example.com",
      accessState: "approved",
      role: "superuser",
    },
    {
      id: "pending-2",
      email: "pending-super@example.com",
      accessState: "pending",
      role: "superuser",
    },
    {
      id: "revoked-1",
      email: "revoked@example.com",
      accessState: "revoked",
      role: "member",
    },
  ];

  it("builds a superuser-friendly summary of access management state", () => {
    expect(
      buildAccessSummary(users, {
        "approved-1": [{ credentialId: "context7" }, { credentialId: "corridor" }],
        "approved-2": [{ credentialId: "corridor" }],
      }),
    ).toEqual({
      pendingRequests: 2,
      approvedUsers: 2,
      superusers: 1,
      usersWithCredentials: 2,
      credentialCount: 3,
    });
  });

  it("returns only users awaiting review", () => {
    expect(getPendingAccessUsers(users)).toEqual([
      {
        id: "pending-1",
        email: "pending@example.com",
        accessState: "pending",
        role: "member",
      },
      {
        id: "pending-2",
        email: "pending-super@example.com",
        accessState: "pending",
        role: "superuser",
      },
    ]);
  });
});
