'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { card, btn, input, select, sectionTitle, label as labelCls } from '@/lib/styles'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

const DESIGNATIONS = [
  'Co-Founder', 'Head Transaction Coordinator', 'Transaction Coordinator', 'Partner',
  'Marketing Coordinator', 'Social Media Manager', 'Interior Designer',
  'Field Support Assistant', 'Financial Manager',
]
const PP_STATUSES = ['Candidate Property Practitioner', 'Property Practitioner', 'Principal Property Practitioner']
const PP_QUALIFICATIONS = ['NQF4', 'NQF5']

export default function SettingsPage() {
  const router = useRouter()
  const [userId, setUserId]       = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const [fullName, setFullName]   = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  const [phoneNumber, setPhoneNumber] = useState('')
  const [designation, setDesignation]           = useState('')
  const [ppStatus, setPpStatus]                 = useState('')
  const [ppQualification, setPpQualification]   = useState('')
  const [ffcNumber, setFfcNumber]               = useState('')
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [saveError, setSaveError]     = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      const meta = data.user.user_metadata ?? {}
      setUserId(data.user.id)
      setUserEmail(data.user.email ?? '')
      setFullName(meta.full_name ?? meta.name ?? '')
      setAvatarUrl(meta.avatar_url ?? meta.picture ?? null)

      supabase.from('profiles')
        .select('phone_number, designation, property_practitioner_status, property_practitioner_qualification, ffc_number')
        .eq('id', data.user.id).single().then(({ data: profile }) => {
          setPhoneNumber(profile?.phone_number ?? '')
          setDesignation(profile?.designation ?? '')
          setPpStatus(profile?.property_practitioner_status ?? '')
          setPpQualification(profile?.property_practitioner_qualification ?? '')
          setFfcNumber(profile?.ffc_number ?? '')
        })
    })
  }, [router])

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  async function saveProfile() {
    if (!userId) return
    if (!designation) { setSaveError('Designation is required'); return }
    setSaving(true)
    setSaveError('')
    const { error } = await supabase.from('profiles')
      .update({
        phone_number:                          phoneNumber.trim() || null,
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
    <div className="p-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-[#1a1a1a]">Settings</h1>
        <button onClick={signOut} className={btn.danger}>
          Sign out
        </button>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Account */}
        <div className={`${card} p-6`}>
          <h3 className={sectionTitle}>Account</h3>
          <div className="flex items-center gap-4 mb-5">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={fullName || userEmail}
                width={56}
                height={56}
                referrerPolicy="no-referrer"
                className="w-14 h-14 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[#E8266F] text-white flex items-center justify-center text-lg font-bold flex-shrink-0">
                {(fullName || userEmail).charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-[#1a1a1a] font-semibold">{fullName || '—'}</p>
              <p className="text-sm text-gray-400">{userEmail}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div>
              <span className={labelCls}>Full Name</span>
              <p className="text-[#1a1a1a] font-medium">{fullName || '—'}</p>
            </div>
            <div>
              <span className={labelCls}>Email</span>
              <p className="text-[#1a1a1a] font-medium">{userEmail}</p>
            </div>
          </div>
        </div>

        {/* Professional Details -- used on generated documents like the
            evaluation Cover Letter (designation + phone under your name). */}
        <div className={`${card} p-6`}>
          <h3 className={sectionTitle}>Professional Details</h3>
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
      </div>
    </div>
  )
}
