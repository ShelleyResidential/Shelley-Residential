'use client'

import Link from 'next/link'
import { ProfessionalDetailsForm } from '../ProfessionalDetailsForm'

function BackArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M11 4L6 9L11 14" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Mobile-only destination for Settings' "Professional Details" -- on
// desktop that same section stays an inline collapse (see SettingsPage),
// but on a phone a dropdown pushed the rest of the account page down
// awkwardly, so tapping it navigates here instead.
export default function ProfessionalDetailsPage() {
  return (
    <div className="p-4 md:p-10">
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/dashboard/settings"
          aria-label="Back to Settings"
          className="w-9 h-9 rounded-full bg-[#1a1a1a] flex items-center justify-center flex-shrink-0"
        >
          <BackArrowIcon />
        </Link>
        <h1 className="text-lg sm:text-2xl font-bold text-[#1a1a1a]">Professional Details</h1>
      </div>

      <div className="max-w-2xl">
        <ProfessionalDetailsForm />
      </div>
    </div>
  )
}
