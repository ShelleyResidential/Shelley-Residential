// Hardcoded evaluation form option lists, shared between the New Evaluation
// form and the Evaluation Details edit form so both stay in sync and edited
// records can be matched back against the same labels.

export const LEAD_SOURCES = [
  { value: 'google',                 label: 'Google' },
  { value: 'social_media',           label: 'Social Media' },
  { value: 'property_portal',        label: 'Property Portal' },
  { value: 'signage_boards',         label: 'Signage / Boards' },
  { value: 'print_flyer_letter',     label: 'Print Flyer or Letter' },
  { value: 'community_promo_event',  label: 'Community / Promo Event' },
  { value: 'office_phone_in',        label: 'Office Phone-In' },
  { value: 'website',                label: 'Website' },
  { value: 'past_client',            label: 'Past Client' },
  { value: 'referral',               label: 'Referral' },
  { value: 'personal_network',       label: 'Personal Network' },
  { value: 'professional_network',   label: 'Professional Network' },
  { value: 'other',                  label: 'Other (please specify)' },
]

export const REFERRAL_TYPES = [
  { value: 'friend',                                  label: 'Friend' },
  { value: 'family_member',                           label: 'Family Member' },
  { value: 'neighbour',                               label: 'Neighbour' },
  { value: 'past_shelley_client',                     label: 'Past Shelley Client' },
  { value: 'estate_agent',                            label: 'Estate Agent' },
  { value: 'attorney',                                label: 'Attorney' },
  { value: 'bond_originator',                         label: 'Bond Originator' },
  { value: 'financial_adviser',                       label: 'Financial Adviser' },
  { value: 'builder_contractor',                       label: 'Builder / Contractor' },
  { value: 'interior_designer',                       label: 'Interior Designer' },
  { value: 'community_group_resident_association',    label: 'Community Group / Resident Association' },
  { value: 'other',                                   label: 'Other (please specify)' },
]

export const MOTIVATIONS = [
  { value: 'upsizing',                    label: 'Upsizing' },
  { value: 'downsizing',                  label: 'Downsizing' },
  { value: 'relocating',                  label: 'Relocating' },
  { value: 'emigration',                  label: 'Emigration' },
  { value: 'lifestyle_change',            label: 'Lifestyle Change' },
  { value: 'retirement',                  label: 'Retirement' },
  { value: 'financial_reasons',           label: 'Financial Reasons' },
  { value: 'investment_decision',         label: 'Investment Decision' },
  { value: 'divorce_separation',          label: 'Divorce / Separation' },
  { value: 'deceased_estate',             label: 'Deceased Estate' },
  { value: 'not_selling_evaluation_only', label: 'Not Selling, Evaluation Only' },
  { value: 'other',                       label: 'Other (please specify)' },
]

export const TIMELINES = [
  { value: 'already_listed',    label: 'Already listed' },
  { value: 'ready_now',         label: 'Ready to list now' },
  { value: 'within_30_days',    label: 'Within the next 30 days' },
  { value: 'within_3_months',   label: 'Within the next 3 months' },
  { value: 'within_6_months',   label: 'Within the next 6 months' },
  { value: 'within_12_months',  label: 'Within the next 12 months' },
  { value: 'no_fixed_timeline', label: 'No fixed timeline – planning ahead' },
  { value: 'just_curious',      label: "Just curious about home's value" },
]

export const REASONS_LOST = [
  { value: 'evaluation_price',  label: 'Evaluation Price' },
  { value: 'commission',        label: 'Commission' },
  { value: 'mandate_terms',     label: 'Mandate Terms' },
  { value: 'agency_size',       label: 'Agency Size' },
  { value: 'not_mls_member',    label: 'Not an MLS Member' },
  { value: 'another_agency',    label: 'Another Agency' },
  { value: 'not_selling',       label: 'Not Selling' },
  { value: 'other',             label: 'Other (please specify)' },
]

export const CONTACT_TAGS = ['Seller', 'Attorney', 'Managing Agent', 'Tenant']
