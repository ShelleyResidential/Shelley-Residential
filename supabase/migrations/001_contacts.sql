-- ============================================================
-- Shelley Residential — Section 1: Contacts
-- ============================================================

-- Enable the moddatetime extension for auto-updating timestamps
create extension if not exists moddatetime schema extensions;

-- ============================================================
-- ENUMS
-- ============================================================

create type contact_title as enum ('Mr', 'Mrs', 'Ms', 'Dr');
create type contact_status as enum ('Active', 'Inactive');
create type contact_preference as enum ('WhatsApp', 'Email', 'Phone');
create type marital_status as enum ('Single', 'Married', 'Divorced', 'Widowed', 'Separated');

create type contact_tag as enum (
  'Current Buyer',
  'Current Seller',
  'Family',
  'Friends',
  'Homeowner',
  'Investor',
  'Referral Agent',
  'Service Provider',
  'Shelly Team Member',
  'Strategic Partner'
);

create type relationship_type as enum (
  'Aunt',
  'Brother',
  'Business Partner',
  'Contractor',
  'Daughter',
  'Employee',
  'Father',
  'Grandfather',
  'Grandmother',
  'Landlord',
  'Managing Agent',
  'Mother',
  'Nephew',
  'Niece',
  'Partner',
  'Sister',
  'Son',
  'Spouse',
  'Tenant',
  'Uncle'
);

-- ============================================================
-- CONTACTS
-- ============================================================

create table contacts (
  id              uuid primary key default gen_random_uuid(),
  title           contact_title,
  name            text not null,
  status          contact_status not null default 'Active',
  phone_number    text,
  email_address   text,
  contact_preference contact_preference,
  tags            contact_tag[] not null default '{}',
  marital_status  marital_status,
  occupation      text,
  company_name    text,
  -- Division and Branch: stored as text now; swap to FK once those tables exist
  division        text,
  branch          text,
  address         text,
  birthday        date,
  wedding_anniversary date,
  home_anniversary    date,
  id_number       text,
  -- agent and created_by will reference auth.users (Supabase built-in)
  agent_id        uuid references auth.users(id) on delete set null,
  created_by      uuid references auth.users(id) on delete set null,
  date_added      timestamptz not null default now()
);

-- Index for common filter columns
create index on contacts (status);
create index on contacts (agent_id);
create index on contacts using gin (tags);

-- ============================================================
-- CONTACT RELATIONSHIPS  (Linked Contact)
-- ============================================================

create table contact_relationships (
  id                uuid primary key default gen_random_uuid(),
  contact_id        uuid not null references contacts(id) on delete cascade,
  linked_contact_id uuid not null references contacts(id) on delete cascade,
  relationship_type relationship_type not null,
  created_at        timestamptz not null default now(),
  -- Prevent duplicate pairs in the same direction
  unique (contact_id, linked_contact_id, relationship_type)
);

create index on contact_relationships (contact_id);
create index on contact_relationships (linked_contact_id);

-- ============================================================
-- CONTACT NOTES  (Activity Log)
-- ============================================================

create table contact_notes (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid not null references contacts(id) on delete cascade,
  agent_id       uuid not null references auth.users(id) on delete cascade,
  note_text      text not null,
  created_at     timestamptz not null default now(),
  last_edited_at timestamptz not null default now()
);

create index on contact_notes (contact_id);
create index on contact_notes (agent_id);

-- Auto-update last_edited_at on every update
create trigger set_last_edited_at
  before update on contact_notes
  for each row
  execute procedure extensions.moddatetime(last_edited_at);

-- ============================================================
-- NOTE EDIT HISTORY
-- Stores every previous version before it is overwritten
-- ============================================================

create table contact_note_history (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid not null references contact_notes(id) on delete cascade,
  note_text    text not null,  -- the version being replaced
  edited_at    timestamptz not null default now()
);

create index on contact_note_history (note_id);

-- Trigger: snapshot old note_text into history before each update
create or replace function fn_archive_note_version()
returns trigger language plpgsql as $$
begin
  if new.note_text <> old.note_text then
    insert into contact_note_history (note_id, note_text, edited_at)
    values (old.id, old.note_text, now());
  end if;
  return new;
end;
$$;

create trigger archive_note_version
  before update on contact_notes
  for each row
  execute procedure fn_archive_note_version();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table contacts              enable row level security;
alter table contact_relationships enable row level security;
alter table contact_notes         enable row level security;
alter table contact_note_history  enable row level security;

-- CONTACTS — all authenticated users can read; only the owning agent or creator can write
create policy "Agents can read all contacts"
  on contacts for select
  to authenticated
  using (true);

create policy "Agents can insert contacts"
  on contacts for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "Agent or creator can update contact"
  on contacts for update
  to authenticated
  using (agent_id = auth.uid() or created_by = auth.uid());

-- CONTACT RELATIONSHIPS — same read-all, write-own pattern
create policy "Agents can read all relationships"
  on contact_relationships for select
  to authenticated
  using (true);

create policy "Agents can manage relationships for their contacts"
  on contact_relationships for all
  to authenticated
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_relationships.contact_id
        and (c.agent_id = auth.uid() or c.created_by = auth.uid())
    )
  );

-- CONTACT NOTES — strictly private: only the writing agent sees their own notes
create policy "Agent sees only their own notes"
  on contact_notes for select
  to authenticated
  using (agent_id = auth.uid());

create policy "Agent can insert their own notes"
  on contact_notes for insert
  to authenticated
  with check (agent_id = auth.uid());

create policy "Agent can update their own notes"
  on contact_notes for update
  to authenticated
  using (agent_id = auth.uid());

create policy "Agent can delete their own notes"
  on contact_notes for delete
  to authenticated
  using (agent_id = auth.uid());

-- NOTE HISTORY — readable only by the note's author
create policy "Agent sees history of their own notes"
  on contact_note_history for select
  to authenticated
  using (
    exists (
      select 1 from contact_notes n
      where n.id = contact_note_history.note_id
        and n.agent_id = auth.uid()
    )
  );
