import * as webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()

console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
console.log('VAPID_SUBJECT=mailto:you@example.com')
console.log(`
Set these three variables in the API's environment to enable Web Push.
Replace VAPID_SUBJECT with a contact mailto: or https: URL you control.
Keep VAPID_PRIVATE_KEY secret. Changing the pair invalidates every existing browser subscription.`)
