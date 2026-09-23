do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'field photos read for board members'
  ) then
    create policy "field photos read for board members" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'field-photos'
        and private.can_read_board(((storage.foldername(name))[1])::uuid)
      );
  end if;
end $$;