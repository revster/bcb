/**
 * seed.ts — populate initial data
 *
 * Run once after `npx drizzle-kit push` on a fresh database:
 *   npx tsx seed.ts
 *
 * Safe to re-run: skips seeding if the quips table already has rows.
 */

import db = require('./db');
import { reminderQuips } from './schema';
import { count } from 'drizzle-orm';

const QUIPS = [
  "Those pages won't read themselves. Probably.",
  'The book has been waiting patiently. It\'s starting to feel neglected.',
  'A week has passed. The characters are still mid-sentence, waiting for you.',
  "Your bookmark hasn't moved. Are you and it okay?",
  "Books don't read themselves. We checked.",
  'Just a friendly reminder that the ending exists and it\'s waiting for you.',
  'Your reading thread is looking a little lonely this week.',
  'The plot thickens. You\'d know this if you\'d opened the book.',
  'Progress: 0%. Guilt: rising.',
  'The story is still there. Patiently. Quietly. Judging.',
  'Wow, another week of incredible progress. Truly inspiring.',
  "At this rate you'll finish sometime before the next ice age. Maybe.",
  "I see you've been very busy. Reading, presumably. Oh wait.",
  "Bold strategy, not reading. Let's see if it pays off.",
  'Your bookmark has filed a missing persons report.',
  'Historians will marvel at your reading pace.',
  'Incredible dedication to not opening the book this week.',
  "A whole seven days! You're really committing to this.",
  'I admire your consistency. Consistently not reading, but still.',
  "The book club meets whether you've read the book or not. Just saying.",
  'Even one page is one more than yesterday!',
  "You've read this far — the finish line exists, I promise.",
  'Ten minutes tonight. That\'s all. You can do ten minutes.',
  'The best time to read was last week. The second best time is now.',
  'You picked this book for a reason. Remember that reason?',
  'Future you, having finished the book, will thank present you.',
  'Chapter one is always the hardest to return to. Push through!',
  "Think of how smug you'll feel when you're done.",
  "The couch, a blanket, and this book. That's all you need tonight.",
  "You're so close to finding out what happens. Don't you want to know?",
  "Somewhere, a fictional character is waiting for you to find out their fate.",
  'The author spent years writing this. YEARS.',
  "In another timeline, you've already finished. Be that person.",
  'Every unread page is a small tragedy.',
  "The book sighs. You don't hear it. But it sighs.",
  'Literature weeps.',
  'Somewhere a librarian just felt a disturbance in the force.',
  'The unread chapters grow restless.',
  'This is not a drill. The book club meeting approaches.',
  'Time is a flat circle and you are still on the same page.',
  "You've been online. The bot has noticed.",
  'Discord activity detected. Book activity: none.',
  'You had time to check your messages. Just saying.',
  'I\'ve seen you react to memes this week. The book deserves a reaction too.',
  'Online status: active. Reading status: concerning.',
  'You were here. The book was here. What happened?',
  "The bot doesn't sleep. It just watches your reading progress not change.",
  'Notification settings: on. Reading settings: apparently off.',
  'Your last /progress update was a week ago. The bot remembers everything.',
  "You muted the book club channel didn't you. Didn't you.",
  'To read or not to read. That is the question. The answer is to read.',
  'A book unread is a conversation never had.',
  'What is time, really, if not pages unread.',
  'In the grand tapestry of life, this week was a dropped stitch.',
  'The unexamined book is not worth owning.',
  "If a book sits unread and nobody logs progress, did the week even happen?",
  'We are all just bookmarks in the great novel of existence. Move forward.',
  'Somewhere between intention and action lies your unread chapter.',
  'The journey of a thousand pages begins with a single page. You know this.',
  'This too shall pass. The book, however, will remain unread unless you act.',
];

const existing = (db.select({ c: count() }).from(reminderQuips).get() as { c: number }).c;

if (existing > 0) {
  console.log(`Skipping quips seed — table already has ${existing} row(s).`);
} else {
  db.insert(reminderQuips)
    .values(QUIPS.map(text => ({ text })))
    .run();
  console.log(`Seeded ${QUIPS.length} quips.`);
}
