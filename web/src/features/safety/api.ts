import { api } from '../../api'

export type ReportReason = 'fake_profile' | 'harassment' | 'inappropriate_content' | 'spam' | 'underage' | 'other'
export type ReportStatus = 'open' | 'actioned' | 'dismissed'
export type BlockedMember = { bumpId: string; name: string; age: number }
export type AdminReport = {
  report: { id: string; reason: ReportReason; details: string | null; status: ReportStatus; note: string | null; createdAt: number; reviewedAt: number | null }
  reporter: { bumpId: string; name: string }
  reported: { bumpId: string; name: string; age: number; email: string; suspended: boolean; openReportCount: number }
}
export type ReportDecision = { id: string; decision: 'dismiss'; note?: string } | { id: string; decision: 'action'; note: string; suspend: boolean }

export const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'fake_profile', label: 'Fake profile' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'spam', label: 'Spam' },
  { value: 'underage', label: 'Appears underage' },
  { value: 'other', label: 'Something else' },
]
export const reasonLabel = (r: ReportReason) => REASONS.find((x) => x.value === r)?.label ?? r

export const safetyApi = api.enhanceEndpoints({ addTagTypes: ['Blocks', 'AdminReports'] }).injectEndpoints({
  endpoints: (b) => ({
    blocks: b.query<BlockedMember[], void>({ query: () => 'blocks', providesTags: ['Blocks'] }),
    blockMember: b.mutation<{ ok: true }, string>({
      query: (bumpId) => ({ url: 'blocks', method: 'POST', body: { bumpId } }),
      invalidatesTags: ['Wall', 'Connections', 'Blocks'],
    }),
    unblockMember: b.mutation<{ ok: true }, string>({
      query: (bumpId) => ({ url: `blocks/${encodeURIComponent(bumpId)}`, method: 'DELETE' }),
      invalidatesTags: ['Wall', 'Connections', 'Blocks'],
    }),
    reportMember: b.mutation<{ ok: true }, { bumpId: string; reason: ReportReason; details?: string }>({
      query: (body) => ({ url: 'reports', method: 'POST', body }),
      invalidatesTags: ['AdminReports'],
    }),
    adminReports: b.query<AdminReport[], ReportStatus>({
      query: (status) => `admin/reports?status=${status}`,
      providesTags: ['AdminReports'],
    }),
    decideReport: b.mutation<{ ok: true }, ReportDecision>({
      query: ({ id, ...body }) => ({ url: `admin/reports/${id}/decision`, method: 'POST', body }),
      invalidatesTags: ['AdminReports'],
    }),
    liftSuspension: b.mutation<{ ok: true }, string>({
      query: (bumpId) => ({ url: `admin/suspensions/${encodeURIComponent(bumpId)}/lift`, method: 'POST' }),
      invalidatesTags: ['AdminReports'],
    }),
  }),
})

export const {
  useBlocksQuery, useBlockMemberMutation, useUnblockMemberMutation, useReportMemberMutation,
  useAdminReportsQuery, useDecideReportMutation, useLiftSuspensionMutation,
} = safetyApi
