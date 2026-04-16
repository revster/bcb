/**
 * scripts/seed-quips.js
 *
 * Seeds the ReminderQuip table with the default quip list.
 * Idempotent — skips if quips already exist.
 *
 * Usage: node scripts/seed-quips.js
 */

require('dotenv').config();
const db = require('../db');

const QUIPS = [
  // Hermione-style homework-planner vibes
  "I hope you're aware that reading won't do itself. The book is just sitting there, waiting.",
  "Contrary to popular belief, 'meaning to read it' does not count as progress.",
  "A bookmark left unmoved is a cry for help. Consider this your intervention.",
  "You've been 'about to start that chapter' for a suspicious number of days.",
  "The book hasn't moved. Neither has your progress. Coincidence? I think not.",
  "Just a gentle reminder that 'I'll read it tomorrow' has been said before. Many times.",
  "Your reading log called. It said it misses you.",
  "Fun fact: books progress faster when they're opened.",
  "There are 24 hours in a day. Surely one of them can belong to the book.",
  "I'm not saying you're behind. I'm just saying the book has feelings too.",

  // Slightly passive-aggressive
  "The others are reading. I'm not saying anything. Just noting it.",
  "At this rate, we'll be discussing spoilers before you've hit chapter two.",
  "No progress in a week. Truly a bold literary strategy.",
  "I've cross-referenced your schedule and found several unclaimed reading windows.",
  "The plot thickens — but only for people who are actually reading it.",
  "Some members have already finished. No pressure. (There is pressure.)",
  "Your future self, who has to discuss this book, is begging you to read.",
  "Technically the month isn't over. Technically.",
  "This is not a guilt trip. This is a narrative opportunity. Open the book.",
  "I believe in you. The book believes in you. Your excuses do not.",

  // Book-specific encouragement
  "One chapter. That's it. Just one. You can do this.",
  "Reading five pages a day gets it done. That's less than a long coffee break.",
  "The good news: the book is not getting longer. The month, however, is getting shorter.",
  "You picked this book (or voted for it). It deserves your attention.",
  "Think of how good it'll feel to say you finished. That feeling requires finishing.",
  "The story is mid-climax and you're not there. That's the real tragedy.",
  "Progress doesn't have to mean a marathon session. Even a chapter counts.",
  "Ten minutes before bed. Ten pages. You'd be surprised what that adds up to.",
  "It's not a race, but also: the discussion thread opens soon.",
  "The epilogue channel is waiting for you. Don't be the last one there.",

  // Harry Potter / magical flavour
  "Even Ron managed to finish his homework eventually. Sometimes.",
  "Hermione would have read it twice by now and written three essays.",
  "In the words of the great Albus Dumbledore: 'Words are our most inexhaustible source of magic.' The book has words. Just saying.",
  "You'd think a magical reading tracker would be more motivating. Apparently not.",
  "This reminder has been dispatched via enchanted planner. Please respond by reading.",
  "The book is not a Horcrux. You do not need to destroy it. You just need to read it.",
  "Consider this your Howler. Minus the screaming. Please read.",
  "Even Neville kept up with his herbology reading. Neville.",
  "The sorting hat sorted you into this book club. Act like it.",
  "Reading: less dangerous than Defence Against the Dark Arts, more rewarding than Divination.",

  // Meta / self-aware
  "Yes, this is an automated message. That doesn't make it less true.",
  "The bot has been watching your progress bar. It is sad.",
  "I was programmed to be encouraging. But also honest. Please read.",
  "Your reading thread is lonely. It was created just for you.",
  "This is reminder number one. There will be more if required.",
  "The algorithm has flagged your account as 'suspiciously unread.'",
  "No judgment. Just a friendly nudge from your book club bot.",
  "I don't know what you've been doing this week, but I know it wasn't reading.",
  "You're one of the most capable readers in this club. Act like it.",
  "This message self-destructs in seven days. Then a new one arrives.",

  // Wholesome closers
  "You've got this. Seriously. Just open the book.",
  "The best time to start reading was seven days ago. The second best time is now.",
  "Books don't read themselves, but you'd be surprised how fast they go once you start.",
  "We're rooting for you. All of us. Even the bot.",
  "See you in the epilogue thread — when you get there.",
];

async function main() {
  const existing = await db.reminderQuip.count();
  if (existing > 0) {
    console.log(`Skipping seed — ${existing} quip(s) already in database.`);
    return;
  }

  await db.reminderQuip.createMany({
    data: QUIPS.map(text => ({ text })),
  });

  console.log(`Seeded ${QUIPS.length} quips.`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => db.$disconnect());
