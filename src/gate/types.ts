// 开航门禁领域模型：系固器材批次、检验批次、绑扎点、占用记录、结论与离线补录队列

export type Shift = '码头班' | '大副';

// 器材批次：送检期间旧放行照走（送检中 + 放行仍在有效期 = 可继续使用）
export type BatchStatus = '有效' | '送检中' | '过期';

export interface EquipBatch {
  id: string; // 器材批次号
  kind: string; // 器材类型
  ratedLoad: number; // 额定负荷 kN
  certNo: string; // 最近一次放行证书号
  certValid: boolean; // 旧放行是否仍在有效期内
  validUntil: string; // 放行有效期至
  inspectionBatchId: string; // 所属检验批次
  sentForInspection: boolean; // 是否已送检
  status: BatchStatus;
}

export interface InspectionBatch {
  id: string; // 检验批次号
  lab: string; // 检定机构
  submittedAt: string;
  result: '未出结果' | '合格' | '不合格';
  resultedAt?: string;
  equipmentBatchIds: string[];
}

export interface LashingPoint {
  id: string; // 绑扎点号
  bay: number;
  side: '左' | '右' | '中';
  wll: number; // 安全负荷 kN
  status: '正常' | '损伤停用';
}

// 绑扎点占用记录：一个绑扎点同一时刻只能被一票货物占用
export interface LashingAssign {
  pointId: string;
  cargoId: string;
  equipmentBatchId: string;
  shift: Shift;
  securedAt: number; // 首次占用计时（以首次上传为准，重复上传不刷新）
  clientId: string; // 本地幂等键
  serverSeq: number; // 服务端受理序号
}

export type ConclusionStatus = '有效' | '已作废';

export interface LashingConclusion {
  cargoId: string;
  status: ConclusionStatus;
  reason?: string; // 作废原因（检定 / 重心 / 绑扎点变化）
  updatedAt: number;
}

export interface StabilityConclusion {
  planRevision: number; // 结论所依据的配载版本
  status: ConclusionStatus;
  reason?: string;
  updatedAt: number;
}

export type QueueOpStatus = '待同步' | '同步中' | '已同步' | '失败' | '冲突';

export interface QueueOp {
  clientId: string;
  type: 'lashing-submit';
  cargoId: string;
  pointId: string;
  equipmentBatchId: string;
  shift: Shift;
  clientCreatedAt: number; // 本地生成时间，离线时用于先到先裁
  status: QueueOpStatus;
  attempts: number;
  lastError?: string;
  syncedAt?: number;
  serverSeq?: number;
}

export interface ConflictAdvice {
  id: string;
  cargoId: string;
  pointId: string; // 争抢失败的点
  winnerShift: Shift;
  winnerCargoId: string;
  alternatives: string[]; // 推荐替代绑扎点
  at: number;
}

export interface GateEvent {
  id: string;
  at: number;
  kind: 'occupy-ok' | 'occupy-conflict' | 'invalidate' | 'confirm' | 'inspection' | 'queue' | 'lock' | 'migrate' | 'block';
  text: string;
}

export interface GateState {
  shift: Shift;
  online: boolean;
  failNext: boolean; // 下一次请求模拟网络失败
  versionRevision: number; // 系固与稳性版本号
  versionLocked: boolean;
  migratedFromLegacy: boolean; // 是否由缺检验批次的旧草稿升级而来
  batches: EquipBatch[];
  inspections: InspectionBatch[];
  points: LashingPoint[];
  assignments: LashingAssign[];
  lashingConclusions: Record<string, LashingConclusion>;
  stability: StabilityConclusion;
  queue: QueueOp[];
  advice: ConflictAdvice[];
  events: GateEvent[];
}
