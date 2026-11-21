# Mobile app (Android + iOS) - wraps the live site
1. Put your real domain in capacitor.config.json ("server.url").
2. `npm install && npx cap add android` (and `npx cap add ios` on a Mac).
3. `npx cap open android` -> Build > Generate Signed Bundle (Play Store). iOS needs Xcode on macOS + Apple Developer account.
