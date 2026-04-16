/**
 * lib/resolveUsernames.ts
 *
 * Builds a userId → username map for a list of user IDs.
 * Checks both the User table (most recent username, updated on every interaction)
 * and MemberChannel (username at registration time). User table wins on conflict.
 */

import db = require('../db');

export async function resolveUsernames(userIds: string[]): Promise<Record<string, string>> {
  if (!userIds.length) return {};
  const [users, members] = await Promise.all([
    db.user.findMany({ where: { userId: { in: userIds } } }),
    db.memberChannel.findMany({ where: { userId: { in: userIds } } }),
  ]);
  const map: Record<string, string> = {};
  for (const m of members) map[m.userId] = m.username;
  for (const u of users)   map[u.userId] = u.username; // User table wins (more recent)
  return map;
}
