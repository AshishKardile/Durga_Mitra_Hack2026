require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { rateLimit } = require('express-rate-limit');

const app = express();
const port = Number(process.env.PORT || 3000);
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) throw new Error('Set SESSION_SECRET before running in production.');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
const dbOptions = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'durg_mitra',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
};
const pool = mysql.createPool(dbOptions);
const sessionStore = new MySQLStore({ ...dbOptions, createDatabaseTable: true });
const smtpReady = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM);
const mailer = smtpReady ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
}) : null;
const otpHash = (userId, value) => crypto.createHmac('sha256', process.env.SESSION_SECRET || 'development-only-change-this-secret').update(`${userId}:${value}`).digest('hex');
const sameHash = (a, b) => {
  const aa = Buffer.from(String(a || ''), 'hex'); const bb = Buffer.from(String(b || ''), 'hex');
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
};

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(session({
  name: 'durgmitra.sid',
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
const recoveryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const cleanEmail = value => String(value || '').trim().toLowerCase();
const publicUser = row => ({ id: row.id, name: row.full_name, email: row.email, mobile: row.mobile, address: row.address || '', role: row.role });

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false, message: 'Database is unavailable.' }); }
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const members = req.body?.members;
  if (!Array.isArray(members) || members.length < 1 || members.length > 8) return res.status(400).json({ message: 'Register between 1 and 8 group members.' });
  const normalized = members.map(m => ({ ...m, email: cleanEmail(m.email) }));
  if (normalized.some(m => !m.name || !m.mobile || !m.email || !m.password || m.password.length < 8 || !m.country || !m.state || !m.district)) return res.status(400).json({ message: 'Complete each required field. Passwords must contain at least 8 characters.' });
  if (new Set(normalized.map(m => m.email)).size !== normalized.length) return res.status(400).json({ message: 'Each group member must use a different email.' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const groupId = require('crypto').randomUUID();
    for (const m of normalized) {
      const passwordHash = await bcrypt.hash(m.password, 12);
      await connection.execute(
        'INSERT INTO app_users (group_id, full_name, mobile, gender, email, password_hash, country, state, district, address, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [groupId, String(m.name).trim(), String(m.mobile).trim(), m.gender || null, m.email, passwordHash, m.country, m.state, m.district, m.address || null, m.email === cleanEmail(process.env.ADMIN_EMAIL) ? 'admin' : 'user']
      );
    }
    await connection.commit();
    res.status(201).json({ message: 'Account created. Log in with your email and password.', email: normalized[0].email });
  } catch (err) {
    if (connection) await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'That email is already registered. Use a different email or log in.' });
    console.error('Registration failed:', err.code || err.message);
    res.status(500).json({ message: 'Could not create the account. Check the database setup and try again.' });
  } finally { connection?.release(); }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const password = String(req.body?.password || '');
  try {
    const [rows] = await pool.execute('SELECT * FROM app_users WHERE email = ? LIMIT 1', [email]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) return res.status(401).json({ message: 'Email or password is incorrect.' });
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ message: 'Could not start a secure session.' });
      req.session.user = publicUser(rows[0]);
      req.session.save(saveErr => saveErr ? res.status(500).json({ message: 'Could not save the session.' }) : res.json({ user: req.session.user }));
    });
  } catch (err) {
    console.error('Login failed:', err.code || err.message);
    res.status(503).json({ message: 'Login service is unavailable. Check the MySQL connection.' });
  }
});

app.post('/api/auth/forgot-password', recoveryLimiter, async (req, res) => {
  if (!smtpReady) return res.status(503).json({ message: 'Password recovery email is not configured yet. Set SMTP values in .env.' });
  const email = cleanEmail(req.body?.email);
  const generic = 'If an account is registered with that email, a one-time code has been sent.';
  try {
    const [users] = await pool.execute('SELECT id, full_name, email FROM app_users WHERE email = ? LIMIT 1', [email]);
    if (!users.length) return res.json({ message: generic });
    const account = users[0];
    const [recent] = await pool.execute('SELECT COUNT(*) AS total FROM password_reset_otps WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)', [account.id]);
    if (Number(recent[0].total) >= 3) return res.json({ message: generic });
    const otp = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.execute('UPDATE password_reset_otps SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [account.id]);
    await pool.execute('INSERT INTO password_reset_otps (user_id, otp_hash, expires_at) VALUES (?, ?, ?)', [account.id, otpHash(account.id, otp), expiresAt]);
    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM,
        to: account.email,
        subject: 'Your Durg Mitra password reset code',
        text: `Hello ${account.full_name},\n\nYour Durg Mitra password reset code is ${otp}. It expires in 10 minutes. If you did not request this, you can ignore this email.\n\nDurg Mitra`,
        html: `<p>Hello ${String(account.full_name).replace(/[&<>"']/g, '')},</p><p>Your Durg Mitra password reset code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${otp}</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p><p>Durg Mitra</p>`
      });
    } catch (err) {
      await pool.execute('UPDATE password_reset_otps SET used_at = NOW() WHERE user_id = ? AND otp_hash = ?', [account.id, otpHash(account.id, otp)]);
      console.error('OTP email delivery failed:', err.code || err.message);
      return res.status(503).json({ message: 'Could not send the reset email. Check SMTP settings and try again.' });
    }
    res.json({ message: generic });
  } catch (err) {
    console.error('Password reset request failed:', err.code || err.message);
    res.status(503).json({ message: 'Password recovery is unavailable. Check MySQL setup.' });
  }
});

app.post('/api/auth/verify-reset-otp', recoveryLimiter, async (req, res) => {
  const email = cleanEmail(req.body?.email), otp = String(req.body?.otp || '').trim();
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ message: 'Enter the 6-digit code from your email.' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT r.* FROM password_reset_otps r JOIN app_users u ON u.id = r.user_id WHERE u.email = ? AND r.used_at IS NULL ORDER BY r.created_at DESC LIMIT 1 FOR UPDATE', [email]
    );
    const record = rows[0];
    if (!record || record.expires_at <= new Date() || record.attempt_count >= 5) {
      if (record) await connection.execute('UPDATE password_reset_otps SET attempt_count = 5 WHERE id = ?', [record.id]);
      await connection.commit();
      return res.status(400).json({ message: 'That code is invalid or expired. Request a new one.' });
    }
    const expected = otpHash(record.user_id, otp);
    if (!sameHash(record.otp_hash, expected)) {
      await connection.execute('UPDATE password_reset_otps SET attempt_count = attempt_count + 1 WHERE id = ?', [record.id]);
      await connection.commit();
      return res.status(400).json({ message: 'That code is invalid or expired. Request a new one.' });
    }
    const resetToken = crypto.randomBytes(32).toString('base64url');
    await connection.execute('UPDATE password_reset_otps SET verified_at = NOW(), reset_token_hash = ?, expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE id = ?', [otpHash(record.user_id, resetToken), record.id]);
    await connection.commit();
    res.json({ resetToken });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('OTP verification failed:', err.code || err.message);
    res.status(503).json({ message: 'Could not verify the code. Try again.' });
  } finally { connection?.release(); }
});

app.post('/api/auth/reset-password', recoveryLimiter, async (req, res) => {
  const email = cleanEmail(req.body?.email), token = String(req.body?.resetToken || ''), password = String(req.body?.password || '');
  if (password.length < 8) return res.status(400).json({ message: 'Password must contain at least 8 characters.' });
  if (token.length < 32) return res.status(400).json({ message: 'Verify your email code before changing the password.' });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT u.id AS user_id, r.id AS reset_id, r.reset_token_hash FROM app_users u JOIN password_reset_otps r ON r.user_id = u.id WHERE u.email = ? AND r.verified_at IS NOT NULL AND r.used_at IS NULL AND r.expires_at > NOW() ORDER BY r.created_at DESC LIMIT 1 FOR UPDATE', [email]);
    const record = rows[0];
    if (!record || !sameHash(record.reset_token_hash, otpHash(record.user_id, token))) {
      await connection.rollback();
      return res.status(400).json({ message: 'Password reset expired. Request and verify a new OTP.' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await connection.execute('UPDATE app_users SET password_hash = ? WHERE id = ?', [passwordHash, record.user_id]);
    await connection.execute('UPDATE password_reset_otps SET used_at = NOW(), reset_token_hash = NULL WHERE id = ?', [record.reset_id]);
    await connection.execute('UPDATE password_reset_otps SET used_at = NOW() WHERE user_id = ? AND id <> ? AND used_at IS NULL', [record.user_id, record.reset_id]);
    await connection.commit();
    res.json({ message: 'Password changed. Log in with your new password.' });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Password change failed:', err.code || err.message);
    res.status(503).json({ message: 'Could not change the password. Check the database and try again.' });
  } finally { connection?.release(); }
});

app.get('/api/auth/me', (req, res) => req.session.user ? res.json({ user: req.session.user }) : res.status(401).json({ message: 'Not signed in.' }));
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => { res.clearCookie('durgmitra.sid'); res.json({ ok: true }); }));

app.get('/api/admin/users', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ message: 'Administrator access required.' });
  try {
    const [rows] = await pool.query('SELECT id, group_id, full_name, mobile, gender, email, country, state, district, address, role, created_at FROM app_users ORDER BY created_at DESC');
    res.json({ users: rows });
  } catch { res.status(503).json({ message: 'Could not load accounts.' }); }
});

app.use(express.static(path.join(__dirname)));
app.listen(port, () => console.log(`Durg Mitra running at http://localhost:${port}`));
