create table if not exists public.user_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_app_state enable row level security;

drop policy if exists "Users can read own app state" on public.user_app_state;
create policy "Users can read own app state"
on public.user_app_state
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own app state" on public.user_app_state;
create policy "Users can insert own app state"
on public.user_app_state
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own app state" on public.user_app_state;
create policy "Users can update own app state"
on public.user_app_state
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own app state" on public.user_app_state;
create policy "Users can delete own app state"
on public.user_app_state
for delete
to authenticated
using (auth.uid() = user_id);

create or replace function public.set_user_app_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_app_state_updated_at on public.user_app_state;
create trigger set_user_app_state_updated_at
before update on public.user_app_state
for each row
execute function public.set_user_app_state_updated_at();

create index if not exists user_app_state_updated_at_idx
on public.user_app_state (updated_at desc);

create table if not exists public.user_reader_books (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text not null,
  book jsonb not null,
  client_id text,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

alter table public.user_reader_books enable row level security;
alter table public.user_reader_books replica identity full;

drop policy if exists "Users can read own reader books" on public.user_reader_books;
create policy "Users can read own reader books"
on public.user_reader_books
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own reader books" on public.user_reader_books;
create policy "Users can insert own reader books"
on public.user_reader_books
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own reader books" on public.user_reader_books;
create policy "Users can update own reader books"
on public.user_reader_books
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own reader books" on public.user_reader_books;
create policy "Users can delete own reader books"
on public.user_reader_books
for delete
to authenticated
using (auth.uid() = user_id);

create or replace function public.set_user_reader_books_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_reader_books_updated_at on public.user_reader_books;
create trigger set_user_reader_books_updated_at
before update on public.user_reader_books
for each row
execute function public.set_user_reader_books_updated_at();

create index if not exists user_reader_books_updated_at_idx
on public.user_reader_books (user_id, updated_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_app_state'
  ) then
    alter publication supabase_realtime add table public.user_app_state;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_reader_books'
  ) then
    alter publication supabase_realtime add table public.user_reader_books;
  end if;
end $$;
