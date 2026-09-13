alter table public.sources
  drop constraint sources_type_check,
  add constraint sources_type_check
    check (type in ('pdf', 'docx', 'txt', 'pasted_text', 'website', 'youtube', 'audio'));
