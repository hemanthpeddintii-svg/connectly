import type { FastifyInstance } from 'fastify'
import { preferencesRoutes } from './preferences.ts'
import { safetyRoutes } from './safety.ts'
import { accountRoutes } from './account.ts'
import { attachmentRoutes } from './attachments.ts'
import { pushRoutes } from './push.ts'
import { betaRoutes } from './beta.ts'
import { trackingRoutes } from './tracking.ts'

export async function featureRoutes(app: FastifyInstance) {
  await app.register(preferencesRoutes)
  await app.register(safetyRoutes)
  await app.register(accountRoutes)
  await app.register(attachmentRoutes)
  await app.register(pushRoutes)
  await app.register(betaRoutes)
  await app.register(trackingRoutes)
}
