# Shiftly

Shiftly is a mobile-friendly shift calendar for repeating work patterns and shared household schedules. It combines calculated day, night, off, and crèche shifts with date-specific edits, notes, and Firebase realtime sync.

It is a static web app: there is no build step or application server. The calendar runs in the browser and can be deployed to GitHub Pages or any other HTTPS static host.

## Features

- Configure separate calendars and repeating patterns for Intel, Pfizer, and crèche schedules.
- Set pattern anchors and calendar-specific names from **Settings**.
- Edit an individual date without changing the underlying repeating pattern.
- Add annual leave, hospital appointments, overtime, or free-form notes to a date.
- Navigate by month, jump to today, or swipe across the calendar on touch devices.
- Show or hide each configured calendar and switch between dark and light themes.
- Export hospital appointments to `.ics` for Apple Calendar, Google Calendar, or another compatible calendar app.
- Export the displayed year as a PNG image or print-ready PDF.
- Install the app as a standalone progressive web app on supported browsers.
- View shared data anonymously and sign in with Google to save changes.

## Run locally

Because the app uses ES modules, Firebase authentication, and a service worker, serve it from an HTTP(S) origin. Do not open `index.html` directly with `file://`.

For example, with Python installed:

```sh
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Firebase setup

The Firebase web configuration is defined near the top of [`app.js`](app.js). For a separate Firebase project:

1. Create a Firebase project and register a Web app.
2. Replace the `firebaseConfig` object in `app.js` with the configuration for that app.
3. Enable **Authentication > Sign-in method > Anonymous**.
4. Enable **Authentication > Sign-in method > Google**.
5. Create a Firestore database.
6. Publish [`firestore.rules`](firestore.rules).
7. Add the local and production hostnames under **Authentication > Settings > Authorized domains**.

The app uses one shared Firestore document:

```text
shared/schedule
```

The document contains schedule settings, date overrides, notes, and sync metadata. Firestore listeners make updates from another signed-in device appear automatically.

### Access model

- Anonymous authentication is used to read the shared calendar and establish a device identity.
- Google authentication is required to write schedule changes to Firestore.
- The rules in `firestore.rules` allow authenticated reads and restrict writes to the Google provider.

The Firebase web configuration is necessarily visible to browsers. Protect the project with Firebase Authentication and Firestore Security Rules; do not put server credentials or service-account keys in this repository.

## Data and offline behavior

Schedule settings, date overrides, notes, calendar visibility, and theme preference are also stored in the browser's `localStorage`. This allows the UI to load immediately and preserves device preferences between visits.

Cloud sync requires a working Firebase connection. If a user is anonymous, changes remain local until they sign in with Google and can be saved to the shared document.

## Deploy

Deploy the repository contents as static files. GitHub Pages is supported, and the app can also be hosted by Netlify, Cloudflare Pages, an object-storage website host, or another HTTPS static host.

After deployment:

1. Add the deployed hostname to Firebase Authentication's authorized domains.
2. Open the deployed URL and verify that anonymous sign-in, Google sign-in, Firestore sync, and calendar exports work.
3. Keep `firestore.rules` deployed whenever the rules change.

The service worker caches the app shell for repeat visits. Update the cache name in [`sw.js`](sw.js) when a release needs to invalidate an older cached asset set.
