import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react'
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type Profile = { bumpId: string; name: string; age: number; bio: string; interests: string[] }
export type UserStatus = 'unverified' | 'pending' | 'active' | 'rejected' | 'deleted'
export type Me = Profile & { email: string; status: UserStatus; role: 'user' | 'admin'; rejectionReason: string | null; membershipExpiresAt: number | null; isMember: boolean }
export type VerificationStatus = 'pending' | 'approved' | 'rejected'
export type AdminVerification = {
  id: string; status: VerificationStatus; reason: string | null; createdAt: number; reviewedAt: number | null
  user: { bumpId: string; name: string; age: number; email: string }
}
export type Plan = { id: string; name: string; amountPaise: number; days: number }
export type PlansResponse = { plans: Plan[]; payment: { payeeName: string | null; upiId: string | null; currency: string } }
export type Payment = {
  id: string; planId: string; amountPaise: number; days: number; reference: string
  status: VerificationStatus; reason: string | null; createdAt: number; reviewedAt: number | null
}
export type AdminPayment = Payment & { user: { bumpId: string; name: string; email: string } }
export type Connection = { id: string; createdAt: number; profile: Profile }
export type Message = {
  id: string; mine: boolean; kind: 'text' | 'image' | 'voice'; body: string
  attachmentMime: string | null; attachmentDurationMs: number | null; createdAt: number
}
type AuthResult = { token: string; user: Me }

const TOKEN_KEY = 'token'
export const readToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export const authSlice = createSlice({
  name: 'auth',
  initialState: { token: readToken() as string | null },
  reducers: {
    setToken(state, a: PayloadAction<string | null>) {
      state.token = a.payload
      try {
        if (a.payload) localStorage.setItem(TOKEN_KEY, a.payload)
        else localStorage.removeItem(TOKEN_KEY)
      } catch { /* storage unavailable: session-only */ }
    },
  },
})

const rawBaseQuery = fetchBaseQuery({
  baseUrl: '/v0',
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as { auth: { token: string | null } }).auth.token
    if (token) headers.set('authorization', `Bearer ${token}`)
    return headers
  },
})

// A 401 while holding a token means the session was revoked or expired: drop it so the app returns to sign-in.
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, queryApi, extra) => {
  const result = await rawBaseQuery(args, queryApi, extra)
  if (result.error?.status === 401 && (queryApi.getState() as { auth: { token: string | null } }).auth.token) {
    queryApi.dispatch(authSlice.actions.setToken(null))
  }
  return result
}

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: ['Me', 'Wall', 'Connections', 'Messages', 'AdminVerifications', 'Payments', 'AdminPayments'],
  endpoints: (b) => ({
    login: b.mutation<AuthResult, { email: string; password: string }>({
      query: (body) => ({ url: 'login', method: 'POST', body }),
    }),
    forgotPassword: b.mutation<{ ok: true }, { email: string }>({
      query: (body) => ({ url: 'password/forgot', method: 'POST', body }),
    }),
    resetPassword: b.mutation<{ ok: true }, { token: string; newPassword: string }>({
      query: (body) => ({ url: 'password/reset', method: 'POST', body }),
    }),
    changePassword: b.mutation<AuthResult, { currentPassword: string; newPassword: string }>({
      query: (body) => ({ url: 'password/change', method: 'POST', body }),
      // Other sessions were revoked server-side; adopt the fresh token so this device stays signed in.
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try { dispatch(authSlice.actions.setToken((await queryFulfilled).data.token)) } catch { /* surfaced by the caller */ }
      },
    }),
    logoutAll: b.mutation<{ ok: true }, void>({
      query: () => ({ url: 'logout-all', method: 'POST' }),
    }),
    signup: b.mutation<AuthResult, { email: string; password: string; name: string; age: number; bio?: string; interests?: string[] }>({
      query: (body) => ({ url: 'signup', method: 'POST', body }),
    }),
    me: b.query<Me, void>({ query: () => 'me', providesTags: ['Me'] }),
    updateMe: b.mutation<Me, Partial<Pick<Me, 'name' | 'bio' | 'interests'>>>({
      query: (body) => ({ url: 'me', method: 'PATCH', body }),
      invalidatesTags: ['Me'],
    }),
    submitVerification: b.mutation<{ status: 'pending' }, FormData>({
      query: (body) => ({ url: 'verification', method: 'POST', body }),
      invalidatesTags: ['Me'],
    }),
    adminVerifications: b.query<AdminVerification[], VerificationStatus>({
      query: (status) => `admin/verifications?status=${status}`,
      providesTags: ['AdminVerifications'],
    }),
    decideVerification: b.mutation<{ ok: true }, { id: string; decision: 'approve' } | { id: string; decision: 'reject'; reason: string }>({
      query: ({ id, ...body }) => ({ url: `admin/verifications/${id}/decision`, method: 'POST', body }),
      invalidatesTags: ['AdminVerifications'],
    }),
    plans: b.query<PlansResponse, void>({ query: () => 'membership/plans' }),
    myPayments: b.query<Payment[], void>({ query: () => 'payments/mine', providesTags: ['Payments'] }),
    submitPayment: b.mutation<{ status: 'pending' }, FormData>({
      query: (body) => ({ url: 'payments', method: 'POST', body }),
      invalidatesTags: ['Payments'],
    }),
    adminPayments: b.query<AdminPayment[], VerificationStatus>({
      query: (status) => `admin/payments?status=${status}`,
      providesTags: ['AdminPayments'],
    }),
    decidePayment: b.mutation<{ ok: true }, { id: string; decision: 'approve' } | { id: string; decision: 'reject'; reason: string }>({
      query: ({ id, ...body }) => ({ url: `admin/payments/${id}/decision`, method: 'POST', body }),
      invalidatesTags: ['AdminPayments', 'Me'],
    }),
    wall: b.query<Profile[], void>({ query: () => 'profiles', providesTags: ['Wall'] }),
    act: b.mutation<{ matched: boolean; connectionId?: string }, { bumpId: string; action: 'like' | 'skip' }>({
      query: (body) => ({ url: 'actions', method: 'POST', body }),
      invalidatesTags: ['Wall', 'Connections'],
    }),
    connections: b.query<Connection[], void>({ query: () => 'connections', providesTags: ['Connections'] }),
    messages: b.query<Message[], string>({
      query: (id) => `connections/${id}/messages`,
      providesTags: (_r, _e, id) => [{ type: 'Messages', id }],
    }),
    sendMessage: b.mutation<Message, { id: string; body: string }>({
      query: ({ id, body }) => ({ url: `connections/${id}/messages`, method: 'POST', body: { body } }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Messages', id: a.id }],
    }),
  }),
})

export const {
  useLoginMutation, useSignupMutation, useForgotPasswordMutation, useResetPasswordMutation, useChangePasswordMutation, useLogoutAllMutation, useMeQuery, useUpdateMeMutation, useWallQuery,
  useActMutation, useConnectionsQuery, useSubmitVerificationMutation, usePlansQuery, useMyPaymentsQuery, useSubmitPaymentMutation, useAdminPaymentsQuery, useDecidePaymentMutation, useAdminVerificationsQuery, useDecideVerificationMutation, useMessagesQuery, useSendMessageMutation,
} = api
