/**
 * lib/resolveUsernames.ts
 *
 * Builds a userId → username map for a list of user IDs.
 * Checks both the User table (most recent username, updated on every interaction)
 * and MemberChannel (username at registration time). User table wins on conflict.
 */

import { inArray } from 'drizzle-orm';
import db = require('../db');
import { users, memberChannels } from '../schema';

export async function resolveUsernames(userIds: string[]): Promise<Record<string, string>> {
  if (!userIds.length) return {};
  const [userRows, memberRows] = [
    db.select({ userId: users.userId, username: users.username }).from(users).where(inArray(users.userId, userIds)).all(),
    db.select({ userId: memberChannels.userId, username: memberChannels.username }).from(memberChannels).where(inArray(memberChannels.userId, userIds)).all(),
  ];
  const map: Record<string, string> = {};
  for (const m of memberRows) map[m.userId] = m.username;
  for (const u of userRows)   map[u.userId] = u.username; // User table wins (more recent)
  return map;
}
