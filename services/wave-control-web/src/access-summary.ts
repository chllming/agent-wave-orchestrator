type AccessUser = {
  accessState?: string | null;
  id?: string | null;
  role?: string | null;
};

export type AccessSummary = {
  pendingRequests: number;
  approvedUsers: number;
  superusers: number;
  usersWithCredentials: number;
  credentialCount: number;
};

export function getPendingAccessUsers<T extends AccessUser>(users: T[]): T[] {
  return users.filter((user) => String(user.accessState || "none") === "pending");
}

export function buildAccessSummary(
  users: AccessUser[],
  userCredentialItems: Record<string, any[]>,
): AccessSummary {
  const approvedUsers = users.filter((user) => String(user.accessState || "none") === "approved").length;
  const superusers = users.filter(
    (user) =>
      String(user.accessState || "none") === "approved" &&
      String(user.role || "member") === "superuser",
  ).length;
  const usersWithCredentials = Object.values(userCredentialItems).filter((entries) => entries.length > 0).length;
  const credentialCount = Object.values(userCredentialItems).reduce(
    (total, entries) => total + entries.length,
    0,
  );

  return {
    pendingRequests: getPendingAccessUsers(users).length,
    approvedUsers,
    superusers,
    usersWithCredentials,
    credentialCount,
  };
}
