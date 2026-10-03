import { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Accordion,
  Badge,
  Button,
  Card,
  Group,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  ThemeIcon,
  Tooltip
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconBolt,
  IconCheck,
  IconCircleCheck,
  IconClipboardCheck,
  IconCloudOff,
  IconDatabase,
  IconDeviceFloppy,
  IconFileCertificate,
  IconHistory,
  IconLock,
  IconLockOpen,
  IconMapPin,
  IconPrinter,
  IconRefresh,
  IconReplace,
  IconWifi,
  IconX
} from '@tabler/icons-react';
import type { AppDispatch, RootState } from '../store';
import type { EquipBatch, LashingPoint, QueueOp } from './types';
import { LASHING_REQUIREMENTS, batchUsable, evaluateGate, formatDateTime, formatTime, pointUsable } from './logic';
import {
  armFailure,
  blockAttempt,
  confirmLashing,
  confirmStability,
  dismissAdvice,
  flushQueue,
  lockVersion,
  migrateLegacyDraft,
  resetDemo,
  resolveInspection,
  setPointStatus,
  setShift,
  setOnline,
  submitConcurrent,
  submitLashing
} from './slice';

const CARGO_NAMES: Record<string, string> = {
  'BL-88247': 'BL-88247 重大件（112.5t）',
  'BL-88219': 'BL-88219 危险品箱 UN1263'
};

function statusColor(batch: EquipBatch): string {
  const { usable } = batchUsable(batch);
  if (!usable) return 'red';
  return batch.status === '送检中' ? 'orange' : 'teal';
}

function opBadge(op: QueueOp) {
  switch (op.status) {
    case '已同步': return <Badge size="xs" color="teal">已同步 #{op.serverSeq}</Badge>;
    case '同步中': return <Badge size="xs" color="blue">同步中</Badge>;
    case '冲突': return <Badge size="xs" color="red">争抢失利</Badge>;
    case '失败': return <Badge size="xs" color="red">失败待重试</Badge>;
    default: return <Badge size="xs" color="orange">本地待同步</Badge>;
  }
}

export default function GatePage() {
  const gate = useSelector((root: RootState) => root.gate);
  const planRevision = useSelector((root: RootState) => root.stowage.planRevision);
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();

  const [cargoId, setCargoId] = useState('BL-88247');
  const [pointId, setPointId] = useState<string | null>(null);
  const [equipmentBatchId, setEquipmentBatchId] = useState<string | null>('EQ-A12');

  const evaluation = useMemo(() => evaluateGate(gate), [gate]);
  const assignmentByPoint = useMemo(() => new Map(gate.assignments.map((a) => [a.pointId, a])), [gate.assignments]);
  const batchById = useMemo(() => new Map(gate.batches.map((b) => [b.id, b])), [gate.batches]);

  const required = LASHING_REQUIREMENTS[cargoId];
  const usableBatches = gate.batches.filter((b) => batchUsable(b).usable);
  const selectedBatch = equipmentBatchId ? batchById.get(equipmentBatchId) : undefined;
  const selectedPoint = pointId ? gate.points.find((p) => p.id === pointId) : null;
  const pointBlocked = !pointId || !selectedPoint || !pointUsable(selectedPoint) || !!assignmentByPoint.has(pointId) || !equipmentBatchId || !selectedBatch || !batchUsable(selectedBatch).usable;
  const pendingQueue = gate.queue.filter((op) => op.status === '待同步' || op.status === '失败');

  const tryPrint = () => {
    if (!evaluation.passed) {
      dispatch(blockAttempt('打印被门禁拦截：存在作废结论/未占满绑扎点/未同步记录，确认通过后方可打印'));
      return;
    }
    navigate('/print');
  };

  return (
    <div className="page gate-page">
      <div className="page-heading">
        <div>
          <small>LASHING & SAILING GATE / 开航门禁</small>
          <h1>系固批次 · 绑扎点 · 检验批次联动</h1>
          <p>码头班与大副共用同一套绑扎点台账：先到先占，后到见替代点；检定、重心或绑扎点变化，结论立即作废。</p>
        </div>
        <Group gap="xs">
          <SegmentedControl
            value={gate.shift}
            onChange={(value) => dispatch(setShift(value as '码头班' | '大副'))}
            data={[{ label: '码头班', value: '码头班' }, { label: '大副', value: '大副' }]}
          />
          <Tooltip label="切换断网：提交进入本地批次，回连后按绑扎点合并补录">
            <Switch
              checked={gate.online}
              onChange={(e) => dispatch(setOnline(e.currentTarget.checked))}
              onLabel={<IconWifi size={14} />}
              offLabel={<IconCloudOff size={14} />}
              label={gate.online ? '在线' : '断网'}
              labelPosition="left"
            />
          </Tooltip>
          <Button variant="default" leftSection={<IconBolt size={15} />} onClick={() => dispatch(armFailure())}>注入一次链路故障</Button>
          <Button variant="default" color="red" leftSection={<IconRefresh size={15} />} onClick={() => { dispatch(resetDemo()); setCargoId('BL-88247'); setPointId(null); setEquipmentBatchId('EQ-A12'); }}>重置演示</Button>
        </Group>
      </div>

      {/* 门禁总览 */}
      <Card padding="md" className={`gate-card ${evaluation.passed ? 'gate-ok' : 'gate-bad'}`}>
        <div className="gate-summary">
          <div>
            <Group gap="sm">
              <ThemeIcon size={42} radius="xl" color={evaluation.passed ? 'teal' : 'red'} variant="light">
                {evaluation.passed ? <IconCircleCheck size={24} /> : <IconAlertTriangle size={24} />}
              </ThemeIcon>
              <div>
                <Text fw={800} fz="lg">{evaluation.passed ? '门禁通过：可以锁版并打印开航资料' : '门禁未通过：锁版与打印已锁定'}</Text>
                <Text size="xs" c="dimmed">
                  系固与稳性版本 V{gate.versionRevision}{gate.versionLocked ? ' · 已锁定' : ' · 草稿'}
                  {gate.migratedFromLegacy ? ' · 由缺检验批次的旧草稿升级为首版' : ''}
                </Text>
              </div>
            </Group>
          </div>
          <Group gap="xs">
            <Button
              color="teal"
              leftSection={gate.versionLocked ? <IconLock size={16} /> : <IconLockOpen size={16} />}
              disabled={!evaluation.passed || gate.versionLocked}
              onClick={() => dispatch(lockVersion())}
            >
              {gate.versionLocked ? '版本已锁定' : '锁定系固/稳性版本'}
            </Button>
            <Button
              variant={evaluation.passed ? 'filled' : 'default'}
              color={evaluation.passed ? 'teal' : 'gray'}
              leftSection={<IconPrinter size={16} />}
              onClick={tryPrint}
            >打印配载包</Button>
          </Group>
        </div>
        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing={6} mt="sm">
          {evaluation.checks.map((check) => (
            <div key={check.key} className={`gate-check ${check.passed ? 'pass' : 'fail'}`}>
              {check.passed ? <IconCheck size={14} /> : <IconX size={14} />}
              <div><strong>{check.label}</strong><span>{check.detail}</span></div>
            </div>
          ))}
        </SimpleGrid>
      </Card>

      {!gate.migratedFromLegacy && (
        <Card padding="sm" mt="md" className="legacy-banner">
          <Group justify="space-between">
            <Group gap="sm">
              <IconFileCertificate size={18} />
              <div>
                <Text size="sm" fw={700}>检测到旧版草稿：配载已存在但器材未挂检验批次</Text>
                <Text size="xs" c="dimmed">升级后自动补挂检验批次、系固版本从首版 V1 起编，原绑扎与稳性结论需重新确认。</Text>
              </div>
            </Group>
            <Button size="xs" variant="light" color="orange" leftSection={<IconDeviceFloppy size={14} />} onClick={() => dispatch(migrateLegacyDraft())}>升级为首版</Button>
          </Group>
        </Card>
      )}

      <div className="gate-grid">
        {/* 左：绑扎点台账 + 提交 */}
        <Stack gap="md">
          <Card padding={0}>
            <div className="panel-title">
              <div><strong>绑扎点占用台账</strong><Text size="xs" c="dimmed">两班同时提交同一点时，服务端先到先裁</Text></div>
              <Badge color={gate.online ? 'teal' : 'orange'} variant="light">{gate.online ? '在线裁决' : '断网排队中'}</Badge>
            </div>
            <div className="point-grid">
              {gate.points.map((point) => {
                const assign = assignmentByPoint.get(point.id);
                const active = pointId === point.id;
                const disabled = !pointUsable(point) || !!assign;
                return (
                  <button
                    key={point.id}
                    className={`point-card ${active ? 'active' : ''} ${assign ? 'occupied' : ''} ${!pointUsable(point) ? 'damaged' : ''}`}
                    disabled={disabled}
                    onClick={() => setPointId(point.id)}
                    title={!pointUsable(point) ? '绑扎点损伤停用，占用结论已作废' : assign ? `已被 ${assign.shift} / ${assign.cargoId} 占用` : '空闲，点击选择'}
                  >
                    <div className="point-head"><strong>{point.id}</strong><Badge size="xs" color={pointUsable(point) ? 'gray' : 'red'}>{point.status}</Badge></div>
                    <small>Bay {point.bay} · {point.side}舷 · WLL {point.wll}kN</small>
                    {assign ? (
                      <div className="point-assign">
                        <b>{assign.cargoId}</b>
                        <span>{assign.shift} · {assign.equipmentBatchId}</span>
                        <em>计时起 {formatTime(assign.securedAt)} · #{assign.serverSeq ?? '本地'}</em>
                      </div>
                    ) : <div className="point-free">{pointUsable(point) ? '空闲可占' : '—'}</div>}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card padding="md">
            <div className="panel-title" style={{ padding: 0, borderBottom: 0, marginBottom: 10 }}>
              <div><strong>绑扎提交</strong><Text size="xs" c="dimmed">{CARGO_NAMES[cargoId]} · 要求 {required.points} 点 / 单点 ≥ {required.minWll}kN</Text></div>
              <IconMapPin size={18} />
            </div>
            <Stack gap="sm">
              <Select
                label="货物"
                data={Object.entries(LASHING_REQUIREMENTS).map(([id, req]) => ({ value: id, label: `${id} · ${req.label}` }))}
                value={cargoId}
                onChange={(value) => value && setCargoId(value)}
              />
              <Select
                label="系固器材批次（仅放行有效/送检中旧放行有效可选）"
                data={gate.batches.map((b) => ({
                  value: b.id,
                  label: `${b.id} ${b.kind} ${b.ratedLoad}kN · ${b.status}${b.sentForInspection ? '（送检中，旧放行照走）' : ''}`,
                  disabled: !batchUsable(b).usable
                }))}
                value={equipmentBatchId}
                onChange={setEquipmentBatchId}
              />
              {selectedBatch && <Text size="xs" c={batchUsable(selectedBatch).usable ? 'teal' : 'red'}>{batchUsable(selectedBatch).note} · 检验批次 {selectedBatch.inspectionBatchId}</Text>}
              <Group grow>
                <Button
                  color="teal"
                  disabled={pointBlocked || gate.versionLocked}
                  onClick={() => pointId && equipmentBatchId && dispatch(submitLashing({ cargoId, pointId, equipmentBatchId }))}
                >
                  {gate.online ? '提交占用所选绑扎点' : '断网：存入本地批次'}
                </Button>
                <Button
                  variant="light"
                  color="orange"
                  disabled={pointBlocked || gate.versionLocked}
                  onClick={() => pointId && equipmentBatchId && dispatch(submitConcurrent({ cargoId, pointId, equipmentBatchId }))}
                >
                  模拟两班同时抢此点
                </Button>
              </Group>
              {gate.versionLocked && <Text size="xs" c="red"><IconLock size={12} /> 版本已锁定，绑扎点占用变更被拦截。</Text>}
              <Text size="xs" c="dimmed">
                {pointId && selectedPoint
                  ? `所选点 ${pointId}（${selectedPoint.status}，WLL ${selectedPoint.wll}kN）${assignmentByPoint.has(pointId) ? ' · 已被占用' : ' · 空闲'}`
                  : '请先在上方台账中点击一个空闲绑扎点'}
              </Text>
            </Stack>
          </Card>

          {/* 争抢失利建议 */}
          {gate.advice.length > 0 && (
            <Card padding="md" className="advice-card">
              <div className="panel-title" style={{ padding: 0, borderBottom: 0 }}>
                <div><strong>后到者替代点建议</strong><Text size="xs" c="dimmed">先到者已占用，改占替代点后冲突解除</Text></div>
                <IconReplace size={18} />
              </div>
              <Stack gap="sm" mt="sm">
                {gate.advice.map((adv) => (
                  <div key={adv.id} className="advice-row">
                    <div>
                      <Text size="sm" fw={700}>{adv.cargoId} 争抢 {adv.pointId} 失利</Text>
                      <Text size="xs" c="dimmed">{adv.winnerShift}（{adv.winnerCargoId}）先到占用 · {formatTime(adv.at)}</Text>
                      <Group gap={6} mt={6}>
                        {adv.alternatives.length ? adv.alternatives.map((alt) => (
                          <Button
                            key={alt}
                            size="compact-xs"
                            variant="light"
                            color="teal"
                            onClick={() => { setCargoId(adv.cargoId); setPointId(alt); }}
                          >改占 {alt}</Button>
                        )) : <Text size="xs" c="red">暂无满足负荷的空闲替代点</Text>}
                      </Group>
                    </div>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={() => dispatch(dismissAdvice(adv.id))}>忽略</Button>
                  </div>
                ))}
              </Stack>
            </Card>
          )}
        </Stack>

        {/* 右：结论确认 / 器材检验 / 队列 / 日志 */}
        <Stack gap="md">
          <Card padding="md">
            <div className="panel-title" style={{ padding: 0, borderBottom: 0 }}>
              <div><strong>绑扎与稳性结论</strong><Text size="xs" c="dimmed">检定、重心或绑扎点变化后立即作废，未确认不得锁版/打印</Text></div>
              <IconClipboardCheck size={18} />
            </div>
            <Table mt="sm" verticalSpacing="xs">
              <Table.Tbody>
                {Object.values(gate.lashingConclusions).map((c) => (
                  <Table.Tr key={c.cargoId}>
                    <Table.Td><Text size="sm" fw={700}>{c.cargoId} 绑扎</Text></Table.Td>
                    <Table.Td><Badge size="sm" color={c.status === '有效' ? 'teal' : 'red'}>{c.status}</Badge></Table.Td>
                    <Table.Td>{c.status === '已作废'
                      ? <Button size="compact-xs" color="teal" onClick={() => dispatch(confirmLashing(c.cargoId))}>大副重新确认</Button>
                      : <Text size="xs" c="dimmed">{formatTime(c.updatedAt)}</Text>}</Table.Td>
                  </Table.Tr>
                ))}
                <Table.Tr>
                  <Table.Td><Text size="sm" fw={700}>稳性（V{gate.stability.planRevision}）</Text></Table.Td>
                  <Table.Td><Badge size="sm" color={gate.stability.status === '有效' ? 'teal' : 'red'}>{gate.stability.status}</Badge></Table.Td>
                  <Table.Td>{gate.stability.status === '已作废'
                    ? <Button size="compact-xs" color="teal" onClick={() => dispatch(confirmStability(planRevision))}>大副重新确认</Button>
                    : <Text size="xs" c="dimmed">{formatTime(gate.stability.updatedAt)}</Text>}</Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
            {Object.values(gate.lashingConclusions).some((c) => c.status === '已作废') && (
              <Text size="xs" c="red" mt={6}>作废原因：{Object.values(gate.lashingConclusions).filter((c) => c.status === '已作废').map((c) => `${c.cargoId}：${c.reason}`).join('；')}</Text>
            )}
            {gate.stability.status === '已作废' && <Text size="xs" c="red">稳性作废原因：{gate.stability.reason}（当前配载 V{planRevision}）</Text>}
          </Card>

          <Accordion multiple defaultValue={['equip']} variant="separated">
            <Accordion.Item value="equip">
              <Accordion.Control icon={<IconDatabase size={16} />}>器材批次与检验批次（{gate.batches.length} 批）</Accordion.Control>
              <Accordion.Panel>
                <Table verticalSpacing="xs">
                  <Table.Thead><Table.Tr><Table.Th>批次</Table.Th><Table.Th>额定</Table.Th><Table.Th>放行/检定</Table.Th><Table.Th>状态</Table.Th></Table.Tr></Table.Thead>
                  <Table.Tbody>
                    {gate.batches.map((b) => (
                      <Table.Tr key={b.id}>
                        <Table.Td><Text size="xs" fw={700}>{b.id}</Text><Text size="xs" c="dimmed">{b.kind} · {b.inspectionBatchId}</Text></Table.Td>
                        <Table.Td><Text size="xs">{b.ratedLoad}kN</Text></Table.Td>
                        <Table.Td><Text size="xs">{b.certNo}</Text><Text size="xs" c="dimmed">{b.sentForInspection ? `送检中 · 旧放行${b.certValid ? '有效照走' : '已失效'}` : `放行至 ${b.validUntil}`}</Text></Table.Td>
                        <Table.Td><Badge size="xs" color={statusColor(b)}>{b.status}</Badge></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                {gate.inspections.filter((i) => i.result === '未出结果').map((ins) => (
                  <Card key={ins.id} padding="sm" mt="sm" withBorder>
                    <Text size="xs" fw={700}>{ins.id} · {ins.lab} · {ins.submittedAt} 送检，结果未出</Text>
                    <Text size="xs" c="dimmed" mt={4}>涉及 {ins.equipmentBatchIds.join('、')}；出结果后关联绑扎结论立即作废/恢复。</Text>
                    <Group gap="xs" mt={8}>
                      <Button size="compact-xs" color="teal" onClick={() => dispatch(resolveInspection({ inspectionId: ins.id, result: '合格' }))}>检定合格（换新放行）</Button>
                      <Button size="compact-xs" color="red" variant="light" onClick={() => dispatch(resolveInspection({ inspectionId: ins.id, result: '不合格' }))}>检定不合格（批次停用）</Button>
                    </Group>
                  </Card>
                ))}
                <div className="point-admin">
                  <Text size="xs" fw={700} mt="sm">绑扎点状态（模拟甲板巡查发现损伤）：</Text>
                  {gate.points.map((p: LashingPoint) => (
                    <Group key={p.id} justify="space-between" py={3}>
                      <Text size="xs">{p.id} <Badge size="xs" color={p.status === '正常' ? 'teal' : 'red'}>{p.status}</Badge></Text>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color={p.status === '正常' ? 'red' : 'teal'}
                        disabled={gate.versionLocked}
                        onClick={() => dispatch(setPointStatus({ pointId: p.id, status: p.status === '正常' ? '损伤停用' : '正常' }))}
                      >{p.status === '正常' ? '标记损伤停用' : '修复恢复正常'}</Button>
                    </Group>
                  ))}
                </div>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="queue">
              <Accordion.Control icon={<IconCloudOff size={16} />}>
                断网补录批次
                {pendingQueue.length > 0 && <Badge color="orange" ml={8} size="xs">{pendingQueue.length} 待处理</Badge>}
              </Accordion.Control>
              <Accordion.Panel>
                <Group justify="space-between" mb="sm">
                  <Text size="xs" c="dimmed">回连后按绑扎点合并，重复上传不重复计时；失败记录保留在本地批次中重试。</Text>
                  <Button
                    size="compact-xs"
                    color="teal"
                    leftSection={<IconRefresh size={13} />}
                    disabled={!gate.online || pendingQueue.length === 0}
                    onClick={() => dispatch(flushQueue())}
                  >{gate.online ? '回连合并并重试' : '当前断网'}</Button>
                </Group>
                {gate.queue.length === 0 && <Text size="xs" c="dimmed">暂无本地批次记录。</Text>}
                <Stack gap={6}>
                  {gate.queue.map((op) => (
                    <div key={op.clientId} className="queue-row">
                      <div>
                        <Text size="xs" fw={700}>{op.cargoId} → {op.pointId}</Text>
                        <Text size="xs" c="dimmed">{op.shift} · {op.equipmentBatchId} · 本地生成 {formatDateTime(op.clientCreatedAt)} · 第 {op.attempts} 次尝试{op.lastError ? ` · ${op.lastError}` : ''}</Text>
                      </div>
                      {opBadge(op)}
                    </div>
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="log">
              <Accordion.Control icon={<IconHistory size={16} />}>门禁事件流</Accordion.Control>
              <Accordion.Panel>
                <div className="gate-log">
                  {gate.events.map((ev) => (
                    <div key={ev.id} className={`log-line log-${ev.kind}`}>
                      <span>{formatTime(ev.at)}</span><i />{ev.text}
                    </div>
                  ))}
                </div>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>
      </div>
    </div>
  );
}
