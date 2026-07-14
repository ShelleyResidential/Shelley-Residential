type AddressComponent = { long_name: string; short_name: string; types: string[] }

type GeocodeResult = {
  street_number: string | null
  route: string | null
  suburb: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  google_place_id: string | null
  formatted_address: string | null
}

function extractComponent(components: AddressComponent[], type: string): string | null {
  const match = components.find(c => c.types.includes(type))
  return match ? match.long_name : null
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&components=country:ZA&region=za&key=${apiKey}`
  const res = await fetch(url)
  const json = await res.json()

  if (json.status !== 'OK' || !json.results?.[0]) return null

  const result = json.results[0]
  const components: AddressComponent[] = result.address_components ?? []

  return {
    street_number: extractComponent(components, 'street_number'),
    route:         extractComponent(components, 'route'),
    suburb:        extractComponent(components, 'sublocality') ?? extractComponent(components, 'sublocality_level_1') ?? extractComponent(components, 'neighborhood'),
    city:          extractComponent(components, 'locality') ?? extractComponent(components, 'administrative_area_level_2'),
    province:      extractComponent(components, 'administrative_area_level_1'),
    postal_code:   extractComponent(components, 'postal_code'),
    country:       extractComponent(components, 'country'),
    latitude:      result.geometry?.location?.lat ?? null,
    longitude:     result.geometry?.location?.lng ?? null,
    google_place_id: result.place_id ?? null,
    formatted_address: result.formatted_address ?? null,
  }
}
