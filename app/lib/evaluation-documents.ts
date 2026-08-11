export const DOCUMENTS_BUCKET = 'evaluation-documents'

export const REPORT_TYPES = [
  { key: 'property_report', label: 'Property Report' },
  { key: 'ss_report',       label: 'SS Report' },
  { key: 'suburb_report',   label: 'Suburb Report' },
] as const

// System-generated (not user-uploaded) -- rendered under its own "Forms"
// section with Generate/Regenerate instead of an upload control.
export const FORM_TYPES = [
  { key: 'cover_letter', label: 'Cover Letter' },
] as const

export type ReportType = typeof REPORT_TYPES[number]['key']
export type FormType   = typeof FORM_TYPES[number]['key']
