import { api } from '../../api'

export type AccountState = {
  /** Epoch ms when quiet mode ends; null when off. QUIET_FOREVER means "until turned off". */
  quietUntil: number | null
  deactivated: boolean
  deleteRequestedAt: number | null
  deletionDueAt: number | null
}

/** The API's sentinel for quiet mode without an end date (the largest JavaScript Date). */
export const QUIET_FOREVER = 8_640_000_000_000_000

// Every mutation returns the new state, which is written straight into the cached query. Wall and
// Connections are invalidated because quiet mode and deactivation change what other members see.
const changesState = {
  invalidatesTags: ['Wall', 'Connections'] as ('Wall' | 'Connections')[],
  async onQueryStarted(_arg: unknown, { dispatch, queryFulfilled }: { dispatch: (action: any) => unknown; queryFulfilled: Promise<{ data: AccountState }> }) {
    try {
      const { data } = await queryFulfilled
      dispatch(accountApi.util.updateQueryData('account', undefined, () => data))
    } catch { /* the component shows the error */ }
  },
}

export const accountApi = api.injectEndpoints({
  endpoints: (b) => ({
    account: b.query<AccountState, void>({ query: () => 'account' }),
    turnOnQuietMode: b.mutation<AccountState, { hours?: number }>({
      query: (body) => ({ url: 'account/quiet-mode', method: 'POST', body }), ...changesState,
    }),
    turnOffQuietMode: b.mutation<AccountState, void>({
      query: () => ({ url: 'account/quiet-mode', method: 'DELETE' }), ...changesState,
    }),
    deactivate: b.mutation<AccountState, void>({
      query: () => ({ url: 'account/deactivate', method: 'POST', body: {} }), ...changesState,
    }),
    reactivate: b.mutation<AccountState, void>({
      query: () => ({ url: 'account/deactivate', method: 'DELETE' }), ...changesState,
    }),
    requestDeletion: b.mutation<AccountState, { reason?: string }>({
      query: (body) => ({ url: 'account/delete-request', method: 'POST', body }), ...changesState,
    }),
    cancelDeletion: b.mutation<AccountState, void>({
      query: () => ({ url: 'account/delete-request', method: 'DELETE' }), ...changesState,
    }),
  }),
})

export const {
  useAccountQuery, useTurnOnQuietModeMutation, useTurnOffQuietModeMutation, useDeactivateMutation,
  useReactivateMutation, useRequestDeletionMutation, useCancelDeletionMutation,
} = accountApi
