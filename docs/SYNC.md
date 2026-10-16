# Keep your library safe (cloud sync)

By default your books live only in the browser on one phone. Sync copies them to your own free
[Supabase](https://supabase.com) project, so they survive a lost phone or cleared browser and show on every device.
The app keeps working offline and syncs when it can. **Export backup** still works as a second copy.

You do this once (about 10 minutes). Never share your password or the `service_role` key with anyone; the app only needs the public keys below.

## 1. Create the project

1. Sign up at supabase.com (free plan) and click **New project**. Pick any name, a strong database password, and a region near you.
2. When it is ready, open **SQL Editor > New query**, paste this, and click **Run**:

```sql
create table public.books (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  primary key (user_id, id)
);

alter table public.books enable row level security;

create policy "own books" on public.books
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

## 2. Create your login

1. Open **Authentication > Sign In / Providers** and turn **off** "Allow new users to sign up", so only you can ever get in.
2. Open **Authentication > Users > Add user > Create new user**. Enter your email and a password, and tick **Auto Confirm User**.

## 3. Connect the app

1. Open **Project Settings > API**. Copy the **Project URL** and the **anon public** key.
2. In the app, tap **Sync is off** at the bottom, paste the URL and key, enter the email and password from step 2, and tap **Sign in and sync**.
   Your existing books upload on the first sync. Repeat on each device (or put the URL and anon key in `config.js` so they are pre-filled).

The dot at the bottom turns green when you are synced. Free Supabase projects pause after a week of no activity;
opening the app and syncing counts as activity, and a paused project can be resumed from the Supabase dashboard without losing data.
