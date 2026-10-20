Durg Mitra Android Studio Project
=================================

Open this folder (DurgMitra-AndroidStudio) in Android Studio and let Gradle sync.
The project uses Android Gradle Plugin 8.13.2, Gradle 8.13, and JDK 17. Install
Android SDK Platform 36 when prompted. Use Build > Build APK(s) to create an APK.

What is included
----------------
- app/: Android WebView wrapper, permissions, local web app assets and logo.
- backend/: existing Node.js and MySQL backend source, schema, and SMTP template.
- The web app's full HTML interface and interactions are bundled into the APK.

Android demo mode
-----------------
The default build loads the bundled app offline in Android WebView. The WebView
uses a secure asset origin and keeps demo data on that device. It supports the
existing app UI, local demo registration, route/fort/community screens, location
permission, file picker, and opening the SMS app for a user-reviewed SOS draft.
Demo mode does not send email OTPs, sync users to MySQL, or send SMS by itself.

Connect to the live backend
---------------------------
1. Deploy the included Node server and MySQL database to a reachable HTTPS host.
   Follow backend/README.txt and fill SMTP credentials only in the server's
   private .env file. Never put database or SMTP secrets in the Android app.
2. In app/build.gradle, change APP_START_URL to the deployed app URL, for example
   https://your-domain.example/. Keep it HTTPS.
3. Sync and rebuild the Android app. Since the page is then served by your host,
   its /api requests use the same origin and the MySQL authentication and email
   OTP flows can work. Do not use localhost as the phone's server address; on an
   Android device localhost refers to that device, not your computer.

The application is a WebView-based Android starting project. It is not a native
Kotlin screen rewrite. The included server must run separately from Android.
