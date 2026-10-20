Durg Mitra
==========

Quick local preview
-------------------
Open index.html in a browser for the local prototype. Its demo accounts are
stored in that browser only; this mode does not write to MySQL.

Run with MySQL
--------------
1. In MySQL Workbench, open and execute schema.sql. This creates the
   durg_mitra database, app_users table and password_reset_otps table.
2. Install Node.js, copy .env.example to .env, and enter your MySQL connection
   values, a long random SESSION_SECRET, and working SMTP credentials. Keep
   .env private. SMTP is required to send password reset codes.
3. In this folder, run: npm install
4. Run: npm start
5. Open http://localhost:3000. Register and log in here to save profiles in
   MySQL. A normal static hosting service cannot connect directly to MySQL;
   deploy the Node server and MySQL database for a hosted production app.

Administrator access
--------------------
Set ADMIN_EMAIL in .env before registering that email. For an existing account,
set its role to admin in MySQL Workbench, for example:
  UPDATE app_users SET role='admin' WHERE email='you@example.com';
The signed-in administrator account can read the account directory from
/api/admin/users. Password hashes are excluded from that API response.

Password handling
-----------------
Passwords are bcrypt-hashed by the server and the database has a password_hash
column, never a readable password column. Passwords cannot be recovered or
shown to an administrator. The login screen saves only the last-used email;
the password field is masked and passwords are not saved in local storage.
Forgot password sends a one-time code to the registered email. The code expires
after 10 minutes and is limited to 5 verification attempts. The user must verify
the code before the new password and confirmation fields appear. Configure a
real SMTP provider in .env for email delivery. Direct index.html preview cannot
send email; it shows a clearly labelled demo-only code and changes only the
browser's local demo account.

Gad Rakshak Guide
-----------------
The chat panel answers from the app's starter fort and safety information. It
is not connected to a live AI model or live weather/access feeds, and no AI can
guarantee every answer is 100% correct. Verify current conditions with official
local sources and use emergency services for urgent situations.

Files
-----
- index.html: application UI and interactions
- durg-mitra-logo.png: logo and background art
- server.js: Node/Express API and MySQL-backed authentication
- schema.sql: MySQL database and account table setup
- .env.example: backend configuration template
