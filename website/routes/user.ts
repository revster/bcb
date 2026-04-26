import type { Request, Response } from 'express';
import { eq, or } from 'drizzle-orm';
import { computeUserStats } from '../lib/userStats';
import db = require('../../db');
import { users, memberChannels } from '../../schema';

const express      = require('express');
const router       = express.Router();
const requireLogin = require('../middleware/requireLogin');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionReq = Request & { session: any };

router.get('/me', requireLogin, async (req: SessionReq, res: Response) => {
  const user  = req.session.user;
  const stats = await computeUserStats(user.id);

  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) >> 22n) % 6}.png`;

  res.render('user/stats', {
    title:       'My Stats',
    appName:     "Hermione's Army",
    stats,
    avatarUrl,
    displayName: user.globalName || user.username,
    isOwnProfile: true,
  });
});

router.get('/u/:userId', requireLogin, async (req: Request, res: Response) => {
  const userId = req.params['userId'] as string;

  // Resolve display name from DB (User table wins over MemberChannel)
  const userRow   = db.select({ username: users.username }).from(users).where(eq(users.userId, userId)).get();
  const memberRow = db.select({ username: memberChannels.username }).from(memberChannels).where(eq(memberChannels.userId, userId)).get();
  const displayName = userRow?.username ?? memberRow?.username ?? null;

  if (!displayName) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Member not found.' });
  }

  const stats     = await computeUserStats(userId);
  const avatarUrl = `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`;

  res.render('user/stats', {
    title:        `${displayName}'s Stats`,
    appName:      "Hermione's Army",
    stats,
    avatarUrl,
    displayName,
    isOwnProfile: false,
  });
});

module.exports = router;
