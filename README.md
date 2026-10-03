# AUP Work Scholars

Next.js 15 (App Router) + React 19 + TypeScript + Tailwind CSS + Supabase.

Three account types:

| Role | Can do |
| --- | --- |
| Work scholar (student) | Time in / time out, tuition and personal wallet balances, time records, interactive work calendar, earnings and withdrawal history |
| Supervisor | Manage department students and finances, set tuition balances, transfer tuition credit into personal wallets, record withdrawals, set weekly shifts, view time records |
| Administrator | Everything: create departments and accounts, assign users, change rates, manage tuition and wallets, correct time records, record withdrawals, deactivate accounts |

Light and dark mode follow the system setting and can be toggled in the header.

## Setup

1. **Create a Supabase project** at https://supabase.com.
2. **Run the schema.** Open SQL Editor, paste all of `supabase/schema.sql`, and run it. Then run `supabase/kiosk_schema.sql` for the shared `/time-in-out` kiosk, `supabase/financial_schema.sql` for tuition balances and wallets, `supabase/profile_schema.sql` for editable profiles, and `supabase/work_assignment_schema.sql` to add the student work assignment field to an existing database.
3. **Turn off public sign ups.** Authentication > Providers > Email > disable "Allow new users to sign up". Accounts are only created by supervisors and administrators through the app.
4. **Configure environment variables.**
   ```bash
   cp .env.example .env.local
   ```
   Fill in the project URL, the anon key, and the service role key (Project Settings > API).
   The service role key is server only and is used for creating accounts.
5. **Create your first administrator.** Authentication > Users > Add user (tick auto confirm), then in the SQL editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
6. **Install and run.**
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:3000 and sign in.

## First steps inside the app

1. Admin: Departments, create a department.
2. Admin: Users and assignments, create a supervisor and assign them to the department.
3. Supervisor: sign in, Students, create work scholar accounts (they join the supervisor's department automatically).
4. Supervisor: Schedules, add weekly shifts.
5. Students sign in, tap Time in and Time out, and watch the calendar and earnings fill in.

## How the pieces fit

- `supabase/schema.sql` tables, row level security (RLS), and triggers. RLS is the real security boundary: students only see their own rows, supervisors only their department's students, admins everything.
- Students cannot backdate: a database trigger forces `time_in` and `time_out` to the server time for student writes.
- `app/actions/*` server actions. Account creation uses the service role client only after checking the caller's role.
- `app/(app)/{student,supervisor,admin}` role areas. Each layout calls `requireRole`, and `middleware.ts` refreshes the session and redirects signed out visitors to `/login`.
- `/time-in-out` is a shared kiosk. Keyboard-emulating RFID readers type the card's student ID into the focused field and submit it; the server calls `kiosk_toggle_time` to atomically clock that student in or out. Run `supabase/kiosk_schema.sql` after the main schema.
- Work earnings reduce each student's configured school tuition balance. A negative tuition balance is credit; an administrator or department supervisor can move that credit to the student's personal wallet. Record a withdrawal to deduct money from the wallet. Run `supabase/financial_schema.sql` once after the main schema, then set each student's tuition amount on the Finances screen.
- Each user can open their profile from the account block in the sidebar, edit their name and bio, and upload a profile photo and cover photo. Uploads are converted to WebP and stored on the app server under `data/profile-uploads` by default; set `PROFILE_UPLOAD_DIR` to a persistent writable directory in production.
- `lib/format.ts` all times display in Philippine time (`Asia/Manila`). Change `TZ` there if needed. Currency is PHP.
- `app/globals.css` the blue theme as CSS variables for light and dark.

## Things you will probably add next

- Supervisor approval of time records, or a kiosk mode for shared computers.
- Date range filters and CSV export for payroll.
- Password reset flow and a "change password" page (Supabase `auth.updateUser`).
- Generated database types: `npx supabase gen types typescript --project-id <id> > lib/database.types.ts`.
