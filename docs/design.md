# Dairy Farm Mobile App Design

The visual and interaction design for the app. Colour tokens live in `apps/mobile/src/ui/palette.ts`, spacing,
radii and type in `apps/mobile/src/ui/theme.ts`. `test/palette.test.ts` checks every text/background pair for
WCAG AA contrast.

**Decisions recorded on 27 Oct 2026** (changes to the first draft):

| Topic | Decision |
|---|---|
| Input borders | Stay `line-200`; the error state uses a 2 pt `red-700` border |
| Dark mode | The app is light-only for now (`userInterfaceStyle: light`), so every phone shows this design. The dark palette stays in `palette.ts` (and its contrast is tested) for the dark design to come |
| Charts | One hue per chart (`green-700`); series are compared in separate small charts on one scale, never by two similar hues |
| Sale confirmation | Only for an unusual sale: a special price, part or no payment, a currency other than the farm's, or more than half the milk in stock. An ordinary sale saves at once and shows a "Sale saved" notice |
| Stock reconciliation task | Dropped. Stock is a ledger with reasoned adjustments; negative-stock days are shown as a notice on the stock screen |
| Sync status | A compact indicator in every screen header; Home also shows the full status with the last sync time |
| Backend names | Never shown to the farmer ("your account", "Can’t connect right now", not "Supabase" or "server") |
| Large text | Summary cards and quick actions drop to one column when the text-scaled screen width is under 340 pt |
| Expenses | Entered from **Records** |
| Animal profile | One vertical timeline with filter chips, not a tab row |

## Product direction

A calm, capable, modern mobile app that helps one farmer run the daily records of their dairy farm. It feels
connected to dairy farming through milk white, pasture green and warm natural accents, without cow-print motifs,
cartoon farm illustrations or decorative clutter.

Android and iOS, built with React Native and Expo. It supports quick use in a barn or field: one-handed use, bright
outdoor light, intermittent connectivity, and a farmer entering records while busy. The next useful action and clear
status come before dense charts or administrative controls.

UI states distinguish a record saved on the phone from one accepted by the farmer's account. Security and ownership
are enforced on the server; hiding a control is never a security boundary.

## Design principles

1. **Make daily work fast.** Recording milk, adding a health concern, logging a sale or checking a reminder takes only a few clear steps.
2. **Keep the farmer oriented.** Consistent navigation, plain language, visible units, clear dates and a persistent sync status.
3. **Show what matters now.** Urgent animal care, due tasks, today's production and quick actions first; secondary detail one tap away.
4. **Make records trustworthy.** Calculated totals, preserved historical values, confirmation of consequential actions, validation errors explained in context.
5. **Use colour with meaning.** Green for farm operations and healthy progress, amber for attention, red only for urgent or blocking issues. Never colour alone.
6. **Design for imperfect conditions.** Offline entry, large touch targets, readable type, high contrast, forgiving forms.

## Visual identity

### Colour palette

| Token | Hex | Theme key | Use |
|---|---|---|---|
| `green-900` | `#173F2B` | | Dark emphasis |
| `green-800` | `#24583A` | `primary` | Primary buttons, active navigation, selected controls |
| `green-700` | `#34734B` | `chart` | Chart marks, links on pale backgrounds |
| `green-100` | `#E8F1E9` | `primarySoft` | Selected backgrounds, success panels |
| `milk-50` | `#FBFAF6` | `background` | Main app background |
| `white` | `#FFFFFF` | `surface` | Cards, sheets, text entry |
| `ink-900` | `#202A24` | `text` | Main text |
| `ink-700` | `#46534B` | `textMuted` | Secondary text and descriptions |
| `line-200` | `#DCE3DC` | `border` | Dividers, outlines, input borders |
| `sky-700` | `#356A83` | `info` | Informational accents |
| `sky-100` | `#E8F1F5` | `infoSoft` | Informational panels |
| `straw-700` | `#805B12` | `attention` | Attention text and icons on pale amber |
| `straw-100` | `#FBF1D9` | `attentionSoft` | Upcoming reminders, caution panels, offline/waiting sync |
| `red-700` | `#A5322A` | `danger` | Urgent warnings, destructive actions, failed sync |
| `red-100` | `#F9E9E6` | `dangerSoft` | Urgent panels, validation error backgrounds |

`primary` is for primary actions and active states, not every icon or card. Amber is for upcoming or caution states,
red only for urgent, overdue, blocked or destructive states, blue for neutral information. Straw yellow and pale green
are never used for small text. Status labels always include words (**Overdue**, **Waiting to sync**,
**Withdrawal active**) alongside icon and colour.

Measured contrast (light): text on background 13+:1, `textMuted` 7.7:1, white on `primary` 8.3:1, `attention` on
`attentionSoft` 5.5:1, `danger` on `dangerSoft` 5.8:1, `info` on `infoSoft` 5.2:1.

### Typography

System fonts: SF Pro on iOS, Roboto on Android. All sizes scale with the system text size.

| Style | Size | Weight | Use |
|---|---:|---|---|
| Screen title | 28 pt | Semibold | Main screen heading |
| Section title | 19 pt | Semibold | Screen sections and sheet headings |
| Card title | 16 pt | Semibold | Summary and list cards |
| Body | 16 pt | Regular | Labels and instructions |
| Secondary | 14 pt | Regular | Supporting details, metadata |
| Caption | 13 pt | Medium | Timestamps, units, chart labels; never essential instructions |
| Figure | 22–28 pt | Semibold | Key totals such as litres or balance |

No long all-caps labels, light weights, or text in images.

### Shape, spacing and icons

* 8 pt spacing scale: 4, 8, 16, 24, 32 (and 12 where needed). 16 pt screen side padding.
* Cards and panels: radius 16, 1 pt `line-200` border, no heavy shadows. Inputs and buttons: radius 12. Chips: radius 20.
* No heavy gradients, glass effects or layered card piles.
* Icons: Material Community Icons (`@expo/vector-icons`), which include farm shapes (cow, milk drop, needle,
  stethoscope). They sit in soft rounded "badges" tinted green, sky, straw or red by topic, and always next to a label.
* Cards have a soft green-tinted shadow (`shadow` in `theme.ts`) and a hairline border.
* Touch targets at least 48 × 48 dp.

## Information architecture

Five-destination bottom navigation; less frequent tools under **More**.

| Destination | Purpose |
|---|---|
| **Home** | Today's overview, urgent items, quick actions, sync state |
| **Animals** | Herd list, search, registration, animal profiles |
| **Records** | Milk, health, breeding, pregnancy, calving, vaccination, milk use and expenses |
| **Sales** | Customers, milk sales, payments, balances, milk stock |
| **More** | Reports, reminders, history, settings, data export, help |

* Each tab shows an icon and a short label; the active tab uses `primary` and an accessible selected state.
* Each tab keeps its navigation stack. Native back behaviour and safe-area insets.
* Create flows open as full-screen forms; bottom sheets only for short, reversible choices.
* Every screen header carries the compact sync indicator.

## Core screens

### Sign-in and onboarding

* Wordmark, one-line explanation, focused sign-in form; email verification and password reset by 6-digit code.
* No farm role choice: there is one farmer account.
* Short stepper: profile, farm (optional), units and currency (ZMW default), reminders, app lock, first action.
* Ends with **Add your first animal** or **Record today's milk**. Setup can be paused and resumed.

### Home

Answers: **What needs attention today, and what can I do next?**

1. Greeting and date, then the sync status.
2. **Needs attention** (withdrawals, animals needing attention) only when there is something.
3. **Quick actions**: Record milk, Add animal, Log sale, Record health issue (one tap each).
4. A period choice (Today, This week, This month) for the sections below.
5. Herd, Milk, and Sales and money summary cards; each opens its details.
6. **Coming up**: the next vaccinations, pregnancy checks, calvings and follow-ups.

Cards have a short title, a large value with unit or currency, and a small supporting label. Production, revenue,
cash received, customer debt and stock are never combined into one number.

### Animals list and profile

* Search by ear tag, ID or name; filter chips for status, breed, production and health.
* Rows show name or ear tag, breed, status and a photo or placeholder.
* Profile: photo, name, status, key facts, withdrawal banner, an **Add record** set of actions, and one chronological
  timeline. History is kept after sale, transfer, death or retirement.

### Record milk

* Date (today by default) and session: **Morning**, **Afternoon**, **Evening**.
* A milking round lists the herd for one session; a single entry is also available.
* Numeric keypad, litres shown. Active withdrawal shown before save with the milk's eligibility.
* Duplicate sessions are refused with a link to the existing entry. Offline entries are labelled **Waiting to sync**.

### Health and treatment

* Animal, date, plain-language symptoms; diagnosis labelled **Suspected** or **Confirmed**.
* No medicine suggestions or calculated doses.
* A withdrawal shows a high-visibility notice with the exact end date and time, and whether milk is restricted now.

### Breeding, pregnancy, calving and vaccination

* Event-first forms with only the relevant fields.
* A breeding event never shows **Pregnant**; only a pregnancy check result does.
* Expected calving shows its source and can be corrected from veterinary guidance.
* Vaccination for one animal or a group; reminder intervals are configurable; overdue items are labelled.

### Sales and customers

1. Choose or add a customer.
2. Litres shortcut or another amount.
3. Listed price (or a special price), calculated total, stock for the date.
4. Paid in full, part, or on credit, with the method; the balance is calculated.
5. **Save sale.** An unusual sale (see decisions) shows a check summary first.
6. The customer statement opens with a **Sale saved** notice.

Totals and balances are never typed. Saving is refused, with the fix explained, when values are invalid or stock is
insufficient. An offline sale is marked as waiting for the account to confirm price, payment and stock.

Customer profile: contact details, history, litres, payments and balance per currency; payments apply to the oldest
sales first, with extra kept as credit.

### Stock and expenses

* Stock is a balance card with its movements; withdrawal milk is never counted.
* Expense entry: category, amount, currency, date, payee (optional), note, receipt photo (optional).

### Reports

* Report picker by topic; period chips and only the relevant filters.
* Key totals with label, unit or currency and period above simple charts with text summaries and a table view.
* Exports say what is created (CSV or PDF) and warn before sharing private data with another app.

### Reminders, settings and history

* Reminders grouped by urgency, filterable.
* Settings: profile, farm, units and currency, reminders, security, sync, export, account and data.
* Audit history is read-only and explains edits, corrections, reversals and price changes in plain language.

## Components

Building blocks in `src/ui/kit.tsx`: `IconBadge`, `SectionHeader` (title with a "See all" style link), `ListGroup`
and `ListRow` (iOS-style grouped rows with icon, subtitle, value and chevron), `ActionTile` (icon tile for main
actions), `StatCard` (icon, label, large figure, note), `Avatar` (initials), `Pill` (status label).

Screen patterns:
* **Home**: a deep green "today" card (greeting, date, milk today, milk for sale), then attention rows, four quick
  action tiles, stat cards per topic, charts in a white card, and coming-up rows.
* **Records**: a green milking-round banner, care actions as an icon tile grid, other entries as grouped rows.
* **Animals**: rows with an initials avatar, ID, breed and age, and status pills (in milk, dry, pregnant, withdrawal).
* **Sales**: stock and price stat cards, **New sale**, grouped links, and customers with avatar and balance.
* **More**: a farm card, then grouped rows for records, account and data.
* Tab bar: white, with the active tab's icon in a pale green pill.

Other components: 
`SyncHeader` (header indicator), `SyncStatus` (full status on Home), `SyncBadge` (per record), `Notice`
(info, success, attention, error), `Button`, `TextField`, `Choice`, `Toggle`, `Chips`, `DateField`, `BarChart`,
`HorizontalBars`, summary tiles and quick actions on Home.

## Interaction and motion

* Short transitions; the system reduced-motion setting is respected.
* Routine success is shown inline; confirmation dialogs only for destructive or unusual financial actions.
* The primary action sits at the end of the form. Form input survives navigation, interruption and failed requests.
* After saving, return to the relevant list or profile, or offer the next related action.

## Forms and validation

* Every field labelled; optional fields marked; sensible defaults and the right keyboard.
* Errors beside the field, saying how to fix them. The server validates again and its answer wins; the farmer's
  input is kept if a change is rejected.
* A record is clearly saved on the phone, waiting to sync, confirmed, or needing attention.
* Money always shows its currency; currencies are never mixed in one total.

## Offline, loading and error states

| State | Treatment |
|---|---|
| Offline | Amber header indicator; cached data stays usable |
| Saved on the phone | **Waiting to sync** with a count |
| Syncing | Blue header indicator; work continues |
| Change rejected | Red indicator and **Sync issues** with the reason and a fix; the entry is kept |
| Conflict | Both versions shown; a sale or stock movement is never silently overwritten |
| Empty list | What will appear here, and one action to create it |
| No search results | The search term and **Clear search** |
| Can't connect | Cached data, labelled as possibly out of date, and retry |

## Accessibility

* WCAG 2.2 AA contrast (tested), system text scaling, 48 dp targets.
* Labels and values for icons, tabs, badges, charts and custom controls; validation and sync changes announced.
* Health, payment and sync state never by colour alone. Plain language and visible units.
* Usable at 200% text: cards drop to one column. No swipe-only or destructive gestures.

## Writing style

* Direct verbs: **Record milk**, **Add animal**, **Log sale**, **Mark complete**.
* Units always: **12.5 L**, **ZMW 250**, **Due 28 Oct**. Dates in the farmer's chosen format.
* No unexplained abbreviations, backend terms or blaming error messages.

## Acceptance checklist

* Record milk, Add animal, Log sale and Record health issue are one tap from Home.
* The bottom navigation is visible and consistent; every header shows sync state.
* Amounts show currency, milk shows litres, summaries show their period.
* Produced milk, eligible stock, milk sold, revenue, payments and customer debt are never confused.
* An offline record survives a restart and is marked as waiting to sync; a failed sync keeps the record and says what to do.
* Withdrawal restrictions are prominent and stated in words. Pregnancy is never inferred from breeding alone.
* Forms keep entries after validation or network errors.
* Contrast, text scaling, screen-reader labels, touch targets and reduced motion are checked on Android and iOS, on small, standard and large phones.
