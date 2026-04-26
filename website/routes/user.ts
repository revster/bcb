import type { Request, Response } from 'express';
import { computeUserStats } from '../lib/userStats';

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
    title:     'My Stats',
    appName:   'BCB',
    stats,
    avatarUrl,
  });
});

module.exports = router;
