export const DOCUMENTS_BUCKET = 'evaluation-documents'

export const REPORT_TYPES = [
  { key: 'property_report', label: 'Property Report' },
  { key: 'ss_report',       label: 'SS Report' },
  { key: 'suburb_report',   label: 'Suburb Report' },
] as const

export type ReportType = typeof REPORT_TYPES[number]['key']
