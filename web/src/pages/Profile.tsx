import { useState, type FormEvent } from 'react'
import { useMeQuery, useUpdateMeMutation } from '../api'

export default function Profile() {
  const { data: me, isLoading } = useMeQuery()
  const [update, { isLoading: saving, isSuccess }] = useUpdateMeMutation()
  const [error, setError] = useState('')
  if (isLoading || !me) return <p className="text-stone-500">Loading…</p>

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const f = new FormData(e.currentTarget)
    try {
      await update({
        name: String(f.get('name')),
        bio: String(f.get('bio')),
        interests: String(f.get('interests')).split(',').map((s) => s.trim()).filter(Boolean),
      }).unwrap()
    } catch { setError('Could not save your profile.') }
  }
  const field = 'w-full rounded-md border border-stone-300 bg-white px-3 py-2 outline-none focus:border-stone-900'
  return (
    <form key={me.name + me.bio} onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-stone-500">Your ID: <code>{me.bumpId}</code> · {me.email}</p>
      <input name="name" defaultValue={me.name} required className={field} />
      <textarea name="bio" defaultValue={me.bio} rows={4} maxLength={500} placeholder="About you" className={field} />
      <input name="interests" defaultValue={me.interests.join(', ')} placeholder="Interests (comma separated)" className={field} />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {isSuccess && !error && <p role="status" className="text-sm text-emerald-700">Saved.</p>}
      <button disabled={saving} className="self-start rounded-md bg-stone-900 px-4 py-2 text-white disabled:opacity-50">Save</button>
    </form>
  )
}
