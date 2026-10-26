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

export function sanitizeChartMarkup(
  raw: unknown,
  entryPriceRaw?: unknown,
  detectedPlotBoxHint?: DetectedPlotBounds,
  hasSubPaneIndicator = false
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

  const lastCandleX = Number.isFinite(Number(ac.lastCandleX))
    ? Number(ac.lastCandleX)
    : 760;
  const lastCandleY = Number.isFinite(Number(ac.lastCandleY))
    ? Number(ac.lastCandleY)
    : 500;

  const zones: ChartMarkupZone[] = Array.isArray(m.zones)
    ? m.zones.slice(0, 12).map((z) => {
        const zr = (z && typeof z === 'object' ? z : {}) as Record<
          string,
          unknown
        >;
        const labelStr = String(zr.label || zr.role || 'Zone');
        const validRole = normalizeZoneRole(zr.role, labelStr);
        const endXNum = Number(zr.endX);

        return {
          label: labelStr,
          role: validRole,
          startX: Number.isFinite(Number(zr.startX)) ? Number(zr.startX) : 180,
          endX:
            Number.isFinite(endXNum) && endXNum > 0 ? endXNum : undefined,
          topY: Number.isFinite(Number(zr.topY)) ? Number(zr.topY) : 460,
          bottomY: Number.isFinite(Number(zr.bottomY))
            ? Number(zr.bottomY)
            : 500,
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
        const toneRaw = `${String(fr.tone || '')} ${String(
          fr.label || ''
        )}`.toLowerCase();
        const tone: 'bullish' | 'bearish' = toneRaw.includes('bear')
          ? 'bearish'
          : 'bullish';
        const endXNum = Number(fr.endX);
        return {
          label: String(
            fr.label || (tone === 'bullish' ? 'Bullish FVG' : 'Bearish FVG')
          ),
          tone,
          startX: Number.isFinite(Number(fr.startX)) ? Number(fr.startX) : 320,
          endX:
            Number.isFinite(endXNum) && endXNum > 0 ? endXNum : undefined,
          topY: Number.isFinite(Number(fr.topY)) ? Number(fr.topY) : 470,
          bottomY: Number.isFinite(Number(fr.bottomY))
            ? Number(fr.bottomY)
            : 505,
          topPrice: fr.topPrice ? String(fr.topPrice) : undefined,
          bottomPrice: fr.bottomPrice ? String(fr.bottomPrice) : undefined,
          mitigated: Boolean(fr.mitigated),
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
          kind,
          label: sbr.label ? String(sbr.label) : kind,
          tone,
          startX: Number.isFinite(Number(sbr.startX))
            ? Number(sbr.startX)
            : 260,
          endX: Number.isFinite(Number(sbr.endX)) ? Number(sbr.endX) : 480,
          y: Number.isFinite(Number(sbr.y)) ? Number(sbr.y) : 450,
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
          kind,
          label: String(lqr.label || kind),
          tone,
          startX: Number.isFinite(Number(lqr.startX))
            ? Number(lqr.startX)
            : 220,
          endX: Number.isFinite(Number(lqr.endX))
            ? Number(lqr.endX)
            : lastCandleX,
          y: Number.isFinite(Number(lqr.y)) ? Number(lqr.y) : 340,
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
          x1: Number.isFinite(Number(tr.x1)) ? Number(tr.x1) : 180,
          y1: Number.isFinite(Number(tr.y1)) ? Number(tr.y1) : 540,
          x2: Number.isFinite(Number(tr.x2)) ? Number(tr.x2) : 680,
          y2: Number.isFinite(Number(tr.y2)) ? Number(tr.y2) : 440,
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
        const toneRaw = String(sr.tone || 'neutral').toLowerCase();
        return {
          tag: String(sr.tag || 'HH'),
          x: Number.isFinite(Number(sr.x)) ? Number(sr.x) : 420,
          y: Number.isFinite(Number(sr.y)) ? Number(sr.y) : 420,
          position:
            String(sr.position || 'above').toLowerCase() === 'below'
              ? 'below'
              : 'above',
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

  const rawLeftX = Number.isFinite(Number(pb.leftX))
    ? Number(pb.leftX)
    : detectedPlotBoxHint?.leftX ?? 28;
  const rawRightX = Number.isFinite(Number(pb.rightX))
    ? Number(pb.rightX)
    : detectedPlotBoxHint?.rightX ?? 885;
  const rawTopY = Number.isFinite(Number(pb.topY))
    ? Number(pb.topY)
    : detectedPlotBoxHint?.topY ?? 55;
  let resolvedBottomY = Number.isFinite(Number(pb.bottomY))
    ? Number(pb.bottomY)
    : detectedPlotBoxHint?.bottomY ?? 880;

  if (hasSubPaneIndicator && detectedPlotBoxHint?.bottomY) {
    resolvedBottomY = Math.min(resolvedBottomY, detectedPlotBoxHint.bottomY);
  }

  const maxAllowedMainY = resolvedBottomY - 4;
  const minAllowedMainY = rawTopY + 4;
  const clampMainY = (yVal: number) =>
    Math.max(minAllowedMainY, Math.min(maxAllowedMainY, yVal));

  const clampedZones = hasSubPaneIndicator
    ? zones
        .filter((z) => Math.min(z.topY, z.bottomY) < resolvedBottomY + 12)
        .map((z) => ({
          ...z,
          topY: clampMainY(z.topY),
          bottomY: clampMainY(z.bottomY),
        }))
    : zones;

  const clampedFvgs = hasSubPaneIndicator
    ? fairValueGaps
        .filter((f) => Math.min(f.topY, f.bottomY) < resolvedBottomY + 12)
        .map((f) => ({
          ...f,
          topY: clampMainY(f.topY),
          bottomY: clampMainY(f.bottomY),
        }))
    : fairValueGaps;

  const clampedBreaks = hasSubPaneIndicator
    ? structureBreaks
        .filter((sb) => sb.y <= resolvedBottomY + 10)
        .map((sb) => ({
          ...sb,
          y: clampMainY(sb.y),
        }))
    : structureBreaks;

  const clampedLiquidity = hasSubPaneIndicator
    ? liquidityLevels
        .filter((lq) => lq.y <= resolvedBottomY + 10)
        .map((lq) => ({
          ...lq,
          y: clampMainY(lq.y),
        }))
    : liquidityLevels;

  const clampedTrendlines = hasSubPaneIndicator
    ? trendlines
        .filter(
          (t) => t.y1 <= resolvedBottomY + 15 && t.y2 <= resolvedBottomY + 15
        )
        .map((t) => ({
          ...t,
          y1: clampMainY(t.y1),
          y2: clampMainY(t.y2),
        }))
    : trendlines;

  const clampedSwings = hasSubPaneIndicator
    ? swings
        .filter((s) => s.y <= resolvedBottomY + 12)
        .map((s) => ({
          ...s,
          y: clampMainY(s.y),
        }))
    : swings;

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
      axisTicks: Array.isArray(ac.axisTicks)
        ? ac.axisTicks
            .slice(0, 8)
            .map((t) => {
              const tr = (t && typeof t === 'object' ? t : {}) as Record<
                string,
                unknown
              >;
              const priceStr = tr.price ? String(tr.price).trim() : '';
              const yNum = Number(tr.y);
              if (!priceStr || !Number.isFinite(yNum)) return null;
              if (hasSubPaneIndicator && yNum > resolvedBottomY + 12) {
                return null;
              }
              return { price: priceStr, y: yNum };
            })
            .filter((t): t is { price: string; y: number } => t !== null)
        : undefined,
      lastCandleX,
      lastCandleY: hasSubPaneIndicator ? clampMainY(lastCandleY) : lastCandleY,
    },
    zones: clampedZones,
    fairValueGaps: clampedFvgs,
    structureBreaks: clampedBreaks,
    liquidityLevels: clampedLiquidity,
    trendlines: clampedTrendlines,
    swings: clampedSwings,
  };
}
