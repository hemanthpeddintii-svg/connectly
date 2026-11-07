import PageHeader from '../components/PageHeader'

const items = [
  ['Be kind', 'Write to people the way you would like to be written to. Honest and gentle is always welcome.'],
  ['Respect a no', "Not now is a complete answer. Do not push, repeat or send a new request to change someone's mind."],
  ['Protect your details', 'Keep your phone number, address and workplace to yourself until you truly trust someone. Never send money.'],
  ['Meet safely', 'Meet in a public place, tell a friend where you are going, and plan your own way home.'],
  ['Report concerns', 'If something feels wrong, report the member or block them. They are never told who reported them.'],
]

export default function Guidelines() {
  return (
    <div className="flex flex-col gap-4 pb-4">
      <PageHeader title="Community guidelines" back="/settings" backLabel="Back to settings" />
      <p className="text-[15px] text-slate">Five habits that keep this community safe.</p>
      <ul className="flex flex-col gap-3">
        {items.map(([t, d]) => (
          <li key={t} className="rounded-3xl bg-white p-4"><h2 className="text-base font-semibold">{t}</h2><p className="mt-1 text-[15px] text-slate">{d}</p></li>
        ))}
      </ul>
    </div>
  )
}
