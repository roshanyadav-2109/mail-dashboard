'use client'

import Icon from './icons'

/** Big search field on the home page; opens the Ctrl+K palette. */
export default function SearchTrigger() {
  return (
    <div className="hero-search">
      <button type="button" onClick={() => window.dispatchEvent(new Event('open-palette'))}>
        <Icon name="search" />
        <span>Search</span>
        <span className="kbds">
          <kbd>Ctrl</kbd>
          <kbd>K</kbd>
        </span>
      </button>
    </div>
  )
}
