export function normalRandom(mean = 0, std = 1): number {
  let u1 = 0, u2 = 0
  while (u1 === 0) u1 = Math.random()
  while (u2 === 0) u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * std + mean
}

export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  if (p === 0.5) return 0
  if (p > 0.5) return -normalQuantile(1 - p)
  const t = Math.sqrt(-2 * Math.log(p))
  return -(t - (2.515517 + 0.802853 * t + 0.010328 * t * t) /
    (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t))
}

export function normalCDF(x: number): number {
  const sign = x < 0 ? -1 : 1
  const z = Math.abs(x) / Math.SQRT2
  const t = 1.0 / (1.0 + 0.3275911 * z)
  const y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z)
  return 0.5 * (1.0 + sign * y)
}

function computeROC(labels: (0 | 1)[], scores: number[], nPos: number, nNeg: number) {
  const paired = labels.map((label, i) => ({ score: scores[i], label }))
  paired.sort((a, b) => b.score - a.score)
  let tp = 0, fp = 0
  const points: { fpr: number; tpr: number }[] = [{ fpr: 0, tpr: 0 }]
  // Group by tied scores so ROC curve is independent of sample order
  let i = 0
  while (i < paired.length) {
    let tiePos = 0, tieNeg = 0
    const score = paired[i].score
    while (i < paired.length && paired[i].score === score) {
      if (paired[i].label === 1) tiePos++
      else tieNeg++
      i++
    }
    tp += tiePos
    fp += tieNeg
    points.push({ fpr: fp / nNeg, tpr: tp / nPos })
  }
  // Trapezoidal AUC
  let auc = 0
  for (let j = 1; j < points.length; j++) {
    auc += (points[j].fpr - points[j - 1].fpr) * (points[j].tpr + points[j - 1].tpr) / 2
  }
  return { points, computedAuc: auc }
}

export interface IndicatorConfig {
  name: string
  type: 'continuous' | 'categorical'
  posMean: number
  posStd: number
  negMean: number
  negStd: number
  sensitivity: number
  specificity: number
}

export interface AllRocResult {
  indicators: { name: string; type: string; points: { fpr: number; tpr: number }[]; computedAuc: number }[]
  combined?: { points: { fpr: number; tpr: number }[]; computedAuc: number }
  rawData: { label: 0 | 1; scores: Record<string, number>; combinedScore?: number }[]
}

export function generateAllROC(nPos: number, nNeg: number, indicators: IndicatorConfig[], includeCombined: boolean): AllRocResult {
  const total = nPos + nNeg
  const labels: (0 | 1)[] = [...new Array<1>(nPos).fill(1), ...new Array<0>(nNeg).fill(0)]

  const allScores: Record<string, number[]> = {}
  for (const ind of indicators) {
    const s: number[] = []
    if (ind.type === 'continuous') {
      for (let i = 0; i < total; i++) {
        s.push(labels[i] === 1 ? normalRandom(ind.posMean, ind.posStd) : normalRandom(ind.negMean, ind.negStd))
      }
    } else {
      for (let i = 0; i < total; i++) {
        const pred = labels[i] === 1
          ? (Math.random() < ind.sensitivity ? 1 : 0)
          : (Math.random() < (1 - ind.specificity) ? 1 : 0)
        s.push(pred)
      }
    }
    allScores[ind.name] = s
  }

  const indResults = indicators.map(ind => ({
    name: ind.name, type: ind.type,
    ...computeROC(labels, allScores[ind.name], nPos, nNeg),
  }))

  let combined: { points: { fpr: number; tpr: number }[]; computedAuc: number } | undefined
  let combinedScores: number[] | undefined
  if (includeCombined && indicators.length >= 2) {
    combinedScores = Array.from({ length: total }, (_, i) =>
      indicators.reduce((sum, ind) => {
        const s = allScores[ind.name][i]
        if (ind.type === 'continuous') {
          const mean = (ind.posMean + ind.negMean) / 2
          const std = Math.max((ind.posStd + ind.negStd) / 2, 1)
          return sum + (s - mean) / std
        }
        return sum + s
      }, 0)
    )
    combined = computeROC(labels, combinedScores, nPos, nNeg)
  }

  const rawData = labels.map((label, i) => ({
    label,
    scores: Object.fromEntries(indicators.map(ind => [ind.name, allScores[ind.name][i]])) as Record<string, number>,
    combinedScore: combinedScores?.[i],
  }))

  return { indicators: indResults, combined, rawData }
}

export function interpolateROC(points: { fpr: number; tpr: number }[], targetFpr: number): number {
  if (targetFpr <= 0) return 0
  if (targetFpr >= 1) return 1
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i].fpr <= targetFpr && points[i + 1].fpr >= targetFpr) {
      const range = points[i + 1].fpr - points[i].fpr
      if (range === 0) return points[i].tpr
      const t = (targetFpr - points[i].fpr) / range
      return points[i].tpr + t * (points[i + 1].tpr - points[i].tpr)
    }
  }
  return points[points.length - 1].tpr
}

export function generateKMData(medianSurvival: number, sampleSize: number, censorRate: number, cureRate: number = 0) {
  const lambda = Math.log(2) / medianSurvival
  const rawData: { time: number; event: 0 | 1 }[] = []
  // Generate non-cured patients first
  let maxEventTime = 0
  for (let i = 0; i < sampleSize; i++) {
    if (Math.random() < cureRate) continue // placeholder, will fill later
    const survivalTime = -Math.log(Math.random()) / lambda
    if (Math.random() < censorRate) {
      const censorTime = Math.random() * 3 * medianSurvival
      if (censorTime < survivalTime) {
        rawData.push({ time: Math.round(censorTime * 100) / 100, event: 0 })
        continue
      }
    }
    const eventTime = Math.round(survivalTime * 100) / 100
    rawData.push({ time: eventTime, event: 1 })
    if (eventTime > maxEventTime) maxEventTime = eventTime
  }
  // Cure patients: censored AFTER the last event so they preserve the survival plateau
  const nCured = sampleSize - rawData.length
  for (let i = 0; i < nCured; i++) {
    const followup = maxEventTime + medianSurvival * (1 + Math.random() * 2)
    rawData.push({ time: Math.round(followup * 100) / 100, event: 0 })
  }
  rawData.sort((a, b) => a.time - b.time)
  let nAtRisk = sampleSize
  let survival = 1.0
  const points: { time: number; survival: number }[] = [{ time: 0, survival: 1.0 }]
  for (const e of rawData) {
    if (e.event === 1) {
      survival *= (nAtRisk - 1) / nAtRisk
      points.push({ time: e.time, survival })
    }
    nAtRisk--
  }
  return { points, rawData }
}

export function interpolateKM(points: { time: number; survival: number }[], targetTime: number): number {
  let survival = 1.0
  for (const p of points) {
    if (p.time <= targetTime) survival = p.survival
    else break
  }
  return survival
}
