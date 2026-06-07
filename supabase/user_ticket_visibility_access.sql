-- Repair ticket visibility for support users.
-- Support users can read tickets they created or tickets assigned to their employee record.
-- Admin users continue to read every ticket.

create or replace function public.current_user_assignment_keys()
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base_keys text[];
  employee_keys text[] := '{}';
begin
  select coalesce(array_agg(distinct value) filter (where value <> ''), '{}')
  into base_keys
  from (
    select lower(coalesce((select email from public.profiles where id = auth.uid()), '')) as value
    union
    select lower(coalesce((select full_name from public.profiles where id = auth.uid()), ''))
    union
    select lower(coalesce((select raw_user_meta_data ->> 'full_name' from auth.users where id = auth.uid()), ''))
    union
    select lower(coalesce((select raw_user_meta_data ->> 'name' from auth.users where id = auth.uid()), ''))
    union
    select lower(coalesce((select email from auth.users where id = auth.uid()), ''))
  ) keys;

  if to_regclass('public.employees') is not null then
    execute $employee_query$
      select coalesce(array_agg(distinct value) filter (where value <> ''), '{}')
      from (
        select lower(coalesce(name, '')) as value
        from public.employees
        where lower(coalesce(email, '')) = any($1)
           or lower(coalesce(name, '')) = any($1)
        union
        select lower(coalesce(email, '')) as value
        from public.employees
        where lower(coalesce(email, '')) = any($1)
           or lower(coalesce(name, '')) = any($1)
      ) employee_keys
    $employee_query$
    using base_keys
    into employee_keys;
  end if;

  return (
    select coalesce(array_agg(distinct value) filter (where value <> ''), '{}')
    from unnest(base_keys || employee_keys) value
  );
end;
$$;

create or replace function public.can_access_ticket(ticket_created_by uuid, ticket_assigned_to text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_role() = 'admin'
    or ticket_created_by = auth.uid()
    or lower(coalesce(ticket_assigned_to, '')) = any(public.current_user_assignment_keys());
$$;

create or replace function public.can_update_ticket_status(ticket_assigned_to text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_role() = 'admin'
    or lower(coalesce(ticket_assigned_to, '')) = any(public.current_user_assignment_keys());
$$;
