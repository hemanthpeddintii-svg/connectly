# Sending email (Gmail, for testing)

Connectly sends sign-up, password-reset and request notification emails over SMTP. For local testing a personal Gmail account works. Do not use it for real users.

## 1. Enable 2-Step Verification
Google Account -> Security -> "2-Step Verification" -> turn it on. App Passwords are not offered without it.

## 2. Create an App Password
Google Account -> Security -> "App passwords" (search for it if you do not see it). Name it "Connectly" and copy the 16-character password Google shows once.

## 3. Configure
Copy `api/.env.example` to `api/.env` (git-ignored) and fill in:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<your gmail address>
SMTP_PASS=<16-char app password>
MAIL_FROM="Connectly <your gmail address>"
```

`npm run dev` and `npm start` in `api/` load `api/.env` automatically. Never commit it or paste the password anywhere else.

## 4. Test it
Start the API, then request a password reset for an account whose email is yours (or sign up with it):

```
curl -X POST http://localhost:4000/v0/password/forgot -H 'content-type: application/json' -d '{"email":"you@gmail.com"}'
```

Check your inbox (and spam). Adjust the port/path to your API; with no SMTP settings the email is printed in the server log instead.

## Limits
Gmail allows roughly 500 messages per day and may throttle or block automated sending. It is for testing only.

## Production
Use a transactional provider (Amazon SES, Postmark, SendGrid, Resend, Mailgun) with a verified sending domain (SPF, DKIM, DMARC). They all expose SMTP: set the same `SMTP_*` variables to the provider's values. In production, if no SMTP is configured, mail is dropped with a warning and contents are never logged.
