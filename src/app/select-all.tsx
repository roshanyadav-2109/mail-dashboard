'use client'

import { useEffect, useRef, useState } from 'react'

// Multi-select for server-rendered tables. Row checkboxes may sit inside the bulk form or point at it with
// form="…" (needed when rows also have their own one-click forms), so everything goes through form.elements.

const boxesOf = (form: HTMLFormElement, name: string) =>
  [...form.elements].filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'checkbox' && el.name === name)

function useSelection(form: () => HTMLFormElement | null | undefined, name: string, onCount: (on: number, all: number) => void) {
  useEffect(() => {
    const f = form()
    if (!f) return
    const sync = () => {
      const boxes = boxesOf(f, name)
      onCount(boxes.filter((b) => b.checked).length, boxes.length)
    }
    const onChange = (e: Event) => {
      if ((e.target as HTMLInputElement | null)?.form === f) sync()
    }
    document.addEventListener('change', onChange)
    sync()
    return () => document.removeEventListener('change', onChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])
}

/** Header checkbox: ticks or clears every `name` checkbox of its form. Pass `form` when it sits outside the form. */
export function SelectAll({ name, form, label = 'Select all' }: { name: string; form?: string; label?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useSelection(
    () => ref.current?.form,
    name,
    (on, all) => {
      if (!ref.current) return
      ref.current.checked = on > 0 && on === all
      ref.current.indeterminate = on > 0 && on < all
    },
  )
  return (
    <input
      ref={ref}
      type="checkbox"
      form={form}
      aria-label={label}
      title={label}
      onChange={(e) => {
        const f = e.currentTarget.form
        if (!f) return
        const boxes = boxesOf(f, name)
        boxes.forEach((b) => (b.checked = e.currentTarget.checked))
        // Setting .checked fires no event; announce it once so the counters update.
        boxes[0]?.dispatchEvent(new Event('change', { bubbles: true }))
      }}
    />
  )
}

/** "N of M selected" bar; its buttons stay disabled until something is ticked. Must sit inside the bulk form. */
export function Selected({ children, total, name = 'email' }: { children: React.ReactNode; total: number; name?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(0)
  useSelection(() => ref.current?.closest('form'), name, (on) => setCount(on))
  return (
    <div ref={ref} className="bulk-bar">
      <span>
        <b>{count}</b> of {total} selected
      </span>
      <fieldset disabled={count === 0} className="bulk-actions">
        {children}
      </fieldset>
    </div>
  )
}
