import { useState, useMemo, useCallback, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { saveBlobFile, saveTextFile } from './fileExport'
import { generateAllROC, interpolateROC, normalCDF, type IndicatorConfig, type AllRocResult } from './stats'

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#8b5cf6', '#ec4899']
const COMBINED_COLOR = '#111827'

interface Indicator extends IndicatorConfig {
  id: number
}

interface BatchResult extends AllRocResult {
  batchIndex: number
}

function NumSlider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <div className="slider-row">
      <div className="slider-label">
        <span>{label}</span>
        <input type="number" className="num-input" value={value} min={min} step={step}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(Math.max(min, v)) }} />
      </div>
      <input type="range" min={min} max={max} step={step}
        value={Math.max(min, Math.min(max, value))}
        onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  )
}

function theoreticalAUC(posMean: number, posStd: number, negMean: number, negStd: number): number {
  const denom = Math.sqrt(posStd * posStd + negStd * negStd)
  if (denom === 0) return 0.5
  return normalCDF((posMean - negMean) / denom)
}

export default function RocSimulator() {
  const [nPositive, setNPositive] = useState(100)
  const [nNegative, setNNegative] = useState(100)
  const [batchCount, setBatchCount] = useState(1)
  const [showCombined, setShowCombined] = useState(false)
  const [indicators, setIndicators] = useState<Indicator[]>([
    { id: 1, name: '连续指标 1', type: 'continuous', posMean: 60, posStd: 15, negMean: 40, negStd: 15, sensitivity: 0.8, specificity: 0.8 },
  ])
  const [results, setResults] = useState<BatchResult[]>([])
  const [nextId, setNextId] = useState(2)
  const chartRef = useRef<HTMLDivElement>(null)

  const addIndicator = (type: 'continuous' | 'categorical') => {
    if (indicators.length >= 6) return
    const label = type === 'continuous' ? '连续指标' : '分类指标'
    setIndicators(prev => [...prev, {
      id: nextId, name: `${label} ${nextId}`, type,
      posMean: 55, posStd: 15, negMean: 45, negStd: 15,
      sensitivity: 0.8, specificity: 0.8,
    }])
    setNextId(p => p + 1)
  }

  const removeIndicator = (id: number) => {
    if (indicators.length <= 1) return
    setIndicators(prev => prev.filter(ind => ind.id !== id))
  }

  const updateIndicator = (id: number, field: string, value: number | string) => {
    setIndicators(prev => prev.map(ind => ind.id === id ? { ...ind, [field]: value } : ind))
  }

  const generate = useCallback(() => {
    const configs: IndicatorConfig[] = indicators.map(({ name, type, posMean, posStd, negMean, negStd, sensitivity, specificity }) =>
      ({ name, type, posMean, posStd, negMean, negStd, sensitivity, specificity }))
    const batches: BatchResult[] = []
    for (let b = 0; b < batchCount; b++) {
      batches.push({ batchIndex: b, ...generateAllROC(nPositive, nNegative, configs, showCombined) })
    }
    setResults(batches)
  }, [indicators, nPositive, nNegative, batchCount, showCombined])

  const downloadCSV = async () => {
    if (results.length === 0) return
    const indNames = indicators.map(ind => ind.name)
    const hasCombined = results[0].combined != null
    const header = ['批次', '样本ID', '标签(1=阳性/0=阴性)', ...indNames,
      ...(hasCombined ? ['联合模型得分'] : [])].join(',')
    const rows = ['﻿' + header]
    for (const batch of results) {
      batch.rawData.forEach((d, i) => {
        const scores = indNames.map(n => (d.scores[n] ?? 0).toFixed(2))
        const row = [batch.batchIndex + 1, i + 1, d.label, ...scores,
          ...(hasCombined && d.combinedScore != null ? [d.combinedScore.toFixed(4)] : [])]
        rows.push(row.join(','))
      })
    }
    await saveTextFile('roc_data.csv', rows.join('\n'), 'text/csv;charset=utf-8;')
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
        void saveBlobFile('roc_curve.png', b)
      }, 'image/png')
    }
    img.src = url
  }, [])

  const { chartData, lineKeys } = useMemo(() => {
    if (results.length === 0) return { chartData: [], lineKeys: [] }
    const fprGrid = Array.from({ length: 201 }, (_, i) => i / 200)
    const keys: { key: string; color: string; opacity: number; name: string; showInLegend: boolean }[] = []
    const seen = new Set<string>()

    const data = fprGrid.map(fpr => {
      const row: Record<string, number> = { fpr, 参考线: fpr }
      for (const batch of results) {
        for (const ind of batch.indicators) {
          const key = batchCount > 1 ? `${ind.name}_b${batch.batchIndex}` : ind.name
          row[key] = interpolateROC(ind.points, fpr)
        }
        if (batch.combined) {
          const key = batchCount > 1 ? `联合模型_b${batch.batchIndex}` : '联合模型'
          row[key] = interpolateROC(batch.combined.points, fpr)
        }
      }
      return row
    })

    const firstBatch = results[0]
    for (const ind of firstBatch.indicators) {
      for (const batch of results) {
        const key = batchCount > 1 ? `${ind.name}_b${batch.batchIndex}` : ind.name
        if (seen.has(key)) continue
        seen.add(key)
        const isPrimary = batch.batchIndex === 0
        const ii = firstBatch.indicators.indexOf(ind)
        keys.push({
          key, color: COLORS[ii % COLORS.length],
          opacity: batchCount > 1 ? (isPrimary ? 1 : 0.3) : 1,
          name: isPrimary ? `${ind.name} (AUC=${ind.computedAuc.toFixed(3)})` : key,
          showInLegend: isPrimary,
        })
      }
    }
    if (firstBatch.combined) {
      for (const batch of results) {
        const key = batchCount > 1 ? `联合模型_b${batch.batchIndex}` : '联合模型'
        if (seen.has(key)) continue
        seen.add(key)
        const isPrimary = batch.batchIndex === 0
        keys.push({
          key, color: COMBINED_COLOR,
          opacity: batchCount > 1 ? (isPrimary ? 1 : 0.3) : 1,
          name: isPrimary ? `联合模型 (AUC=${firstBatch.combined!.computedAuc.toFixed(3)})` : key,
          showInLegend: isPrimary,
        })
      }
    }

    return { chartData: data, lineKeys: keys }
  }, [results, batchCount])

  return (
    <div className="simulator">
      <div className="controls">
        <div className="section-title">样本设置</div>
        <div className="group-card">
          <NumSlider label="阳性样本数 (1)" value={nPositive} min={1} max={500} step={1} onChange={v => setNPositive(Math.round(v))} />
          <NumSlider label="阴性样本数 (0)" value={nNegative} min={1} max={500} step={1} onChange={v => setNNegative(Math.round(v))} />
        </div>

        <div className="section-title">指标设置</div>
        {indicators.map((ind, ii) => (
          <div className="group-card" key={ind.id}>
            <div className="group-header">
              <span className="group-name">
                <span className="color-dot" style={{ background: COLORS[ii % COLORS.length] }} />
                {ind.name}
                <span className="type-badge">{ind.type === 'continuous' ? '连续' : '分类'}</span>
              </span>
              {indicators.length > 1 && (
                <button className="remove-btn" onClick={() => removeIndicator(ind.id)}>×</button>
              )}
            </div>
            {ind.type === 'continuous' ? (
              <>
                <NumSlider label="阳性均值" value={ind.posMean} min={0} max={200} step={0.5}
                  onChange={v => updateIndicator(ind.id, 'posMean', v)} />
                <NumSlider label="阳性标准差" value={ind.posStd} min={1} max={50} step={0.5}
                  onChange={v => updateIndicator(ind.id, 'posStd', v)} />
                <NumSlider label="阴性均值" value={ind.negMean} min={0} max={200} step={0.5}
                  onChange={v => updateIndicator(ind.id, 'negMean', v)} />
                <NumSlider label="阴性标准差" value={ind.negStd} min={1} max={50} step={0.5}
                  onChange={v => updateIndicator(ind.id, 'negStd', v)} />
                <div className="auc-display">
                  理论 AUC: {theoreticalAUC(ind.posMean, ind.posStd, ind.negMean, ind.negStd).toFixed(3)}
                </div>
              </>
            ) : (
              <>
                <NumSlider label="灵敏度" value={ind.sensitivity} min={0.1} max={1} step={0.01}
                  onChange={v => updateIndicator(ind.id, 'sensitivity', v)} />
                <NumSlider label="特异度" value={ind.specificity} min={0.1} max={1} step={0.01}
                  onChange={v => updateIndicator(ind.id, 'specificity', v)} />
              </>
            )}
          </div>
        ))}

        <div className="add-btn-group">
          <button className="btn btn-add" onClick={() => addIndicator('continuous')}>+ 连续指标</button>
          <button className="btn btn-add" onClick={() => addIndicator('categorical')}>+ 分类指标</button>
        </div>

        {indicators.length >= 2 && (
          <label className="checkbox-row">
            <input type="checkbox" checked={showCombined} onChange={e => setShowCombined(e.target.checked)} />
            <span>显示联合模型</span>
          </label>
        )}

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
          <div className="no-data">调整参数后点击「生成数据」查看 ROC 曲线</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 25, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="fpr" type="number" domain={[0, 1]}
                tickFormatter={(v: number) => v.toFixed(1)}
                label={{ value: '1 - Specificity', position: 'bottom', offset: 8 }} />
              <YAxis domain={[0, 1]}
                tickFormatter={(v: number) => v.toFixed(1)}
                label={{ value: 'Sensitivity', angle: -90, position: 'insideLeft', offset: 0 }} />
              <Tooltip formatter={(value: number) => value.toFixed(3)}
                labelFormatter={(label: number) => `FPR: ${label.toFixed(3)}`} />
              <Legend verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
              <Line dataKey="参考线" stroke="#ccc" strokeDasharray="5 5" dot={false} strokeWidth={1} legendType="none" />
              {lineKeys.map(lk => (
                <Line key={lk.key} dataKey={lk.key} stroke={lk.color}
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
                <th>指标</th>
                <th>类型</th>
                <th>批次</th>
                <th>AUC</th>
              </tr>
            </thead>
            <tbody>
              {results.flatMap(batch => [
                ...batch.indicators.map((ind, ii) => (
                  <tr key={`${batch.batchIndex}-${ii}`}>
                    <td>{ind.name}</td>
                    <td>{ind.type === 'continuous' ? '连续' : '分类'}</td>
                    <td>{batch.batchIndex + 1}</td>
                    <td>{ind.computedAuc.toFixed(4)}</td>
                  </tr>
                )),
                ...(batch.combined ? [(
                  <tr key={`${batch.batchIndex}-combined`} style={{ fontWeight: 600 }}>
                    <td>联合模型</td>
                    <td>组合</td>
                    <td>{batch.batchIndex + 1}</td>
                    <td>{batch.combined.computedAuc.toFixed(4)}</td>
                  </tr>
                )] : []),
              ])}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
