import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  resetServer,
  seedAssignments,
  seedBatches,
  seedInspections,
  seedPoints,
  setServerForceFail,
  submitLashingToServer,
  type ServerSubmitResult
} from './data';
import { LASHING_REQUIREMENTS, batchUsable, mergeQueueByPoint, suggestAlternatives } from './logic';
import type {
  ConflictAdvice,
  GateEvent,
  GateState,
  QueueOp,
  Shift
} from './types';

const PERSIST_KEY = 'yy62-gate-state';
export const FIRST_LEGACY_REVISION = 1; // 旧草稿缺检验批次时升级为首版

let eventSeq = 0;
function event(kind: GateEvent['kind'], text: string): GateEvent {
  return { id: `EV-${Date.now()}-${eventSeq++}`, at: Date.now(), kind, text };
}

export function buildInitialGateState(): GateState {
  return {
    shift: '码头班',
    online: true,
    failNext: false,
    versionRevision: 6,
    versionLocked: false,
    migratedFromLegacy: false,
    batches: seedBatches.map((b) => ({ ...b })),
    inspections: seedInspections.map((i) => ({ ...i })),
    points: seedPoints.map((p) => ({ ...p })),
    assignments: seedAssignments.map((a) => ({ ...a })),
    lashingConclusions: {
      'BL-88247': { cargoId: 'BL-88247', status: '有效', updatedAt: Date.now() - 3_600_000 },
      'BL-88219': { cargoId: 'BL-88219', status: '有效', updatedAt: Date.now() - 3_500_000 }
    },
    stability: { planRevision: 5, status: '有效', updatedAt: Date.now() - 3_600_000 },
    queue: [],
    advice: [],
    events: [
      event('occupy-ok', '初始装载：重大件 BL-88247 已占用 LP-15-L1/L2/R1，危险品箱 BL-88219 已占用 LP-13-L1'),
      event('inspection', '批次 EQ-B07、EQ-C03 随检验批次 JC-2610-01 送检；EQ-B07 旧放行仍在有效期，照走')
    ]
  };
}

function loadInitial(): GateState {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as GateState;
        return { ...buildInitialGateState(), ...parsed, online: true, failNext: false };
      } catch { /* 损坏则重建 */ }
    }
  }
  return buildInitialGateState();
}

interface SubmitArg {
  cargoId: string;
  pointId: string;
  equipmentBatchId: string;
}

/** 单条绑扎提交：在线直接裁决；离线进入本地批次队列（回连后补录） */
export const submitLashing = createAsyncThunk('gate/submit', async (arg: SubmitArg, { getState, dispatch, rejectWithValue }) => {
  const state = (getState() as { gate: GateState }).gate;
  if (state.versionLocked) {
    dispatch(gateSlice.actions.blockAttempt('版本已锁定：绑扎点占用变更被拦截，请先解锁（重新走确认流程）'));
    return rejectWithValue({ locked: true });
  }
  const op: QueueOp = {
    clientId: `CL-${arg.cargoId}-${arg.pointId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'lashing-submit',
    cargoId: arg.cargoId,
    pointId: arg.pointId,
    equipmentBatchId: arg.equipmentBatchId,
    shift: state.shift,
    clientCreatedAt: Date.now(),
    status: '待同步',
    attempts: 0
  };

  if (!state.online) {
    dispatch(gateSlice.actions.queueLocal({ op }));
    return { mode: 'offline' as const, op };
  }

  dispatch(gateSlice.actions.markSync({ clientId: op.clientId, op }));
  try {
    const result = await submitLashingToServer({
      clientId: op.clientId,
      cargoId: op.cargoId,
      pointId: op.pointId,
      equipmentBatchId: op.equipmentBatchId,
      shift: op.shift,
      clientCreatedAt: op.clientCreatedAt
    });
    dispatch(gateSlice.actions.resolveSync({ op, result }));
    return { mode: 'online' as const, op, result };
  } catch (e) {
    dispatch(gateSlice.actions.resolveSync({ op, result: { error: (e as Error).message } }));
    return rejectWithValue({ op, error: (e as Error).message });
  }
});

/** 两班同时争抢同一绑扎点：本地按生成顺序先到先裁，服务端再次裁决 */
export const submitConcurrent = createAsyncThunk(
  'gate/concurrent',
  async (arg: { cargoId: string; pointId: string; equipmentBatchId: string }, { getState, dispatch, rejectWithValue }) => {
    const state = (getState() as { gate: GateState }).gate;
    if (state.versionLocked) {
      dispatch(gateSlice.actions.blockAttempt('版本已锁定：双班争抢演示被拦截'));
      return rejectWithValue({ locked: true });
    }
    const otherShift: Shift = state.shift === '码头班' ? '大副' : '码头班';
    const base = Date.now();
    // 两班"同时"提交：随机决定谁先到（1ms 差），模拟网络到达顺序
    const order = Math.random() < 0.5 ? [state.shift, otherShift] : [otherShift, state.shift];
    const payloads = order.map((shift, index) => ({
      clientId: `CC-${arg.cargoId}-${shift}-${base}-${index}`,
      type: 'lashing-submit' as const,
      cargoId: index === 0 ? arg.cargoId : 'BL-88219',
      pointId: arg.pointId,
      equipmentBatchId: arg.equipmentBatchId,
      shift,
      clientCreatedAt: base + index,
      status: '待同步' as const,
      attempts: 0
    }));

    if (!state.online) {
      dispatch(gateSlice.actions.queueConcurrent({ ops: payloads }));
      return { mode: 'offline' as const };
    }

    const results: { op: QueueOp; result: ServerSubmitResult | { error: string } }[] = [];
    for (const op of payloads) {
      dispatch(gateSlice.actions.markSync({ clientId: op.clientId, op }));
      try {
        const result = await submitLashingToServer(op);
        dispatch(gateSlice.actions.resolveSync({ op, result }));
        results.push({ op, result });
      } catch (e) {
        const result = { error: (e as Error).message };
        dispatch(gateSlice.actions.resolveSync({ op, result }));
        results.push({ op, result });
      }
    }
    return { mode: 'online' as const, results };
  }
);

/** 回连补录：按绑扎点合并、去重后逐条重试；失败的留在本地批次 */
export const flushQueue = createAsyncThunk('gate/flush', async (_: void, { getState, dispatch }) => {
  const state = (getState() as { gate: GateState }).gate;
  const retryable = state.queue.filter((op) => op.status === '待同步' || op.status === '失败');
  const { merged, dropped } = mergeQueueByPoint(retryable);
  dispatch(gateSlice.actions.applyMerge({ merged, dropped }));

  const outcomes: { op: QueueOp; result: ServerSubmitResult | { error: string } }[] = [];
  for (const op of merged) {
    dispatch(gateSlice.actions.markSync({ clientId: op.clientId }));
    try {
      const result = await submitLashingToServer({
        clientId: op.clientId,
        cargoId: op.cargoId,
        pointId: op.pointId,
        equipmentBatchId: op.equipmentBatchId,
        shift: op.shift,
        clientCreatedAt: op.clientCreatedAt
      });
      dispatch(gateSlice.actions.resolveSync({ op, result }));
      outcomes.push({ op, result });
    } catch (e) {
      const result = { error: (e as Error).message };
      dispatch(gateSlice.actions.resolveSync({ op, result }));
      outcomes.push({ op, result });
    }
  }
  return outcomes;
});

function invalidateAffected(state: GateState, opts: { equipmentBatchId?: string; pointId?: string; cargoId?: string }) {
  const cargoIds = new Set<string>();
  if (opts.cargoId) cargoIds.add(opts.cargoId);
  state.assignments.forEach((a) => {
    if (opts.equipmentBatchId && a.equipmentBatchId === opts.equipmentBatchId) cargoIds.add(a.cargoId);
    if (opts.pointId && a.pointId === opts.pointId) cargoIds.add(a.cargoId);
  });
  cargoIds.forEach((cargoId) => {
    state.lashingConclusions[cargoId] = {
      cargoId,
      status: '已作废',
      reason: opts.pointId ? `绑扎点 ${opts.pointId} 状态变化` : `检验批次结果变化（${opts.equipmentBatchId}）`,
      updatedAt: Date.now()
    };
  });
  // 稳性与绑扎耦合：绑扎结论作废时稳性结论一并作废，未重新确认不得锁版
  if (cargoIds.size > 0) {
    state.stability = { planRevision: state.stability.planRevision, status: '已作废', reason: '绑扎结论作废联动', updatedAt: Date.now() };
  }
  return [...cargoIds];
}

const slice = createSlice({
  name: 'gate',
  initialState: loadInitial,
  reducers: {
    setShift(state, action: PayloadAction<Shift>) { state.shift = action.payload; },
    setOnline(state, action: PayloadAction<boolean>) {
      state.online = action.payload;
      state.events.unshift(event('queue', action.payload ? '链路恢复：可回连补录' : '已断网：绑扎提交进入本地批次，回连后按绑扎点合并'));
    },
    armFailure(state) {
      state.failNext = true;
      setServerForceFail(true);
      state.events.unshift(event('queue', '已注入一次链路故障：下一次提交将失败并进入本地批次重试'));
    },

    // 检验批次结果落地：关联器材批次状态立即更新，相应绑扎结论立即作废
    resolveInspection(state, action: PayloadAction<{ inspectionId: string; result: '合格' | '不合格' }>) {
      const inspection = state.inspections.find((i) => i.id === action.payload.inspectionId);
      if (!inspection || state.versionLocked) return;
      inspection.result = action.payload.result;
      inspection.resultedAt = new Date().toISOString().slice(0, 10);
      const affected: string[] = [];
      state.batches.forEach((batch) => {
        if (batch.inspectionBatchId !== inspection.id) return;
        batch.sentForInspection = false;
        if (action.payload.result === '合格') {
          batch.status = '有效';
          batch.certNo = `RL-${inspection.id.slice(-5)}-${batch.id.slice(-3)}`;
          batch.validUntil = '2027-04-30';
          batch.certValid = true;
        } else {
          batch.status = '过期';
          batch.certValid = false;
          affected.push(...invalidateAffected(state, { equipmentBatchId: batch.id }));
        }
      });
      state.events.unshift(event(
        'inspection',
        `检验批次 ${inspection.id} 出结果：${action.payload.result}` +
        (action.payload.result === '不合格' && affected.length ? `；${[...new Set(affected)].join('、')} 的绑扎结论已作废` : '；器材批次放行状态已更新')
      ));
    },

    // 绑扎点停用/修复：占用该点的绑扎结论立即作废
    setPointStatus(state, action: PayloadAction<{ pointId: string; status: '正常' | '损伤停用' }>) {
      if (state.versionLocked) return;
      const point = state.points.find((p) => p.id === action.payload.pointId);
      if (!point || point.status === action.payload.status) return;
      point.status = action.payload.status;
      const affected = invalidateAffected(state, { pointId: point.id });
      state.events.unshift(event(
        'invalidate',
        `绑扎点 ${point.id} 标记为${action.payload.status}` + (affected.length ? `；${[...new Set(affected)].join('、')} 的绑扎与稳性结论立即作废` : '')
      ));
    },

    // 重心（配载）变化后稳性结论作废（由配载工作台在移货后调用）
    invalidateStability(state, action: PayloadAction<{ planRevision: number; reason: string }>) {
      if (state.stability.planRevision !== action.payload.planRevision || state.stability.status !== '有效') {
        state.stability = { planRevision: action.payload.planRevision, status: '已作废', reason: action.payload.reason, updatedAt: Date.now() };
        state.versionLocked = false; // 锁版依据已变，自动解锁待重新确认
        state.events.unshift(event('invalidate', `重心/配载变化（V${action.payload.planRevision}）：稳性结论作废，已锁定版本同时失效`));
      }
    },

    confirmLashing(state, action: PayloadAction<string>) {
      const cargoId = action.payload;
      state.lashingConclusions[cargoId] = { cargoId, status: '有效', updatedAt: Date.now() };
      state.events.unshift(event('confirm', `大副重新确认 ${cargoId} 绑扎校核结论`));
    },
    confirmStability(state, action: PayloadAction<number>) {
      state.stability = { planRevision: action.payload, status: '有效', updatedAt: Date.now() };
      state.events.unshift(event('confirm', `大副确认基于配载 V${action.payload} 的稳性结论`));
    },

    lockVersion(state) {
      state.versionLocked = true;
      state.versionRevision += 1;
      state.events.unshift(event('lock', `系固与稳性版本 V${state.versionRevision} 锁定，可打印开航资料`));
    },
    blockAttempt(state, action: PayloadAction<string>) {
      state.events.unshift(event('block', action.payload));
    },

    queueLocal(state, action: PayloadAction<{ op: QueueOp }>) {
      state.queue.push(action.payload.op);
      state.events.unshift(event('queue', `断网：${action.payload.op.shift} 对 ${action.payload.op.cargoId} @ ${action.payload.op.pointId} 的绑扎提交存入本地批次`));
    },
    queueConcurrent(state, action: PayloadAction<{ ops: QueueOp[] }>) {
      state.queue.push(...action.payload.ops);
      const [first, second] = action.payload.ops;
      state.events.unshift(event(
        'occupy-conflict',
        `断网双班同时提交：${first.shift}（${first.cargoId}）本地先到占位 ${first.pointId}，${second.shift} 回连后见裁决与替代点`
      ));
    },
    markSync(state, action: PayloadAction<{ clientId: string; op?: QueueOp }>) {
      const existing = state.queue.find((op) => op.clientId === action.payload.clientId);
      if (existing) {
        existing.status = '同步中';
        existing.attempts += 1;
      } else if (action.payload.op) {
        state.queue.push({ ...action.payload.op, status: '同步中', attempts: 1 });
      }
    },
    resolveSync(state, action: PayloadAction<{ op: QueueOp; result: ServerSubmitResult | { error: string } }>) {
      const { op, result } = action.payload;
      const queued = state.queue.find((item) => item.clientId === op.clientId);

      if ('error' in result) {
        if (queued) {
          queued.status = '失败';
          queued.lastError = result.error;
        } else {
          state.queue.push({ ...op, status: '失败', attempts: 1, lastError: result.error });
        }
        state.events.unshift(event('queue', `提交 ${op.cargoId} @ ${op.pointId} 失败：${result.error}；保留在本地批次，可重试`));
        return;
      }

      if (result.outcome === 'accepted' || result.outcome === 'duplicate') {
        const a = result.assignment;
        // 幂等：重复上传不产生新占用、不刷新计时
        if (!state.assignments.some((item) => item.clientId === a.clientId || item.pointId === a.pointId)) {
          state.assignments.push({ ...a });
        }
        if (queued) {
          queued.status = '已同步';
          queued.syncedAt = Date.now();
          queued.serverSeq = a.serverSeq;
        }
        state.events.unshift(event(
          'occupy-ok',
          result.outcome === 'duplicate'
            ? `重复上传 ${op.cargoId} @ ${a.pointId} 命中幂等记录（#${a.serverSeq}），计时仍为 ${new Date(a.securedAt).toLocaleTimeString('zh-CN')}`
            : `${a.shift}提交的 ${a.cargoId} 占用绑扎点 ${a.pointId}（受理 #${a.serverSeq}，器材 ${a.equipmentBatchId}）`
        ));
      } else {
        // conflict：先到者占用，后到者得到替代点建议
        const occupied = result.occupiedBy;
        if (queued) queued.status = '冲突';
        const req = LASHING_REQUIREMENTS[op.cargoId];
        const alternatives = suggestAlternatives(
          op.pointId,
          req?.minWll ?? 0,
          state.points,
          state.assignments
        );
        const advice: ConflictAdvice = {
          id: `ADV-${op.clientId}`,
          cargoId: op.cargoId,
          pointId: op.pointId,
          winnerShift: occupied.shift,
          winnerCargoId: occupied.cargoId,
          alternatives,
          at: Date.now()
        };
        state.advice.unshift(advice);
        state.events.unshift(event(
          'occupy-conflict',
          `${op.shift}（${op.cargoId}）争抢 ${op.pointId} 失利：${occupied.shift}（${occupied.cargoId}）已先占（#${occupied.serverSeq}），建议改占 ${alternatives.join('、') || '（暂无可用替代点）'}`
        ));
      }
    },
    applyMerge(state, action: PayloadAction<{ merged: QueueOp[]; dropped: QueueOp[] }>) {
      const ids = new Set(action.payload.merged.map((op) => op.clientId));
      const synced = state.queue.filter((op) => op.status === '已同步');
      const other = state.queue.filter((op) => !ids.has(op.clientId) && op.status !== '待同步' && op.status !== '失败');
      state.queue = [...synced, ...other, ...action.payload.merged];
      if (action.payload.dropped.length) {
        state.events.unshift(event('queue', `回连合并：按绑扎点合并 ${action.payload.merged.length} 条，去重 ${action.payload.dropped.length} 条重复上传（不重复计时）`));
      } else {
        state.events.unshift(event('queue', `回连合并：${action.payload.merged.length} 条本地记录按绑扎点整理后补录`));
      }
    },
    dismissAdvice(state, action: PayloadAction<string>) {
      state.advice = state.advice.filter((a) => a.id !== action.payload);
    },

    // 旧草稿缺检验批次 → 升级成首版（演示入口：从仅配载草稿迁移）
    migrateLegacyDraft(state) {
      if (state.migratedFromLegacy) return;
      state.migratedFromLegacy = true;
      state.versionRevision = FIRST_LEGACY_REVISION;
      state.versionLocked = false;
      state.batches.forEach((b) => { void batchUsable(b); });
      state.stability = { planRevision: 5, status: '已作废', reason: '旧草稿升级首版，需重新确认', updatedAt: Date.now() };
      Object.values(state.lashingConclusions).forEach((c) => {
        c.status = '已作废';
        c.reason = '旧草稿缺检验批次，升级为首版后需重新确认';
        c.updatedAt = Date.now();
      });
      state.events.unshift(event('migrate', '检测到旧草稿缺少检验批次：已为全部器材批次补挂检验批次并升级为系固首版 V1，结论待重新确认'));
    },

    resetDemo() {
      resetServer();
      if (typeof localStorage !== 'undefined') localStorage.removeItem(PERSIST_KEY);
      return buildInitialGateState();
    }
  }
});

export const gateSlice = slice;
export const {
  setShift,
  setOnline,
  armFailure,
  resolveInspection,
  setPointStatus,
  invalidateStability,
  confirmLashing,
  confirmStability,
  lockVersion,
  blockAttempt,
  dismissAdvice,
  migrateLegacyDraft,
  resetDemo
} = slice.actions;
export const gateActions = slice.actions;

export function persistGateState(state: GateState) {
  if (typeof localStorage === 'undefined') return;
  const { online: _online, failNext: _fail, ...persisted } = state;
  void _online; void _fail;
  localStorage.setItem(PERSIST_KEY, JSON.stringify(persisted));
}
