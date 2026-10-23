# Wheel of Fortune

A frontend-only testing prototype built with React, strict TypeScript, Vite, SVG and react-i18next. Visitors confirm an Instagram visit, spin a weighted wheel, wait 60 minutes after a loss, or submit an email to save a prize claim on their device. French and English are included. There is no backend, remote database, authentication, email delivery or administration UI.

**Winner records are stored only in each visitor’s browser. They are not centrally collected. The operator cannot retrieve claims from other visitors’ browsers or from another device/profile.** A public deployment does not change this limitation.

## Requirements and local development

Use Node.js **24.x** and npm. The lockfile fixes dependency versions.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Use a portrait viewport no wider than 768 CSS pixels. Wider windows show a desktop restriction; landscape windows within that width show a rotation message. Square windows are accepted. No environment variables or credentials are required.

## Architecture

| Location | Responsibility |
| --- | --- |
| `src/components/`, `src/App.tsx` | Screens, accessible native dialogs, SVG wheel and viewport restrictions |
| `src/game/` | Pure selection, geometry and transitions; animation and browser participation coordination |
| `src/config/` | Bundled JSON and shared build/startup validation |
| `src/claims/` | Email/record validation, native IndexedDB, reconciliation and CSV export |
| `src/i18n/` | Typed French/English resources and language preference |
| `public/assets/`, `public/privacy/` | Local artwork and bilingual draft privacy pages |
| `tests/`, `src/**/*.test.ts` | Playwright journeys/visuals and Vitest logic/storage tests |

The game uses `/` and in-memory screen/dialog state; there is no client-side URL router. Privacy pages are real static files at `/privacy/fr.html` and `/privacy/en.html`. Assets use root-relative paths; serve the build at the domain root. There are no server entry points or Vercel Functions.

## Validation and production build

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

`npm run build` checks TypeScript, validates the bundled configuration through Vite's config import, and writes the static site to **`dist/`**, including `claims-export.js`. Preview serves that build locally; it is not a production server requirement.

Playwright requires Google Chrome (`channel: 'chrome'`). If absent, install it with `npx playwright install chrome` or the system package manager. Run the complete suites with port 4173 free:

```sh
npm run test:e2e -- --workers=1
PLAYWRIGHT_DEV_SERVER=1 npm run test:e2e -- --workers=1
```

The default browser suite builds and starts production preview; development mode includes React Strict Mode and three source-controller continuity checks skipped in production. Tests control time/randomness, use isolated storage and compare 32 pixel baselines in `docs/stage-7/screenshots/`. Do not update those baselines merely to silence a failure. `npm run test:watch` starts interactive Vitest.

Repeat the concurrency checks when changing storage or coordination:

```sh
npm run test:e2e -- --workers=1 tests/audit.spec.ts tests/claims.spec.ts \
  --grep 'simultaneous ready tabs|committed claim without Web Locks' --repeat-each=10
PLAYWRIGHT_DEV_SERVER=1 npm run test:e2e -- --workers=1 tests/participation.spec.ts \
  --grep 'simultaneous attempts in two ready' --repeat-each=10
```

## Game configuration and probabilities

Edit **`src/config/game.json`**, then validate, build and test again. Invalid configuration fails the build. It requires 2–12 uniquely identified segments, both prize/loss kinds, nonempty `fr`/`en` labels, numeric probabilities in `[0, 1]`, and a total within `1e-9` of one. Unknown fields are rejected. Visible wedges have equal angles regardless of their probability; a zero-weight wedge remains visible but cannot win.

| Segment | Probability |
| --- | ---: |
| `loss-1` | 25% |
| `dessert` | 10% |
| `loss-2` | 20% |
| `coffee` | 8% |
| `loss-3` | 15% |
| `fries` | 7% |
| `loss-4` | 10% |
| `discount` | 5% |

These are demonstration prizes and probabilities. Selection uses exact decimal comparisons normalized to the accepted total. Intervals are half-open: a cumulative boundary belongs to the following nonempty interval, including 0.85 → `loss-4` and 0.95 → `discount`. Preserve the [accepted Stage 4 boundary rules](docs/stage-4-acceptance/README.md).

Other settings: `defaultLanguage` (`fr` or `en`), `maxViewportWidth` (1–768), `cooldownMinutes` (1–10080, currently 60), and `spin` duration (1–60000ms), full turns (1–100), reveal delay (0–10000ms). Current motion is six clockwise turns over 16 seconds plus a two-second reveal delay; reduced motion skips rotation. No sound or vibration is used.

Instagram is deliberately hardcoded as **https://instagram.com/cfoco.france**, in `INSTAGRAM_URL` in `src/game/participation.ts`. There is no environment-variable or JSON override. Any deliberate profile change requires a source change and corresponding tests. Opening the profile only enables a self-reported confirmation; this app cannot verify a follow.

Interface translations are in `src/i18n/fr.json` and `en.json`; prize labels are in the game JSON. Keep keys and interpolation parameters aligned. The default is French; the selector persists language without resetting participation. Artwork provenance and reference approximations are documented in [assets](public/assets/README.md) and the [Stage 3 report](docs/stage-3/README.md).

## Browser persistence and recovery

| Browser storage | Contents |
| --- | --- |
| localStorage `wheel-of-fortune.participation` | Visitor UUID, Instagram acknowledgement, committed outcome/prize snapshot, rotation, status and cooldown deadline |
| localStorage `wheel-of-fortune.language` | Language preference |
| IndexedDB `wheel-of-fortune.claims`, version 1 | Completed claims with original prize, normalized email, UTC timestamps and completion receipt |
| IndexedDB `wheel-of-fortune.participation.lock`, version 1 | Temporary owner/deadline lease when Web Locks are unavailable |
| localStorage `wheel-of-fortune.participation.lock.closed` | Temporary shutdown marker for fallback recovery |

An outcome is saved before animation. Refresh recovers that same outcome; pending prizes block another spin and retain their original snapshots. Claim transactions commit before participation completes. Startup reconciliation recovers a committed claim after an interrupted/failed localStorage update. Duplicate submissions retain the first record. Corrupt/unsupported participation or inconsistent claims fail closed and preserve data; there is no automatic reset.

Web Locks coordinate tabs; BroadcastChannel/storage events propagate changes. The fallback lease renews once a second; an unclean crash can require five seconds plus polling to recover. Unsent email drafts are not persisted. Closing a pending popup keeps “View my gift” available; completed participation remains disabled.

Configuration updates affect **future spins only**. Keep the same HTTPS production origin and existing storage keys/schema across deployments. Old awards/cooldowns are independent of current prizes and configuration IDs. Preview domains, custom domains and different browser profiles have separate storage; changing domains does not transfer records.

## CSV export

Open the deployed game's **main page at `/`** in the browser/profile holding the completed claims. In that page's developer console, run:

```js
await (await import(new URL('claims-export.js', location.href).href)).downloadClaimsCsv();
```

For Vite development, use:

```js
await (await import(new URL('src/claims/export.ts', location.href).href)).downloadClaimsCsv();
```

The download contains only that browser's committed claims, with UTF-8 BOM, CRLF, ISO timestamps, escaped quotes and spreadsheet formula protection. An empty database gives headers only. No claims are sent anywhere. CSV files contain email addresses; handle them accordingly. CSV is not a complete storage backup or a recovery/import format. See [the detailed operator procedure](docs/csv-export.md).

## Manual browser-data reset for testing

This intentionally destroys local participation, pending gifts, completed claims and language preference. Export any needed completed claims first; CSV does not preserve pending prizes or restore participation. **Do not use reset as a recovery step for corrupted records or real pending gifts.**

1. Close every tab/window using that exact site origin so another tab cannot retain a lock or recreate state.
2. In the browser's site-data settings, select that origin and clear its stored data. Keep the application closed while clearing to prevent another live tab from recreating state.
3. The reset must cover localStorage and both IndexedDB databases listed above. Reopen `/`; the Instagram gate and a new visitor identity should appear. Startup may recreate empty databases.

Clear only the intended testing origin. This does not delete downloaded CSV files or data on other origins, devices or profiles. Production contains no reset/debug controls.

## Vercel deployment preparation

This project is prepared for a static Vite deployment at the domain root. No `vercel.json` is needed: game screens have no deep URL routes, and `/privacy/*.html` and `/claims-export.js` must remain static files. Add routing configuration only if real deep-link routes are introduced later. See [Vercel's Vite guidance](https://vercel.com/docs/frameworks/frontend/vite).

When a deployment is separately authorized:

1. Import the repository into a Vercel project and select the directory containing `package.json` as the root.
2. Select **Vite**, **Node.js 24.x**, install command **`npm ci`**, build command **`npm run build`**, output directory **`dist`**. Include development dependencies for TypeScript/Vite; no environment variables, integration, database or runtime server are required. Vercel documents [build settings](https://vercel.com/docs/builds/configure-a-build) and [Node version selection](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
3. For the intended public URL, open the project’s **Deployment Protection** settings and disable Vercel Authentication, Password Protection and any IP restriction that would block anonymous visitors. Check team-inherited settings too. No protection-bypass secret is required by this app. Confirm actual anonymous access rather than assuming a production/deployment URL is public. See [Vercel's protection controls](https://vercel.com/docs/deployment-protection).
4. Use the HTTPS URL and a stable production domain. Vercel manages [SSL certificates](https://vercel.com/docs/domains/working-with-ssl). Browser storage must be allowed; HTTPS provides the secure context for browser APIs, but does not guarantee persistence or grant storage permission.
5. Check anonymous access in a signed-out browser; `/`, both privacy pages, local artwork and `/claims-export.js`; a mobile win/claim/refresh/export; loss cooldown; desktop/landscape gates; and absence of console/network errors.

Publish only the generated `dist/` contents. Keep `claims-export.js` and its shared hashed modules together. Do not upload local browser profiles, CSV exports, credentials, tests or source reports as the static output. `.env*` and `.vercel/` are ignored. This stage prepares deployment only; it does not create a project or deploy.

## Prototype limitations and privacy

- Client-side participation restrictions can be bypassed by clearing/editing storage, changing the clock or using another profile/device. This is not production-grade fraud prevention, identity verification or prize accounting.
- Clearing/evicting storage, private-session expiry or changing origin/profile can lose awards and claims. There is no centralized winner list, remote recovery, cross-device lookup, authentication or email delivery.
- Chrome/Linux and mobile emulation were exercised. Other engines, physical devices, virtual keyboards and hardware screen readers remain unverified. Reference gaps prevent full original winning/decoration fidelity claims.
- The [French](public/privacy/fr.html) and [English](public/privacy/en.html) policies remain drafts. Operator identity/contact, legal basis, retention periods, recipients/export handling and hosting details are explicitly incomplete. Do not represent this prototype as legally compliant or suitable for an uncontrolled real-prize campaign without addressing those gaps.

See [Stage 7 verification and visual baselines](docs/stage-7/README.md) and [Stage 8 audit/deployment checklist](docs/stage-8/README.md).
