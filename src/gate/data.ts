import type {
  EquipBatch,
  InspectionBatch,
  LashingAssign,
  LashingPoint,
  Shift
} from './types';

// ---- 种子数据 ----

export const seedBatches: EquipBatch[] = [
  {
    id: 'EQ-A12',
    kind: '重型绑扎带',
    ratedLoad: 80,
    certNo: 'RL-2608-041',
    certValid: true,
    validUntil: '2026-11-30',
    inspectionBatchId: 'JC-2609-03',
    sentForInspection: false,
    status: '有效'
  },
  {
    id: 'EQ-B07',
    kind: '链条系固件',
    ratedLoad: 120,
    certNo: 'RL-2606-118',
    certValid: true, // 器材已送检，但旧放行仍在有效期 —— 旧放行照走
    validUntil: '2026-10-20',
    inspectionBatchId: 'JC-2610-01',
    sentForInspection: true,
    status: '送检中'
  },
  {
    id: 'EQ-C03',
    kind: '花篮螺丝',
    ratedLoad: 60,
    certNo: 'RL-2602-077',
    certValid: false, // 放行已过期，检定结果未出 → 门禁不接受
    validUntil: '2026-09-18',
    inspectionBatchId: 'JC-2610-01',
    sentForInspection: true,
    status: '过期'
  },
  {
    id: 'EQ-D21',
    kind: '重型绑扎带',
    ratedLoad: 90,
    certNo: 'RL-2609-006',
    certValid: true,
    validUntil: '2026-12-15',
    inspectionBatchId: 'JC-2609-03',
    sentForInspection: false,
    status: '有效'
  }
];

export const seedInspections: InspectionBatch[] = [
  {
    id: 'JC-2609-03',
    lab: '中海设备检定站',
    submittedAt: '2026-09-05',
    result: '合格',
    resultedAt: '2026-09-12',
    equipmentBatchIds: ['EQ-A12', 'EQ-D21']
  },
  {
    id: 'JC-2610-01',
    lab: '中海设备检定站',
    submittedAt: '2026-09-28',
    result: '未出结果',
    equipmentBatchIds: ['EQ-B07', 'EQ-C03']
  }
];

export const seedPoints: LashingPoint[] = [
  { id: 'LP-15-L1', bay: 15, side: '左', wll: 150, status: '正常' },
  { id: 'LP-15-L2', bay: 15, side: '左', wll: 150, status: '正常' },
  { id: 'LP-15-R1', bay: 15, side: '右', wll: 150, status: '正常' },
  { id: 'LP-15-R2', bay: 15, side: '右', wll: 150, status: '损伤停用' },
  { id: 'LP-13-L1', bay: 13, side: '左', wll: 100, status: '正常' },
  { id: 'LP-13-R1', bay: 13, side: '右', wll: 100, status: '正常' },
  { id: 'LP-13-R2', bay: 13, side: '右', wll: 100, status: '正常' },
  { id: 'LP-12-L1', bay: 12, side: '左', wll: 100, status: '正常' }
];

// 初始已占用：重大件 BL-88247 已占 3/4 点；危险品箱 BL-88219 已占 1/2 点
export const seedAssignments: LashingAssign[] = [
  { pointId: 'LP-15-L1', cargoId: 'BL-88247', equipmentBatchId: 'EQ-B07', shift: '码头班', securedAt: 1759365000000, clientId: 'seed-1', serverSeq: 101 },
  { pointId: 'LP-15-L2', cargoId: 'BL-88247', equipmentBatchId: 'EQ-A12', shift: '大副', securedAt: 1759365600000, clientId: 'seed-2', serverSeq: 102 },
  { pointId: 'LP-15-R1', cargoId: 'BL-88247', equipmentBatchId: 'EQ-A12', shift: '码头班', securedAt: 1759366200000, clientId: 'seed-3', serverSeq: 103 },
  { pointId: 'LP-13-L1', cargoId: 'BL-88219', equipmentBatchId: 'EQ-D21', shift: '大副', securedAt: 1759366800000, clientId: 'seed-4', serverSeq: 104 }
];

// ---- 模拟服务端 ----
// 只维护两件事：绑扎点占用裁决 + 客户端幂等。刷新页面后状态从 localStorage 恢复。

export interface ServerSubmitArg {
  clientId: string;
  cargoId: string;
  pointId: string;
  equipmentBatchId: string;
  shift: Shift;
  clientCreatedAt: number;
}

export type ServerSubmitResult =
  | { outcome: 'accepted'; assignment: LashingAssign }
  | { outcome: 'duplicate'; assignment: LashingAssign }
  | { outcome: 'conflict'; occupiedBy: LashingAssign };

interface ServerState {
  seq: number;
  accepted: Record<string, LashingAssign>; // clientId -> 受理结果（幂等）
}

const SERVER_KEY = 'yy62-gate-server';

function loadServer(): ServerState {
  if (typeof localStorage === 'undefined') return { seq: 105, accepted: {} };
  const raw = localStorage.getItem(SERVER_KEY);
  if (raw) {
    try { return JSON.parse(raw) as ServerState; } catch { /* 损坏则重建 */ }
  }
  const state: ServerState = { seq: 105, accepted: {} };
  seedAssignments.forEach((a) => { state.accepted[a.clientId] = a; });
  localStorage.setItem(SERVER_KEY, JSON.stringify(state));
  return state;
}

let serverState: ServerState | null = null;
let forceFail = false;

function persist() {
  if (serverState && typeof localStorage !== 'undefined') {
    localStorage.setItem(SERVER_KEY, JSON.stringify(serverState));
  }
}

export function setServerForceFail(value: boolean) { forceFail = value; }

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 模拟绑扎点提交。
 * - 同一 clientId 重复上传：返回首次受理记录，不重复计时（幂等）
 * - 同一绑扎点并发：按服务端到达顺序裁决，先到者占用
 */
export async function submitLashingToServer(arg: ServerSubmitArg): Promise<ServerSubmitResult> {
  await delay(260 + Math.random() * 260);
  if (forceFail) {
    forceFail = false;
    throw new Error('链路中断：服务端暂不可达');
  }
  if (!serverState) serverState = loadServer();

  const existing = serverState.accepted[arg.clientId];
  if (existing) return { outcome: 'duplicate', assignment: existing };

  const occupied = Object.values(serverState.accepted).find((a) => a.pointId === arg.pointId);
  if (occupied) return { outcome: 'conflict', occupiedBy: occupied };

  const assignment: LashingAssign = {
    pointId: arg.pointId,
    cargoId: arg.cargoId,
    equipmentBatchId: arg.equipmentBatchId,
    shift: arg.shift,
    securedAt: arg.clientCreatedAt, // 计时以首次上传（本地生成时间）为准
    clientId: arg.clientId,
    serverSeq: serverState.seq++
  };
  serverState.accepted[arg.clientId] = assignment;
  persist();
  return { outcome: 'accepted', assignment };
}

/** 演示用：重置服务端占用与全部本地门禁数据 */
export function resetServer() {
  serverState = { seq: 105, accepted: {} };
  seedAssignments.forEach((a) => { serverState!.accepted[a.clientId] = a; });
  persist();
}
