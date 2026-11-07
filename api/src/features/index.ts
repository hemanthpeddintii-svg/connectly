import type { FastifyInstance } from 'fastify'
import { preferencesRoutes } from './preferences.ts'
import { safetyRoutes } from './safety.ts'
import { accountRoutes } from './account.ts'
import { attachmentRoutes } from './attachments.ts'
import { pushRoutes } from './push.ts'

export async function featureRoutes(app: FastifyInstance) {
  await app.register(preferencesRoutes)
  await app.register(safetyRoutes)
  await app.register(accountRoutes)
  await app.register(attachmentRoutes)
  await app.register(pushRoutes)
}
