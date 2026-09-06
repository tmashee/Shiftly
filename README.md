# Shiftly

Shiftly is a static shift calendar for Intel/Pfizer/Crèche patterns, day edits, notes, hospital appointments, exports, and shared Firebase sync.

## Use

- Open a date to edit shifts or add a note.
- Swipe or use the arrows to change month.
- Use Settings to edit names, patterns, anchors, and working days.
- Use Help in the header for the short in-app guide.
- Hospital appointments can be exported/imported as `.ics` files.

## Firebase setup

1. Create a Firebase Web app and copy its config into `app.js`.
2. Enable **Authentication → Anonymous** and **Google**.
3. Create a Firestore database.
4. Publish `firestore.rules`.
5. Add the GitHub Pages domain under **Authentication → Settings → Authorized domains**.

Anonymous users can view the shared calendar. Google-authenticated users can save changes. The shared document is `shared/schedule`, and updates appear through Firestore realtime listeners.

## Deploy

Serve the files from GitHub Pages or another HTTPS static host. Do not open `index.html` with `file://`; Firebase modules, authentication popups, and the service worker require a hosted origin.
