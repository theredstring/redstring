# Code Signing

How Redstring's releases are signed on each platform, and the yearly renewal. Written after the Apple Developer account moved from an individual membership to Interfaith Softworks LLC (October 2026), so the next renewal is one page, not an afternoon.

## The one rule

**Apple Team ID `24MPFEY5BE` must never change.** The macOS updater on every installed copy accepts an update only if it is a Developer ID build of `io.redstring.app` from that team (`electron/updaterSignature.cjs`, contract C-4 in `documentation/security/THREAT_MODEL.md`). It checks the team, never the name on the certificate, so certificates can be renewed, renamed or replaced freely. A build from any other team would leave every Mac user stuck on their current version.

Never pin the certificate's name (CN or O) anywhere. `test/release/check-mac-signing-cert.test.js` asserts the pre-LLC certificate still passes.

## At a glance

| Platform | Signed with | Made by | Lasts | Where it lives |
|---|---|---|---|---|
| macOS | Developer ID Application | Account Holder, by hand (below) | 1 year | GitHub secrets `CSC_LINK`, `CSC_KEY_PASSWORD` |
| macOS notarization | App Store Connect team API key, or an Apple ID login | Account Holder or Admin | Until revoked | `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) |
| iOS | Apple Distribution | Xcode, automatically | 1 year | Xcode, the login keychain or Apple's cloud |
| Android | Upload key; Google holds the app signing key | Us, once | 25+ years | Not set up yet (below) |
| Windows | Authenticode code-signing certificate | A certificate authority, after verifying the LLC | 1 to 3 years | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, `WIN_PUBLISHER_NAME`. Not set up yet: releases ship unsigned (`ALLOW_UNSIGNED_WINDOWS=true`) |
| Linux | Nothing | | | AppImages ship unsigned |

The Apple Developer membership renews every January 22 (auto-renew on, LLC card). If it lapses, installed apps keep working, but nothing can be notarized and App Store apps are pulled.

## macOS: renew the Developer ID certificate (yearly)

Apple issues Developer ID certificates for one year (five until 2026). The release workflow's "Check signing certificate (macOS)" step warns 60 days before expiry and fails once it has expired, so the warning on a release run is the cue. Start about a month before.

Only the Account Holder can create a Developer ID certificate. Do it on the Mac that will export it, because the private key is created there.

1. **Make the request file.** Open Certificate Assistant (`open "/System/Library/CoreServices/Certificate Assistant.app"`; on recent macOS, Spotlight's "Keychain" opens Passwords, not Keychain Access) and choose Request a Certificate From a Certificate Authority. Email: any address, it isn't put on the certificate. Common Name: `Interfaith Softworks LLC`. CA email blank. Saved to disk.
2. **Create the certificate.** developer.apple.com, Certificates, +. Under the Developer ID heading choose **Developer ID Application**: not Apple Development, not Apple Distribution, not Developer ID Installer. Profile type **G2 Sub-CA**. Upload the request file, download the `.cer`, double-click it. Nothing confirms the install; check with `security find-identity -v -p codesigning`.
3. **Export it.** Keychain Access, My Certificates, right-click "Developer ID Application: Interfaith Softworks LLC (24MPFEY5BE)", Export, `.p12`, **with a strong password** (GitHub rejects an empty secret, and the file is the signing key).
4. **Check it.** `/usr/bin/openssl pkcs12 -in <file>.p12 -nokeys -clcerts | /usr/bin/openssl x509 -noout -subject -enddate` should show the LLC, `24MPFEY5BE` and a date a year out.
5. **Replace the secrets**, from the repo folder:
   ```
   base64 -i <file>.p12 | gh secret set CSC_LINK
   gh secret set CSC_KEY_PASSWORD
   ```
   The second one asks for the `.p12` password.
6. **Keep the backup, delete the loose files.** The `.p12` and its password go in the password manager, the only backup of the key. Delete the `.p12` and the `.certSigningRequest` from disk (both are gitignored).
7. **Do not revoke the old certificate.** Shipped builds were signed with it. Let it expire.
8. **Prove it on the next release.** The check step prints `Signing as Developer ID Application: Interfaith Softworks LLC (24MPFEY5BE), valid until ...`. On the published app, `codesign -dv /Applications/Redstring.app` shows the new authority. Then update a Mac running the previous version through the in-app updater.

A lapsed renewal only stops Mac releases from building. Shipped copies keep running, because each was notarized and timestamped when it was signed.

## macOS: notarization login

The workflow notarizes with the team's **App Store Connect API key** when `APPLE_API_KEY_P8` is set, and with the Apple ID login otherwise. The key belongs to the team, not to a person, so it keeps working through Account Holder and member changes; the Apple ID login stops when that person leaves the team or changes their password.

To set up the key (once):

1. App Store Connect, Users and Access, Integrations, App Store Connect API, Team Keys, +. Access: Developer.
2. Download the `.p8` (Apple allows this once). Note the Key ID and the Issuer ID shown above the list.
3. From the repo folder:
   ```
   gh secret set APPLE_API_KEY_P8 < AuthKey_<KEYID>.p8
   gh secret set APPLE_API_KEY_ID      # paste the Key ID
   gh secret set APPLE_API_ISSUER      # paste the Issuer ID
   ```
4. The next release logs `Notarizing with the App Store Connect API key`. Once one has passed, the `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD` secrets can be deleted.
5. Keep the `.p8` in the password manager and delete it from disk.

Notarization fails with an agreement error when Apple has published a new Program License Agreement the Account Holder hasn't accepted. Sign in to developer.apple.com and App Store Connect and accept it.

## iOS

The Xcode project uses automatic signing with `DEVELOPMENT_TEAM = 24MPFEY5BE`. Xcode makes and renews the Apple Distribution certificate the first time it archives for App Store Connect (Product, Archive, Distribute App). Nothing to do by hand.

- Apple Development certificates are per person (they carry the member's name, even in an organization). Apple Distribution certificates carry the organization's name.
- If Xcode shows a stale team name or type after an account change: Xcode, Settings, Accounts, remove the Apple ID and add it again. In Signing & Capabilities, pick the team, never a "(Personal Team)".

## Android (when publishing to Google Play)

Not set up: `android/app/build.gradle` has no release signing and no workflow builds Android. With Play App Signing, Google holds the key that signs what users install; we hold only an **upload key**, which Google can reset if it is lost.

1. Generate it once: `keytool -genkeypair -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`.
2. Keystore and passwords go in the password manager. Never commit the `.jks` (gitignored).
3. Enrol in Play App Signing when creating the app in Play Console. For CI, store the keystore as a base64 secret and its passwords as secrets, the same pattern as `CSC_LINK`.

## Windows (when buying the certificate)

Buy it **in the LLC's name**. electron-updater checks the publisher name of every downloaded update against the one the installed app was built with (`verifyUpdateCodeSignature`; `WIN_PUBLISHER_NAME` pins it). Once a signed release ships, changing that name strands every Windows user, which is the same trap the Team ID rule avoids on macOS.

- The certificate authority verifies the organization first (D-U-N-S, registration, phone), so allow days to weeks.
- Options: Microsoft's Azure signing service (formerly Trusted Signing; check its current eligibility rules for organizations), or a cloud-signing certificate from SSL.com, DigiCert or Sectigo. Keys must live in hardware or a cloud HSM now, so a cloud service needs a workflow change (electron-builder's `win.azureSignOptions` for Azure) rather than a `.pfx` in `WIN_CSC_LINK`.
- When the first signed release ships: set `WIN_PUBLISHER_NAME` to the exact name on the certificate, and remove the `ALLOW_UNSIGNED_WINDOWS` variable.

## Changing the Account Holder

The account is an organization, so the Account Holder can be handed to another member at any time; the Team ID, apps, bundle IDs, certificates and API keys stay with the team. Before handing it over: notarize with the team API key (above), and keep the previous holder on the team as Admin until a release has passed. Only the Account Holder can create Developer ID certificates afterwards.
