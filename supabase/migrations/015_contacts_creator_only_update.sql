-- Only the agent who captured a contact can edit it -- everyone else is
-- view-only (the read-all policy already covers that, unchanged). Replaces
-- the old "agent or creator" update policy, which let the assigned agent
-- edit a contact even if someone else captured it.
drop policy "Agent or creator can update contact" on contacts;

create policy "Only creator can update contact"
  on contacts for update
  to authenticated
  using (created_by = auth.uid() or created_by is null);
