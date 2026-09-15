const GMAIL_INBOX_LABEL_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX'

// The INBOX label's own metadata carries messagesUnread directly -- far
// cheaper than paging through users.messages.list?q=is:unread just to
// count them.
export async function getUnreadInboxCount(accessToken: string) {
  const res = await fetch(GMAIL_INBOX_LABEL_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const json = await res.json()
  if (json.error) {
    return { count: null as number | null, error: { message: json.error.message, code: res.status } }
  }
  return { count: (json.messagesUnread ?? 0) as number, error: undefined as { message: string; code?: number } | undefined }
}
