import { useState, useMemo, useCallback, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { generateKMData, interpolateKM } from './stats'

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#8b5cf6', '#ec4899']

interface KmGroup {
  id: number
  name: string
  medianSurvival: number
  sampleSize: number
  censorRate: number
  cureRate: number
}

interface KmResult {
  groupName: string
  groupIndex: number
  batchIndex: number
  points: { time: number; survival: number }[]
  rawData: { time: number; event: 0 | 1 }[]
  targetMedian: number
  sampleSize: number
  eventCount: number
  censorCount: number
  cureRate: number
}

function NumSlider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <div className="slider-row">
      <div className="slider-label">
        <span>{label}</span>
        <input type="number" className="num-input" value={value} min={min} max={max}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v))) }} />
      </div>
      <input type="range" min={min} max={max} step={step}
        value={Math.max(min, Math.min(max, value))}
        onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  )
}

export default function KmSimulator() {
  const [groups, setGroups] = useState<KmGroup[]>([
    { id: 1, name: '组 1', medianSurvival: 12, sampleSize: 100, censorRate: 0.2, cureRate: 0.1 },
  ])
  const [batchCount, setBatchCount] = useState(1)
  const [results, setResults] = useState<KmResult[]>([])
  const [nextId, setNextId] = useState(2)
  const chartRef = useRef<HTMLDivElement>(null)

  const addGroup = () => {
    if (groups.length >= 6) return
    setGroups(prev => [...prev, {
      id: nextId, name: `组 ${nextId}`, medianSurvival: 18, sampleSize: 100, censorRate: 0.2, cureRate: 0.1,
    }])
    setNextId(p => p + 1)
  }

  const removeGroup = (id: number) => {
    if (groups.length <= 1) return
    setGroups(prev => prev.filter(g => g.id !== id))
  }

  const updateGroup = (id: number, field: keyof KmGroup, value: number | string) => {
    setGroups(prev => prev.map(g => (g.id === id ? { ...g, [field]: value } : g)))
  }

  const generate = useCallback(() => {
    const r: KmResult[] = []
    groups.forEach((group, gi) => {
      for (let b = 0; b < batchCount; b++) {
        const result = generateKMData(group.medianSurvival, group.sampleSize, group.censorRate, group.cureRate)
        const eventCount = result.rawData.filter(d => d.event === 1).length
        r.push({
          groupName: group.name, groupIndex: gi, batchIndex: b,
          targetMedian: group.medianSurvival, sampleSize: group.sampleSize,
          eventCount, censorCount: group.sampleSize - eventCount,
          cureRate: group.cureRate, ...result,
        })
      }
    })
    setResults(r)
  }, [groups, batchCount])

  const downloadCSV = () => {
    if (results.length === 0) return
    const rows = ['﻿组名,批次,样本ID,时间,事件(1=事件/0=删失)']
    for (const r of results) {
      r.rawData.forEach((d, i) => {
        rows.push(`${r.groupName},${r.batchIndex + 1},${i + 1},${d.time},${d.event}`)
      })
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'km_data.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const exportImage = useCallback(() => {
    const svg = chartRef.current?.querySelector('svg')
    if (!svg) return
    const { width, height } = svg.getBoundingClientRect()
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(width))
    clone.setAttribute('height', String(height))
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = '* { font-family: -apple-system, "Segoe UI", "Noto Sans SC", sans-serif; }'
    clone.insertBefore(style, clone.firstChild)
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width * 2; canvas.height = height * 2
      const ctx = canvas.getContext('2d')!
      ctx.scale(2, 2)
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      canvas.toBlob(b => {
        if (!b) return
        const a = document.createElement('a')
        a.download = 'km_curve.png'; a.href = URL.createObjectURL(b); a.click()
      }, 'image/png')
    }
    img.src = url
  }, [])

  const { chartData, lineKeys, maxTime } = useMemo(() => {
    if (results.length === 0) return { chartData: [], lineKeys: [], maxTime: 60 }

    let mt = 0
    for (const r of results) {
      const last = r.rawData[r.rawData.length - 1]
      if (last && last.time > mt) mt = last.time
    }
    mt = Math.ceil(mt * 1.1)

    const timeGrid = Array.from({ length: 201 }, (_, i) => Math.round((i / 200) * mt * 100) / 100)
    const keys: { key: string; color: string; opacity: number; name: string; showInLegend: boolean }[] = []
    const seen = new Set<string>()

    const data = timeGrid.map(time => {
      const row: Record<string, number> = { time }
      for (const r of results) {
        const key = batchCount > 1 ? `${r.groupName}_b${r.batchIndex}` : r.groupName
        row[key] = interpolateKM(r.points, time)
      }
      return row
    })

    for (const r of results) {
      const key = batchCount > 1 ? `${r.groupName}_b${r.batchIndex}` : r.groupName
      if (seen.has(key)) continue
      seen.add(key)
      const isBatchPrimary = r.batchIndex === 0
      keys.push({
        key, color: COLORS[r.groupIndex % COLORS.length],
        opacity: batchCount > 1 ? (isBatchPrimary ? 1 : 0.3) : 1,
        name: isBatchPrimary ? r.groupName : key,
        showInLegend: isBatchPrimary,
      })
    }

    return { chartData: data, lineKeys: keys, maxTime: mt }
  }, [results, batchCount])

  return (
    <div className="simulator">
      <div className="controls">
        <div className="section-title">KM 生存曲线参数</div>

        {groups.map((group, gi) => (
          <div className="group-card" key={group.id}>
            <div className="group-header">
              <span className="group-name">
                <span className="color-dot" style={{ background: COLORS[gi % COLORS.length] }} />
                {group.name}
              </span>
              {groups.length > 1 && (
                <button className="remove-btn" onClick={() => removeGroup(group.id)}>×</button>
              )}
            </div>
            <NumSlider label="中位生存期（月）" value={group.medianSurvival} min={1} max={60} step={1}
              onChange={v => updateGroup(group.id, 'medianSurvival', Math.round(v))} />
            <NumSlider label="样本量" value={group.sampleSize} min={1} max={1000} step={1}
              onChange={v => updateGroup(group.id, 'sampleSize', Math.round(v))} />
            <NumSlider label="删失率" value={group.censorRate} min={0} max={0.5} step={0.05}
              onChange={v => updateGroup(group.id, 'censorRate', v)} />
            <NumSlider label="长期生存率（治愈率）" value={group.cureRate} min={0} max={0.5} step={0.05}
              onChange={v => updateGroup(group.id, 'cureRate', v)} />
          </div>
        ))}

        <button className="btn btn-add" style={{ width: '100%' }} onClick={addGroup}>
          + 添加组 ({groups.length}/6)
        </button>

        <NumSlider label="批次数量" value={batchCount} min={1} max={10} step={1} onChange={v => setBatchCount(Math.round(v))} />

        <div className="btn-group">
          <button className="btn btn-primary" onClick={generate}>生成数据</button>
        </div>
        <div className="btn-group" style={{ marginTop: 6 }}>
          <button className="btn btn-secondary" onClick={downloadCSV} disabled={results.length === 0}>下载 CSV</button>
          <button className="btn btn-secondary" onClick={exportImage} disabled={results.length === 0}>导出图片</button>
        </div>
      </div>

      <div className="chart-area" ref={chartRef}>
        {results.length === 0 ? (
          <div className="no-data">调整参数后点击「生成数据」查看 KM 生存曲线</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 25, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="time" type="number" domain={[0, maxTime]}
                label={{ value: '时间（月）', position: 'bottom', offset: 8 }} />
              <YAxis domain={[0, 1]}
                tickFormatter={(v: number) => v.toFixed(1)}
                label={{ value: '生存概率', angle: -90, position: 'insideLeft', offset: 0 }} />
              <Tooltip formatter={(value: number) => value.toFixed(3)}
                labelFormatter={(label: number) => `时间: ${Number(label).toFixed(1)} 月`} />
              <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
              {lineKeys.map(lk => (
                <Line key={lk.key} dataKey={lk.key} type="stepAfter" stroke={lk.color}
                  strokeWidth={lk.opacity === 1 ? 2 : 1} strokeOpacity={lk.opacity}
                  dot={false} name={lk.showInLegend ? lk.name : lk.key}
                  legendType={lk.showInLegend ? 'line' : 'none'} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="data-area">
        <div className="section-title">统计摘要</div>
        {results.length > 0 && (
          <table className="stats-table">
            <thead>
              <tr>
                <th>组名</th>
                <th>批次</th>
                <th>中位生存期</th>
                <th>样本量</th>
                <th>事件数</th>
                <th>删失数</th>
                <th>治愈率</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>{r.groupName}</td>
                  <td>{r.batchIndex + 1}</td>
                  <td>{r.targetMedian} 月</td>
                  <td>{r.sampleSize}</td>
                  <td>{r.eventCount}</td>
                  <td>{r.censorCount}</td>
                  <td>{(r.cureRate * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
