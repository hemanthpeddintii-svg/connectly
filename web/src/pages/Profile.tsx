import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { api, authSlice, useMeQuery, useUpdateMeMutation } from '../api'
import { unsubscribeThisDevice } from '../features/push/unsubscribe'
import { plural } from '../format'
import { btnPrimary, card, field } from '../ui'
import Monogram from '../components/Monogram'
import RealPerson from '../components/Badge'
import { Loading } from '../components/State'
import { ChevronIcon } from '../components/icons'

const row = 'flex min-h-14 items-center justify-between rounded-[22px] bg-white px-5 text-[15px] font-semibold'

export default function Profile() {
  const { data: me, isLoading } = useMeQuery()
  const [update, { isLoading: saving, isSuccess }] = useUpdateMeMutation()
  const dispatch = useDispatch()
  const nav = useNavigate()
  const [error, setError] = useState('')
  if (isLoading || !me) return <Loading />

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
  function logout() {
    const token = localStorage.getItem('token')
    if (token) void unsubscribeThisDevice(token)
    dispatch(authSlice.actions.setToken(null))
    dispatch(api.util.resetApiState())
    nav('/login', { replace: true })
  }
  return (
    <div className="flex flex-col gap-4 pb-4">
      <h1 className="pt-2 font-display text-[28px] font-semibold leading-tight">My profile</h1>
      <form key={me.name + me.bio} onSubmit={submit} className={`${card} flex flex-col gap-3`}>
        <div className="flex items-center gap-4">
          <Monogram name={me.name} size={64} />
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl font-semibold">{me.name}, {me.age}</h2>
            {me.status === 'active' && <RealPerson />}
          </div>
        </div>
        <p className="text-[13px] text-slate">Your ID: <code>{me.bumpId}</code> · {me.email}</p>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Name
          <input name="name" defaultValue={me.name} required className={`${field} font-normal`} /></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">About me
          <textarea name="bio" defaultValue={me.bio} rows={4} maxLength={500} className={`${field} font-normal`} /></label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">Interests (comma separated)
          <input name="interests" defaultValue={me.interests.join(', ')} className={`${field} font-normal`} /></label>
        {error && <p role="alert" className="text-sm text-ember-deep">{error}</p>}
        {isSuccess && !error && <p role="status" className="text-sm text-verified">Saved.</p>}
        <button disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save'}</button>
      </form>
      {me.gender === 'man' && (
        <>
          <Link to="/membership" className={row}><span><b>{plural(me.requestCredits, 'request')}</b> · Get more</span><ChevronIcon size={20} /></Link>
          <Link to="/sent" className={row}>Requests you've sent<ChevronIcon size={20} /></Link>
        </>
      )}
      <Link to="/settings" className={row}>Settings<ChevronIcon size={20} /></Link>
      {me.role === 'admin' && <Link to="/admin" className={row}>Admin<ChevronIcon size={20} /></Link>}
      <button type="button" onClick={logout} className="h-12 rounded-full border border-stone-300 text-base font-semibold">Log out</button>
      <p className="text-center text-[13px] text-slate">Members see your monogram, never a photo.</p>
    </div>
  )
}
