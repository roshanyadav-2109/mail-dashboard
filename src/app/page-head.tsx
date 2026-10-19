import Link from 'next/link'

/** Standard page header: breadcrumb, title, description and optional right-aligned actions. */
export default function PageHead({
  title,
  description,
  crumbs,
  actions,
}: {
  title: string
  description?: string
  crumbs?: { href?: string; name: string }[]
  actions?: React.ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        {crumbs && (
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={c.name}>
                {i > 0 && ' / '}
                {c.href ? <Link href={c.href}>{c.name}</Link> : c.name}
              </span>
            ))}
          </div>
        )}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  )
}
