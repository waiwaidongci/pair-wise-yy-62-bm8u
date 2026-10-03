import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { stowageApi, type Cargo, type CargoType } from './api';
import {
  buildSeededConclusions,
  buildSeededPoints,
  cogOf,
  cargoSig,
  findAlternatives,
  gateStatus,
  gearSig,
  migrateDraft,
  pointSig,
  revalidateConclusions,
  revalidateStability,
  type Crew,
  type GearBatch,
  type GearType,
  type LashingConclusion,
  type LashingPoint,
  type OfflineRecord,
  type StabilityConclusion
} from './lashing';

export type StowageComment = {
  id: string;
  cargoId: string;
  author: string;
  role: '船长' | '码头' | '货主';
  content: string;
  status: '待确认' | '已接受' | '已退回';
};

type State = {
  cargo: Cargo[];
  activeCargoId: string;
  planRevision: number;
  comments: StowageComment[];
  acceptedLimits: string[];
  locked: boolean;
  viewMode: '3d' | 'section';
  draftSavedAt: string;
  // 系固门禁
  gearBatches: GearBatch[];
  points: LashingPoint[];
  conclusions: LashingConclusion[];
  stability: StabilityConclusion;
  offlineQueue: OfflineRecord[];
  networkOnline: boolean;
  simulateFlushFailure: boolean;
  gateVersion: number;
  upgradedFromDraft: boolean;
  activeCrew: Crew;
  lastConflict: { pointId: string; by: Crew; alternatives: string[] } | null;
  lastFlush: { at: string; merged: number; duplicated: number; failed: number } | null;
};

const initialCargo: Cargo[] = [
  { id: 'BL-88214', bill: 'SEA-88214', type: '集装箱', bay: 12, row: 4, tier: 2, deck: '主甲板', weight: 24.6, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '已绑扎', color: '#2b7c75' },
  { id: 'BL-88219', bill: 'SEA-88219', type: '集装箱', bay: 13, row: 4, tier: 2, deck: '主甲板', weight: 28.1, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 1263', lashing: '需复核', color: '#c77835' },
  { id: 'BL-88231', bill: 'SEA-88231', type: '集装箱', bay: 10, row: 6, tier: 1, deck: '主甲板', weight: 18.2, dimension: '20 × 8 × 8.6 ft', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#366d94' },
  { id: 'BL-88240', bill: 'SEA-88240', type: '集装箱', bay: 8, row: 2, tier: 2, deck: '货舱', weight: 31.4, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '待绑扎', color: '#6d528d' },
  { id: 'BL-88247', bill: 'SEA-88247', type: '重大件', bay: 15, row: 0, tier: 1, deck: '主甲板', weight: 112.5, dimension: '18.4 × 4.2 × 4.8 m', port: '温哥华', hazmat: '无', lashing: '需复核', color: '#b64f49' },
  { id: 'BL-88254', bill: 'SEA-88254', type: '散货', bay: 5, row: 0, tier: 0, deck: '货舱', weight: 286.0, dimension: '散装 / 420 m³', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#9a7836' }
];

const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('yy62-stowage-plan') : null;
const saved = raw ? JSON.parse(raw) : null;

const seededComments: StowageComment[] = [
  { id: 'CM-21', cargoId: 'BL-88219', author: '港方配载', role: '码头', content: '危险品箱与船员生活区保持隔离，请在最终图中标注危险品隔离线。', status: '待确认' },
  { id: 'CM-22', cargoId: 'BL-88247', author: '周船长', role: '船长', content: '重大件横向支撑需增加两组绑扎点，检查甲板局部强度。', status: '待确认' },
  { id: 'CM-23', cargoId: 'BL-88254', author: '货主代表', role: '货主', content: '釜山港卸货前不得覆盖散货舱口，已接受当前安排。', status: '已接受' }
];

const baseState = {
  cargo: initialCargo,
  activeCargoId: 'BL-88247',
  planRevision: 5,
  comments: seededComments,
  acceptedLimits: [],
  locked: false,
  viewMode: '3d' as const,
  draftSavedAt: '09:52'
};

const migrated = migrateDraft(saved, baseState.cargo);
const initialState: State = {
  ...baseState,
  ...migrated,
  activeCrew: '大副',
  lastConflict: null,
  lastFlush: null
};

function revalidateDraft(state: State) {
  state.conclusions = revalidateConclusions(state.conclusions, state.cargo, state.points, state.gearBatches);
  state.stability = revalidateStability(state.stability, state.cargo);
}

const slice = createSlice({
  name: 'stowage',
  initialState,
  reducers: {
    selectCargo(state, action: PayloadAction<string>) { state.activeCargoId = action.payload; },
    moveCargo(state, action: PayloadAction<{ id: string; bay: number; row: number; tier: number }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (cargo) Object.assign(cargo, action.payload);
      state.planRevision += 1;
      state.draftSavedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      revalidateDraft(state);
    },
    updateLashing(state, action: PayloadAction<{ id: string; lashing: Cargo['lashing'] }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (cargo) cargo.lashing = action.payload.lashing;
      revalidateDraft(state);
    },
    addComment(state, action: PayloadAction<{ cargoId: string; author: string; role: StowageComment['role']; content: string }>) {
      state.comments.unshift({ ...action.payload, id: `CM-${Date.now()}`, status: '待确认' });
    },
    acceptComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload);
      if (comment) comment.status = '已接受';
    },
    rejectComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload);
      if (comment) comment.status = '已退回';
    },
    acceptLimit(state, action: PayloadAction<string>) {
      if (!state.acceptedLimits.includes(action.payload)) state.acceptedLimits.push(action.payload);
    },
    setViewMode(state, action: PayloadAction<'3d' | 'section'>) { state.viewMode = action.payload; },
    lockPlan(state) {
      const conflicts = detectConflicts(state.cargo);
      const gate = gateStatus(state.cargo, state.conclusions, state.stability, state.points, state.gearBatches, conflicts.length);
      if (!gate.passed) return; // 门禁未确认，锁不了版
      state.locked = true;
      state.planRevision += 1;
    },
    // ---------- 系固门禁 ----------
    setActiveCrew(state, action: PayloadAction<Crew>) { state.activeCrew = action.payload; },
    addGearBatch(state, action: PayloadAction<{ type: GearType; spec: string; quantity: number; certificateNo: string; inspectedAt: string; validUntil: string }>) {
      const n = state.gearBatches.length + 1;
      state.gearBatches.push({
        id: `LG-2609-${String(n).padStart(2, '0')}`,
        ...action.payload,
        status: '有效',
        releasedForCurrentVoyage: true
      });
    },
    sendGearForInspection(state, action: PayloadAction<string>) {
      const batch = state.gearBatches.find((b) => b.id === action.payload);
      if (!batch) return;
      batch.status = '送检中';
      // 旧放行照走：releasedForCurrentVoyage 保持 true，已放行航次继续有效，不作废结论
    },
    receiveGearCertificate(state, action: PayloadAction<{ id: string; certificateNo: string; inspectedAt: string; validUntil: string }>) {
      const batch = state.gearBatches.find((b) => b.id === action.payload.id);
      if (!batch) return;
      Object.assign(batch, action.payload);
      batch.status = '有效';
      revalidateDraft(state); // 检定变化 → 对应绑扎结论立即作废
    },
    recordLashingPoint(state, action: PayloadAction<{ bay: number; row: number; deck: '主甲板' | '货舱'; recordedBy: Crew }>) {
      const { bay, row, deck, recordedBy } = action.payload;
      if (!state.networkOnline) {
        // 断网补录：进入本地队列，回连后按绑扎点合并
        const localBatchId = `LB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 900 + 100)}`;
        state.offlineQueue.push({
          clientId: `CL-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          localBatchId,
          kind: 'point',
          payload: { bay, row, deck, recordedBy },
          createdAt: new Date().toISOString(),
          status: 'pending',
          attempts: 0
        });
        return;
      }
      applyPointRecord(state, { bay, row, deck, recordedBy, recordedAt: new Date().toISOString() });
    },
    releasePoint(state, action: PayloadAction<string>) {
      const p = state.points.find((x) => x.id === action.payload);
      if (!p) return;
      p.status = '可用';
      p.occupiedBy = null;
      p.recordedBy = null;
      p.recordedByAll = [];
      p.recordedAt = null;
      p.version += 1; // 绑扎点变化 → 结论作废
      revalidateDraft(state);
    },
    createConclusion(state, action: PayloadAction<string>) {
      const cargoId = action.payload;
      if (state.conclusions.some((c) => c.cargoId === cargoId)) return;
      const item = state.cargo.find((c) => c.id === cargoId);
      if (!item) return;
      const pointIds = state.points.filter((p) => p.status === '已占用' && p.occupiedBy === cargoId).map((p) => p.id);
      const gearBatchIds = state.gearBatches.filter((b) => b.status !== '过期').slice(0, 2).map((b) => b.id);
      state.conclusions.push({
        id: `LC-${cargoId.slice(-3)}`,
        cargoId,
        pointIds,
        gearBatchIds,
        status: '待确认',
        confirmedAt: null,
        confirmedBy: null,
        invalidReason: null,
        basedOn: { weight: item.weight, cog: cogOf([item]), pointSig: pointSig(state.points, pointIds), gearSig: gearSig(state.gearBatches, gearBatchIds) }
      });
    },
    addConclusionPoint(state, action: PayloadAction<{ cargoId: string; pointId: string }>) {
      const conc = state.conclusions.find((c) => c.cargoId === action.payload.cargoId);
      const p = state.points.find((x) => x.id === action.payload.pointId);
      if (!conc || !p) return;
      if (!conc.pointIds.includes(p.id)) conc.pointIds.push(p.id);
    },
    removeConclusionPoint(state, action: PayloadAction<{ cargoId: string; pointId: string }>) {
      const conc = state.conclusions.find((c) => c.cargoId === action.payload.cargoId);
      if (conc) conc.pointIds = conc.pointIds.filter((id) => id !== action.payload.pointId);
    },
    addConclusionGear(state, action: PayloadAction<{ cargoId: string; gearId: string }>) {
      const conc = state.conclusions.find((c) => c.cargoId === action.payload.cargoId);
      if (!conc) return;
      if (!conc.gearBatchIds.includes(action.payload.gearId)) conc.gearBatchIds.push(action.payload.gearId);
    },
    removeConclusionGear(state, action: PayloadAction<{ cargoId: string; gearId: string }>) {
      const conc = state.conclusions.find((c) => c.cargoId === action.payload.cargoId);
      if (conc) conc.gearBatchIds = conc.gearBatchIds.filter((id) => id !== action.payload.gearId);
    },
    confirmConclusion(state, action: PayloadAction<{ cargoId: string; confirmedBy: string }>) {
      const conc = state.conclusions.find((c) => c.cargoId === action.payload.cargoId);
      const item = state.cargo.find((c) => c.id === action.payload.cargoId);
      if (!conc || !item) return;
      conc.status = '已确认';
      conc.confirmedAt = new Date().toISOString();
      conc.confirmedBy = action.payload.confirmedBy;
      conc.invalidReason = null;
      conc.basedOn = { weight: item.weight, cog: cogOf([item]), pointSig: pointSig(state.points, conc.pointIds), gearSig: gearSig(state.gearBatches, conc.gearBatchIds) };
    },
    confirmStability(state, action: PayloadAction<string>) {
      state.stability.status = '已确认';
      state.stability.confirmedAt = new Date().toISOString();
      state.stability.confirmedBy = action.payload;
      state.stability.invalidReason = null;
      state.stability.basedOn = { cog: cogOf(state.cargo), cargoSig: cargoSig(state.cargo) };
    },
    setNetworkOnline(state, action: PayloadAction<boolean>) { state.networkOnline = action.payload; },
    setSimulateFlushFailure(state, action: PayloadAction<boolean>) { state.simulateFlushFailure = action.payload; },
    flushOfflineQueue(state) {
      if (!state.networkOnline) return;
      const pending = state.offlineQueue.filter((r) => r.status === 'pending' || r.status === 'failed');
      if (pending.length === 0) return;
      if (state.simulateFlushFailure) {
        // 回连失败：保留本地批次，可重试
        pending.forEach((r) => { r.status = 'failed'; r.attempts += 1; });
        state.lastFlush = { at: new Date().toISOString(), merged: 0, duplicated: 0, failed: pending.length };
        state.simulateFlushFailure = false;
        return;
      }
      let merged = 0;
      let duplicated = 0;
      for (const rec of pending) {
        // 幂等：同 clientId 已同步则跳过，不重复计时
        if (state.offlineQueue.some((r) => r.clientId !== rec.clientId && r.status === 'synced' && samePointPayload(r.payload, rec.payload))) {
          duplicated += 1;
          rec.status = 'synced';
          continue;
        }
        if (rec.kind === 'point') {
          applyPointRecord(state, { ...(rec.payload as { bay: number; row: number; deck: '主甲板' | '货舱'; recordedBy: Crew }), recordedAt: rec.createdAt });
          merged += 1;
        }
        rec.status = 'synced';
      }
      state.lastFlush = { at: new Date().toISOString(), merged, duplicated, failed: 0 };
      revalidateDraft(state);
    },
    retryOfflineBatch(state, action: PayloadAction<string>) {
      if (!state.networkOnline) return;
      const batchId = action.payload;
      const recs = state.offlineQueue.filter((r) => r.localBatchId === batchId && r.status === 'failed');
      if (recs.length === 0) return;
      let merged = 0;
      for (const rec of recs) {
        if (rec.kind === 'point') {
          applyPointRecord(state, { ...(rec.payload as { bay: number; row: number; deck: '主甲板' | '货舱'; recordedBy: Crew }), recordedAt: rec.createdAt });
          merged += 1;
        }
        rec.status = 'synced';
      }
      state.lastFlush = { at: new Date().toISOString(), merged, duplicated: 0, failed: 0 };
      revalidateDraft(state);
    },
    clearConflict(state) { state.lastConflict = null; },
    dismissUpgrade(state) { state.upgradedFromDraft = false; }
  }
});

// 绑扎点记录应用：先到者占用，后到者看替代点；同点合并，不重复计时
function applyPointRecord(
  state: State,
  payload: { bay: number; row: number; deck: '主甲板' | '货舱'; recordedBy: Crew; recordedAt?: string }
) {
  const { bay, row, deck, recordedBy } = payload;
  const recordedAt = payload.recordedAt ?? new Date().toISOString();
  const id = `LP-${bay}-${row}`;
  const existing = state.points.find((p) => p.id === id);
  if (existing) {
    if (existing.status === '已占用' && existing.recordedBy !== recordedBy) {
      // 两班同时提交同一绑扎点：先到者占用，后到者看到替代点
      state.lastConflict = {
        pointId: id,
        by: recordedBy,
        alternatives: findAlternatives(existing, state.points).map((p) => p.id)
      };
      return;
    }
    // 同班组补录或已占用：合并，保留最早 recordedAt（不重复计时）
    if (!existing.recordedByAll.includes(recordedBy)) existing.recordedByAll.push(recordedBy);
    if (!existing.recordedAt || recordedAt < existing.recordedAt) existing.recordedAt = recordedAt;
    return;
  }
  state.points.push({
    id,
    bay,
    row,
    deck,
    status: '已占用',
    occupiedBy: null,
    recordedBy,
    recordedByAll: [recordedBy],
    recordedAt,
    version: 1
  });
}

function samePointPayload(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return a.bay === b.bay && a.row === b.row && a.deck === b.deck;
}

export const {
  selectCargo,
  moveCargo,
  updateLashing,
  addComment,
  acceptComment,
  rejectComment,
  acceptLimit,
  setViewMode,
  lockPlan,
  setActiveCrew,
  addGearBatch,
  sendGearForInspection,
  receiveGearCertificate,
  recordLashingPoint,
  releasePoint,
  createConclusion,
  addConclusionPoint,
  removeConclusionPoint,
  addConclusionGear,
  removeConclusionGear,
  confirmConclusion,
  confirmStability,
  setNetworkOnline,
  setSimulateFlushFailure,
  flushOfflineQueue,
  retryOfflineBatch,
  clearConflict,
  dismissUpgrade
} = slice.actions;

export const store = configureStore({
  reducer: { stowage: slice.reducer, [stowageApi.reducerPath]: stowageApi.reducer },
  middleware: (getDefault) => getDefault().concat(stowageApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('yy62-stowage-plan', JSON.stringify(store.getState().stowage));
});

export type RootState = ReturnType<typeof store.getState>;

export function calculateStability(cargo: Cargo[]) {
  const total = cargo.reduce((sum, item) => sum + item.weight, 0);
  const longitudinal = cargo.reduce((sum, item) => sum + item.weight * item.bay, 0) / Math.max(total, 1);
  const vertical = cargo.reduce((sum, item) => sum + item.weight * (item.tier + 1), 0) / Math.max(total, 1);
  const deckLoad = cargo.filter((item) => item.deck === '主甲板').reduce((sum, item) => sum + item.weight, 0);
  const stability = Math.max(0, 92 - Math.abs(longitudinal - 10.8) * 2.2 - Math.max(0, vertical - 1.75) * 8);
  return {
    total,
    longitudinal,
    vertical,
    deckLoad,
    stability,
    trim: (longitudinal - 10.8) < -0.4 ? '艉倾' : (longitudinal - 10.8) > 0.4 ? '艏倾' : '正平'
  };
}

export function detectConflicts(cargo: Cargo[]) {
  const issues: { id: string; cargoId: string; level: 'high' | 'medium'; title: string; detail: string }[] = [];
  const slots = new Map<string, Cargo>();
  cargo.forEach((item) => {
    const key = `${item.deck}-${item.bay}-${item.row}-${item.tier}`;
    const existing = slots.get(key);
    if (existing) issues.push({ id: `${item.id}-overlap`, cargoId: item.id, level: 'high', title: '货位重叠', detail: `${item.id} 与 ${existing.id} 占用相同二维货位。` });
    slots.set(key, item);
    if (item.hazmat !== '无' && item.deck === '主甲板' && item.row <= 1) issues.push({ id: `${item.id}-hazmat`, cargoId: item.id, level: 'high', title: '危险品隔离不足', detail: `${item.id} 与船体边界距离小于方案要求。` });
    if (item.weight > 100 && item.lashing !== '已绑扎') issues.push({ id: `${item.id}-lashing`, cargoId: item.id, level: 'medium', title: '重大件绑扎未完成', detail: `${item.id} 重量 ${item.weight}t，绑扎状态为“${item.lashing}”。` });
    if (item.type === '集装箱' && item.weight > 30 && item.tier >= 3) issues.push({ id: `${item.id}-stack`, cargoId: item.id, level: 'medium', title: '上层堆重超限', detail: `${item.id} 不应放在第 ${item.tier} 层。` });
  });
  return issues;
}
