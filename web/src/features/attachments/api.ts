import { api, type Message } from '../../api'

export type AttachmentQuota = { imagesRemaining: number; resetsAt: number | null }

export const attachmentsApi = api.injectEndpoints({
  endpoints: (b) => ({
    sendAttachment: b.mutation<Message, { connectionId: string; file: Blob; filename: string; durationMs?: number }>({
      query: ({ connectionId, file, filename, durationMs }) => {
        const body = new FormData()
        if (durationMs !== undefined) body.set('durationMs', String(durationMs))
        body.set('file', file, filename)
        return { url: `connections/${connectionId}/attachments`, method: 'POST', body }
      },
      invalidatesTags: (_r, _e, a) => [{ type: 'Messages', id: a.connectionId }],
    }),
    attachmentQuota: b.query<AttachmentQuota, string>({
      query: (connectionId) => `connections/${connectionId}/attachments/quota`,
      // Refetched together with the message list, so it follows every photo sent or received.
      providesTags: (_r, _e, id) => [{ type: 'Messages', id }],
    }),
  }),
})

export const { useSendAttachmentMutation, useAttachmentQuotaQuery } = attachmentsApi
