/** A soft background wash that follows the Indian seasons. It never changes the logo, only the light behind it. */
export type Season = 'summer' | 'monsoon' | 'festive' | 'winter'

export function seasonOf(date = new Date()): Season {
  const m = date.getMonth() // 0 = January
  if (m >= 2 && m <= 4) return 'summer'
  if (m >= 5 && m <= 8) return 'monsoon'
  if (m >= 9 && m <= 10) return 'festive'
  return 'winter'
}

const WASH: Record<Season, string> = {
  summer: '#F7EBCF',
  monsoon: '#DCEAEF',
  festive: '#FBE6D2',
  winter: '#E8E6F1',
}

/** A radial wash for the top of a page, fading into the paper colour. */
export const seasonWash = (date = new Date()) =>
  `radial-gradient(60% 55% at 78% 8%, ${WASH[seasonOf(date)]} 0%, rgba(250,247,241,0) 70%)`
