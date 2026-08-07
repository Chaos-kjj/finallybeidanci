# APK delivery requirement

- After **any** workspace modification, do not report completion until `npm run build` succeeds.
- `npm run build` is the canonical delivery command. It must run all tests, perform the offline scan, rebuild and sync web assets, assemble `android/app/build/outputs/apk/debug/app-debug.apk`, and pass the APK freshness verifier.
- Never treat changes in `src/`, `dist/`, or `android/app/src/main/assets/public/` as delivered until the final APK has been rebuilt and verified.
- Never use `npm run build:web`, `npm run android:sync`, or opening Android Studio as evidence that the APK is current.
- If APK generation or freshness verification cannot run, explicitly state that delivery is incomplete; do not claim the product change is finished.
- The source fingerprint deliberately covers documentation and tests as well as runtime code, so even non-runtime edits require a refreshed APK before handoff.
