-- People who may use the knowledge base, their personal tokens and what they did with them.

create table users (
  id          bigint generated always as identity primary key,
  name        text not null,
  email       text unique,
  note        text,
  created_at  timestamptz not null default now(),
  disabled_at timestamptz
);

-- Only a SHA-256 of each token is stored; the token itself is shown once at creation.
create table tokens (
  id           bigint generated always as identity primary key,
  user_id      bigint not null references users (id) on delete cascade,
  prefix       text not null unique,
  hash         text not null unique,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index tokens_user on tokens (user_id);

-- One row per tool call. Purged after USAGE_RETENTION_DAYS; totals survive in usage_daily.
create table usage_events (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     bigint references users (id) on delete set null,
  token_id    bigint references tokens (id) on delete set null,
  tool        text not null,
  input       jsonb not null default '{}',
  result      jsonb not null default '{}',
  duration_ms integer not null,
  error       text,
  client      text
);
create index usage_events_at on usage_events (at);
create index usage_events_user_at on usage_events (user_id, at);

-- Calls per person, day (Europe/Istanbul) and tool; kept forever, tiny.
create table usage_daily (
  day     date not null,
  user_id bigint not null references users (id) on delete cascade,
  tool    text not null,
  calls   integer not null default 0,
  errors  integer not null default 0,
  primary key (day, user_id, tool)
);
