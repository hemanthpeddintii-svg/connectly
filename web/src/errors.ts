/** Turns an auth-related API error into a message a person can act on. */
export function authErrorMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  const e = err as { status?: number; data?: { error?: string; retryAfterSeconds?: number; issues?: { message?: string }[] } }
  const code = e?.data?.error
  const tooCommon = e?.data?.issues?.some((i) => i.message === 'password_too_common')
  if (code === 'too_many_attempts' || e?.status === 429) {
    const mins = e?.data?.retryAfterSeconds ? Math.max(1, Math.ceil(e.data.retryAfterSeconds / 60)) : null
    return mins ? `Too many attempts. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.` : 'Too many attempts. Please wait a bit and try again.'
  }
  if (code === 'invalid_credentials') return 'Wrong email or password.'
  if (code === 'wrong_password') return 'Your current password is incorrect.'
  if (code === 'same_password') return 'Choose a password different from your current one.'
  if (code === 'email_taken') return 'That email is already registered.'
  if (code === 'invalid_or_expired_token') return 'This reset link is invalid or has expired. Request a new one.'
  if (code === 'invite_invalid') return 'That invite code is not valid, or it has already been used. Ask the person who invited you for a new one.'
  if (code === 'invalid_input') {
    return tooCommon
      ? 'That password is too common. Choose something harder to guess.'
      : 'Check your details (password needs 8+ characters, age 18+).'
  }
  return fallback
}
