// Deleting Evaluations, Contacts, and Properties is restricted to a single
// admin account while the team is still cleaning up test/mock data.
const CAN_DELETE_EMAIL = 'luke@shelley.co.za'

export function canDelete(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase() === CAN_DELETE_EMAIL
}
