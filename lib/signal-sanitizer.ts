import type {
  ChartMarkupData,
  ChartMarkupFvg,
  ChartMarkupLiquidity,
  ChartMarkupStructureBreak,
  ChartMarkupSwing,
  ChartMarkupTrendline,
  ChartMarkupZone,
  CrtMacroBias,
  CrtTopDownContext,
  DetectedPlotBounds,
  ExecutionCategory,
  SignalType,
  ZoneRole,
} from '@/lib/trading-data';

const VALID_SIGNALS: SignalType[] = ['BUY', 'SELL', 'HOLD'];

export function normalizeSignalType(raw: unknown): SignalType {
  const upper = String(raw || 'HOLD')
    .trim()
    .toUpperCase()
    .replace(/_/g, ' ');
  if (VALID_SIGNALS.includes(upper as SignalType)) {
    return upper as SignalType;
  }
  if (upper.startsWith('BUY')) return 'BUY';
  if (upper.startsWith('SELL')) return 'SELL';
  return 'HOLD';
}

export function deriveExecutionCategory(signal: SignalType): ExecutionCategory {
  if (signal === 'BUY' || signal === 'SELL') return 'Market Execution';
  return 'Stand Aside';
}

export function normalizeCrtBias(raw: unknown): CrtMacroBias {
  const upper = String(raw || 'NEUTRAL')
    .trim()
    .toUpperCase();
  if (upper.includes('BULL') || upper === 'BUY' || upper === 'LONG') {
    return 'BULLISH';
  }
  if (upper.includes('BEAR') || upper === 'SELL' || upper === 'SHORT') {
    return 'BEARISH';
  }
  return 'NEUTRAL';
}

export function sanitizeCrtContext(raw: unknown): CrtTopDownContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const h1Bias = normalizeCrtBias(r.h1Bias);
  const rawValid =
    typeof r.h1CrtValid === 'boolean'
      ? r.h1CrtValid
      : String(r.h1CrtValid || '').toLowerCase() === 'true';

  const h1CrtValid = rawValid && h1Bias !== 'NEUTRAL';

  return {
    macroTimeframe: String(r.macroTimeframe || 'H1').trim() || 'H1',
    executionTimeframe: String(r.executionTimeframe || 'M5').trim() || 'M5',
    h1CrtValid,
    h1Bias,
    crtRangeHigh: r.crtRangeHigh ? String(r.crtRangeHigh).trim() : undefined,
    crtRangeLow: r.crtRangeLow ? String(r.crtRangeLow).trim() : undefined,
    crtEquilibrium: r.crtEquilibrium ? String(r.crtEquilibrium).trim() : undefined,
    crtSweepStatus:
      String(r.crtSweepStatus || '').trim() ||
      (h1CrtValid
        ? `Valid H1 ${h1Bias.toLowerCase()} CRT range reaction confirmed.`
        : 'No valid H1 CRT range sweep or POI reaction present.'),
    m5ExecutionTrigger:
      String(r.m5ExecutionTrigger || '').trim() ||
      'Evaluated M5 micro displacement and invalidation swing.',
    alignmentVerdict:
      String(r.alignmentVerdict || '').trim() ||
      (h1CrtValid
        ? `H1 ${h1Bias} CRT sets target draw · M5 refines entry & risk`
        : 'Vetoed to HOLD — H1 CRT setup is invalid; M5 noise ignored'),
  };
}

/**
 * Hard deterministic guardrail enforcing the institutional Top-Down CRT law:
 * 1. H1 always dominates. If H1 CRT is invalid or NEUTRAL, M5 by itself is meaningless -> HOLD.
 * 2. M5 never overrides H1 macro bias: Bullish H1 cannot emit SELL; Bearish H1 cannot emit BUY.
 */
export function enforceTopDownCrtDominance(
  rawSignal: SignalType,
  crtContext?: CrtTopDownContext
): {
  signalType: SignalType;
  crtContext?: CrtTopDownContext;
  vetoReason?: string;
} {
  if (!crtContext) {
    return { signalType: rawSignal };
  }

  if (!crtContext.h1CrtValid || crtContext.h1Bias === 'NEUTRAL') {
    if (rawSignal !== 'HOLD') {
      const vetoReason =
        'H1 CRT setup is not valid — standalone M5 signal vetoed to HOLD.';
      return {
        signalType: 'HOLD',
        vetoReason,
        crtContext: {
          ...crtContext,
          h1CrtValid: false,
          alignmentVerdict: vetoReason,
        },
      };
    }
    return { signalType: 'HOLD', crtContext };
  }

  if (crtContext.h1Bias === 'BULLISH' && rawSignal === 'SELL') {
    const vetoReason =
      'H1 CRT bias is BULLISH — counter-trend M5 bearish move cannot override H1 (forced HOLD).';
    return {
      signalType: 'HOLD',
      vetoReason,
      crtContext: {
        ...crtContext,
        alignmentVerdict: vetoReason,
      },
    };
  }

  if (crtContext.h1Bias === 'BEARISH' && rawSignal === 'BUY') {
    const vetoReason =
      'H1 CRT bias is BEARISH — counter-trend M5 bullish move cannot override H1 (forced HOLD).';
    return {
      signalType: 'HOLD',
      vetoReason,
      crtContext: {
        ...crtContext,
        alignmentVerdict: vetoReason,
      },
    };
  }

  return { signalType: rawSignal, crtContext };
}

export function normalizeZoneRole(
  raw: unknown,
  labelHint = ''
): ChartMarkupZone['role'] {
  const combined = `${String(raw || '')} ${labelHint}`.toLowerCase();
  if (
    combined.includes('bullish ob') ||
    combined.includes('bull ob') ||
    (combined.includes('order block') &&
      (combined.includes('bull') || combined.includes('demand')))
  ) {
    return 'Bullish OB';
  }
  if (
    combined.includes('bearish ob') ||
    combined.includes('bear ob') ||
    (combined.includes('order block') &&
      (combined.includes('bear') || combined.includes('supply')))
  ) {
    return 'Bearish OB';
  }
  if (combined.includes('demand')) return 'Demand Zone';
  if (combined.includes('supply')) return 'Supply Zone';
  if (combined.includes('resist')) return 'Resistance';
  if (combined.includes('liq')) return 'Liquidity';
  return 'Support';
}

export function normalizeKeyLevelRole(raw: unknown, labelHint = ''): ZoneRole {
  const combined = `${String(raw || '')} ${labelHint}`.toLowerCase();
  if (
    combined.includes('fvg') ||
    combined.includes('imbalance') ||
    combined.includes('fair value')
  ) {
    return 'Fair Value Gap';
  }
  if (
    combined.includes('bos') ||
    combined.includes('choch') ||
    combined.includes('break')
  ) {
    return 'Structure Break';
  }
  return normalizeZoneRole(raw, labelHint);
}

export function parseNumPrice(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).replace(/[^0-9.-]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanAnchorId(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const s = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return s || undefined;
}

export function sanitizeChartMarkup(
  raw: unknown,
  entryPriceRaw?: unknown,
  detectedPlotBoxHint?: DetectedPlotBounds,
  hasSubPaneIndicator = false,
  opticalEnhancement?: {
    detectedAxisTicks?: Array<{ id: string; y: number }>;
    liveBadgeY?: number | null;
    detectedPivots?: Array<{
      id: string;
      kind: 'high' | 'low';
      x: number;
      y: number;
    }>;
    detectedFvgCandidates?: Array<{
      id: string;
      tone: 'bullish' | 'bearish';
      startX: number;
      topY: number;
      bottomY: number;
      mitigatedEndX?: number;
    }>;
    candleEnvelope?: {
      candleCount: number;
      firstCandleX: number;
      lastCandleX: number;
      lastCandleCloseY: number;
      minHighY: number;
      maxLowY: number;
    };
  }
): ChartMarkupData | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const pb = (
    m.plotBox && typeof m.plotBox === 'object' ? m.plotBox : {}
  ) as Record<string, unknown>;
  const ac = (
    m.axisCalibration && typeof m.axisCalibration === 'object'
      ? m.axisCalibration
      : {}
  ) as Record<string, unknown>;

  const tickMap = new Map<string, number>();
  for (const t of opticalEnhancement?.detectedAxisTicks || []) {
    const id = cleanAnchorId(t.id);
    if (id && Number.isFinite(t.y)) {
      tickMap.set(id, t.y);
    }
  }
  if (
    opticalEnhancement?.liveBadgeY !== null &&
    opticalEnhancement?.liveBadgeY !== undefined &&
    Number.isFinite(opticalEnhancement.liveBadgeY)
  ) {
    tickMap.set('LIVE', opticalEnhancement.liveBadgeY);
  }

  const pivotMap = new Map<
    string,
    { id: string; kind: 'high' | 'low'; x: number; y: number }
  >();
  for (const p of opticalEnhancement?.detectedPivots || []) {
    const id = cleanAnchorId(p.id);
    if (id) pivotMap.set(id, p);
  }

  const gapMap = new Map<
    string,
    {
      id: string;
      tone: 'bullish' | 'bearish';
      startX: number;
      topY: number;
      bottomY: number;
      mitigatedEndX?: number;
    }
  >();
  for (const g of opticalEnhancement?.detectedFvgCandidates || []) {
    const id = cleanAnchorId(g.id);
    if (id) gapMap.set(id, g);
  }

  const env = opticalEnhancement?.candleEnvelope;

  // Prefer deterministic optical plotBox over LLM plotBox guesses!
  const rawLeftX = detectedPlotBoxHint
    ? detectedPlotBoxHint.leftX
    : Number.isFinite(Number(pb.leftX))
    ? Number(pb.leftX)
    : 24;
  const rawRightX = detectedPlotBoxHint
    ? detectedPlotBoxHint.rightX
    : Number.isFinite(Number(pb.rightX))
    ? Number(pb.rightX)
    : 880;
  const rawTopY = detectedPlotBoxHint
    ? detectedPlotBoxHint.topY
    : Number.isFinite(Number(pb.topY))
    ? Number(pb.topY)
    : 58;
  let resolvedBottomY = detectedPlotBoxHint
    ? detectedPlotBoxHint.bottomY
    : Number.isFinite(Number(pb.bottomY))
    ? Number(pb.bottomY)
    : 875;

  if (hasSubPaneIndicator && detectedPlotBoxHint?.bottomY) {
    resolvedBottomY = Math.min(resolvedBottomY, detectedPlotBoxHint.bottomY);
  }

  const lastCandleX = env?.lastCandleX
    ? env.lastCandleX
    : Number.isFinite(Number(ac.lastCandleX))
    ? Number(ac.lastCandleX)
    : Math.min(rawRightX - 35, 760);
  const lastCandleY = env?.lastCandleCloseY
    ? env.lastCandleCloseY
    : Number.isFinite(Number(ac.lastCandleY))
    ? Number(ac.lastCandleY)
    : (rawTopY + resolvedBottomY) / 2;

  const zones: ChartMarkupZone[] = Array.isArray(m.zones)
    ? m.zones.slice(0, 12).map((z) => {
        const zr = (z && typeof z === 'object' ? z : {}) as Record<
          string,
          unknown
        >;
        const labelStr = String(zr.label || zr.role || 'Zone');
        const validRole = normalizeZoneRole(zr.role, labelStr);
        const endXNum = Number(zr.endX);
        const pId = cleanAnchorId(zr.pivotId);
        const matchedPiv = pId ? pivotMap.get(pId) : undefined;

        return {
          label: labelStr,
          role: validRole,
          startX: matchedPiv
            ? matchedPiv.x
            : Number.isFinite(Number(zr.startX))
            ? Number(zr.startX)
            : Math.max(rawLeftX + 40, lastCandleX - 240),
          endX:
            Number.isFinite(endXNum) && endXNum > 0 ? endXNum : undefined,
          topY: Number.isFinite(Number(zr.topY)) ? Number(zr.topY) : lastCandleY - 15,
          bottomY: Number.isFinite(Number(zr.bottomY))
            ? Number(zr.bottomY)
            : lastCandleY + 15,
          topPrice: zr.topPrice ? String(zr.topPrice) : undefined,
          bottomPrice: zr.bottomPrice ? String(zr.bottomPrice) : undefined,
          mitigated: Boolean(zr.mitigated),
          isPrimary: Boolean(zr.isPrimary),
        };
      })
    : [];

  const fairValueGaps: ChartMarkupFvg[] = Array.isArray(m.fairValueGaps)
    ? m.fairValueGaps.slice(0, 8).map((f) => {
        const fr = (f && typeof f === 'object' ? f : {}) as Record<
          string,
          unknown
        >;
        const gId = cleanAnchorId(fr.gapId);
        const matchedGap = gId ? gapMap.get(gId) : undefined;
        const toneRaw = `${String(fr.tone || '')} ${String(
          fr.label || ''
        )}`.toLowerCase();
        const tone: 'bullish' | 'bearish' = matchedGap
          ? matchedGap.tone
          : toneRaw.includes('bear')
          ? 'bearish'
          : 'bullish';
        const endXNum = Number(fr.endX);
        return {
          gapId: matchedGap?.id || gId,
          label: String(
            fr.label || (tone === 'bullish' ? 'Bullish FVG' : 'Bearish FVG')
          ),
          tone,
          startX: matchedGap
            ? matchedGap.startX
            : Number.isFinite(Number(fr.startX))
            ? Number(fr.startX)
            : Math.max(rawLeftX + 80, lastCandleX - 160),
          endX: matchedGap?.mitigatedEndX
            ? matchedGap.mitigatedEndX
            : Number.isFinite(endXNum) && endXNum > 0
            ? endXNum
            : undefined,
          topY: matchedGap
            ? matchedGap.topY
            : Number.isFinite(Number(fr.topY))
            ? Number(fr.topY)
            : lastCandleY - 12,
          bottomY: matchedGap
            ? matchedGap.bottomY
            : Number.isFinite(Number(fr.bottomY))
            ? Number(fr.bottomY)
            : lastCandleY + 12,
          topPrice: fr.topPrice ? String(fr.topPrice) : undefined,
          bottomPrice: fr.bottomPrice ? String(fr.bottomPrice) : undefined,
          mitigated: matchedGap
            ? Boolean(matchedGap.mitigatedEndX)
            : Boolean(fr.mitigated),
          isPrimary: Boolean(fr.isPrimary),
        };
      })
    : [];

  const structureBreaks: ChartMarkupStructureBreak[] = Array.isArray(
    m.structureBreaks
  )
    ? m.structureBreaks.slice(0, 10).map((sb) => {
        const sbr = (sb && typeof sb === 'object' ? sb : {}) as Record<
          string,
          unknown
        >;
        const pId = cleanAnchorId(sbr.pivotId);
        const matchedPiv = pId ? pivotMap.get(pId) : undefined;
        const kindUpper = String(sbr.kind || sbr.label || 'BOS').toUpperCase();
        const kind: 'BOS' | 'CHoCH' =
          kindUpper.includes('CHOCH') ||
          kindUpper.includes('CH') ||
          kindUpper.includes('MSS')
            ? 'CHoCH'
            : 'BOS';
        const toneRaw = String(sbr.tone || '').toLowerCase();
        const tone: 'bullish' | 'bearish' = toneRaw.includes('bear')
          ? 'bearish'
          : 'bullish';
        return {
          pivotId: matchedPiv?.id || pId,
          kind,
          label: sbr.label ? String(sbr.label) : kind,
          tone,
          startX: matchedPiv
            ? matchedPiv.x
            : Number.isFinite(Number(sbr.startX))
            ? Number(sbr.startX)
            : Math.max(rawLeftX + 60, lastCandleX - 220),
          endX: Number.isFinite(Number(sbr.endX))
            ? Number(sbr.endX)
            : lastCandleX,
          y: matchedPiv
            ? matchedPiv.y
            : Number.isFinite(Number(sbr.y))
            ? Number(sbr.y)
            : lastCandleY,
          price: sbr.price ? String(sbr.price) : undefined,
          isPrimary: Boolean(sbr.isPrimary),
        };
      })
    : [];

  const liquidityLevels: ChartMarkupLiquidity[] = Array.isArray(
    m.liquidityLevels
  )
    ? m.liquidityLevels.slice(0, 8).map((lq) => {
        const lqr = (lq && typeof lq === 'object' ? lq : {}) as Record<
          string,
          unknown
        >;
        const pId = cleanAnchorId(lqr.pivotId);
        const matchedPiv = pId ? pivotMap.get(pId) : undefined;
        const rawKind = String(lqr.kind || lqr.label || 'BSL').toUpperCase();
        const kind: ChartMarkupLiquidity['kind'] = rawKind.includes('EQH')
          ? 'EQH'
          : rawKind.includes('EQL')
          ? 'EQL'
          : rawKind.includes('SSL')
          ? 'SSL'
          : rawKind.includes('SWEEP')
          ? 'Sweep'
          : 'BSL';
        const toneRaw = String(lqr.tone || '').toLowerCase();
        const tone: 'bullish' | 'bearish' | 'neutral' =
          toneRaw === 'bullish'
            ? 'bullish'
            : toneRaw === 'bearish'
            ? 'bearish'
            : 'neutral';
        return {
          pivotId: matchedPiv?.id || pId,
          kind,
          label: String(lqr.label || kind),
          tone,
          startX: matchedPiv
            ? matchedPiv.x
            : Number.isFinite(Number(lqr.startX))
            ? Number(lqr.startX)
            : Math.max(rawLeftX + 50, lastCandleX - 260),
          endX: Number.isFinite(Number(lqr.endX))
            ? Number(lqr.endX)
            : lastCandleX,
          y: matchedPiv
            ? matchedPiv.y
            : Number.isFinite(Number(lqr.y))
            ? Number(lqr.y)
            : lastCandleY,
          price: lqr.price ? String(lqr.price) : undefined,
          swept: Boolean(lqr.swept || kind === 'Sweep'),
          isPrimary: Boolean(lqr.isPrimary),
        };
      })
    : [];

  const trendlines: ChartMarkupTrendline[] = Array.isArray(m.trendlines)
    ? m.trendlines.slice(0, 6).map((t) => {
        const tr = (t && typeof t === 'object' ? t : {}) as Record<
          string,
          unknown
        >;
        const p1Id = cleanAnchorId(tr.startPivotId);
        const p2Id = cleanAnchorId(tr.endPivotId);
        const piv1 = p1Id ? pivotMap.get(p1Id) : undefined;
        const piv2 = p2Id ? pivotMap.get(p2Id) : undefined;

        const toneRaw = String(tr.tone || 'neutral').toLowerCase();
        const roleRaw = `${String(tr.role || '')} ${String(
          tr.label || ''
        )}`.toLowerCase();
        const role: ChartMarkupTrendline['role'] = roleRaw.includes('upper')
          ? 'Channel Upper'
          : roleRaw.includes('lower')
          ? 'Channel Lower'
          : 'Trendline';
        return {
          label: String(tr.label || role),
          role,
          x1: piv1
            ? piv1.x
            : Number.isFinite(Number(tr.x1))
            ? Number(tr.x1)
            : Math.max(rawLeftX + 60, lastCandleX - 320),
          y1: piv1
            ? piv1.y
            : Number.isFinite(Number(tr.y1))
            ? Number(tr.y1)
            : lastCandleY + 40,
          x2: piv2
            ? piv2.x
            : Number.isFinite(Number(tr.x2))
            ? Number(tr.x2)
            : lastCandleX,
          y2: piv2
            ? piv2.y
            : Number.isFinite(Number(tr.y2))
            ? Number(tr.y2)
            : lastCandleY - 20,
          style:
            String(tr.style || '').toLowerCase() === 'dashed'
              ? 'dashed'
              : 'solid',
          tone:
            toneRaw === 'bullish'
              ? 'bullish'
              : toneRaw === 'bearish'
              ? 'bearish'
              : 'neutral',
          isPrimary: Boolean(tr.isPrimary),
        };
      })
    : [];

  const swings: ChartMarkupSwing[] = Array.isArray(m.swings)
    ? m.swings.slice(0, 18).map((s) => {
        const sr = (s && typeof s === 'object' ? s : {}) as Record<
          string,
          unknown
        >;
        const pId = cleanAnchorId(sr.pivotId);
        const matchedPiv = pId ? pivotMap.get(pId) : undefined;
        const tagStr = String(sr.tag || 'HH');
        const inferredBelow =
          matchedPiv?.kind === 'low' ||
          tagStr.toUpperCase().endsWith('L') ||
          String(sr.position || '').toLowerCase() === 'below';
        const toneRaw = String(sr.tone || 'neutral').toLowerCase();
        return {
          pivotId: matchedPiv?.id || pId,
          tag: tagStr,
          x: matchedPiv
            ? matchedPiv.x
            : Number.isFinite(Number(sr.x))
            ? Number(sr.x)
            : Math.max(rawLeftX + 80, lastCandleX - 180),
          y: matchedPiv
            ? matchedPiv.y
            : Number.isFinite(Number(sr.y))
            ? Number(sr.y)
            : lastCandleY,
          position: inferredBelow ? 'below' : 'above',
          tone:
            toneRaw === 'bullish'
              ? 'bullish'
              : toneRaw === 'bearish'
              ? 'bearish'
              : 'neutral',
          price: sr.price ? String(sr.price) : undefined,
          isPrimary: Boolean(sr.isPrimary),
        };
      })
    : [];

  // Ensure Primary Setup view always includes the most relevant setup confluence anchor(s)
  const entryNum = parseNumPrice(entryPriceRaw);
  const hasPrimaryZoneOrFvg =
    zones.some((z) => z.isPrimary) || fairValueGaps.some((f) => f.isPrimary);

  if (!hasPrimaryZoneOrFvg) {
    if (zones.length > 0) {
      let bestIdx = 0;
      let bestDist = Infinity;
      zones.forEach((z, idx) => {
        const zp = parseNumPrice(z.topPrice) ?? parseNumPrice(z.bottomPrice);
        const dist =
          entryNum !== null && zp !== null
            ? Math.abs(zp - entryNum)
            : Math.abs((z.topY + z.bottomY) / 2 - lastCandleY);
        const penalty = z.mitigated ? 1.6 : 1;
        if (dist * penalty < bestDist) {
          bestDist = dist * penalty;
          bestIdx = idx;
        }
      });
      zones[bestIdx].isPrimary = true;
    } else if (fairValueGaps.length > 0) {
      fairValueGaps[fairValueGaps.length - 1].isPrimary = true;
    }
  }

  if (
    structureBreaks.length > 0 &&
    !structureBreaks.some((sb) => sb.isPrimary)
  ) {
    let latestIdx = 0;
    let maxEndX = -Infinity;
    structureBreaks.forEach((sb, idx) => {
      if (sb.endX > maxEndX) {
        maxEndX = sb.endX;
        latestIdx = idx;
      }
    });
    structureBreaks[latestIdx].isPrimary = true;
  }

  const maxAllowedMainY = resolvedBottomY - 4;
  const minAllowedMainY = rawTopY + 4;
  const clampMainY = (yVal: number) =>
    Math.max(minAllowedMainY, Math.min(maxAllowedMainY, yVal));

  const clampedZones = zones
    .filter(
      (z) =>
        !hasSubPaneIndicator || Math.min(z.topY, z.bottomY) < resolvedBottomY + 12
    )
    .map((z) => ({
      ...z,
      topY: clampMainY(z.topY),
      bottomY: clampMainY(z.bottomY),
    }));

  const clampedFvgs = fairValueGaps
    .filter(
      (f) =>
        !hasSubPaneIndicator || Math.min(f.topY, f.bottomY) < resolvedBottomY + 12
    )
    .map((f) => ({
      ...f,
      topY: clampMainY(f.topY),
      bottomY: clampMainY(f.bottomY),
    }));

  const clampedBreaks = structureBreaks
    .filter((sb) => !hasSubPaneIndicator || sb.y <= resolvedBottomY + 10)
    .map((sb) => ({
      ...sb,
      y: clampMainY(sb.y),
    }));

  const clampedLiquidity = liquidityLevels
    .filter((lq) => !hasSubPaneIndicator || lq.y <= resolvedBottomY + 10)
    .map((lq) => ({
      ...lq,
      y: clampMainY(lq.y),
    }));

  const clampedTrendlines = trendlines
    .filter(
      (t) =>
        !hasSubPaneIndicator ||
        (t.y1 <= resolvedBottomY + 15 && t.y2 <= resolvedBottomY + 15)
    )
    .map((t) => ({
      ...t,
      y1: clampMainY(t.y1),
      y2: clampMainY(t.y2),
    }));

  const clampedSwings = swings
    .filter((s) => !hasSubPaneIndicator || s.y <= resolvedBottomY + 12)
    .map((s) => ({
      ...s,
      y: clampMainY(s.y),
    }));

  // Reconcile axisTicks against pre-measured pixel Y anchors (`T1..Tk` and `LIVE`)
  const resolvedAxisTicks = Array.isArray(ac.axisTicks)
    ? ac.axisTicks
        .slice(0, 14)
        .map((t) => {
          const tr = (t && typeof t === 'object' ? t : {}) as Record<
            string,
            unknown
          >;
          const priceStr = tr.price ? String(tr.price).trim() : '';
          if (!priceStr || parseNumPrice(priceStr) === null) return null;

          const tickId = cleanAnchorId(tr.tickId || tr.id);
          let yNum = tickId && tickMap.has(tickId) ? tickMap.get(tickId)! : Number(tr.y);

          if (!Number.isFinite(yNum)) return null;

          // If tickId was omitted, snap to nearest pre-measured optical tick within ±18 units
          if (!tickId && tickMap.size > 0) {
            let bestDist = 18;
            tickMap.forEach((exactY) => {
              const d = Math.abs(exactY - yNum);
              if (d < bestDist) {
                bestDist = d;
                yNum = exactY;
              }
            });
          }

          if (yNum < rawTopY - 12 || yNum > resolvedBottomY + 12) {
            return null;
          }
          return {
            tickId,
            price: priceStr,
            y: yNum,
          };
        })
        .filter(
          (t): t is { tickId: string | undefined; price: string; y: number } =>
            t !== null
        )
    : undefined;

  return {
    plotBox: {
      leftX: rawLeftX,
      rightX: rawRightX,
      topY: rawTopY,
      bottomY: resolvedBottomY,
    },
    axisCalibration: {
      highRefPrice: ac.highRefPrice ? String(ac.highRefPrice) : undefined,
      highRefY: Number.isFinite(Number(ac.highRefY))
        ? Number(ac.highRefY)
        : undefined,
      lowRefPrice: ac.lowRefPrice ? String(ac.lowRefPrice) : undefined,
      lowRefY: Number.isFinite(Number(ac.lowRefY))
        ? Math.min(Number(ac.lowRefY), resolvedBottomY)
        : undefined,
      axisTicks: resolvedAxisTicks,
      lastCandleX,
      lastCandleY: clampMainY(lastCandleY),
    },
    zones: clampedZones,
    fairValueGaps: clampedFvgs,
    structureBreaks: clampedBreaks,
    liquidityLevels: clampedLiquidity,
    trendlines: clampedTrendlines,
    swings: clampedSwings,
  };
}

