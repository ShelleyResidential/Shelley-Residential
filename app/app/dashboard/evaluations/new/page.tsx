'use client'

import { Suspense } from 'react'
import { Breadcrumbs } from '@/lib/Breadcrumbs'
import { EvaluationForm } from '../EvaluationForm'

export default function NewEvaluationPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f8f7f4]" />}>
      <div className="bg-[#f8f7f4] min-h-screen">
        <main className="max-w-2xl mx-auto px-4 py-10">
          <Breadcrumbs items={[{ label: 'Analyse' }, { label: 'Evaluations', href: '/dashboard/evaluations' }, { label: 'New Evaluation' }]} />
          <h1 className="text-2xl font-bold text-[#1a1a1a] mb-8">New Evaluation</h1>
          <EvaluationForm />
        </main>
      </div>
    </Suspense>
  )
}
