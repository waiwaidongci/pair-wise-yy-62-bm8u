import type {
  EquipBatch,
  GateState,
  LashingAssign,
  LashingPoint,
  QueueOp
} from './types';

// 需要纳入开航门禁的绑扎要求：货物 -> 需要的有效绑扎点数与最低负荷
export const LASHING_REQUIREMENTS: Record<string, { points: number; minWll: number; label: string }> = {
  'BL-88247': { points: 4, minWll: 100, label: '重大件四点绑扎' },
  'BL-88219': { points: 2, minWll: 80, label: '危险品箱两点绑扎' }
};

/** 器材批次当前是否可用于系固：过期/检定不合格不可用；送检中但旧放行有效则放行照走 */
export function batchUsable(batch: EquipBatch): { usable: boolean; note: string } {
  if (!batch.certValid) return { usable: false, note: '放行已过期，等待检定结果' };
  if (batch.sentForInspection) return { usable: true, note: '送检中，旧放行照走（有效期至 ' + batch.validUntil + '）' };
  return { usable: true, note: '放行有效（至 ' + batch.validUntil + '）' };
}

/** 绑扎点是否可占用：停用点不参与推荐 */
export function pointUsable(point: LashingPoint) {
  return point.status === '正常';
}

/**
 * 推荐替代绑扎点：
 * 1. 同 Bay 且状态正常、未占用；2. 负荷满足要求；3. 同舷侧优先，其次对侧
 */
export function suggestAlternatives(
  preferredPointId: string,
  requiredWll: number,
  points: LashingPoint[],
  assignments: LashingAssign[]
): string[] {
  const preferred = points.find((p) => p.id === preferredPointId);
  const occupied = new Set(assignments.map((a) => a.pointId));
  const pool = points
    .filter((p) => p.id !== preferredPointId && pointUsable(p) && p.wll >= requiredWll && !occupied.has(p.id))
    .sort((a, b) => {
      if (!preferred) return a.bay - b.bay;
      const score = (p: LashingPoint) =>
        (p.bay === preferred.bay ? 0 : 10 + Math.abs(p.bay - preferred.bay)) +
        (p.side === preferred.side ? 0 : 2);
      return score(a) - score(b);
    });
  return pool.slice(0, 3).map((p) => p.id);
}

export interface GateCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
  blocking: boolean;
}

/**
 * 开航门禁校核。任一项不通过即不允许锁版与打印。
 */
export function evaluateGate(state: GateState): { passed: boolean; checks: GateCheck[] } {
  const checks: GateCheck[] = [];
  const batchById = new Map(state.batches.map((b) => [b.id, b]));
  const pointById = new Map(state.points.map((p) => [p.id, p]));

  // 1. 每票重点货物的绑扎点数是否占满，器材是否可用，绑扎点是否正常
  for (const [cargoId, req] of Object.entries(LASHING_REQUIREMENTS)) {
    const assigns = state.assignments.filter((a) => a.cargoId === cargoId);
    const uniquePoints = new Set(assigns.map((a) => a.pointId));
    if (uniquePoints.size >= req.points) {
      checks.push({ key: `count-${cargoId}`, label: `${cargoId} ${req.label}`, passed: true, detail: `已占用 ${uniquePoints.size} 个绑扎点`, blocking: true });
    } else {
      checks.push({ key: `count-${cargoId}`, label: `${cargoId} ${req.label}`, passed: false, detail: `还需 ${req.points - uniquePoints.size} 个绑扎点`, blocking: true });
    }

    const badEquipment = assigns.filter((a) => {
      const batch = batchById.get(a.equipmentBatchId);
      return !batch || !batchUsable(batch).usable;
    });
    checks.push({
      key: `equip-${cargoId}`,
      label: `${cargoId} 系固器材批次`,
      passed: badEquipment.length === 0 && assigns.length > 0,
      detail: badEquipment.length
        ? `批次 ${badEquipment.map((a) => a.equipmentBatchId).join('、')} 不可用（过期或检定不合格）`
        : assigns.length ? '全部器材批次放行有效' : '尚未使用任何器材',
      blocking: true
    });

    const overloaded = assigns.filter((a) => {
      const point = pointById.get(a.pointId);
      return !point || !pointUsable(point) || point.wll < req.minWll;
    });
    checks.push({
      key: `point-${cargoId}`,
      label: `${cargoId} 绑扎点状态与负荷`,
      passed: overloaded.length === 0 && assigns.length > 0,
      detail: overloaded.length
        ? `绑扎点 ${overloaded.map((a) => a.pointId).join('、')} 停用或负荷不足（需 ≥${req.minWll}kN）`
        : assigns.length ? '绑扎点正常、负荷满足' : '尚未占用绑扎点',
      blocking: true
    });
  }

  // 2. 绑扎结论：检定 / 重心 / 绑扎点变化后立即作废，必须重新确认
  const invalidLashing = Object.values(state.lashingConclusions).filter((c) => c.status === '已作废');
  checks.push({
    key: 'lashing-conclusions',
    label: '绑扎校核结论',
    passed: invalidLashing.length === 0,
    detail: invalidLashing.length ? `${invalidLashing.map((c) => c.cargoId + '（' + c.reason + '）').join('、')} 已作废待确认` : '全部有效',
    blocking: true
  });

  // 3. 稳性结论：配载（重心）变化后作废
  checks.push({
    key: 'stability',
    label: '稳性结论',
    passed: state.stability.status === '有效',
    detail: state.stability.status === '有效'
      ? `基于配载 V${state.stability.planRevision}，大副已确认`
      : `已作废（${state.stability.reason}），需重新确认`,
    blocking: true
  });

  // 4. 断网补录队列：存在未成功同步的记录不得开航
  const pending = state.queue.filter((op) => op.status === '待同步' || op.status === '同步中' || op.status === '失败');
  checks.push({
    key: 'queue',
    label: '离线补录同步',
    passed: pending.length === 0,
    detail: pending.length ? `${pending.length} 条绑扎记录待同步/重试` : '本地记录均已同步',
    blocking: true
  });

  // 5. 先到先裁冲突：后到者尚未改用替代点
  const unresolved = state.advice.filter((adv) => !state.assignments.some((a) => a.cargoId === adv.cargoId && a.pointId !== adv.pointId && adv.alternatives.includes(a.pointId)));
  // 仅在"需求点数未占满"时才真正阻断，已通过补点解决的冲突只作提示
  const reallyBlocking = unresolved.filter((adv) => {
    const req = LASHING_REQUIREMENTS[adv.cargoId];
    if (!req) return false;
    return new Set(state.assignments.filter((a) => a.cargoId === adv.cargoId).map((a) => a.pointId)).size < req.points;
  });
  checks.push({
    key: 'conflicts',
    label: '绑扎点先到先裁',
    passed: reallyBlocking.length === 0,
    detail: reallyBlocking.length
      ? `${reallyBlocking.length} 起争抢需改占替代点：${reallyBlocking.map((a) => `${a.cargoId}→${a.pointId}`).join('、')}`
      : unresolved.length ? '争抢已通过替代点解决' : '无争抢',
    blocking: true
  });

  return { passed: checks.every((c) => !c.blocking || c.passed), checks };
}

/**
 * 断网补录回连后，按绑扎点合并待同步记录：
 * - 按绑扎点分组，同一点上「同票货 + 同器材批次」的重复上传只保留首条（重复上传不重复计时）
 * - 不同班组/货物对同一点的争抢予以保留，回连后按本地生成顺序交服务端先到先裁
 * - 失败的记录保留在本地批次中等待重试，不会因合并丢失
 */
export function mergeQueueByPoint(queue: QueueOp[]): { merged: QueueOp[]; dropped: QueueOp[] } {
  const kept = new Map<string, QueueOp>();
  const dropped: QueueOp[] = [];
  const ordered = [...queue].sort((a, b) => a.clientCreatedAt - b.clientCreatedAt);
  for (const op of ordered) {
    const recordKey = `${op.pointId}|${op.cargoId}|${op.equipmentBatchId}`;
    const existing = kept.get(recordKey);
    if (!existing) {
      kept.set(recordKey, op);
      continue;
    }
    // 同一条绑扎记录的重复上传：失败副本优先（需要重试），计时仍取最早一条
    if (op.status === '失败' && existing.status !== '失败') {
      dropped.push(existing);
      kept.set(recordKey, { ...op, clientCreatedAt: Math.min(existing.clientCreatedAt, op.clientCreatedAt) });
    } else {
      dropped.push(op);
    }
  }
  return {
    merged: [...kept.values()].sort((a, b) => a.clientCreatedAt - b.clientCreatedAt),
    dropped
  };
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${formatTime(ts)}`;
}
