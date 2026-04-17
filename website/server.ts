require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express    = require('express');
const session    = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const authRoutes   = require('./routes/auth');
const adminRoutes  = require('./routes/admin');
const apiRoutes    = require('./routes/api');
const requireAdmin = require('./middleware/requireAdmin');
const csrf         = require('./middleware/csrf');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:             ["'self'"],
      styleSrc:               ["'self'", "'unsafe-inline'"],
      scriptSrc:              ["'self'", "'unsafe-inline'"],
      imgSrc:                 ["'self'", 'https:', 'data:'],
      upgradeInsecureRequests: null,
    },
  },
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Views ─────────────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Sessions ──────────────────────────────────────────────────────────────────
app.use(session({
  store: new SQLiteStore({
    db:  'sessions.db',
    dir: path.join(__dirname, '..'),
  }),
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production', // HTTPS only in prod
    sameSite: 'lax',
    maxAge:   24 * 60 * 60 * 1000, // 24 hours
  },
}));

// ── CSRF (after session, before routes) ──────────────────────────────────────
app.use(csrf);

// ── Rate limiting on auth ─────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min window
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',  authLimiter, authRoutes);
app.use('/api',   apiRoutes);
app.use('/admin', requireAdmin, adminRoutes);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/', (req: any, res: any) => {
  res.redirect(req.session?.user ? '/admin' : '/auth/login');
});

// ── 404 ───────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((req: any, res: any) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

// ── 500 ───────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: any, req: any, res: any, next: any) => {
  console.error(err);
  res.status(500).render('error', { title: 'Server Error', message: 'Something went wrong.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Web server running at http://localhost:${PORT}`);
});
