// Option lists for the Inspection tab -- shared between the (client) tab UI
// and (server) Inspection Form PDF generation, so the printed wording can
// never drift from what the app itself shows. Moved out of the 'use client'
// evaluations/[id]/page.tsx so server-only code (inspection-form.ts) can
// import it without pulling a client page into the server bundle.

export const PATIO_OPTIONS     = ['Covered', 'Open / Sundeck', 'Fully Enclosed', 'Large', 'Epic']
export const SECURITY_OPTIONS  = ['Standard', 'CCTV', 'Electric Fencing']
export const CONDITION_ITEMS   = ['Flooring', 'Windows / Doors', 'Flow / Layout', 'Architecture']
export const ADDITIONAL_OPTS   = ['Water Storage / Filtration', 'Storeroom', 'Solar Panels', 'Inverter', 'Batteries']

// Architecture reads better as a style judgement ("Notable"/"Standard")
// than the generic "Good"/"Poor" every other General Condition item uses --
// the underlying stored value is still 'good'/'poor' either way.
export function conditionLabel(item: string, value: 'good' | 'poor'): string {
  if (item === 'Architecture') return value === 'good' ? 'Notable' : 'Standard'
  return value === 'good' ? 'Good' : 'Poor'
}

export const ROAD_LEVEL_OPTS      = [{ value: 'above_road_level', label: 'Above Road Level' }, { value: 'on_road_level', label: 'On Road Level' }, { value: 'below_road_level', label: 'Below Road Level' }]
export const LAND_SIZE_OPTS       = [{ value: 'subdivisible', label: 'Subdivisible' }, { value: 'not_subdivisible', label: 'Not Subdivisible' }]
export const GATE_FENCING_OPTS    = [{ value: 'auto_gate', label: 'Auto Gate' }, { value: 'fully_fenced_walled', label: 'Fully Fenced/Walled' }, { value: 'none', label: 'None' }]
export const GARAGE_DESC_OPTS     = [{ value: 'tandem', label: 'Tandem' }]
export const PARKING_OPTS         = [{ value: '2_cars', label: '2 Cars' }, { value: '3_9_cars', label: '3-9 Cars' }, { value: '10_plus_cars', label: '10+ Cars' }]
export const SIZE_OPTS            = [{ value: 'large', label: 'Large' }, { value: 'medium', label: 'Medium' }, { value: 'small', label: 'Small' }]
export const GARDEN_DESC_OPTS     = [{ value: 'level', label: 'Level' }, { value: 'slope_terrace', label: 'Slope/Terrace' }]
export const GOOD_POOR_OPTS       = [{ value: 'good', label: 'Good' }, { value: 'poor', label: 'Poor' }]
export const FINISH_OPTS          = [{ value: 'modern', label: 'Modern' }, { value: 'neat', label: 'Neat' }, { value: 'outdated', label: 'Outdated' }]
export const KITCHEN_POS_OPTS     = [{ value: 'open_plan', label: 'Open Plan' }, { value: 'down_passage', label: 'Down Passage' }, { value: 'separate', label: 'Separate' }]
export const RECEPTION_TYPE_OPTS  = [{ value: 'pub', label: 'Pub' }, { value: 'gym', label: 'Gym' }, { value: 'library', label: 'Library' }, { value: 'other', label: 'Other' }]
export const STUDY_TYPE_OPTS      = [{ value: 'nook', label: 'Nook' }, { value: 'separate_room', label: 'Separate Room' }]
export const FLATLET_BED_OPTS     = [{ value: 'studio', label: 'Studio' }, { value: 'one_bed', label: '1 Bedroom' }, { value: 'two_bed', label: '2 Bedroom' }]

export const optLabel = (opts: { value: string; label: string }[], v: string | null | undefined) =>
  opts.find(o => o.value === v)?.label ?? '—'
