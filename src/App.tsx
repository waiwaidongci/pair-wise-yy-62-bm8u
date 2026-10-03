import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  ActionIcon,
  AppShell,
  AppShellHeader,
  AppShellMain,
  AppShellNavbar,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconAnchor,
  IconBoxMultiple,
  IconCheck,
  IconCircleCheck,
  IconCircleX,
  IconClipboardCheck,
  IconClock,
  IconCloudOff,
  IconCloudUpload,
  IconCube,
  IconFileDescription,
  IconHistory,
  IconLayoutBoardSplit,
  IconLock,
  IconMap2,
  IconPlayerPlay,
  IconPlus,
  IconPrinter,
  IconRefresh,
  IconRepeat,
  IconRulerMeasure,
  IconRoute,
  IconShip,
  IconUsers,
  IconWifi,
  IconWifiOff,
  IconX
} from '@tabler/icons-react';
import * as THREE from 'three';
import { useGetVoyageQuery, type Cargo, type CargoType } from './api';
import {
  acceptComment,
  acceptLimit,
  addComment,
  addConclusionGear,
  addConclusionPoint,
  addGearBatch,
  calculateStability,
  clearConflict,
  confirmConclusion,
  confirmStability,
  createConclusion,
  detectConflicts,
  dismissUpgrade,
  flushOfflineQueue,
  lockPlan,
  moveCargo,
  receiveGearCertificate,
  recordLashingPoint,
  rejectComment,
  releasePoint,
  removeConclusionGear,
  removeConclusionPoint,
  retryOfflineBatch,
  selectCargo,
  sendGearForInspection,
  setActiveCrew,
  setNetworkOnline,
  setSimulateFlushFailure,
  setViewMode,
  store,
  updateLashing,
  type RootState
} from './store';
import {
  findAlternatives,
  gateStatus,
  type Crew,
  type GearBatch,
  type GearStatus,
  type GearType,
  type LashingConclusion,
  type LashingPoint
} from './lashing';

const nav = [
  { path: '/', label: '航次总览', icon: <IconShip size={17} /> },
  { path: '/stowage', label: '配载与货位', icon: <IconLayoutBoardSplit size={17} /> },
  { path: '/lashing', label: '系固门禁', icon: <IconClipboardCheck size={17} /> },
  { path: '/compare', label: '方案对比', icon: <IconHistory size={17} /> },
  { path: '/print', label: '配载图与清单', icon: <IconPrinter size={17} /> }
];

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></div><Group gap="xs">{actions}</Group></div>;
}

function ThreeHold({ compact = false }: { compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cargo = useSelector((root: RootState) => root.stowage.cargo);
  const activeId = useSelector((root: RootState) => root.stowage.activeCargoId);
  const dispatch = useDispatch();
  const [rotation, setRotation] = useState({ theta: .65, phi: 1.05 });
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dce7e3');
    scene.fog = new THREE.Fog('#dce7e3', 38, 88);
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 200);
    scene.add(new THREE.HemisphereLight('#ffffff', '#4b625b', 2.4));
    const light = new THREE.DirectionalLight('#fff5dd', 3.3);
    light.position.set(22, 38, 20);
    light.castShadow = true;
    scene.add(light);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), new THREE.MeshStandardMaterial({ color: '#4c7c86', roughness: .72 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -.15;
    scene.add(water);
    const hullMat = new THREE.MeshStandardMaterial({ color: '#214c46', roughness: .55, metalness: .18 });
    const deckMat = new THREE.MeshStandardMaterial({ color: '#8b928d', roughness: .9 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(56, 5.5, 18), hullMat);
    hull.position.y = 2.2;
    hull.castShadow = true;
    scene.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(56, .45, 18), deckMat);
    deck.position.y = 5.15;
    deck.receiveShadow = true;
    scene.add(deck);
    for (let x = -24; x <= 24; x += 4) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(.08, .06, 18), new THREE.MeshBasicMaterial({ color: '#b8c8c3' }));
      line.position.set(x, 5.4, 0);
      scene.add(line);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(8, 7, 14), new THREE.MeshStandardMaterial({ color: '#e6e5df' }));
    bridge.position.set(21, 8.7, 0);
    scene.add(bridge);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 4, 16), new THREE.MeshStandardMaterial({ color: '#c26843' }));
    stack.position.set(18, 14.2, 0);
    scene.add(stack);
    const boxes: THREE.Mesh[] = [];
    cargo.filter((item) => item.type === '集装箱').forEach((item) => {
      const geometry = item.dimension.startsWith('20') ? new THREE.BoxGeometry(2.35, 2.3, 2.3) : new THREE.BoxGeometry(4.5, 2.3, 2.3);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: item.color, roughness: .68 }));
      mesh.position.set((item.bay - 20) * 2.2, item.deck === '主甲板' ? 6.7 + item.tier * 2.45 : 2.1 + item.tier * 2.45, (item.row - 4) * 2.5);
      mesh.castShadow = true;
      mesh.userData.id = item.id;
      boxes.push(mesh);
      scene.add(mesh);
    });
    const heavy = cargo.find((item) => item.type === '重大件');
    if (heavy) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(9.5, 2.4, 3), new THREE.MeshStandardMaterial({ color: heavy.color }));
      mesh.position.set((heavy.bay - 20) * 2.2, 6.7, 1.2);
      mesh.userData.id = heavy.id;
      boxes.push(mesh);
      scene.add(mesh);
      const center = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, 8.5, 12), new THREE.MeshStandardMaterial({ color: '#e9b54d' }));
      center.position.set((heavy.bay - 20) * 2.2, 7.95, 1.2);
      center.rotation.z = Math.PI / 2;
      scene.add(center);
    }
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let theta = .65;
    let phi = 1.05;
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const onDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      theta += (event.clientX - lastX) * .007;
      phi = Math.max(.5, Math.min(1.55, phi + (event.clientY - lastY) * .005));
      lastX = event.clientX;
      lastY = event.clientY;
      setRotation({ theta, phi });
    };
    const onUp = (event: PointerEvent) => {
      dragging = false;
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(boxes)[0];
      if (hit?.object.userData.id) dispatch(selectCargo(String(hit.object.userData.id)));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      const radius = compact ? 68 : 61;
      camera.position.set(Math.sin(theta) * Math.sin(phi) * radius, Math.cos(phi) * radius + 15, Math.cos(theta) * Math.sin(phi) * radius);
      camera.lookAt(0, 7, 0);
      boxes.forEach((box) => { box.material = box.material as THREE.MeshStandardMaterial; (box.material as THREE.MeshStandardMaterial).emissive = box.userData.id === activeId ? new THREE.Color('#1a5c4b') : new THREE.Color('#000000'); });
      renderer.render(scene, camera);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      renderer.dispose();
    };
  }, [activeId, cargo, compact, dispatch]);
  return <div ref={containerRef} className="three-hold"><canvas ref={canvasRef} /><div className="three-legend"><span><i style={{ background: '#2b7c75' }} />集装箱</span><span><i style={{ background: '#b64f49' }} />重大件</span><span><i style={{ background: '#e9b54d' }} />吊点</span></div><div className="three-hint">拖动旋转 · 点击货箱选择</div><div className="orientation">艏 <span>→</span> 艉</div></div>;
}

function SectionView() {
  const cargo = useSelector((root: RootState) => root.stowage.cargo);
  const dispatch = useDispatch();
  return <div className="section-view"><div className="section-labels"><span>第 3 层</span><span>第 2 层</span><span>第 1 层</span><span>舱底</span></div><div className="section-grid">{Array.from({ length: 9 * 4 }).map((_, index) => { const tier = 4 - Math.floor(index / 9); const row = index % 9; const item = cargo.find((cargoItem) => cargoItem.tier === tier && cargoItem.row === row); return <button key={index} className={item ? 'occupied' : ''} style={item ? { background: item.color } : undefined} onClick={() => item && dispatch(selectCargo(item.id))} title={item ? `${item.id} · ${item.weight}t` : `空货位 R${row} T${tier}`}>{item?.bill.slice(-3)}</button>; })}</div><div className="section-axis">舱内横向剖面 · 鼠标悬停查看重量</div></div>;
}

function Overview() {
  const state = useSelector((root: RootState) => root.stowage);
  const { data } = useGetVoyageQuery();
  const dispatch = useDispatch();
  const stability = calculateStability(state.cargo);
  const conflicts = detectConflicts(state.cargo);
  const gate = gateStatus(state.cargo, state.conclusions, state.stability, state.points, state.gearBatches, conflicts.length);
  const active = state.cargo.find((item) => item.id === state.activeCargoId) ?? state.cargo[0];
  return <div className="page">
    <PageHeading eyebrow={`${data?.id ?? 'V-2609-17'} / 航次审阅`} title="多用途船舶配载校核" description={`${data?.vessel ?? '海岳轮'} · ${data?.route ?? '上海 → 釜山 → 温哥华'} · 计划离港 ${data?.departure ?? '10-02 14:00'}`} actions={<><Button variant="default" leftSection={<IconRefresh size={16} />} onClick={() => dispatch(setViewMode(state.viewMode === '3d' ? 'section' : '3d'))}>{state.viewMode === '3d' ? '二维剖面' : '三维视角'}</Button><Button color="teal" leftSection={<IconLock size={16} />} disabled={conflicts.length > 0 || !gate.passed || state.locked} onClick={() => dispatch(lockPlan())}>{state.locked ? '方案已锁定' : gate.passed ? '锁定配载版本' : '门禁未通过，无法锁版'}</Button></>} />
    {conflicts.length > 0 && <div className="warning-banner"><IconAlertTriangle size={18} /><strong>{conflicts.length} 项配载冲突待处理</strong><span>{conflicts.map((item) => item.title).join('、')}</span></div>}
    {!gate.passed && <div className="gate-banner"><IconLock size={18} /><strong>开航门禁未通过</strong><span>{gate.blockers.slice(0, 4).map((b) => b.message).join('；')}{gate.blockers.length > 4 ? ` 等 ${gate.blockers.length} 项` : ''}</span><Button size="xs" variant="default" component={NavLink} to="/lashing">前往系固门禁</Button></div>}
    {gate.passed && !state.locked && <div className="gate-banner pass"><IconCircleCheck size={18} /><strong>开航门禁已通过</strong><span>货物绑扎、稳性结论与器材批次均有效，可锁版或打印。</span></div>}
    <SimpleGrid cols={{ base: 2, lg: 4 }} spacing="sm" mb="md">{[
      ['总货重', `${stability.total.toFixed(1)} t`, '设计上限 3560 t', 'ok'],
      ['稳性裕度', `${stability.stability.toFixed(1)}%`, stability.stability > 70 ? '符合航次要求' : '低于控制线', stability.stability > 70 ? 'ok' : 'bad'],
      ['纵倾状态', stability.trim, `Lcg ${stability.longitudinal.toFixed(2)} m`, 'ok'],
      ['主甲板载荷', `${stability.deckLoad.toFixed(1)} t`, '局部强度已校核', 'ok']
    ].map((item) => <Card key={item[0]} padding="md" className="metric-card"><Text size="xs" c="dimmed">{item[0]}</Text><Text fw={800} fz={23} mt={3}>{item[1]}</Text><Text size="xs" c={item[3] === 'bad' ? 'red' : 'teal'}>{item[2]}</Text></Card>)}</SimpleGrid>
    <div className="overview-grid">
      <Card padding={0} className="scene-card"><div className="panel-title"><div><strong>{state.viewMode === '3d' ? '三维货位与航次分布' : '舱内横向剖面'}</strong><Text size="xs" c="dimmed">货箱颜色对应目的港与货类</Text></div><Badge color="teal" variant="light">方案 V{state.planRevision}</Badge></div>{state.viewMode === '3d' ? <ThreeHold /> : <SectionView />}</Card>
      <Stack gap="sm">
        <Card padding="md"><div className="panel-title"><div><strong>当前货位</strong><Text size="xs" c="dimmed">{active.id}</Text></div><Badge color={active.hazmat !== '无' ? 'orange' : 'gray'}>{active.hazmat === '无' ? '普通货' : '危险品'}</Badge></div><Stack gap={6} mt="sm"><Text fw={700}>{active.bill} · {active.type}</Text><Text size="xs" c="dimmed">{active.dimension}</Text><SimpleGrid cols={2} spacing="xs"><div className="mini-stat"><span>重量</span><strong>{active.weight} t</strong></div><div className="mini-stat"><span>卸货港</span><strong>{active.port}</strong></div><div className="mini-stat"><span>货位</span><strong>Bay {active.bay} / Row {active.row} / Tier {active.tier}</strong></div><div className="mini-stat"><span>绑扎</span><strong>{active.lashing}</strong></div></SimpleGrid></Stack></Card>
        <Card padding="md"><div className="panel-title"><div><strong>重量分布</strong><Text size="xs" c="dimmed">按横向货位统计</Text></div><IconRulerMeasure size={18} /></div><div className="weight-bars">{[2, 4, 6, 8, 10, 12, 14].map((bay) => { const weight = state.cargo.filter((item) => item.bay === bay).reduce((sum, item) => sum + item.weight, 0); return <div key={bay}><span>{weight.toFixed(0)}t</span><i style={{ height: `${Math.max(8, weight / 1.2)}px` }} /><small>B{bay}</small></div>; })}</div></Card>
        <Card padding="md"><div className="panel-title"><div><strong>角色限制条件</strong><Text size="xs" c="dimmed">{state.comments.filter((item) => item.status === '待确认').length} 项待确认</Text></div><IconUsers size={18} /></div>{state.comments.slice(0, 3).map((comment) => <div className="limit-row" key={comment.id}><div><Text size="xs" fw={700}>{comment.author} · {comment.role}</Text><Text size="xs" c="dimmed">{comment.content}</Text></div><Badge size="xs" color={comment.status === '待确认' ? 'orange' : 'teal'}>{comment.status}</Badge></div>)}</Card>
      </Stack>
    </div>
  </div>;
}

function Stowage() {
  const state = useSelector((root: RootState) => root.stowage);
  const dispatch = useDispatch();
  const active = state.cargo.find((item) => item.id === state.activeCargoId) ?? state.cargo[0];
  const conflicts = detectConflicts(state.cargo);
  const stability = calculateStability(state.cargo);
  const [bay, setBay] = useState(active.bay);
  const [row, setRow] = useState(active.row);
  const [tier, setTier] = useState(active.tier);
  const [dragId, setDragId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  useEffect(() => { setBay(active.bay); setRow(active.row); setTier(active.tier); }, [active.bay, active.row, active.tier]);
  const slots = useMemo(() => Array.from({ length: 28 }).map((_, index) => ({ id: `slot-${index}`, bay: 4 + Math.floor(index / 4), row: index % 4, tier: 0, label: `B${4 + Math.floor(index / 4)} R${index % 4}` })), []);
  return <div className="page">
    <PageHeading eyebrow={`配载工作区 / 方案 V${state.planRevision}`} title="货位安排与冲突校核" description="拖动货箱排序，或输入目标货位精确调整；系统即时重算重量分布。" actions={<Badge size="lg" color={conflicts.length ? 'orange' : 'teal'} leftSection={<IconCheck size={14} />}>{conflicts.length ? `${conflicts.length} 项冲突` : '校验通过'}</Badge>} />
    <div className="stowage-grid">
      <Card padding={0} className="cargo-list-panel"><div className="panel-title"><div><strong>货物清单</strong><Text size="xs" c="dimmed">{state.cargo.length} 票 · 可拖拽</Text></div><TextInput size="xs" placeholder="搜索提单号" /></div><ScrollArea h={600}><div className="cargo-list">{state.cargo.map((item) => <button draggable onDragStart={() => setDragId(item.id)} key={item.id} className={state.activeCargoId === item.id ? 'active' : ''} onClick={() => dispatch(selectCargo(item.id))}><i style={{ background: item.color }} /><div><strong>{item.bill}</strong><span>{item.type} · {item.weight}t · {item.port}</span></div><Badge size="xs" color={item.hazmat === '无' ? 'gray' : 'orange'}>{item.hazmat === '无' ? `B${item.bay}` : 'DG'}</Badge></button>)}</div></ScrollArea></Card>
      <Card padding={0} className="deck-panel"><div className="panel-title"><div><strong>主甲板货位图</strong><Text size="xs" c="dimmed">将货物拖入槽位，或点击槽位选择</Text></div><Group gap="xs"><Badge color="teal">稳性 {stability.stability.toFixed(1)}%</Badge><Badge color="gray">{stability.trim}</Badge></Group></div><div className="deck-layout"><div className="bridge-shape">驾驶台</div><div className="slot-grid">{slots.map((slot) => { const occupied = state.cargo.find((item) => item.deck === '主甲板' && item.bay === slot.bay && item.row === slot.row); return <button key={slot.id} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragId) dispatch(moveCargo({ id: dragId, bay: slot.bay, row: slot.row, tier: occupied?.tier ?? 1 })); setDragId(null); }} className={occupied ? 'occupied' : ''} style={occupied ? { background: occupied.color } : undefined} onClick={() => { if (occupied) { dispatch(selectCargo(occupied.id)); setRow(slot.row); setBay(slot.bay); } }}><small>{slot.label}</small>{occupied && <strong>{occupied.bill.slice(-3)}<span>{occupied.weight}t</span></strong>}</button>; })}</div><div className="deck-axis">左舷 ← 横向 Row → 右舷</div></div></Card>
      <Stack gap="sm">
        <Card padding="md"><div className="panel-title"><div><strong>精确调整</strong><Text size="xs" c="dimmed">{active.id}</Text></div><IconCube size={18} /></div><Stack gap="sm" mt="md"><NumberInput label="Bay 纵向货位" min={1} max={20} value={bay} onChange={(value) => setBay(Number(value))} /><NumberInput label="Row 横向货位" min={0} max={8} value={row} onChange={(value) => setRow(Number(value))} /><NumberInput label="Tier 堆码层" min={0} max={4} value={tier} onChange={(value) => setTier(Number(value))} /><Button color="teal" onClick={() => dispatch(moveCargo({ id: active.id, bay, row, tier }))}>应用货位调整</Button><Divider /><Select label="绑扎状态" data={['已绑扎', '待绑扎', '需复核']} value={active.lashing} onChange={(value) => value && dispatch(updateLashing({ id: active.id, lashing: value as Cargo['lashing'] }))} /></Stack></Card>
        <Card padding="md" className={conflicts.length ? 'conflict-card' : ''}><div className="panel-title"><div><strong>实时冲突</strong><Text size="xs" c="dimmed">重心、稳性、隔离与堆码</Text></div><IconAlertTriangle size={18} /></div>{conflicts.map((item) => <button className="conflict-row" key={item.id} onClick={() => dispatch(selectCargo(item.cargoId))}><Badge size="xs" color={item.level === 'high' ? 'red' : 'orange'}>{item.level === 'high' ? '阻断' : '预警'}</Badge><div><strong>{item.title}</strong><span>{item.detail}</span></div></button>)}{!conflicts.length && <Text size="sm" c="teal" mt="md">当前方案未发现冲突。</Text>}</Card>
      </Stack>
    </div>
    <Card padding="md" mt="md"><div className="panel-title"><div><strong>角色条件与审批</strong><Text size="xs" c="dimmed">船长、码头和货主代表可对方案提出限制</Text></div><IconUsers size={18} /></div><div className="comments-grid">{state.comments.map((item) => <div className="comment-card" key={item.id}><Group justify="space-between"><Badge size="xs">{item.role}</Badge><Text size="xs" c="dimmed">{item.author}</Text></Group><Text size="sm" mt="xs">{item.content}</Text><Group gap="xs" mt="sm"><Button size="compact-xs" color="teal" disabled={item.status !== '待确认'} onClick={() => dispatch(acceptComment(item.id))}>接受</Button><Button size="compact-xs" variant="default" disabled={item.status !== '待确认'} onClick={() => dispatch(rejectComment(item.id))}>退回</Button></Group></div>)}</div><Group mt="md" align="flex-start"><Textarea flex={1} minRows={2} placeholder="输入新的限制条件或调整意见" value={comment} onChange={(event) => setComment(event.currentTarget.value)} /><Button color="teal" onClick={() => { if (comment.trim()) { dispatch(addComment({ cargoId: active.id, author: '本次负责人', role: '船长', content: comment })); setComment(''); } }}>提交条件</Button></Group></Card>
  </div>;
}

function Compare() {
  const state = useSelector((root: RootState) => root.stowage);
  const stability = calculateStability(state.cargo);
  const conflicts = detectConflicts(state.cargo);
  const gate = gateStatus(state.cargo, state.conclusions, state.stability, state.points, state.gearBatches, conflicts.length);
  const changed = state.cargo.filter((item) => item.id === 'BL-88247' || item.id === 'BL-88219' || item.id === 'BL-88240');
  const [acceptOpen, setAcceptOpen] = useState(false);
  const dispatch = useDispatch();
  return <div className="page">
    <PageHeading eyebrow="PLAN BASELINE / V4 → V5" title="配载方案对比" description="按货位、重量分布和受限条件比较两个版本，并逐项决定是否接受。" actions={<Button color="teal" leftSection={<IconCheck size={16} />} onClick={() => setAcceptOpen(true)}>形成审阅结论</Button>} />
    <div className="compare-summary"><div><span>当前版本</span><strong>V{state.planRevision}</strong><small>总重 {stability.total.toFixed(1)}t</small></div><span className="compare-arrow">→</span><div><span>被比较版本</span><strong>V4</strong><small>总重 {(stability.total + 5.2).toFixed(1)}t</small></div><Badge color="teal" variant="light">3 处货位变化</Badge></div>
    <div className="compare-grid"><Card padding={0}><div className="panel-title"><div><strong>V4 基线</strong><Text size="xs" c="dimmed">批准于 09-28 16:20</Text></div></div><div className="mini-deck old-deck">{Array.from({ length: 28 }).map((_, index) => <div key={index} className={index === 6 || index === 11 || index === 17 ? 'changed' : ''}>{index === 6 ? '219' : index === 11 ? '240' : index === 17 ? '247' : ''}</div>)}</div></Card><Card padding={0}><div className="panel-title"><div><strong>V5 候选</strong><Text size="xs" c="dimmed">当前编辑 · {state.draftSavedAt}</Text></div></div><div className="mini-deck new-deck">{Array.from({ length: 28 }).map((_, index) => <div key={index} className={index === 6 || index === 11 || index === 17 ? 'changed' : ''}>{index === 6 ? '219' : index === 11 ? '240' : index === 17 ? '247' : ''}</div>)}</div></Card></div>
    <Card padding="md" mt="md"><div className="panel-title"><div><strong>参数差异</strong><Text size="xs" c="dimmed">系统通过检查的差异可直接接受</Text></div><Badge>{changed.length} 项</Badge></div><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>货物</Table.Th><Table.Th>字段</Table.Th><Table.Th>V4</Table.Th><Table.Th>V5</Table.Th><Table.Th>说明</Table.Th><Table.Th>决定</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{[
      ['BL-88247', '货位', 'Bay 14 / Row 1', 'Bay 15 / Row 0', '扩大重大件绑扎操作空间'],
      ['BL-88219', '绑扎', '待绑扎', '需复核', '危险品隔离边界调整'],
      ['BL-88240', 'Tier', 'Tier 1', 'Tier 2', '降低舱内底层局部载荷']
    ].map((row) => <Table.Tr key={row[0]}><Table.Td>{row[0]}</Table.Td><Table.Td>{row[1]}</Table.Td><Table.Td><Text c="red" td="line-through">{row[2]}</Text></Table.Td><Table.Td><Text c="teal" fw={700}>{row[3]}</Text></Table.Td><Table.Td><Text size="xs">{row[4]}</Text></Table.Td><Table.Td><Checkbox label="接受" defaultChecked /></Table.Td></Table.Tr>)}</Table.Tbody></Table></Card>
    <Modal opened={acceptOpen} onClose={() => setAcceptOpen(false)} title="形成配载审阅结论" centered><Stack><Text size="sm" c="dimmed">接受后生成新的只读版本并保留船长、码头和货主意见。锁定前仍可退回修改。</Text>{['重大件绑扎后由甲板部复核', '危险品隔离线在配载图中明确标注', '釜山卸货顺序不得改变'].map((limit) => <Checkbox key={limit} label={limit} checked={state.acceptedLimits.includes(limit)} onChange={() => dispatch(acceptLimit(limit))} />)}<Button color="teal" disabled={state.acceptedLimits.length < 3 || !gate.passed} onClick={() => { dispatch(lockPlan()); setAcceptOpen(false); }}>{gate.passed ? `接受并锁定 V${state.planRevision + 1}` : '门禁未通过，无法锁定'}</Button></Stack></Modal>
  </div>;
}

function PrintPlan() {
  const { data } = useGetVoyageQuery();
  const state = useSelector((root: RootState) => root.stowage);
  const stability = calculateStability(state.cargo);
  const conflicts = detectConflicts(state.cargo);
  const gate = gateStatus(state.cargo, state.conclusions, state.stability, state.points, state.gearBatches, conflicts.length);
  const dispatch = useDispatch();
  return <div className="page print-page">
    <PageHeading eyebrow="STOWAGE PLAN / PRINT" title="配载图与卸货清单" description="面向船长、码头和理货人员打印，包含重量分布和危险品标记。" actions={<><Button variant="default" leftSection={<IconPlayerPlay size={16} />} onClick={() => dispatch(setViewMode(state.viewMode === '3d' ? 'section' : '3d'))}>预览剖面</Button><Button color="teal" leftSection={<IconPrinter size={16} />} disabled={!gate.passed} onClick={() => window.print()}>{gate.passed ? '打印配载包' : '门禁未通过，无法打印'}</Button></>} />
    {!gate.passed && <div className="gate-banner"><IconLock size={18} /><strong>开航门禁未通过，禁止打印</strong><span>{gate.blockers.slice(0, 4).map((b) => b.message).join('；')}{gate.blockers.length > 4 ? ` 等 ${gate.blockers.length} 项` : ''}</span></div>}
    {gate.passed && <div className="gate-banner pass"><IconCircleCheck size={18} /><strong>开航门禁已通过</strong><span>可打印配载图与绑扎清单。</span></div>}
    <Card padding="xl" className="print-sheet">
      <div className="print-header"><div><Text size="xs" c="dimmed">VESSEL STOWAGE PLAN</Text><h1>{data?.vessel ?? '海岳轮'} · {data?.id ?? 'V-2609-17'}</h1><p>{data?.route}</p></div><div className="print-stamp">方案 V{state.planRevision}<br />已校核</div></div>
      <div className="print-kpis"><div><span>总货重</span><strong>{stability.total.toFixed(1)} t</strong></div><div><span>稳性裕度</span><strong>{stability.stability.toFixed(1)}%</strong></div><div><span>纵倾</span><strong>{stability.trim}</strong></div><div><span>主甲板载荷</span><strong>{stability.deckLoad.toFixed(1)} t</strong></div></div>
      <h3>主甲板配载图</h3>
      <div className="print-deck">{Array.from({ length: 28 }).map((_, index) => { const row = index % 4; const bay = 4 + Math.floor(index / 4); const item = state.cargo.find((cargo) => cargo.deck === '主甲板' && cargo.bay === bay && cargo.row === row); return <div key={index} className={item ? 'filled' : ''} style={item ? { borderTopColor: item.color } : undefined}><span>{item ? item.bill.slice(-3) : ''}</span><small>{item ? `${item.weight}t` : `B${bay}/R${row}`}</small>{item?.hazmat !== '无' && item && <b>DG</b>}</div>; })}</div>
      <h3>卸货顺序与绑扎清单</h3>
      <Table striped><Table.Thead><Table.Tr><Table.Th>顺序</Table.Th><Table.Th>提单号</Table.Th><Table.Th>货位</Table.Th><Table.Th>货类</Table.Th><Table.Th>重量</Table.Th><Table.Th>卸货港</Table.Th><Table.Th>危险品 / 绑扎</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{[...state.cargo].sort((a, b) => (a.port === '釜山' ? -1 : 1) - (b.port === '釜山' ? -1 : 1)).map((item, index) => <Table.Tr key={item.id}><Table.Td>{index + 1}</Table.Td><Table.Td fw={700}>{item.bill}</Table.Td><Table.Td>B{item.bay}/R{item.row}/T{item.tier}</Table.Td><Table.Td>{item.type}</Table.Td><Table.Td>{item.weight} t</Table.Td><Table.Td>{item.port}</Table.Td><Table.Td><Badge size="xs" color={item.hazmat !== '无' ? 'orange' : 'gray'}>{item.hazmat}</Badge> <Text span size="xs">{item.lashing}</Text></Table.Td></Table.Tr>)}</Table.Tbody></Table>
      <div className="print-signatures"><div>配载负责人：____________</div><div>船长确认：____________</div><div>码头代表：____________</div><div>日期：2026-09-29</div></div>
    </Card>
  </div>;
}

function LashingGate() {
  const state = useSelector((root: RootState) => root.stowage);
  const dispatch = useDispatch();
  const conflicts = detectConflicts(state.cargo);
  const gate = gateStatus(state.cargo, state.conclusions, state.stability, state.points, state.gearBatches, conflicts.length);
  const [tab, setTab] = useState<string | null>('gate');
  const [confirmer, setConfirmer] = useState<string>(state.activeCrew);
  const [pointForm, setPointForm] = useState({ bay: 12, row: 2, deck: '主甲板' as '主甲板' | '货舱' });
  const [gearForm, setGearForm] = useState({ type: '绑扎带' as GearType, spec: '', quantity: 10, certificateNo: '', inspectedAt: '2026-09-01', validUntil: '2027-03-01' });
  const [certModal, setCertModal] = useState<GearBatch | null>(null);
  const [certForm, setCertForm] = useState({ certificateNo: '', inspectedAt: '', validUntil: '' });

  const openCert = (batch: GearBatch) => {
    setCertModal(batch);
    setCertForm({ certificateNo: batch.certificateNo, inspectedAt: batch.inspectedAt, validUntil: batch.validUntil });
  };

  const statusColor = (s: string) => (s === '已确认' || s === '有效' ? 'teal' : s === '已作废' || s === '过期' ? 'red' : 'orange');
  const statusIcon = (s: string) => (s === '已确认' || s === '有效' ? <IconCircleCheck size={14} /> : s === '已作废' || s === '过期' ? <IconCircleX size={14} /> : <IconClock size={14} />);

  const needLashing = state.cargo.filter((c) => c.type === '重大件' || c.lashing !== '已绑扎');
  const offlinePending = state.offlineQueue.filter((r) => r.status === 'pending' || r.status === 'failed');
  const failedBatches = Array.from(new Set(state.offlineQueue.filter((r) => r.status === 'failed').map((r) => r.localBatchId)));

  return <div className="page">
    <PageHeading eyebrow="LASHING GATE / 开航门禁" title="系固器材与绑扎门禁" description="货物、绑扎点与检验批次接成开航门禁；检定、重心或绑扎点变化即作废，未确认锁不了版、打不了印。" actions={<Group gap="xs"><Badge size="lg" color={state.networkOnline ? 'teal' : 'gray'} leftSection={state.networkOnline ? <IconWifi size={14} /> : <IconWifiOff size={14} />}>{state.networkOnline ? '在线' : '断网补录中'}</Badge><Badge size="lg" color={gate.passed ? 'teal' : 'red'} leftSection={<IconLock size={14} />}>{gate.passed ? '门禁通过' : `${gate.blockers.length} 项阻断`}</Badge></Group>} />
    {state.upgradedFromDraft && <div className="upgrade-banner"><IconAlertTriangle size={18} /><div><strong>旧草稿已升级为首版 V1</strong><span>检测到本地草稿缺少检验批次与绑扎点，已按当前航次补全器材批次、绑扎点与结论框架。</span></div><Button size="xs" variant="default" onClick={() => dispatch(dismissUpgrade())}>知道了</Button></div>}
    <Tabs value={tab} onChange={setTab} mb="md">
      <Tabs.List>
        <Tabs.Tab value="gate" leftSection={<IconClipboardCheck size={15} />}>门禁总览</Tabs.Tab>
        <Tabs.Tab value="gear" leftSection={<IconAnchor size={15} />}>器材批次</Tabs.Tab>
        <Tabs.Tab value="points" leftSection={<IconMap2 size={15} />}>绑扎点</Tabs.Tab>
        <Tabs.Tab value="conclusions" leftSection={<IconCheck size={15} />}>绑扎结论</Tabs.Tab>
        <Tabs.Tab value="offline" leftSection={<IconCloudUpload size={15} />}>补录队列{offlinePending.length > 0 ? ` (${offlinePending.length})` : ''}</Tabs.Tab>
      </Tabs.List>
    </Tabs>

    {tab === 'gate' && <Stack gap="sm">
      <Card padding="md" className={gate.passed ? 'gate-pass' : 'gate-block'}>
        <Group justify="space-between" align="flex-start">
          <div><Group gap="xs">{gate.passed ? <IconCircleCheck size={22} color="#237162" /> : <IconCircleX size={22} color="#b64440" />}<strong style={{ fontSize: 16 }}>{gate.passed ? '开航门禁通过' : '开航门禁未通过'}</strong></Group><Text size="xs" c="dimmed" mt={4}>货物绑扎结论、稳性结论、器材检验批次与绑扎点须全部确认且有效，方可锁版与打印。</Text></div>
          <Button color="teal" leftSection={<IconLock size={16} />} disabled={!gate.passed || state.locked} onClick={() => dispatch(lockPlan())}>{state.locked ? '方案已锁定' : '确认门禁并锁版'}</Button>
        </Group>
        {!gate.passed && <div className="blocker-list">{gate.blockers.map((b, i) => <div key={i} className="blocker-row"><IconAlertTriangle size={14} /><span>{b.message}</span></div>)}</div>}
      </Card>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
        <Card padding="md">
          <div className="panel-title"><div><strong>稳性结论</strong><Text size="xs" c="dimmed">重心或货位变化后立即作废</Text></div><Badge color={statusColor(state.stability.status)} leftSection={statusIcon(state.stability.status)}>{state.stability.status}</Badge></div>
          {state.stability.status === '已作废' && <div className="invalid-note"><IconAlertTriangle size={13} /> 已作废：{state.stability.invalidReason}（{state.stability.confirmedAt ? '原确认 ' + state.stability.confirmedAt : '未确认'}）</div>}
          {state.stability.status === '已确认' && <Text size="xs" c="dimmed" mt="xs">已由 {state.stability.confirmedBy} 确认于 {new Date(state.stability.confirmedAt!).toLocaleString('zh-CN')}，基于重心 {state.stability.basedOn.cog.toFixed(2)} m。</Text>}
          <Group mt="sm" gap="xs"><TextInput size="xs" label="确认人" value={confirmer} onChange={(e) => setConfirmer(e.currentTarget.value)} style={{ flex: 1 }} /><Button size="xs" color="teal" disabled={!confirmer.trim()} onClick={() => dispatch(confirmStability(confirmer.trim()))}>{state.stability.status === '已作废' ? '重新确认稳性' : '确认稳性结论'}</Button></Group>
        </Card>
        <Card padding="md">
          <div className="panel-title"><div><strong>旧放行照走</strong><Text size="xs" c="dimmed">器材送检不阻塞当前航次</Text></div><IconAnchor size={18} /></div>
          <Text size="xs" c="dimmed" mt="xs">器材批次送检后，status 置为「送检中」，但已放行航次的旧放行继续有效，绑扎结论不作废。仅当新检定证书录入（条款变化）时，对应结论才需重新确认。</Text>
          <div className="gear-mini">{state.gearBatches.map((b) => <div key={b.id}><Badge size="xs" color={statusColor(b.status)}>{b.status}</Badge><span>{b.id} · {b.type}</span>{b.status === '送检中' && <em>旧放行有效</em>}</div>)}</div>
        </Card>
      </SimpleGrid>
    </Stack>}

    {tab === 'gear' && <Stack gap="sm">
      <Card padding={0}>
        <div className="panel-title"><div><strong>系固器材批次</strong><Text size="xs" c="dimmed">检定/送检/新检定</Text></div></div>
        <Table striped verticalSpacing="xs"><Table.Thead><Table.Tr><Table.Th>批次</Table.Th><Table.Th>类型</Table.Th><Table.Th>规格</Table.Th><Table.Th>数量</Table.Th><Table.Th>证书编号</Table.Th><Table.Th>检定日期</Table.Th><Table.Th>有效期至</Table.Th><Table.Th>状态</Table.Th><Table.Th>操作</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{state.gearBatches.map((b) => <Table.Tr key={b.id}><Table.Td fw={700}>{b.id}</Table.Td><Table.Td>{b.type}</Table.Td><Table.Td>{b.spec}</Table.Td><Table.Td>{b.quantity}</Table.Td><Table.Td>{b.certificateNo}</Table.Td><Table.Td>{b.inspectedAt}</Table.Td><Table.Td>{b.validUntil}</Table.Td><Table.Td><Badge size="xs" color={statusColor(b.status)}>{b.status}</Badge>{b.status === '送检中' && <Badge size="xs" color="teal" variant="light" ml={4}>旧放行</Badge>}</Table.Td><Table.Td><Group gap={4}>{b.status === '有效' && <Button size="compact-xs" variant="default" onClick={() => dispatch(sendGearForInspection(b.id))}>送检</Button>}{b.status === '送检中' && <Button size="compact-xs" color="teal" onClick={() => openCert(b)}>新检定</Button>}</Group></Table.Td></Table.Tr>)}</Table.Tbody></Table>
      </Card>
      <Card padding="md">
        <div className="panel-title"><div><strong>新增器材批次</strong></div><IconPlus size={16} /></div>
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="xs" mt="sm">
          <Select size="xs" label="类型" data={['绑扎带', '链条', '花篮螺丝', '卸扣', '支撑木']} value={gearForm.type} onChange={(v) => setGearForm({ ...gearForm, type: v as GearType })} />
          <TextInput size="xs" label="规格" value={gearForm.spec} onChange={(e) => setGearForm({ ...gearForm, spec: e.currentTarget.value })} />
          <NumberInput size="xs" label="数量" value={gearForm.quantity} onChange={(v) => setGearForm({ ...gearForm, quantity: Number(v) })} />
          <TextInput size="xs" label="证书编号" value={gearForm.certificateNo} onChange={(e) => setGearForm({ ...gearForm, certificateNo: e.currentTarget.value })} />
          <TextInput size="xs" label="检定日期" value={gearForm.inspectedAt} onChange={(e) => setGearForm({ ...gearForm, inspectedAt: e.currentTarget.value })} />
          <TextInput size="xs" label="有效期至" value={gearForm.validUntil} onChange={(e) => setGearForm({ ...gearForm, validUntil: e.currentTarget.value })} />
        </SimpleGrid>
        <Button size="xs" color="teal" mt="sm" disabled={!gearForm.spec.trim() || !gearForm.certificateNo.trim()} onClick={() => { dispatch(addGearBatch(gearForm)); setGearForm({ ...gearForm, spec: '', certificateNo: '' }); }}>登记批次</Button>
      </Card>
    </Stack>}

    {tab === 'points' && <Stack gap="sm">
      <Card padding="md">
        <div className="panel-title"><div><strong>记录绑扎点</strong><Text size="xs" c="dimmed">两班同时提交同一点：先到者占用，后到者看到替代点</Text></div></div>
        <Group mt="sm" gap="xs" align="flex-end">
          <Select size="xs" label="班组" data={['码头班', '大副']} value={state.activeCrew} onChange={(v) => dispatch(setActiveCrew(v as Crew))} style={{ width: 110 }} />
          <NumberInput size="xs" label="Bay" min={4} max={15} value={pointForm.bay} onChange={(v) => setPointForm({ ...pointForm, bay: Number(v) })} style={{ width: 90 }} />
          <NumberInput size="xs" label="Row" min={0} max={3} value={pointForm.row} onChange={(v) => setPointForm({ ...pointForm, row: Number(v) })} style={{ width: 90 }} />
          <Select size="xs" label="甲板" data={['主甲板', '货舱']} value={pointForm.deck} onChange={(v) => setPointForm({ ...pointForm, deck: v as '主甲板' | '货舱' })} style={{ width: 100 }} />
          <Button size="xs" color="teal" leftSection={<IconAnchor size={14} />} onClick={() => dispatch(recordLashingPoint({ ...pointForm, recordedBy: state.activeCrew }))}>{state.networkOnline ? '记录并占用' : '断网记录（补录队列）'}</Button>
        </Group>
      </Card>
      <Card padding={0}>
        <div className="panel-title"><div><strong>绑扎点分布</strong><Text size="xs" c="dimmed">{state.points.filter((p) => p.status === '已占用').length} / {state.points.length} 已占用</Text></div><Group gap="xs"><Badge size="xs" color="teal">已占用</Badge><Badge size="xs" color="gray">可用</Badge></Group></div>
        <div className="point-grid">{state.points.map((p) => <button key={p.id} className={p.status === '已占用' ? 'occupied' : ''} onClick={() => p.status === '已占用' && dispatch(releasePoint(p.id))} title={p.status === '已占用' ? `${p.id} · ${p.recordedBy} · v${p.version}（点击释放）` : `${p.id} · 可用`}><small>{p.id}</small>{p.status === '已占用' && <><b>{p.recordedBy?.slice(0, 1)}</b><em>v{p.version}</em></>}</button>)}</div>
        <Text size="xs" c="dimmed" p="xs">点击已占用点可释放（绑扎点变化 → 对应结论立即作废）。</Text>
      </Card>
    </Stack>}

    {tab === 'conclusions' && <Stack gap="sm">
      {needLashing.map((cargo) => {
        const conc = state.conclusions.find((c) => c.cargoId === cargo.id);
        const itemPoints = state.points.filter((p) => p.status === '已占用' && p.occupiedBy === cargo.id);
        return <Card key={cargo.id} padding="md">
          <div className="panel-title"><div><strong>{cargo.id} · {cargo.bill}</strong><Text size="xs" c="dimmed">{cargo.type} · {cargo.weight}t · B{cargo.bay}/R{cargo.row}/T{cargo.tier} · 绑扎 {cargo.lashing}</Text></div>{conc ? <Badge color={statusColor(conc.status)} leftSection={statusIcon(conc.status)}>{conc.status}</Badge> : <Badge color="gray">无结论</Badge>}</div>
          {!conc && <Group mt="sm"><Text size="xs" c="dimmed">该货需绑扎但尚无结论。</Text><Button size="xs" variant="default" onClick={() => dispatch(createConclusion(cargo.id))}>根据已占用点创建结论</Button></Group>}
          {conc && <Stack gap="xs" mt="sm">
            {conc.status === '已作废' && <div className="invalid-note"><IconAlertTriangle size={13} /> 已作废：{conc.invalidReason}</div>}
            <div className="conc-row"><span>绑扎点</span><div className="conc-chips">{conc.pointIds.map((id) => { const p = state.points.find((x) => x.id === id); return <Badge key={id} size="sm" color={p && p.status === '已占用' && p.occupiedBy === cargo.id ? 'teal' : 'red'} rightSection={<IconX size={10} onClick={() => dispatch(removeConclusionPoint({ cargoId: cargo.id, pointId: id }))} />}>{id}</Badge>; })}<Select size="xs" placeholder="加点位" data={itemPoints.filter((p) => !conc.pointIds.includes(p.id)).map((p) => p.id)} value={null} onChange={(v) => v && dispatch(addConclusionPoint({ cargoId: cargo.id, pointId: v }))} style={{ width: 110 }} /></div></div>
            <div className="conc-row"><span>检验批次</span><div className="conc-chips">{conc.gearBatchIds.map((id) => { const b = state.gearBatches.find((x) => x.id === id); return <Badge key={id} size="sm" color={b?.status === '过期' ? 'red' : b?.status === '送检中' ? 'orange' : 'teal'} rightSection={<IconX size={10} onClick={() => dispatch(removeConclusionGear({ cargoId: cargo.id, gearId: id }))} />}>{id}</Badge>; })}<Select size="xs" placeholder="加批次" data={state.gearBatches.filter((b) => !conc.gearBatchIds.includes(b.id)).map((b) => b.id)} value={null} onChange={(v) => v && dispatch(addConclusionGear({ cargoId: cargo.id, gearId: v }))} style={{ width: 130 }} /></div></div>
            {conc.status === '已确认' && <Text size="xs" c="dimmed">已由 {conc.confirmedBy} 确认于 {new Date(conc.confirmedAt!).toLocaleString('zh-CN')}。</Text>}
            <Group gap="xs"><TextInput size="xs" label="确认人" value={confirmer} onChange={(e) => setConfirmer(e.currentTarget.value)} style={{ width: 140 }} /><Button size="xs" color="teal" disabled={conc.pointIds.length === 0 || conc.gearBatchIds.length === 0 || !confirmer.trim()} onClick={() => dispatch(confirmConclusion({ cargoId: cargo.id, confirmedBy: confirmer.trim() }))}>{conc.status === '已作废' ? '重新确认结论' : '确认绑扎结论'}</Button></Group>
          </Stack>}
        </Card>;
      })}
    </Stack>}

    {tab === 'offline' && <Stack gap="sm">
      <Card padding="md">
        <Group justify="space-between"><div><strong>断网补录与回连</strong><Text size="xs" c="dimmed">回连按绑扎点合并；重复上传不重复计时；失败后从本地批次重试</Text></div><Group gap="xs"><Button size="xs" variant={state.networkOnline ? 'default' : 'filled'} color={state.networkOnline ? 'gray' : 'teal'} leftSection={state.networkOnline ? <IconWifiOff size={14} /> : <IconWifi size={14} />} onClick={() => dispatch(setNetworkOnline(!state.networkOnline))}>{state.networkOnline ? '切换到断网' : '切换到在线'}</Button><Button size="xs" color="teal" leftSection={<IconCloudUpload size={14} />} disabled={!state.networkOnline || offlinePending.length === 0} onClick={() => dispatch(flushOfflineQueue())}>回连补录{offlinePending.length > 0 ? ` (${offlinePending.length})` : ''}</Button></Group></Group>
        <Group mt="xs"><Checkbox size="xs" label="下次回连模拟失败（用于演示本地批次重试）" checked={state.simulateFlushFailure} onChange={(e) => dispatch(setSimulateFlushFailure(e.currentTarget.checked))} /></Group>
        {state.lastFlush && <div className="flush-note">最近补录 {new Date(state.lastFlush.at).toLocaleTimeString('zh-CN')}：合并 {state.lastFlush.merged} 条，去重 {state.lastFlush.duplicated} 条，失败 {state.lastFlush.failed} 条。</div>}
      </Card>
      <Card padding={0}>
        <div className="panel-title"><div><strong>本地补录队列</strong><Text size="xs" c="dimmed">{state.offlineQueue.length} 条记录</Text></div></div>
        {state.offlineQueue.length === 0 ? <Text size="sm" c="dimmed" p="md">队列为空。断网时在「绑扎点」页记录，回连后在此补录。</Text> : <Table striped verticalSpacing="xs"><Table.Thead><Table.Tr><Table.Th>本地批次</Table.Th><Table.Th>类型</Table.Th><Table.Th>内容</Table.Th><Table.Th>记录时间</Table.Th><Table.Th>尝试</Table.Th><Table.Th>状态</Table.Th><Table.Th>操作</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{state.offlineQueue.map((r) => <Table.Tr key={r.clientId}><Table.Td>{r.localBatchId}</Table.Td><Table.Td>{r.kind}</Table.Td><Table.Td>{String(r.payload.deck)} B{String(r.payload.bay)} R{String(r.payload.row)} · {String(r.payload.recordedBy)}</Table.Td><Table.Td>{new Date(r.createdAt).toLocaleString('zh-CN')}</Table.Td><Table.Td>{r.attempts}</Table.Td><Table.Td><Badge size="xs" color={r.status === 'synced' ? 'teal' : r.status === 'failed' ? 'red' : 'orange'}>{r.status === 'synced' ? '已同步' : r.status === 'failed' ? '失败' : '待补录'}</Badge></Table.Td><Table.Td>{r.status === 'failed' && <Button size="compact-xs" color="teal" leftSection={<IconRepeat size={12} />} onClick={() => dispatch(retryOfflineBatch(r.localBatchId))}>重试本批</Button>}</Table.Td></Table.Tr>)}</Table.Tbody></Table>}
      </Card>
    </Stack>}

    <Modal opened={!!state.lastConflict} onClose={() => dispatch(clearConflict())} title="绑扎点冲突：先到者占用" centered>
      {state.lastConflict && <Stack gap="sm">
        <Text size="sm">班组 <strong>{state.lastConflict.by}</strong> 提交的绑扎点 <strong>{state.lastConflict.pointId}</strong> 已被先到班组占用。按先到者占用规则，本次提交未生效。</Text>
        <Text size="xs" c="dimmed">可改用以下就近替代点：</Text>
        <Group gap="xs">{state.lastConflict.alternatives.map((id) => { const p = state.points.find((x) => x.id === id); return <Button key={id} size="xs" variant="default" onClick={() => { if (p) dispatch(recordLashingPoint({ bay: p.bay, row: p.row, deck: p.deck, recordedBy: state.lastConflict!.by })); dispatch(clearConflict()); }}>{id} · 可用</Button>; })}</Group>
        <Button size="xs" variant="subtle" onClick={() => dispatch(clearConflict())}>取消</Button>
      </Stack>}
    </Modal>

    <Modal opened={!!certModal} onClose={() => setCertModal(null)} title="新检定证书录入" centered>
      {certModal && <Stack gap="sm">
        <Text size="xs" c="dimmed">{certModal.id} · {certModal.type} · 新检定条款录入后，使用该批次的绑扎结论将立即作废，需重新确认。</Text>
        <TextInput size="xs" label="证书编号" value={certForm.certificateNo} onChange={(e) => setCertForm({ ...certForm, certificateNo: e.currentTarget.value })} />
        <TextInput size="xs" label="检定日期" value={certForm.inspectedAt} onChange={(e) => setCertForm({ ...certForm, inspectedAt: e.currentTarget.value })} />
        <TextInput size="xs" label="有效期至" value={certForm.validUntil} onChange={(e) => setCertForm({ ...certForm, validUntil: e.currentTarget.value })} />
        <Group justify="flex-end"><Button size="xs" variant="default" onClick={() => setCertModal(null)}>取消</Button><Button size="xs" color="teal" onClick={() => { dispatch(receiveGearCertificate({ id: certModal.id, ...certForm })); setCertModal(null); }}>录入并作废旧结论</Button></Group>
      </Stack>}
    </Modal>
  </div>;
}

function Shell({ children }: { children: ReactNode }) {
  const state = useSelector((root: RootState) => root.stowage);
  const stability = calculateStability(state.cargo);
  return <AppShell header={{ height: 62 }} navbar={{ width: 224, breakpoint: 'sm' }} padding={0}>
    <AppShellHeader className="app-header"><Group h="100%" px="md" justify="space-between"><Group gap="sm"><ThemeIcon color="teal" variant="light"><IconShip size={19} /></ThemeIcon><div className="brand-copy"><strong>船舶配载校核台</strong><span>Stowage & Voyage Review</span></div></Group><Group gap="sm" visibleFrom="sm"><Badge variant="light" color="teal">海岳轮</Badge><Text size="xs" c="dimmed">V-2609-17 · 方案 V{state.planRevision}</Text><Badge color={state.locked ? 'teal' : 'orange'}>{state.locked ? '已锁定' : '审阅中'}</Badge></Group><ActionIcon variant="subtle" color="gray"><IconAnchor size={18} /></ActionIcon></Group></AppShellHeader>
    <AppShellNavbar p="xs" className="app-nav"><div className="voyage-card"><Text size="xs" c="dimmed">当前航次</Text><Text fw={800}>上海 → 温哥华</Text><Text size="xs" c="dimmed">经停釜山 · 10-02 离港</Text><Progress value={stability.stability} color={stability.stability > 70 ? 'teal' : 'orange'} size="sm" mt="sm" /><Text size="xs" mt={4}>稳性裕度 {stability.stability.toFixed(1)}%</Text></div>{nav.map((item) => <NavLink end={item.path === '/'} key={item.path} to={item.path}>{item.icon}<span>{item.label}</span></NavLink>)}<div className="nav-foot"><IconRoute size={16} /><Text size="xs">基线：方案 V4<br />草稿：{state.draftSavedAt} 自动保存</Text></div></AppShellNavbar>
    <AppShellMain>{children}</AppShellMain>
  </AppShell>;
}

export default function App() {
  return <BrowserRouter><Shell><Routes><Route path="/" element={<Overview />} /><Route path="/stowage" element={<Stowage />} /><Route path="/lashing" element={<LashingGate />} /><Route path="/compare" element={<Compare />} /><Route path="/print" element={<PrintPlan />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Shell></BrowserRouter>;
}
