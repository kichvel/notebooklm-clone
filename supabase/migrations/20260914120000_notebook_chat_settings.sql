alter table public.notebooks
  add column chat_style text not null default 'default' check (chat_style in ('default', 'custom')),
  add column chat_custom_style text,
  add column chat_answer_length text not null default 'default' check (chat_answer_length in ('shorter', 'default', 'longer'));
