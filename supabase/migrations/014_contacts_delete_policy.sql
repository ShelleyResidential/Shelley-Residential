-- 014_contacts_delete_policy.sql
-- contacts had no DELETE policy at all, so the Delete button on the
-- Contact Details page (gated client-side to luke@shelley.co.za via
-- lib/permissions.ts canDelete()) was silently blocked by RLS for
-- everyone, including that admin account. Add a matching DELETE policy
-- so the one account the app already trusts to delete can actually do so.

CREATE POLICY "Admin can delete contacts"
  ON contacts FOR DELETE
  TO authenticated
  USING (lower(auth.jwt() ->> 'email') = 'luke@shelley.co.za');
