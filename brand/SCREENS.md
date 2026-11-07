# Connectly screen inventory

Design canvas: https://claude.ai/artifact/S1B2srbD5ZN2wrVU1oUFwi (56 boards). Status: updated after the request-flow and phase-2 builds. Everything below is now built in the app (reviewed in a browser: request flow, admin overview, verification case, members, member detail, signup, welcome) EXCEPT where noted here: the designs for Install-the-app and the notification list are still missing; legal text is a DRAFT placeholder; the Chats list has last-message and unread, but a woman only hears about a request by email or push if SMTP and push keys are configured; voice recording, push and the service worker are untested on a real phone.

- **Designed**: a board exists on the canvas (not yet visually reviewed by the team).
- **App today**: what the running app has. "Old model" means it exists but is built for like/skip/match and time-based membership, so it needs rework for request/accept and request packs.

Product model these screens assume: no profile photos; men send requests with a note, women accept or say not now; packs of 10 requests for ₹499 and 20 for ₹899; chat is free after acceptance and is text and voice only; manual UPI payment proof reviewed by an admin.

## Onboarding and sign-in
| Screen | Designed | App today |
| --- | --- | --- |
| Welcome | yes | no (goes straight to log in) |
| Create account (with man/woman choice) | yes | partly: no gender choice, no agreement |
| Log in / locked state | yes | built (lockout message exists) |
| Forgot password / email sent / reset | yes | built |
| Community values and terms | yes | no |
| About you (city, about, looking for) | yes | partly: profile has name, bio, interests only |
| Interests | yes | built inside profile edit |
| Verification: under review / not approved | yes | built (inside the Verify page) |

## Member journeys
| Screen | Designed | App today |
| --- | --- | --- |
| Community card (men) | yes | old model (wall with like/skip) |
| Send request (with note) | yes | no |
| Request sent | yes | no |
| Requests you've sent | yes | no |
| Out of requests | yes | no |
| Get requests (packs) | yes | old model (time-based membership) |
| Payment under review / history | yes | partly: history exists, pack wording does not |
| Requests inbox (women) / empty | yes | no |
| Request detail (women) | yes | no |
| Not now: confirm | yes | no |
| Accepted: come in | yes | old model (match screen is a banner) |
| Filters | yes | built (in Settings) |
| All caught up | yes | built |
| Chats list / empty | yes | built / partly |
| Chat | yes | built (still has image attachments) |
| Chat: recording | yes | built (voice recording exists, untested on a device) |

## Profile, settings and safety
| Screen | Designed | App today |
| --- | --- | --- |
| My profile / edit | yes | built |
| Settings hub | yes | built as one long page |
| Notifications | yes | built (needs a production build to work) |
| Quiet mode | yes | built |
| Blocked members | yes | built |
| Report a member | yes | built (wall and connections only) |
| Chat options (block, report) | yes | no (not available inside chat) |
| Security (change password, sign out everywhere) | yes | built |
| Deactivate or delete | yes | built |
| Community guidelines | yes | no |
| Help and support | yes | no |
| Terms, privacy, refunds | yes | no |

## Admin console (desktop)
| Screen | Designed | App today |
| --- | --- | --- |
| Overview | yes | no |
| Verifications queue and case | yes | queue built as cards (no separate case page) |
| Payments queue and case | yes | queue built as cards, old pack wording |
| Reports queue and case | yes | queue built as cards |
| Members list | yes | no (no member-list endpoint yet) |
| Member detail (balance adjustment, suspend) | yes | no |
| Settings (packs, payee, quick reasons) | yes | no (prices live in code) |

## Not designed yet (known gaps)
- Install-the-app prompt and a push permission explainer.
- Rate-limit and network error states beyond the login lockout.
- Photo-free "report a bug" and in-app feedback.
- Member-facing notification list (what arrives while offline).
- Anything for members who are neither men nor women. The model assumes two roles; this is a product decision to make.

## Review flags
- Copy invented by the design agents (signup agreement wording, verification checks list, the reset page's sign-out line) needs your review.
- Terms, privacy, refund and guidelines links are placeholders.
- Sample names, counts, references and dates are placeholders.
- Heights on the busiest screens were estimated, not measured; check the signup, verify-pending, security and guidelines screens first for clipping.
