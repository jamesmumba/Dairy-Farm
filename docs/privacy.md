# Privacy and data handling

Plain-language summary for farmers, with technical detail for reviewers.

## What the app keeps

| Data | Why |
|---|---|
| Your email, and optionally your name, phone, farm name and location | To sign you in, recover your account, and label your reports |
| Animals, milk, health, treatments, breeding, vaccinations | The farm records you enter |
| Customers' names, phone numbers and addresses (optional), sales and payments | To record sales and what customers owe |
| Expenses and receipt photos, animal photos | Your records |
| A history of changes (audit log) | So corrections, voids, price changes, adjustments and exports can be explained later |

The app does not collect your location, contacts or advertising identifiers, and it does not track you. Vets and other people you name in records are stored as text only: they get no access.

## Where it is stored

* **Your phone:** a working copy, so the app works offline. Your sign-in is kept in the phone's secure storage (Keychain / Android Keystore). When you sign out, the farm data is removed from the phone.
* **Your account:** a managed PostgreSQL database and private file storage (Supabase, Frankfurt, EU), reached only through the Dairy Farm API over encrypted connections (HTTPS/TLS).
* **Backups:** encrypted nightly backups, kept for 30 days.

## Who can see it

Only you, when signed in. Every request is checked against your account on the server, and another account cannot read or change your records. This is tested for every part of the app (`apps/api/test/isolation.test.ts`). Photos are private and are shown through links that expire after 10 minutes. The operator of the service can reach the database for maintenance, backups and processing deletion requests.

## Sharing

You decide what leaves the app. Reports are shared as CSV or PDF files only when you tap *Share*. The app first warns that the file contains farm records (and customer details for the money report). Each export is recorded in your audit history.

## Your choices

* **Export:** Reports › choose a report › Share CSV or PDF, for any period.
* **Correct:** records can be corrected, with the change kept in the history.
* **Delete your account:** More › Delete account. After confirming with you, the operator erases all your records, photos and your sign-in. An anonymous note that a deletion happened (dates and a row count only) is kept. Backups containing your data expire within 30 days.
* **App lock:** use your phone's fingerprint, face or screen lock to protect the app on a shared phone.

## Security measures (technical)

* Supabase Auth with verified email and short-lived access tokens. Tokens are checked against the project's signing keys.
* Server-side validation and owner checks on every route. Parameterised SQL only.
* Rate limiting, `no-store` and `nosniff` headers, and a 256 KB request limit. Internal errors are never shown to clients, and passwords and tokens are never logged.
* The Supabase Data API is locked out (RLS enabled with no policies, and grants revoked). Only the API reaches the data.
* Money, stock and audit records are append-only. Corrections are explicit, carry a reason, and are audited.
