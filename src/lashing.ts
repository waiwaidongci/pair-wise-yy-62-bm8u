import type { Cargo } from './api';

// 系固器材批次 / 绑扎点 / 绑扎结论 / 稳性结论 的领域模型与纯函数

export type GearType = '绑扎带' | '链条' | '花篮螺丝' | '卸扣' | '支撑木';
export type GearStatus = '有效' | '送检中' | '过期';
export type Crew = '码头班' | '大副';
export type ConclusionStatus = '待确认' | '已确认' | '已作废';

export type GearBatch = {
  id: string;
  type: GearType;
  spec: string;
  quantity: number;
  certificateNo: string; // 证书编号
  inspectedAt: string; // 检定日期
  validUntil: string; // 有效期至
  status: GearStatus;
  releasedForCurrentVoyage: boolean; // 旧放行照走：送检前已放行的航次继续有效
};

export type LashingPoint = {
  id: string;
  bay: number;
  row: number;
  deck: '主甲板' | '货舱';
  status: '可用' | '已占用';
  occupiedBy: string | null; // 占用货物 id
  recordedBy: Crew | null; // 先到者
  recordedByAll: Crew[]; // 所有记录过该点的班组（补录合并用）
  recordedAt: string | null;
  version: number; // 绑扎点版本，变化后结论作废
};

export type ConclusionSnapshot = {
  weight: number;
  cog: number;
  pointSig: string;
  gearSig: string;
};

export type LashingConclusion = {
  id: string;
  cargoId: string;
  pointIds: string[];
  gearBatchIds: string[];
  status: ConclusionStatus;
  confirmedAt: string | null;
  confirmedBy: string | null;
  invalidReason: string | null;
  basedOn: ConclusionSnapshot;
};

export type StabilityConclusion = {
  status: ConclusionStatus;
  confirmedAt: string | null;
  confirmedBy: string | null;
  invalidReason: string | null;
  basedOn: { cog: number; cargoSig: string };
};

export type OfflineRecord = {
  clientId: string;
  localBatchId: string; // 本地批次：失败后从本批次重试
  kind: 'point' | 'conclusion' | 'gear';
  payload: Record<string, unknown>;
  createdAt: string;
  status: 'pending' | 'failed' | 'synced';
  attempts: number;
};

export type GateBlocker = {
  type: 'gear' | 'point' | 'conclusion' | 'stability' | 'conflict';
  cargoId?: string;
  message: string;
};

export type GateStatus = { passed: boolean; blockers: GateBlocker[] };

// ---------- 纯计算 ----------

export function cogOf(cargo: Cargo[]): number {
  const total = cargo.reduce((sum, it) => sum + it.weight, 0);
  return cargo.reduce((sum, it) => sum + it.weight * it.bay, 0) / Math.max(total, 1);
}

export function cargoSig(cargo: Cargo[]): string {
  return cargo.map((c) => `${c.id}:${c.bay}:${c.row}:${c.tier}:${c.deck}:${c.weight}`).join('|');
}

export function pointSig(points: LashingPoint[], ids: string[]): string {
  return ids
    .map((id) => {
      const p = points.find((x) => x.id === id);
      return p ? `${p.id}@${p.version}` : `${id}@missing`;
    })
    .join(',');
}

// 器材签名只取证书条款（编号 + 检定/有效期），不含 status：
// 送检(status)变化不改变签名 → 旧放行照走，不作废；新检定(inspectedAt/validUntil)变化 → 作废。
export function gearSig(batches: GearBatch[], ids: string[]): string {
  return ids
    .map((id) => {
      const b = batches.find((x) => x.id === id);
      return b ? `${b.id}:${b.inspectedAt}:${b.validUntil}` : `${id}@missing`;
    })
    .join(',');
}

// 评估单个绑扎结论是否仍有效（基于快照 + 器材/点现状）
export function evaluateConclusion(
  conclusion: LashingConclusion,
  cargo: Cargo,
  points: LashingPoint[],
  batches: GearBatch[]
): { valid: boolean; reason: string | null } {
  const cog = cogOf([cargo]);
  if (conclusion.basedOn.weight !== cargo.weight) return { valid: false, reason: '货物重量变化' };
  if (Math.abs(conclusion.basedOn.cog - cog) > 0.01) return { valid: false, reason: '重心变化' };
  if (conclusion.basedOn.pointSig !== pointSig(points, conclusion.pointIds)) return { valid: false, reason: '绑扎点变化' };
  if (conclusion.basedOn.gearSig !== gearSig(batches, conclusion.gearBatchIds)) return { valid: false, reason: '检验批次变化' };
  for (const id of conclusion.gearBatchIds) {
    const b = batches.find((x) => x.id === id);
    if (!b) return { valid: false, reason: `器材批次 ${id} 不存在` };
    if (b.status === '过期') return { valid: false, reason: `器材批次 ${id} 已过期` };
    if (b.status === '送检中' && !b.releasedForCurrentVoyage) return { valid: false, reason: `器材批次 ${id} 送检中且未放行` };
  }
  for (const id of conclusion.pointIds) {
    const p = points.find((x) => x.id === id);
    if (!p) return { valid: false, reason: `绑扎点 ${id} 不存在` };
    if (p.status !== '已占用' || p.occupiedBy !== cargo.id) return { valid: false, reason: `绑扎点 ${id} 已释放或被占用` };
  }
  return { valid: true, reason: null };
}

// 批量重校验：检定/重心/绑扎点变化 → 对应结论立即作废
export function revalidateConclusions(
  conclusions: LashingConclusion[],
  cargo: Cargo[],
  points: LashingPoint[],
  batches: GearBatch[]
): LashingConclusion[] {
  return conclusions.map((c) => {
    if (c.status === '待确认') return c;
    const item = cargo.find((x) => x.id === c.cargoId);
    if (!item) return { ...c, status: '已作废', invalidReason: '货物已移除', confirmedAt: null };
    const { valid, reason } = evaluateConclusion(c, item, points, batches);
    if (valid) return c;
    return { ...c, status: '已作废', invalidReason: reason, confirmedAt: null };
  });
}

export function revalidateStability(stability: StabilityConclusion, cargo: Cargo[]): StabilityConclusion {
  if (stability.status !== '已确认') return stability;
  const cog = cogOf(cargo);
  const sig = cargoSig(cargo);
  if (Math.abs(stability.basedOn.cog - cog) > 0.01 || stability.basedOn.cargoSig !== sig) {
    return { ...stability, status: '已作废', invalidReason: '重心或货位变化', confirmedAt: null };
  }
  return stability;
}

// 开航门禁：货物 + 绑扎点 + 检验批次 三者结论齐备且有效
export function gateStatus(
  cargo: Cargo[],
  conclusions: LashingConclusion[],
  stability: StabilityConclusion,
  points: LashingPoint[],
  batches: GearBatch[],
  conflictCount: number
): GateStatus {
  const blockers: GateBlocker[] = [];
  if (conflictCount > 0) blockers.push({ type: 'conflict', message: `${conflictCount} 项配载冲突未处理` });
  if (stability.status === '已作废') blockers.push({ type: 'stability', message: '稳性结论已作废，需重新确认' });
  else if (stability.status === '待确认') blockers.push({ type: 'stability', message: '稳性结论未确认' });

  const needLashing = cargo.filter((c) => c.type === '重大件' || c.lashing !== '已绑扎');
  for (const c of needLashing) {
    const conc = conclusions.find((x) => x.cargoId === c.id);
    if (!conc || conc.status === '待确认') blockers.push({ type: 'conclusion', cargoId: c.id, message: `${c.id} 绑扎结论未确认` });
    else if (conc.status === '已作废') blockers.push({ type: 'conclusion', cargoId: c.id, message: `${c.id} 绑扎结论已作废：${conc.invalidReason ?? ''}` });
  }
  for (const conc of conclusions.filter((x) => x.status === '已确认')) {
    for (const id of conc.gearBatchIds) {
      const b = batches.find((x) => x.id === id);
      if (b?.status === '过期') blockers.push({ type: 'gear', cargoId: conc.cargoId, message: `器材批次 ${id} 已过期` });
      if (b?.status === '送检中' && !b.releasedForCurrentVoyage) blockers.push({ type: 'gear', cargoId: conc.cargoId, message: `器材批次 ${id} 送检中未放行` });
    }
    for (const id of conc.pointIds) {
      const p = points.find((x) => x.id === id);
      if (p && (p.status !== '已占用' || p.occupiedBy !== conc.cargoId)) blockers.push({ type: 'point', cargoId: conc.cargoId, message: `绑扎点 ${id} 已失效` });
    }
  }
  return { passed: blockers.length === 0, blockers };
}

// 后到者看到替代点：同甲板、可用、距离最近
export function findAlternatives(point: LashingPoint, points: LashingPoint[], max = 4): LashingPoint[] {
  return points
    .filter((p) => p.status === '可用' && p.deck === point.deck)
    .map((p) => ({ p, d: Math.abs(p.bay - point.bay) + Math.abs(p.row - point.row) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.p);
}

// ---------- 初始数据 ----------

export function buildDefaultPoints(): LashingPoint[] {
  const points: LashingPoint[] = [];
  for (let bay = 4; bay <= 15; bay++) {
    for (let row = 0; row <= 3; row++) {
      points.push({ id: `LP-${bay}-${row}`, bay, row, deck: '主甲板', status: '可用', occupiedBy: null, recordedBy: null, recordedByAll: [], recordedAt: null, version: 0 });
    }
  }
  for (let bay = 5; bay <= 8; bay++) {
    points.push({ id: `LP-H-${bay}`, bay, row: 1, deck: '货舱', status: '可用', occupiedBy: null, recordedBy: null, recordedByAll: [], recordedAt: null, version: 0 });
  }
  return points;
}

export const DEFAULT_GEAR_BATCHES: GearBatch[] = [
  { id: 'LG-2609-01', type: '绑扎带', spec: '50mm × 6m · 5t', quantity: 24, certificateNo: 'ZS-2026-0901', inspectedAt: '2026-03-15', validUntil: '2026-09-14', status: '有效', releasedForCurrentVoyage: true },
  { id: 'LG-2609-02', type: '链条', spec: 'Φ13mm × 8m · 12t', quantity: 8, certificateNo: 'ZS-2026-0902', inspectedAt: '2026-04-02', validUntil: '2026-10-01', status: '有效', releasedForCurrentVoyage: true },
  { id: 'LG-2609-03', type: '花篮螺丝', spec: 'M24 · 8t', quantity: 16, certificateNo: 'ZS-2026-0903', inspectedAt: '2026-02-20', validUntil: '2026-08-19', status: '送检中', releasedForCurrentVoyage: true },
  { id: 'LG-2609-04', type: '卸扣', spec: '12t', quantity: 20, certificateNo: 'ZS-2026-0904', inspectedAt: '2026-05-10', validUntil: '2026-11-09', status: '有效', releasedForCurrentVoyage: true }
];

export function buildSeededPoints(): LashingPoint[] {
  const points = buildDefaultPoints();
  const occupy = (id: string, cargoId: string, by: Crew) => {
    const p = points.find((x) => x.id === id);
    if (p) {
      p.status = '已占用';
      p.occupiedBy = cargoId;
      p.recordedBy = by;
      p.recordedByAll = [by];
      p.recordedAt = '2026-09-30 10:12';
      p.version = 1;
    }
  };
  occupy('LP-15-0', 'BL-88247', '大副');
  occupy('LP-15-1', 'BL-88247', '大副');
  occupy('LP-14-0', 'BL-88247', '大副');
  occupy('LP-14-1', 'BL-88247', '大副');
  occupy('LP-13-0', 'BL-88219', '码头班');
  occupy('LP-13-1', 'BL-88219', '码头班');
  occupy('LP-8-2', 'BL-88240', '大副');
  occupy('LP-8-3', 'BL-88240', '大副');
  return points;
}

export function buildSeededConclusions(cargo: Cargo[], points: LashingPoint[], batches: GearBatch[]): LashingConclusion[] {
  const mk = (id: string, cargoId: string, pointIds: string[], gearBatchIds: string[]): LashingConclusion => {
    const item = cargo.find((c) => c.id === cargoId)!;
    return {
      id,
      cargoId,
      pointIds,
      gearBatchIds,
      status: '待确认',
      confirmedAt: null,
      confirmedBy: null,
      invalidReason: null,
      basedOn: { weight: item.weight, cog: cogOf([item]), pointSig: pointSig(points, pointIds), gearSig: gearSig(batches, gearBatchIds) }
    };
  };
  return [
    mk('LC-247', 'BL-88247', ['LP-15-0', 'LP-15-1', 'LP-14-0', 'LP-14-1'], ['LG-2609-01', 'LG-2609-02']),
    mk('LC-219', 'BL-88219', ['LP-13-0', 'LP-13-1'], ['LG-2609-01']),
    mk('LC-240', 'BL-88240', ['LP-8-2', 'LP-8-3'], ['LG-2609-02'])
  ];
}

export const EMPTY_STABILITY: StabilityConclusion = {
  status: '待确认',
  confirmedAt: null,
  confirmedBy: null,
  invalidReason: null,
  basedOn: { cog: 0, cargoSig: '' }
};

// 旧草稿升级：缺检验批次/绑扎点/结论时升级成首版 V1
export function migrateDraft(saved: any, cargo: Cargo[]): {
  gearBatches: GearBatch[];
  points: LashingPoint[];
  conclusions: LashingConclusion[];
  stability: StabilityConclusion;
  offlineQueue: OfflineRecord[];
  networkOnline: boolean;
  simulateFlushFailure: boolean;
  gateVersion: number;
  upgradedFromDraft: boolean;
} {
  if (saved && Array.isArray(saved.gearBatches) && Array.isArray(saved.points)) {
    return {
      gearBatches: saved.gearBatches,
      points: saved.points,
      conclusions: saved.conclusions ?? [],
      stability: saved.stability ?? EMPTY_STABILITY,
      offlineQueue: saved.offlineQueue ?? [],
      networkOnline: saved.networkOnline ?? true,
      simulateFlushFailure: saved.simulateFlushFailure ?? false,
      gateVersion: saved.gateVersion ?? 1,
      upgradedFromDraft: false
    };
  }
  const points = buildSeededPoints();
  const batches = DEFAULT_GEAR_BATCHES;
  return {
    gearBatches: batches,
    points,
    conclusions: buildSeededConclusions(cargo, points, batches),
    stability: EMPTY_STABILITY,
    offlineQueue: [],
    networkOnline: true,
    simulateFlushFailure: false,
    gateVersion: 1,
    // 仅当确实存在旧草稿、且其缺检验批次/绑扎点时才提示升级；全新用户直接初始化
    upgradedFromDraft: saved != null
  };
}
