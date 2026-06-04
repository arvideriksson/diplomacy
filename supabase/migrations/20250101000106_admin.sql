-- Admin functions (server-side enforcement)
-- Update the admin email list here if you add more admins

create or replace function public.is_admin()
returns boolean as $$
begin
  return (
    select email = any(array['arvid.f.eriksson@gmail.com'])
    from auth.users
    where id = auth.uid()
  );
end;
$$ language plpgsql security definer stable;

create or replace function public.admin_delete_all_games()
returns int as $$
declare
  deleted int;
begin
  if not public.is_admin() then
    raise exception 'Unauthorized: admin access required';
  end if;

  delete from public.games where true;
  get diagnostics deleted = row_count;
  return deleted;
end;
$$ language plpgsql security definer;
