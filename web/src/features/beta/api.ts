import { api } from '../../api'

export type PublicConfig = { inviteOnly: boolean; betaFree: boolean; betaCity: string; supportEmail?: string; supportWhatsapp?: string }
export type MyInvite = { code: string; friendsBrought: number }
export type PriceAnswer = 'yes' | 'no' | 'maybe'

export const betaApi = api
  .enhanceEndpoints({ addTagTypes: ['Invite'] })
  .injectEndpoints({
    endpoints: (b) => ({
      publicConfig: b.query<PublicConfig, void>({ query: () => 'public-config' }),
      myInvite: b.query<MyInvite, void>({ query: () => 'me/invite', providesTags: ['Invite'] }),
      priceInterest: b.mutation<{ ok: true }, { answer: PriceAnswer }>({
        query: (body) => ({ url: 'me/price-interest', method: 'POST', body }),
        invalidatesTags: ['Me'],
      }),
    }),
  })

export const { usePublicConfigQuery, useMyInviteQuery, usePriceInterestMutation } = betaApi

/** Friendly text for a failed gender choice. Returns null when the error is not a full beta. */
export function betaFullMessage(err: unknown, city: string | undefined): string | null {
  const e = err as { status?: number; data?: { error?: string } }
  if (e?.data?.error !== 'beta_full') return null
  return `The beta is full in ${city || 'your city'} right now. You're on the waitlist, and we'll let you know when a place opens up.`
}
