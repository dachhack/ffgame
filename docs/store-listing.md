# Getting Drip into the App Store and Play Store

What is in the repo, and what only a human with the accounts can do. The
engineering half is done; the rest is forms, screenshots and two developer
accounts, and no amount of code will move them.

## What is already here

| Thing | Where |
|---|---|
| Bundle id / package (`com.dripfantasy.app`) | `apps/mobile/app.json` |
| Icons, adaptive icon, splash, notification icon | `apps/mobile/assets/` |
| A production build profile (Android `.aab`, `distribution: store`) | `apps/mobile/eas.json` → `build.production` |
| Submission config, reading credentials from the environment | `apps/mobile/eas.json` → `submit.production` |
| The listing copy — title, subtitle, description, keywords, URLs | `apps/mobile/store.config.json` |
| Privacy policy, live and public | `public/privacy.html` → dripfantasy.com/privacy.html |
| Support page, live and public | `public/support.html` → dripfantasy.com/support.html |
| An APK build workflow for playtesters | `.github/workflows/release-apk.yml` |

## What only you can do

1. **Two accounts.** Apple Developer Program ($99/yr, and an enrolment that can
   take days) and Google Play Console ($25 once). Both need a legal identity and
   a payment method; Play now also asks a new personal developer account for
   12 testers over 14 days before it will let you go public.
2. **Create the app in each console** (App Store Connect; Play Console). The
   bundle id and package above must match exactly.
3. **Screenshots.** Apple wants 6.7" and 6.5" iPhone sets; Play wants a phone
   set plus a 1024×500 feature graphic. Take them from a real build — the
   matchup board mid-week, the live play feed, the commissioner's console, the
   trade screen with a grade on it, and the record book are the five that show
   what this is.
4. **The privacy questionnaires.** Apple's App Privacy and Play's Data Safety
   ask the same things in different words. The honest answers, from what the
   code actually does (see `public/privacy.html`):
   - Collected and **linked to you**: email address, user id, your league
     content (rosters, picks, trades, chat), purchase history.
   - Collected and **not linked**: crash/diagnostic and product-interaction
     analytics, where a build has an analytics key.
   - **Not** collected: location, contacts, photos, health, browsing history,
     advertising identifiers.
   - **Not used for tracking** across other apps or websites, and no data
     brokers. Say so plainly: it is true, and it is the answer that keeps the
     listing simple.
   - Third parties that receive data: Supabase, Fly.io, Stripe, PostHog, Expo /
     APNs / FCM, and ESPN / Sleeper / Yahoo for connected leagues.
5. **Age rating.** 12+ / Teen is the honest place — it is a sports game with
   user-to-user chat. Declare the chat; do not declare simulated gambling
   (drip coin is earned in play, cannot be bought with money and cannot be
   cashed out — if that ever changes, the answer changes with it, and
   `store.config.json` says so beside the flag).
6. **Sign-in review notes.** Both reviewers need a way in. Give them a demo
   account with a league that has games in it, and say in the notes that the
   app is a real-time game whose screens are most of the way empty outside an
   NFL week — a reviewer opening it on a Tuesday in March otherwise sees a
   lobby and nothing else.
7. **Apple only:** if Google sign-in is offered, Apple requires Sign in with
   Apple beside it. That is real work and not yet in the app — either add it
   or ship email sign-in only on iOS.

## Running a submission

```bash
cd apps/mobile
eas build --profile production --platform android     # .aab
eas build --profile production --platform ios         # .ipa (needs the Apple account)
eas submit --profile production --platform android    # → Play internal track
eas submit --profile production --platform ios        # → App Store Connect
eas metadata:push                                     # the listing copy above
```

Credentials come from the environment, never the repo:
`GOOGLE_SERVICE_ACCOUNT_KEY_PATH` for Play; an App Store Connect API key
(`EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`, `EXPO_ASC_KEY_P8`) or
`EXPO_APPLE_APP_SPECIFIC_PASSWORD` for Apple. `eas secret:create` puts them in
EAS so CI never holds them either.

## The order that wastes the least time

Enrol in both programmes first — Apple's can take a week and nothing else
proceeds without it. While waiting: take the screenshots, answer the
questionnaires, and run `eas build --profile production --platform android`
so the first real submission is not also the first real build.
