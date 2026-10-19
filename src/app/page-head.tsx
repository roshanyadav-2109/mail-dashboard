import Link from 'next/link'

/** Standard page header: breadcrumb, title, description and optional right-aligned actions. */
export default function PageHead({
  title,
  description,
  back,
  actions,
}: {
  title: string
  description?: string
  back?: { href: string; name: string }
  actions?: React.ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        {back && (
          <Link className="back" href={back.href}>
            ← {back.name}
          </Link>
        )}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  )
}
