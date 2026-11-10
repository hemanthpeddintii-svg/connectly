/** One shared wording for why men pay a fee. Do not put prices here. */
export const FEE_REASON =
  'Joining and browsing are free. A small platform maintenance fee applies only when a man wants to send a request to connect with someone. It helps cover running the platform and reviewing members. Women use the community free.'

export const FEE_REASON_BETA =
  'Joining and browsing are free. A small platform maintenance fee applies only when a man wants to send a request to connect with someone, and it is free during the closed beta. It helps cover running the platform and reviewing members. Women use the community free.'

export const FEE_REASON_SHORT = 'A small platform maintenance fee applies only when a man sends a request to connect. Women use the community free.'
export const FEE_REASON_SHORT_BETA = 'A small platform maintenance fee applies only when a man sends a request to connect. It is free during the closed beta. Women use the community free.'

export const feeReason = (betaFree?: boolean) => (betaFree ? FEE_REASON_BETA : FEE_REASON)
export const feeReasonShort = (betaFree?: boolean) => (betaFree ? FEE_REASON_SHORT_BETA : FEE_REASON_SHORT)

export const DELETED_AFTER_REVIEW = 'Both files are deleted once the review is decided.'
