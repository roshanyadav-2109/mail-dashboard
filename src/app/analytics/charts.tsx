'use client'

import { useEffect, useRef, useState } from 'react'

// Validated categorical slots (dataviz reference palette, light surface): blue, then orange.
const SERIES = ['#2a78d6', '#eb6834']
const GRID = '#ececea'
const AXIS_TEXT = '#6b6b67'
const H = 220
const PAD = { top: 16, right: 56, bottom: 28, left: 40 }

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const niceMax = (v: number) => {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!
}
const short = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

type Tip = { x: number; y: number; lines: string[] } | null

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.lines.map((l, i) => (
        <div key={i} className={i === 0 ? 'tip-title' : ''}>
          {l}
        </div>
      ))}
    </div>
  )
}

/** Single-series bar chart (emails sent per day). The title names the series, so there's no legend. */
export function BarChart({ data }: { data: { day: string; value: number; detail: string }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<Tip>(null)
  const max = niceMax(Math.max(...data.map((d) => d.value), 0))
  const innerW = Math.max(0, width - PAD.left - PAD.right + 40)
  const innerH = H - PAD.top - PAD.bottom
  const slot = data.length ? innerW / data.length : 0
  const barW = Math.max(2, Math.min(28, slot - 2)) // 2px surface gap between bars
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64)))

  return (
    <div ref={ref} className="chart">
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Emails sent per day">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={width - 16} y1={y(max * f)} y2={y(max * f)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 8} y={y(max * f)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT}>
                {Math.round(max * f)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD.left + i * slot + (slot - barW) / 2
            const top = y(d.value)
            const h = Math.max(0, PAD.top + innerH - top)
            const r = Math.min(4, barW / 2, h)
            return (
              <g key={d.day}>
                {h > 0 && (
                  <path
                    d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`}
                    fill={SERIES[0]}
                  />
                )}
                {/* Hit target taller and wider than the bar */}
                <rect
                  x={PAD.left + i * slot}
                  y={PAD.top}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setTip({ x: Math.min(x + barW / 2, width - 150), y: Math.max(8, top - 56), lines: [short(d.day), `${d.value} sent`, d.detail] })}
                  onMouseLeave={() => setTip(null)}
                />
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>
                    {short(d.day)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  )
}

/** Two-series line chart of rates (same unit, one axis), with a legend, end labels and a crosshair tooltip. */
export function RateChart({ data, series }: { data: { day: string; values: (number | null)[] }[]; series: string[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(...data.flatMap((d) => d.values.map((v) => v ?? 0)), 0.01))
  const innerW = Math.max(0, width - PAD.left - PAD.right)
  const innerH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (data.length > 1 ? (i / (data.length - 1)) * innerW : innerW / 2)
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH
  const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64)))

  const path = (s: number) => {
    let d = ''
    let pen = false
    data.forEach((p, i) => {
      const v = p.values[s]
      if (v === null) return void (pen = false)
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }
  const last = (s: number) => {
    for (let i = data.length - 1; i >= 0; i--) if (data[i].values[s] !== null) return i
    return -1
  }

  return (
    <div ref={ref} className="chart">
      <div className="legend">
        {series.map((name, s) => (
          <span key={name}>
            <i style={{ background: SERIES[s] }} />
            {name}
          </span>
        ))}
      </div>
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={`${series.join(' and ')} per day`}
          onMouseMove={(e) => {
            const bx = e.currentTarget.getBoundingClientRect().left
            const i = Math.round(((e.clientX - bx - PAD.left) / Math.max(1, innerW)) * (data.length - 1))
            setHover(i >= 0 && i < data.length ? i : null)
          }}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(max * f)} y2={y(max * f)} stroke={GRID} />
              <text x={PAD.left - 8} y={y(max * f)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT}>
                {pct(max * f)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.day} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>
                {short(d.day)}
              </text>
            ) : null,
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="#bdbdb8" strokeDasharray="3 3" />}
          {series.map((name, s) => {
            const li = last(s)
            return (
              <g key={name}>
                <path d={path(s)} fill="none" stroke={SERIES[s]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {hover !== null && data[hover].values[s] !== null && (
                  <circle cx={x(hover)} cy={y(data[hover].values[s]!)} r={4.5} fill={SERIES[s]} stroke="#fcfcfb" strokeWidth={2} />
                )}
                {li >= 0 && (
                  <text x={x(li) + 8} y={y(data[li].values[s]!)} dy="0.32em" fontSize={11} fill="#3f3f3c">
                    {name}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {hover !== null && (
        <Tooltip
          tip={{
            x: Math.min(x(hover) + 10, width - 160),
            y: 24,
            lines: [short(data[hover].day), ...series.map((name, s) => `${name}: ${pct(data[hover].values[s])}`)],
          }}
        />
      )}
    </div>
  )
}
