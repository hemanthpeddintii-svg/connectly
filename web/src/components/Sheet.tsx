import { useEffect, useId, useRef, type ReactNode } from 'react'

/** A bottom sheet built on a modal <dialog>, so focus is trapped and Escape closes it. */
export default function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onClick={(e) => { if (e.target === ref.current) onClose() }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto w-full max-w-md rounded-t-[28px] bg-white p-6 pb-8 text-ink backdrop:bg-ink/50 open:flex open:flex-col open:gap-3"
    >
      <span aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-stone-300" />
      <h2 id={titleId} className="font-display text-[22px] font-semibold">{title}</h2>
      {children}
    </dialog>
  )
}
