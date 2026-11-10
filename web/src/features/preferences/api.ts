import { api } from '../../api'

export type Preferences = { minAge: number | null; maxAge: number | null; interests: string[]; city: string; languages: string[] }

export const preferencesApi = api.injectEndpoints({
  endpoints: (b) => ({
    preferences: b.query<Preferences, void>({ query: () => 'preferences' }),
    savePreferences: b.mutation<Preferences, Preferences>({
      query: (body) => ({ url: 'preferences', method: 'PUT', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled
          dispatch(preferencesApi.util.upsertQueryData('preferences', undefined, data))
        } catch { /* the component shows the error */ }
      },
      invalidatesTags: ['Wall'],
    }),
    clearPreferences: b.mutation<Preferences, void>({
      query: () => ({ url: 'preferences', method: 'DELETE' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled
          dispatch(preferencesApi.util.upsertQueryData('preferences', undefined, data))
        } catch { /* the component shows the error */ }
      },
      invalidatesTags: ['Wall'],
    }),
  }),
})

export const { usePreferencesQuery, useSavePreferencesMutation, useClearPreferencesMutation } = preferencesApi
