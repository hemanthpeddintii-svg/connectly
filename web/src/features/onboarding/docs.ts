export type LegalDoc = { slug: 'terms' | 'privacy' | 'refunds'; title: string; blurb: string; sections: { h: string; p: string }[] }

/** Shown as "Updated …" on each legal page. Change it together with TERMS_VERSION in the API when the text changes. */
export const LEGAL_UPDATED = '11 November 2026'

export const DRAFT_NOTE = 'DRAFT PLACEHOLDER. The owner must replace this with legal text reviewed by a qualified lawyer before launch.'

export const LEGAL_DOCS: LegalDoc[] = [
  {
    slug: 'terms', title: 'Terms of use', blurb: 'How the community works.',
    sections: [
      { h: 'Who can join', p: 'You must be 18 or over, use your own real details, and keep one account.' },
      { h: 'How requests work', p: 'Men send a request with a short note. Women can accept, or say not now. A "not now" is a full answer.' },
      { h: 'Behaviour', p: 'Be kind and honest. Harassment, pressure, sending money requests or sharing someone else\'s details leads to removal.' },
      { h: 'What verified means', p: 'Verified means a person on our team looked at a selfie and listened to a voice clip. It is not a background check. We do not check documents or records, and we do not guarantee who any member is or how they will behave. You are responsible for your own decisions about who to talk to and whether to meet.' },
      { h: 'Meeting people', p: 'Meeting someone you found here is your choice and your risk. Read the Staying safe page first. Never send money to another member. [REPLACE WITH REVIEWED TEXT, INCLUDING LIMITS ON OUR LIABILITY]' },
      { h: 'Our right to act', p: 'We may suspend or remove accounts that break these terms. [REPLACE WITH REVIEWED TEXT]' },
    ],
  },
  {
    slug: 'privacy', title: 'Privacy policy', blurb: 'What we keep, and who sees it.',
    sections: [
      { h: 'What we keep', p: 'Your account details, profile, messages, and the selfie and voice clip you send for verification. Our team deletes the selfie and voice clip once your review is decided, whether approved or rejected.' },
      { h: 'Who sees what', p: 'Members see your first name, age, city, about me, looking for and interests. Your selfie and voice clip are only ever seen by our review team and are never shown to members. Both files are deleted once the review is decided.' },
      { h: 'Your choices', p: 'You can deactivate or delete your account from Settings. [REPLACE WITH REVIEWED TEXT, INCLUDING RETENTION PERIODS AND CONTACT DETAILS]' },
    ],
  },
  {
    slug: 'refunds', title: 'Refund policy', blurb: 'Request packs and payments.',
    sections: [
      { h: 'In short', p: 'A request is used once she answers. If nobody answers within 14 days, it is returned to your balance automatically. Selfies and voice clips are never shown to members.' },
      { h: 'Packs', p: 'A pack adds requests to your balance. Each request sent uses one, and it comes back if nobody answers within 14 days. Packs do not expire.' },
      { h: 'Rejected payments', p: 'If we cannot match a payment, we tell you why and you can submit the details again or contact support. [REPLACE WITH REVIEWED TEXT]' },
    ],
  },
]
