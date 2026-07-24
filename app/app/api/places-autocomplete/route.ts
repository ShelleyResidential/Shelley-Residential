import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { input } = await request.json()
  if (!input || typeof input !== 'string' || input.trim().length < 3) {
    return NextResponse.json({ predictions: [] })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return NextResponse.json({ predictions: [] })

  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:za&key=${apiKey}`
  const res = await fetch(url)
  const json = await res.json()

  if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
    return NextResponse.json({ predictions: [], error: json.error_message ?? json.status }, { status: 502 })
  }

  const predictions = (json.predictions ?? []).map((p: { place_id: string; description: string }) => ({
    place_id: p.place_id,
    description: p.description,
  }))

  return NextResponse.json({ predictions })
}
