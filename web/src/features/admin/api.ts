import { api } from '../../api'

export type DecisionKind = 'verification' | 'payment' | 'report'
export type Overview = {
  verificationsPending: number; paymentsPending: number; reportsOpen: number
  oldestWaiting: { verification: number | null; payment: number | null; report: number | null }
  recent: Array<{ kind: DecisionKind; member: { bumpId: string; name: string }; decision: string; by: string; at: number }>
}
export type MemberRow = {
  bumpId: string; name: string; age: number; email: string; gender: 'man' | 'woman' | null
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
}

export const adminApi = api
  .enhanceEndpoints({ addTagTypes: ['AdminReports', 'AdminOverview', 'AdminMembers', 'AdminSettings'] })
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
      adjustCredits: b.mutation<{ requestCredits: number }, { bumpId: string; delta: number; reason: string }>({
        query: ({ bumpId, ...body }) => ({ url: `admin/members/${encodeURIComponent(bumpId)}/credits`, method: 'POST', body }),
        invalidatesTags: ['AdminMembers', 'AdminOverview'],
      }),
      adminSettings: b.query<AdminSettings, void>({ query: () => 'admin/settings', providesTags: ['AdminSettings'] }),
      saveAdminSettings: b.mutation<AdminSettings, AdminSettings>({
        query: (body) => ({ url: 'admin/settings', method: 'PUT', body }),
        invalidatesTags: ['AdminSettings'],
      }),
    }),
  })

export const {
  useAdminOverviewQuery, useAdminMembersQuery, useAdminMemberQuery, useAdjustCreditsMutation,
  useAdminSettingsQuery, useSaveAdminSettingsMutation,
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
