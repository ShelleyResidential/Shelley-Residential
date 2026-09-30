'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { input, select, btn, label as labelCls } from '@/lib/styles'
import { normalizeToE164, formatPhoneDisplay } from '@/lib/phone'

const DESIGNATIONS = [
  'Co-Founder', 'Head Transaction Coordinator', 'Transaction Coordinator', 'Partner',
  'Marketing Coordinator', 'Social Media Manager', 'Interior Designer',
  'Field Support Assistant', 'Financial Manager',
]
const PP_STATUSES = ['Candidate Property Practitioner', 'Property Practitioner', 'Principal Property Practitioner']
const PP_QUALIFICATIONS = ['NQF4', 'NQF5']

// The actual fields + save logic, shared by the desktop inline collapse
// (SettingsPage) and the dedicated mobile page (settings/professional) --
// each fetches and saves independently rather than passing state down,
// since they're never both mounted at the same time.
export function ProfessionalDetailsForm() {
  const [userId, setUserId]                     = useState<string | null>(null)
  const [phoneNumber, setPhoneNumber]           = useState('')
  const [designation, setDesignation]           = useState('')
  const [ppStatus, setPpStatus]                 = useState('')
  const [ppQualification, setPpQualification]   = useState('')
  const [ffcNumber, setFfcNumber]               = useState('')
  const [saving, setSaving]                     = useState(false)
  const [saved, setSaved]                       = useState(false)
  const [saveError, setSaveError]               = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return
      setUserId(data.user.id)
      supabase.from('profiles')
        .select('phone_number, designation, property_practitioner_status, property_practitioner_qualification, ffc_number')
        .eq('id', data.user.id).single().then(({ data: profile }) => {
          // Stored as E.164, shown as the familiar local format -- typing
          // it back in on save gets re-normalized either way.
          setPhoneNumber(profile?.phone_number ? formatPhoneDisplay(profile.phone_number) : '')
          setDesignation(profile?.designation ?? '')
          setPpStatus(profile?.property_practitioner_status ?? '')
          setPpQualification(profile?.property_practitioner_qualification ?? '')
          setFfcNumber(profile?.ffc_number ?? '')
        })
    })
  }, [])

  async function saveProfile() {
    if (!userId) return
    if (!designation) { setSaveError('Designation is required'); return }
    const normalizedPhone = phoneNumber.trim() ? normalizeToE164(phoneNumber.trim()) : null
    if (phoneNumber.trim() && !normalizedPhone) {
      setSaveError("That doesn't look like a valid phone number.")
      return
    }
    setSaving(true)
    setSaveError('')
    const { error } = await supabase.from('profiles')
      .update({
        phone_number:                          normalizedPhone,
        designation,
        property_practitioner_status:          ppStatus || null,
        property_practitioner_qualification:   ppQualification || null,
        ffc_number:                            ffcNumber.trim() || null,
      })
      .eq('id', userId)
    if (error) { setSaveError(error.message); setSaving(false); return }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className={labelCls}>Phone Number</label>
          <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
            placeholder="e.g. 082 123 4567" className={input} />
        </div>
        <div>
          <label className={labelCls}>Designation *</label>
          <select value={designation} onChange={e => setDesignation(e.target.value)} className={select}>
            <option value="">—</option>
            {DESIGNATIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>FFC Number</label>
          <input value={ffcNumber} onChange={e => setFfcNumber(e.target.value)}
            placeholder="e.g. 2024/123456" className={input} />
        </div>
        <div>
          <label className={labelCls}>Property Practitioner Status</label>
          <select value={ppStatus} onChange={e => setPpStatus(e.target.value)} className={select}>
            <option value="">—</option>
            {PP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Property Practitioner Qualification</label>
          <select value={ppQualification} onChange={e => setPpQualification(e.target.value)} className={select}>
            <option value="">—</option>
            {PP_QUALIFICATIONS.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
      </div>
      {saveError && <p className="text-sm text-red-500 mb-3">{saveError}</p>}
      <button onClick={saveProfile} disabled={saving} className={btn.primary}>
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
      </button>
    </div>
  )
}
