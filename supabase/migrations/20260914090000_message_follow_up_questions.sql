alter table public.messages
  add column follow_up_questions text[] not null default '{}';
