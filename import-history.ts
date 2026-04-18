/**
 * import-history.ts — One-off script to import historical BOTM reading data.
 *
 * For each book:
 *   1. Scrapes Goodreads metadata
 *   2. Upserts the Book record
 *   3. Inserts a ClubBook record (month, year)
 *   4. Inserts finished ReadingLog entries for each member who completed it
 *
 * Idempotent: synthetic threadIds (hist-{userId}-{bookId}) prevent duplicate
 * inserts via the unique constraint on ReadingLog.threadId.
 *
 * Run with: npx tsx import-history.ts
 * Nov 2024 (double BOTM month) is excluded — import that manually.
 */

require('dotenv').config();

import db = require('./db');
import scrapeBook from './lib/scrapeBook';
import { books, clubBooks, readingLogs } from './schema';

const M = {
  dawnphoenix: '226685265454956554',
  rreyv:       '186925031635288064',
  tipsy:       '332537475824091136',
  epg:         '414804228444389376',
  aurora:      '471726012888121344',
  birdy:       '106275014055063552',
  memesh:      '469788628655013898',
  abgt:        '517767435525423117',
};

interface Entry {
  url:       string;
  month:     number;
  year:      number;
  finishers: string[];
}

const HISTORY: Entry[] = [
  // ── 2023 (Jan skipped) ────────────────────────────────────────────────────
  { url: 'https://www.goodreads.com/book/show/61065355-the-boys-from-biloxi',              month: 2,  year: 2023, finishers: [M.dawnphoenix, M.rreyv, M.epg] },
  { url: 'https://www.goodreads.com/book/show/58733693-remarkably-bright-creatures',        month: 3,  year: 2023, finishers: [M.dawnphoenix, M.epg] },
  { url: 'https://www.goodreads.com/book/show/60194162-demon-copperhead',                   month: 4,  year: 2023, finishers: [M.dawnphoenix, M.rreyv] },
  { url: 'https://www.goodreads.com/book/show/29579.Foundation',                            month: 5,  year: 2023, finishers: [M.dawnphoenix, M.rreyv, M.epg, M.birdy] },
  { url: 'https://www.goodreads.com/book/show/31933085-less',                               month: 6,  year: 2023, finishers: [M.dawnphoenix, M.rreyv, M.tipsy] },
  { url: 'https://www.goodreads.com/book/show/60531416-yumi-and-the-nightmare-painter',     month: 7,  year: 2023, finishers: [M.dawnphoenix, M.rreyv, M.tipsy, M.epg, M.birdy] },
  { url: 'https://www.goodreads.com/book/show/64222.Going_Postal',                          month: 8,  year: 2023, finishers: [M.dawnphoenix, M.epg, M.birdy] },
  { url: 'https://www.goodreads.com/book/show/8198781-chinaman',                            month: 9,  year: 2023, finishers: [M.dawnphoenix] },
  { url: 'https://www.goodreads.com/book/show/58957615-the-bullet-that-missed',             month: 10, year: 2023, finishers: [M.dawnphoenix, M.rreyv, M.birdy] },
  { url: 'https://www.goodreads.com/book/show/61683285-homecoming',                         month: 11, year: 2023, finishers: [M.dawnphoenix, M.memesh] },
  { url: 'https://www.goodreads.com/book/show/294442.Journey_to_the_River_Sea',             month: 12, year: 2023, finishers: [M.dawnphoenix, M.memesh, M.birdy] },

  // ── 2024 (Nov skipped — double BOTM, import manually) ────────────────────
  { url: 'https://www.goodreads.com/book/show/52843028-the-mysterious-affair-at-styles',   month: 1,  year: 2024, finishers: [M.dawnphoenix, M.tipsy, M.birdy, M.memesh] },
  { url: 'https://www.goodreads.com/book/show/37794149-a-memory-called-empire',            month: 2,  year: 2024, finishers: [M.dawnphoenix] },
  { url: 'https://www.goodreads.com/book/show/9777.The_God_of_Small_Things',               month: 3,  year: 2024, finishers: [M.dawnphoenix] },
  { url: 'https://www.goodreads.com/book/show/34507.Equal_Rites',                          month: 4,  year: 2024, finishers: [M.dawnphoenix, M.rreyv, M.tipsy, M.birdy] },
  { url: 'https://www.goodreads.com/book/show/32721821-letters-from-the-lighthouse',       month: 5,  year: 2024, finishers: [M.dawnphoenix, M.tipsy, M.memesh] },
  { url: 'https://www.goodreads.com/book/show/34497.The_Color_of_Magic',                   month: 6,  year: 2024, finishers: [M.dawnphoenix, M.tipsy, M.birdy, M.memesh] },
  { url: 'https://www.goodreads.com/book/show/1934.Little_Women',                          month: 7,  year: 2024, finishers: [M.dawnphoenix, M.rreyv, M.tipsy] },
  { url: 'https://www.goodreads.com/book/show/181350367-how-to-solve-your-own-murder',     month: 8,  year: 2024, finishers: [M.dawnphoenix, M.rreyv, M.memesh] },
  { url: 'https://www.goodreads.com/book/show/32109569-we-are-legion-we-are-bob',          month: 9,  year: 2024, finishers: [M.dawnphoenix, M.rreyv, M.birdy, M.memesh] },
  { url: 'https://www.goodreads.com/book/show/62226126-the-last-devil-to-die',             month: 10, year: 2024, finishers: [M.dawnphoenix, M.birdy] },
  { url: 'https://www.goodreads.com/book/show/203956647-we-solve-murders',                 month: 12, year: 2024, finishers: [M.dawnphoenix, M.tipsy, M.birdy, M.memesh] },

  // ── 2025 ──────────────────────────────────────────────────────────────────
  { url: 'https://www.goodreads.com/book/show/34506.The_Light_Fantastic',                  month: 1,  year: 2025, finishers: [M.dawnphoenix, M.rreyv, M.tipsy, M.epg, M.birdy, M.memesh, M.abgt] },
  { url: 'https://www.goodreads.com/book/show/2490869.Jeeves_Takes_Charge',                month: 2,  year: 2025, finishers: [M.dawnphoenix, M.epg, M.aurora, M.birdy, M.memesh, M.abgt] },
  { url: 'https://www.goodreads.com/book/show/294047.Amazonia',                            month: 3,  year: 2025, finishers: [M.dawnphoenix, M.rreyv, M.epg, M.memesh, M.abgt] },
  { url: 'https://www.goodreads.com/book/show/276767.The_Word_for_World_Is_Forest',        month: 4,  year: 2025, finishers: [M.dawnphoenix, M.epg, M.aurora, M.birdy, M.memesh] },
  { url: 'https://www.goodreads.com/book/show/25489625-between-the-world-and-me',          month: 5,  year: 2025, finishers: [M.dawnphoenix, M.epg, M.birdy, M.memesh] },
  { url: 'https://www.goodreads.com/book/show/34499.Sourcery',                             month: 6,  year: 2025, finishers: [M.dawnphoenix, M.birdy, M.memesh] },
  { url: 'https://www.goodreads.com/book/show/51132354-the-murder-on-the-links',           month: 7,  year: 2025, finishers: [M.dawnphoenix, M.rreyv, M.birdy, M.memesh] },
  { url: 'https://www.goodreads.com/book/show/56253393-murder-at-the-mushaira',            month: 8,  year: 2025, finishers: [M.dawnphoenix, M.memesh] },
  { url: 'https://www.goodreads.com/book/show/18070753-murder-most-unladylike',            month: 9,  year: 2025, finishers: [M.dawnphoenix, M.rreyv] },
  { url: 'https://www.goodreads.com/book/show/222292420-the-impossible-fortune',           month: 10, year: 2025, finishers: [M.dawnphoenix, M.tipsy, M.birdy, M.memesh] },
  { url: 'https://www.goodreads.com/book/show/13601144-em-and-the-big-hoom',               month: 11, year: 2025, finishers: [M.dawnphoenix, M.memesh] },
  { url: 'https://www.goodreads.com/book/show/53000876-contact',                           month: 12, year: 2025, finishers: [M.dawnphoenix, M.birdy] },
];

function lastDayOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0, 23, 59, 59));
}

function firstDayOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Normalize /en/book/show/ → /book/show/ for consistent storage
function normalizeUrl(url: string): string {
  return url.replace('goodreads.com/en/book/show/', 'goodreads.com/book/show/');
}

async function main() {
  let inserted = 0;
  let skipped  = 0;
  let errors   = 0;

  for (const entry of HISTORY) {
    const normalizedUrl = normalizeUrl(entry.url);
    const label = `[${entry.year}-${String(entry.month).padStart(2, '0')}]`;

    // ── Scrape ──────────────────────────────────────────────────────────────
    let scraped: Awaited<ReturnType<typeof scrapeBook>>;
    try {
      console.log(`${label} Scraping ${normalizedUrl}...`);
      scraped = await scrapeBook(normalizedUrl);
      await sleep(1500); // be polite to Goodreads
    } catch (err) {
      console.error(`${label} Scrape failed: ${(err as Error).message}`);
      errors++;
      continue;
    }

    const { title, author, rating, pages, image, genres } = scraped;

    // ── Upsert book ─────────────────────────────────────────────────────────
    const book = db.insert(books)
      .values({ title, author, rating, pages, image, genres: JSON.stringify(genres), goodreadsUrl: normalizedUrl })
      .onConflictDoUpdate({
        target: books.goodreadsUrl,
        set: { title, author, rating, pages, image, genres: JSON.stringify(genres) },
      })
      .returning()
      .get()!;

    console.log(`${label} Book: "${title}" (id=${book.id})`);

    // ── Upsert club book ─────────────────────────────────────────────────────
    db.insert(clubBooks)
      .values({ bookId: book.id, month: entry.month, year: entry.year })
      .onConflictDoUpdate({
        target: clubBooks.bookId,
        set: { month: entry.month, year: entry.year },
      })
      .run();

    // ── Insert reading logs ──────────────────────────────────────────────────
    const startedAt  = firstDayOfMonth(entry.year, entry.month);
    const finishedAt = lastDayOfMonth(entry.year, entry.month);

    for (const userId of entry.finishers) {
      const threadId = `hist-${userId}-${book.id}`;

      try {
        db.insert(readingLogs)
          .values({
            userId,
            bookId:    book.id,
            threadId,
            status:    'finished',
            progress:  100,
            startedAt,
            finishedAt,
          })
          .run();
        inserted++;
      } catch (err: any) {
        // UNIQUE constraint on threadId means this log already exists — skip
        if (err?.message?.includes('UNIQUE constraint failed')) {
          skipped++;
        } else {
          console.error(`${label} Log insert failed for userId=${userId}: ${err.message}`);
          errors++;
        }
      }
    }

    console.log(`${label} Done — ${entry.finishers.length} logs`);
  }

  console.log(`\nImport complete: ${inserted} inserted, ${skipped} skipped (already existed), ${errors} errors`);
}

main().catch(console.error);
