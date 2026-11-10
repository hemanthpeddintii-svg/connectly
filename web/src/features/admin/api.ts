import { api } from '../../api'

export type DecisionKind = 'verification' | 'payment' | 'report'
export type Overview = {
  verificationsPending: number; paymentsPending: number; reportsOpen: number
  oldestWaiting: { verification: number | null; payment: number | null; report: number | null }
  recent: Array<{ kind: DecisionKind; member: { memberId: string; name: string }; decision: string; by: string; at: number }>
}
export type MemberRow = {
  memberId: string; name: string; age: number; email: string; gender: 'man' | 'woman' | null
  role: 'user' | 'admin'; status: string; requestCredits: number; joinedAt: number; suspended: boolean
}
export type MemberList = { total: number; items: MemberRow[] }
export type MemberQuery = { q: string; status: string; role: string; gender: string; limit: number; offset: number }
export type MemberDetail = {
  member: MemberRow & { city: string; lookingFor: string; rejectionReason: string | null }
  verifications: Array<{ id: string; status: string; reason: string | null; createdAt: number; reviewedAt: number | null }>
  payments: Array<{ id: string; planId: string; requests: number; amountPaise: number; status: string; reason: string | null; reference: string; createdAt: number }>
  audit: Array<{ id: string; action: string; detail: Record<string, unknown>; by: string; at: number }>
}
export type AdminSettings = {
  packs: Array<{ id: 'pack10' | 'pack20'; requests: number; amountPaise: number }>
  payee: { name: string | null; upiId: string | null }
  quickReasons: { verification: string[]; payment: string[] }
  // Beta controls. Assumed camelCase like the rest of this payload.
  inviteOnly?: boolean; betaFree?: boolean; betaFreeRequests?: number; capWomen?: number; capMen?: number; betaCity?: string
  supportEmail?: string; supportWhatsapp?: string
  payCapMen?: number; payCapRupees?: number
}
export type BetaMetrics = {
  members: { women: number; men: number; verifiedWomen: number; verifiedMen: number }
  returnedWeek2: { women: number; men: number }
  requests: { sent: number; accepted: number; declined: number; pending: number; acceptanceRate: number }
  friendsBrought: number
  priceInterest: { yes: number; no: number; maybe: number }
  caps: { women: number; men: number }
  gates: { women20: boolean; women30: boolean; acceptance20: boolean; acceptance30: boolean; friends10: boolean }
}
export type InviteRow = { code: string; label: string | null; maxUses: number | null; uses: number; owner: string | null; createdAt: number; campaign?: boolean }

export const adminApi = api
  .enhanceEndpoints({ addTagTypes: ['AdminReports', 'AdminOverview', 'AdminMembers', 'AdminSettings', 'AdminInvites'] })
  .injectEndpoints({
    endpoints: (b) => ({
      adminOverview: b.query<Overview, void>({
        query: () => 'admin/overview',
        providesTags: ['AdminOverview', 'AdminVerifications', 'AdminPayments', 'AdminReports'],
      }),
      adminMembers: b.query<MemberList, MemberQuery>({
        query: (p) => {
          const qs = new URLSearchParams()
          if (p.q) qs.set('q', p.q)
          if (p.status) qs.set('status', p.status)
          if (p.role) qs.set('role', p.role)
          if (p.gender) qs.set('gender', p.gender)
          qs.set('limit', String(p.limit)); qs.set('offset', String(p.offset))
          return `admin/members?${qs}`
        },
        providesTags: ['AdminMembers'],
      }),
      adminMember: b.query<MemberDetail, string>({
        query: (id) => `admin/members/${encodeURIComponent(id)}`,
        providesTags: ['AdminMembers', 'AdminVerifications', 'AdminPayments', 'AdminReports'],
      }),
      adjustCredits: b.mutation<{ requestCredits: number }, { memberId: string; delta: number; reason: string }>({
        query: ({ memberId, ...body }) => ({ url: `admin/members/${encodeURIComponent(memberId)}/credits`, method: 'POST', body }),
        invalidatesTags: ['AdminMembers', 'AdminOverview'],
      }),
      adminSettings: b.query<AdminSettings, void>({ query: () => 'admin/settings', providesTags: ['AdminSettings', 'AdminInvites'] }),
      betaMetrics: b.query<BetaMetrics, void>({ query: () => 'admin/metrics' }),
      adminInvites: b.query<InviteRow[], void>({
        query: () => 'admin/invites',
        transformResponse: (r: { codes: InviteRow[] }) => r.codes ?? [],
        providesTags: ['AdminInvites'],
      }),
      createInvites: b.mutation<{ codes: string[] }, { count: number; label?: string; maxUses?: number }>({
        query: (body) => ({ url: 'admin/invites', method: 'POST', body }),
        invalidatesTags: ['AdminInvites'],
      }),
      deleteInvite: b.mutation<{ ok: true }, string>({
        query: (code) => ({ url: `admin/invites/${encodeURIComponent(code)}`, method: 'DELETE' }),
        invalidatesTags: ['AdminInvites'],
      }),
      deleteUnusedInvites: b.mutation<{ deleted: number }, void>({
        query: () => ({ url: 'admin/invites/delete-unused', method: 'POST' }),
        invalidatesTags: ['AdminInvites'],
      }),
      saveAdminSettings: b.mutation<AdminSettings, AdminSettings>({
        query: (body) => ({ url: 'admin/settings', method: 'PUT', body }),
        invalidatesTags: ['AdminSettings'],
      }),
    }),
  })

export const {
  useAdminOverviewQuery, useAdminMembersQuery, useAdminMemberQuery, useAdjustCreditsMutation,
  useAdminSettingsQuery, useSaveAdminSettingsMutation, useBetaMetricsQuery, useAdminInvitesQuery, useCreateInvitesMutation,
  useDeleteInviteMutation, useDeleteUnusedInvitesMutation,
} = adminApi

/** Relative age for admin tables: "5 min ago", "3 h ago", "2 d ago". */
export function ago(ms: number | null | undefined, now = Date.now()) {
  if (!ms) return '—'
  const s = Math.max(0, Math.floor((now - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}
