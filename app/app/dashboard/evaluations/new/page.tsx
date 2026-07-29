'use client'

import { Suspense } from 'react'
import { Breadcrumbs } from '@/lib/Breadcrumbs'
import { EvaluationForm } from '../EvaluationForm'

export default function NewEvaluationPage() {
  return (
    <Suspense fallback={<div className="p-10 max-w-4xl" />}>
      <div className="p-10 max-w-4xl">
        <Breadcrumbs items={[{ label: 'Analyse' }, { label: 'Evaluations', href: '/dashboard/evaluations' }, { label: 'New Evaluation' }]} />
        <h1 className="text-2xl font-bold text-[#1a1a1a] mb-8">New Evaluation</h1>
        <EvaluationForm />
      </div>
    </Suspense>
  )
}
