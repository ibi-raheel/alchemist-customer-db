# Alchemist Pharmacy — Customer Database & Loyalty: How It Works

A plain-language guide to what this system is and how every page works. For
setup/deploy steps see [`README.md`](README.md).

---

## 1. What this is

A small, fast web app that lets **pharmacy counter staff record who bought
something, how much they spent, and at which branch** — and runs a **loyalty
points** program on top of that. It sits *alongside* the branches' existing POS
billing software (which we can't access), capturing just the customer + sale
info the pharmacy wants to keep and reward.

**Why it exists**
- Keep a reliable record of customers and their spending across all branches.
- Reward repeat customers with loyalty points that work at *any* branch.
- Give head office real reporting: who's buying, how much, and where.
- Build the purchase history that a future subscriptions product can use.

**What it deliberately does *not* store:** the actual medicines/items on a
receipt. Only the **total amount** is recorded — never line items or drug names.
This keeps the system out of sensitive "health data" territory on purpose.

---

## 2. The two kinds of user

| Role | Who | What they can do |
|------|-----|------------------|
| **Branch** | Counter staff at one branch (one shared login per branch) | Look up/enroll customers, record sales for **their own** branch, redeem points, see **their own** branch's sales |
| **Admin (Head Office)** | The owner / management | Everything a branch can, **plus** see every branch's sales, an all-customers report, and manage branches + branch logins |

Every branch has a unique ID. When a branch is logged in, every sale it records
is automatically stamped with that branch — staff never pick it from a list, so
it can't be mis-attributed.

---

## 3. The technology (in one paragraph)

It's a **Next.js** app hosted on **Vercel** with a **Supabase** (Postgres)
database. The important design choice: **all the security rules live in the
database itself** (Postgres "Row-Level Security"), not just in the app. So even
if the app had a bug, one branch still could not read another branch's sales.
The app is built to be **very lightweight** for slow internet — pages are mostly
plain HTML with almost no JavaScript.

---

## 4. The pages — how each one works

### 🔑 Login (`/login`)
The entry point. Staff enter the branch email + password (or admin credentials).
On success they land on the Capture screen. Wrong details show a simple error.
Nobody can reach any other page without logging in — a guard
(`middleware.ts`) redirects signed-out visitors here automatically.

### 🧾 Capture (`/`) — the main screen
This is where staff spend 99% of their time. It's a three-step flow on one page:

1. **Find customer** — staff type the customer's **11-digit phone number** and
   press Search. (The phone field only accepts digits and exactly 11 of them.)
2. **If the customer exists** → their card appears with their name, address, and
   current **points balance**, plus:
   - **Record purchase** — type the total amount, press the button. Points are
     added automatically (1 point per PKR 100). A green banner confirms it.
   - **Redeem points** — if they have at least 100 points, staff can redeem some
     (1 point = PKR 1).
   - **Edit name / address** — tucked in an expandable section for corrections.
3. **If no customer is found** → a short "New customer" form appears (name +
   address). Saving enrolls them and their loyalty account starts. Addresses are
   automatically stored in **CAPITAL LETTERS** for consistency.

Everything here works by submitting simple forms to the server, so it stays
responsive even on a weak connection.

### 📊 Reports (`/reports`)
- **Top of page:** three totals — **Today**, **This month**, and **All time**
  (amount + number of sales).
- **Recent purchases:** a list of the latest sales showing the **customer**, the
  **branch** it happened at, the **amount**, **points earned**, and the exact
  **date + time**.
- A **branch** login sees only its own sales here. An **admin** sees all
  branches merged, and gets a **"Filter by branch"** dropdown to narrow the list
  to a single branch (e.g. only Khokhar Chowk).

### 🏢 Admin (`/admin`) — head office only
Four sections:
1. **All-time sales — all branches:** total sales + customer counts, and a table
   of every branch's total sales and purchase count.
2. **All customers — sales to date:** every customer with their number of
   **visits**, **total spent**, current **points**, and **last visit date +
   time** — sorted by biggest spenders.
3. **Add branch:** create a new branch (it gets a unique ID automatically).
4. **Create branch login:** pick a branch, set an email + password — this
   creates that branch's login so staff can sign in.

### 🚪 Sign out
The button in the top bar ends the session and returns to Login.

---

## 5. How the data fits together

Four main tables:
- **branches** — each pharmacy branch (unique ID + name).
- **customers** — one record per phone number, **shared across all branches**
  (so anyone can look them up and points pool everywhere).
- **purchases** — one row per sale: which customer, which branch, the total
  amount, the time, and points earned. **Owned by the branch** that made it.
- **loyalty_ledger** — the running record of every points **earn** and
  **redeem**, which is what the balance is calculated from. It's an audit trail:
  you can always see exactly how a balance was reached.

A customer's **points balance** is never stored as an editable number — it's
always calculated from the ledger, so it can't drift or be tampered with.

---

## 6. The loyalty rules

| Rule | Value |
|------|-------|
| Earning | **1 point per PKR 100** spent (rounded down) |
| Redeeming | **1 point = PKR 1** |
| Minimum to redeem | **100 points** |
| Expiry / tiers | None (simple, flat program) |
| Scope | Points **pool across all branches** — earn anywhere, spend anywhere |

Earning happens automatically the moment a purchase is recorded. Redeeming is
protected so a balance can never go negative, even if two counters try at once.

---

## 7. The security model (why it's safe)

- **One login per branch**, each tied to a unique branch ID.
- A branch can **read** the shared customer directory (to look anyone up) but can
  only **write sales for its own branch**.
- A branch **cannot see or touch another branch's sales** — enforced by the
  database, not just the app.
- The loyalty ledger can only be changed by the system's own earning/redeeming
  logic, never edited directly.
- Head office (admin) can see and report on everything.

*(This has been tested directly against the live database: a branch trying to
read or write another branch's data is blocked at the database level.)*

---

## 8. Privacy note

Because only totals are stored (no medicines/line items), this system holds
basic contact info + spend, not health data. A short consent step was removed at
the owner's request to keep counter entry fast. Before going fully live, the
plan is to confirm the current Pakistan data-privacy obligations with local
counsel — see
[`../01_requirements/output/privacy-pakistan.md`](../01_requirements/output/privacy-pakistan.md).

---

## 9. Where things live in the code

```
src/
  middleware.ts            → forces login on every page
  app/
    login/                 → the Login page + sign-in logic
    (app)/
      layout.tsx           → top bar + navigation (shown once signed in)
      page.tsx             → Capture screen (find / enroll / record / redeem)
      actions.ts           → save customer, record purchase, redeem, sign out
      reports/page.tsx     → branch & head-office sales reports
      admin/               → admin dashboard + add-branch / create-login logic
  lib/                     → Supabase connection + auth helpers + loyalty rules
supabase/migrations/       → the database setup (tables, security, loyalty, reports)
```
