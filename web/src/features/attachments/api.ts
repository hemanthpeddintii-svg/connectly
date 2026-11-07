import { api, type Message } from '../../api'

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
  }),
})

export const { useSendAttachmentMutation } = attachmentsApi
