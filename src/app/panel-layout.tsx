'use client'

import { useState } from 'react'

import Icon from './icons'
import PageHead from './page-head'

/**
 * Page header + one main area + a collapsible right-hand panel for secondary forms and settings.
 * The panel toggle sits in the header next to the page's main action, so it takes no extra row.
 */
export default function PanelLayout({
  title,
  description,
  back,
  actions,
  main,
  panel,
  panelLabel,
  panelTitle,
  defaultOpen = false,
}: {
  title: string
  description?: string
  back?: { href: string; name: string }
  actions?: React.ReactNode
  main: React.ReactNode
  panel: React.ReactNode
  panelLabel: string
  panelTitle: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <>
      <PageHead
        title={title}
        description={description}
        back={back}
        actions={
          <>
            <button type="button" className="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              <Icon name="panel" size={16} />
              {panelLabel}
            </button>
            {actions}
          </>
        }
      />
      <div className="workspace">
        <div className="ws-main">{main}</div>
        {open && (
          <aside className="ws-panel">
            <div className="ws-panel-head">
              <h2>{panelTitle}</h2>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close panel">
                ×
              </button>
            </div>
            <div className="ws-panel-body">{panel}</div>
          </aside>
        )}
      </div>
    </>
  )
}
