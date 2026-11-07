import { api } from '../../api'

export type PushConfig = { enabled: boolean; publicKey: string | null }
export type PushSubscriptionBody = { endpoint: string; keys: { p256dh: string; auth: string } }

export const pushApi = api.injectEndpoints({
  endpoints: (b) => ({
    pushConfig: b.query<PushConfig, void>({ query: () => 'push/config' }),
    subscribePush: b.mutation<{ ok: true }, PushSubscriptionBody>({
      query: (body) => ({ url: 'push/subscriptions', method: 'POST', body }),
    }),
    unsubscribePush: b.mutation<{ ok: true; removed: number }, { endpoint: string } | { all: true }>({
      query: (body) => ({ url: 'push/subscriptions', method: 'DELETE', body }),
    }),
  }),
})

export const { usePushConfigQuery, useSubscribePushMutation, useUnsubscribePushMutation } = pushApi
