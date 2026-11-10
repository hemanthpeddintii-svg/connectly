import { api } from '../../api'

export type Stage = 'prepare' | 'free_beta' | 'gate_ready' | 'paid_test'
export type MilestoneGroup = 'women' | 'quality' | 'legal' | 'safety' | 'ops'
export type MilestoneItem = {
  key: string; label: string; kind: 'auto' | 'manual'; group: MilestoneGroup
  done: boolean; detail: string; note: string | null; doneAt: string | null
}
export type Launch = {
  stage: Stage; betaStartedAt: string | null; day: number | null; paidTestEarliest: string | null
  items: MilestoneItem[]; next: { key: string; label: string } | null; doneCount: number; total: number
}
type GM = { women: number; men: number; total: number }
export type UsersOverview = {
  active: { d1: GM; d7: GM; d30: GM }
  byStatus: Record<string, number>
  signupsPerDay: Array<{ day: string; count: number }>
  funnel: Array<{ key: string; step: string; count: number }>
  sources: {
    byKind: { campaign: number; member: number; batch: number; direct: number }
    batches: Array<{ label: string; uses: number; verified: number }>
    topInviters: Array<{ memberId: string; friends: number; verified: number }>
  }
}
export type Campaign = {
  id: string; name: string; platform: string; topic: string | null; notes: string | null
  costPaise: number | null; postedAt: string | null; code: string
  clicks: number; signups: number; verified: number; women: number; men: number
  costPerVerifiedPaise: number | null; createdAt: string
}
export type CampaignInput = { name: string; platform: string; topic?: string; notes?: string; costPaise?: number; postedAt?: string }
export type Growth = {
  byPlatform: Array<{ platform: string; campaigns: number; clicks: number; signups: number; verified: number; women: number; men: number }>
  byWeekday: Array<{ weekday: number; signups: number; verifiedWomen: number }>
  waitlist: { total: number; byCity: Array<{ city: string; count: number }>; byGender: { women: number; men: number; other: number } }
}
export type Waitlist = {
  total: number; byCity: Array<{ city: string; count: number }>; byGender: { women: number; men: number; other: number }
  recent: Array<{ email: string; city: string | null; gender: string | null; source: string | null; createdAt: string }>
}
export type Health = {
  marketplace: {
    requests: { sent: number; accepted: number; declined: number; pending: number; acceptanceRate: number }
    medianReplyHours: number | null; womenWithUnanswered: number; menZeroAccepted: number
    chatsStarted: number; messagesPerChat: number; voiceMessages: number
    retention: { week1: { women: number; men: number }; week2: { women: number; men: number } }
  }
  safety: { openReports: number; repeatReported: number; medianReportResponseHours: number | null; suspended: number; blocks: number; deletionRequests: number }
  money: { pending: number; approved: number; rejected: number; revenuePaise: number; refundedPaise: number; capPaise: number | null; capMen: number | null; paidMen: number }
  alerts: Array<{ level: 'warn' | 'info'; key: string; text: string }>
}

export const launchApi = api
  .enhanceEndpoints({ addTagTypes: ['AdminLaunch', 'AdminCampaigns', 'AdminGrowth', 'AdminWaitlist'] })
  .injectEndpoints({
    endpoints: (b) => ({
      adminLaunch: b.query<Launch, void>({ query: () => 'admin/launch', providesTags: ['AdminLaunch'] }),
      setMilestone: b.mutation<MilestoneItem, { key: string; done: boolean; note?: string }>({
        query: ({ key, ...body }) => ({ url: `admin/milestones/${encodeURIComponent(key)}`, method: 'PUT', body }),
        invalidatesTags: ['AdminLaunch'],
      }),
      saveLaunch: b.mutation<Launch, { betaStartedAt: string | null; paidTest?: boolean }>({
        query: (body) => ({ url: 'admin/launch', method: 'PUT', body }),
        invalidatesTags: ['AdminLaunch'],
      }),
      usersOverview: b.query<UsersOverview, void>({ query: () => 'admin/users-overview' }),
      adminHealth: b.query<Health, void>({ query: () => 'admin/health' }),
      adminCampaigns: b.query<{ campaigns: Campaign[] }, void>({ query: () => 'admin/campaigns', providesTags: ['AdminCampaigns'] }),
      createCampaign: b.mutation<Campaign, CampaignInput>({
        query: (body) => ({ url: 'admin/campaigns', method: 'POST', body }),
        invalidatesTags: ['AdminCampaigns', 'AdminGrowth'],
      }),
      updateCampaign: b.mutation<Campaign, { id: string } & Partial<CampaignInput>>({
        query: ({ id, ...body }) => ({ url: `admin/campaigns/${encodeURIComponent(id)}`, method: 'PATCH', body }),
        invalidatesTags: ['AdminCampaigns', 'AdminGrowth'],
      }),
      deleteCampaign: b.mutation<{ ok: true }, string>({
        query: (id) => ({ url: `admin/campaigns/${encodeURIComponent(id)}`, method: 'DELETE' }),
        invalidatesTags: ['AdminCampaigns', 'AdminGrowth'],
      }),
      adminGrowth: b.query<Growth, void>({ query: () => 'admin/growth', providesTags: ['AdminGrowth', 'AdminCampaigns'] }),
      adminWaitlist: b.query<Waitlist, void>({ query: () => 'admin/waitlist', providesTags: ['AdminWaitlist'] }),
      trackClick: b.mutation<void, { code: string }>({ query: (body) => ({ url: 'track/click', method: 'POST', body }) }),
      joinWaitlist: b.mutation<{ ok: true }, { email: string; city?: string; gender?: 'woman' | 'man' | 'other'; source?: string }>({
        query: (body) => ({ url: 'waitlist', method: 'POST', body }),
        invalidatesTags: ['AdminWaitlist'],
      }),
    }),
  })

export const {
  useAdminLaunchQuery, useSetMilestoneMutation, useSaveLaunchMutation, useUsersOverviewQuery, useAdminHealthQuery,
  useAdminCampaignsQuery, useCreateCampaignMutation, useUpdateCampaignMutation, useDeleteCampaignMutation,
  useAdminGrowthQuery, useAdminWaitlistQuery, useTrackClickMutation, useJoinWaitlistMutation,
} = launchApi

export const PLATFORMS = ['Instagram', 'YouTube', 'WhatsApp', 'X', 'LinkedIn', 'Facebook', 'Reddit', 'Telegram', 'Other'] as const
export const inr = (paise: number | null | undefined) => (paise == null ? '—' : `₹${Math.round(paise / 100).toLocaleString('en-IN')}`)
export const shareLink = (code: string) => `${window.location.origin}/signup?invite=${encodeURIComponent(code)}`
export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
