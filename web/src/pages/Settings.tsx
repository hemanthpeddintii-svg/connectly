import Preferences from '../features/preferences/Preferences'
import Account from '../features/account/Account'
import PushToggle from '../features/push/PushToggle'
import BlockedUsers from '../features/safety/BlockedUsers'
import SecuritySettings from './SecuritySettings'

export default function Settings() {
  return (
    <div className="flex flex-col gap-6">
      <Preferences />
      <PushToggle />
      <BlockedUsers />
      <SecuritySettings />
      <Account />
    </div>
  )
}
