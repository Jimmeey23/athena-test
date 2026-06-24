create schema if not exists extensions;
create extension if not exists vector;
set search_path = public, extensions;

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_uri text,
  mime_type text not null default 'text/plain',
  status text not null default 'active' check (status in ('active', 'archived')),
  embedding_provider text not null default 'openai',
  embedding_model text not null,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  chunk_index integer not null,
  section_heading text,
  chunk_text text not null,
  token_count integer,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists knowledge_documents_status_created_idx
  on public.knowledge_documents (status, created_at desc);

create index if not exists knowledge_chunks_document_idx
  on public.knowledge_chunks (document_id, chunk_index);

create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100)
  where embedding is not null;

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;

drop policy if exists "Authenticated users can read active knowledge documents" on public.knowledge_documents;
create policy "Authenticated users can read active knowledge documents"
  on public.knowledge_documents
  for select
  to authenticated
  using (status = 'active');

drop policy if exists "Authenticated users can read active knowledge chunks" on public.knowledge_chunks;
create policy "Authenticated users can read active knowledge chunks"
  on public.knowledge_chunks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.knowledge_documents d
      where d.id = knowledge_chunks.document_id
        and d.status = 'active'
    )
  );

create or replace function public.match_knowledge_chunks(
  query_embedding vector(1536),
  match_count integer default 5,
  similarity_threshold double precision default 0.2
)
returns table (
  document_id uuid,
  document_title text,
  section_heading text,
  chunk_text text,
  source_uri text,
  similarity double precision
)
language sql
stable
as $$
  select
    d.id as document_id,
    d.title as document_title,
    c.section_heading,
    c.chunk_text,
    d.source_uri,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks c
  join public.knowledge_documents d on d.id = c.document_id
  where d.status = 'active'
    and c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 12));
$$;
