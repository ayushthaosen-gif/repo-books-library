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

## 4. Optional: share a view-only link

This lets the **Share** button in the app create a link that anyone can open to see your books and games (titles, authors, covers, read status, game players and play time). Nothing else is exposed: no notes, reviews, ratings, lent-to names or wishlist items. Nobody can change anything through the link, and **Stop sharing** in the app turns it off immediately.

In **SQL Editor > New query**, paste this and click **Run** (once):

```sql
create table public.shares (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  token text not null unique check (length(token) >= 32),
  created_at timestamptz not null default now()
);

alter table public.shares enable row level security;

-- Only you (signed in) can see, create or remove your link.
create policy "own share" on public.shares
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Anyone holding the link's token can read this safe subset, and nothing else.
create function public.shared_library(p_token text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'title',    b.data->>'title',
    'author',   b.data->>'author',
    'kind',     coalesce(b.data->>'kind', 'book'),
    'status',   coalesce(b.data->>'status', 'unread'),
    'players',  b.data->>'players',
    'playtime', b.data->>'playtime',
    'cover',    coalesce(nullif(b.data->>'photo', ''), nullif(b.data->>'cover', ''), '')
  ) order by lower(b.data->>'title')), '[]'::jsonb)
  from public.shares s
  join public.books b on b.user_id = s.user_id
  where s.token = p_token
    and not b.deleted
    and coalesce(b.data->>'list', 'library') = 'library';
$$;

revoke all on function public.shared_library(text) from public;
grant execute on function public.shared_library(text) to anon, authenticated;
```

Then in the app tap **Share > Create share link** and send the link to whoever you like. Sign-ups stay off, and the link only ever reads.

## 5. Optional: one shared family library

By default each login has its own library. This step makes chosen logins share **one** library (yours), so everyone at home sees and edits the same books, and a book added on any phone shows on all of them. Nobody shares a password: each person gets their own login.

1. **Authentication > Users > Add user > Create new user** for each family member (their own email and password, tick **Auto Confirm User**). Sign-ups stay off.
2. In **SQL Editor > New query**, run this once, replacing `YOU@example.com` with your login email and the member emails with theirs:

```sql
create table public.family (
  owner uuid not null references auth.users(id) on delete cascade,
  member_email text not null,
  primary key (owner, member_email)
);
alter table public.family enable row level security;

-- You and each member can see their own entry. Nobody can change it from the app.
create policy "see own family" on public.family for select to authenticated
  using (owner = auth.uid() or lower(member_email) = lower(auth.jwt()->>'email'));

-- Members can read and write the owner's books.
create policy "family books" on public.books for all to authenticated
  using (exists (select 1 from public.family f
    where f.owner = books.user_id and lower(f.member_email) = lower(auth.jwt()->>'email')))
  with check (exists (select 1 from public.family f
    where f.owner = books.user_id and lower(f.member_email) = lower(auth.jwt()->>'email')));

insert into public.family (owner, member_email)
select id, m from auth.users, unnest(array['mum@example.com', 'dad@example.com']) as m
where email = 'YOU@example.com';
```

3. Each family member opens the app, taps **Sync**, enters the same URL and anon key and **their own** email and password. The status line then reads "Synced ... (family library)". Their books join yours; identical starter books merge, not double.
4. To add someone later, run the last `insert` again with their email. To remove them, `delete from public.family where member_email = '...'`.

**Google Drive:** in Drive, share your books folder with your family's Google accounts (or "Anyone with the link can view"). Each member taps **More > Set Drive folder** once to keep the folder link in the app. PDF links on books sync to everyone, and the reader opens them from Drive.

The dot at the bottom turns green when you are synced. Free Supabase projects pause after a week of no activity;
opening the app and syncing counts as activity, and a paused project can be resumed from the Supabase dashboard without losing data.
