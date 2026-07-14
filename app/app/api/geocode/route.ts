import { NextRequest, NextResponse } from 'next/server'
import { geocodeAddress } from '@/lib/geocode'

export async function POST(request: NextRequest) {
  const { address } = await request.json()
  if (!address || typeof address !== 'string') {
    return NextResponse.json({ error: 'Missing address.' }, { status: 400 })
  }

  const result = await geocodeAddress(address)
  if (!result) {
    return NextResponse.json({ error: 'Could not geocode address.' }, { status: 404 })
  }

  return NextResponse.json(result)
}
