# Turning on sync between phones

The app syncs through a free Google Firebase project. It takes about 5 minutes to set up.

## 1. Create the project
1. Go to <https://console.firebase.google.com> → **Create a project** → name it `budget`. Google Analytics can be off.
2. On the project home page, click the **Web `</>`** icon → nickname `budget` → **Register app**.
3. Copy the `firebaseConfig = { ... }` block. It goes into `firebase-config.js` (see step 5).

## 2. Sign-in accounts
1. **Build → Authentication → Get started → Email/Password → Enable → Save.**
2. **Authentication → Users → Add user**: add one account for each of you, with a password each.
3. **Authentication → Settings → User actions**: untick **Enable create (sign-up)** → **Save**, so nobody else can make an account.

## 3. Database
1. **Build → Firestore Database → Create database** → choose the location nearest you → **Start in production mode**.
2. Open the **Rules** tab, paste in the contents of [`firestore.rules`](firestore.rules) with your two emails filled in, and click **Publish**.

## 4. Using it
- Open the app and tap **Sign in** (the banner on Overview, or the cloud icon at the top left).
- Sign in first on the phone that already has your budget. Its data becomes the shared budget.
- On the other phone, sign in with the other account. If that phone has its own entries, it asks whether to add them.
- The cloud icon shows the state: **green check** means synced, **amber** means saving, **grey** means offline (changes sync later), and **red** means not signed in.

## 5. The config file
`firebase-config.js` holds the values from step 1.3:

```js
window.FIREBASE_CONFIG = { apiKey: "...", authDomain: "...", projectId: "...", appId: "..." };
```

These values are not secret. Access is protected by the sign-in accounts and the Firestore rules.

## Forgot a password?
Tap **Forgot password?** on the sign-in screen, or reset it in **Authentication → Users**.
