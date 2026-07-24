'use client'

import Link from 'next/link'

export type Crumb = { label: string; href?: string }

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="flex items-center flex-wrap gap-1.5 text-sm mb-4">
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-gray-300">&gt;</span>}
            {item.href && !isLast ? (
              <Link href={item.href} className="text-gray-400 hover:text-[#1a1a1a] transition-colors">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? 'text-[#1a1a1a] font-medium' : 'text-gray-400'}>
                {item.label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
