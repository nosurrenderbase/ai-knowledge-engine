'use client';

import {SearchOutlined} from '@ant-design/icons';
import {Drawer, Input, Spin, Typography} from 'antd';
import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {readDoc, runSearch} from '../search/actions';

/**
 * The knowledge base as a point cloud: every indexed chunk at its 3D position
 * (UMAP of the embeddings, computed on the server), coloured by area and
 * module. Hover for the section, click to read the document, search to see
 * where a question lands, and watch live MCP reads light up.
 */

type Row = [string, number, number, number, string, string, string, string, string];
interface Pt {
  area: string;
  x: number;
  y: number;
  z: number;
  path: string;
  title: string;
  section: string;
  module: string;
  kind: string;
}

const AREA_COLOR: Record<string, string> = {backend: '#4da3ff', frontend: '#4cd97b', 'mac-motoru': '#ffad33'};
const AREA_LABEL: Record<string, string> = {backend: 'Backend', frontend: 'Frontend', 'mac-motoru': 'Maç motoru'};
const SCALE = 50;

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}

/** Area hue, shifted a little per module so modules read as sub-clusters. */
function colorOf(p: Pt): THREE.Color {
  const c = new THREE.Color(AREA_COLOR[p.area] ?? '#ffffff');
  const hsl = {h: 0, s: 0, l: 0};
  c.getHSL(hsl);
  const k = hash(p.module || p.path.split('/')[1] || '');
  return new THREE.Color().setHSL((hsl.h + (k - 0.5) * 0.09 + 1) % 1, Math.min(1, hsl.s * (0.85 + k * 0.3)), Math.min(0.78, hsl.l * (0.85 + k * 0.35)));
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Api {
  highlight: (idx: number[], focus?: [number, number, number]) => void;
  pulse: (idx: number[]) => void;
  setVisible: (areas: Set<string>) => void;
}

export function GalaxyView() {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [points, setPoints] = useState<Pt[] | null>(null);
  const [status, setStatus] = useState<'loading' | 'pending' | 'ready' | 'error'>('loading');
  const [hover, setHover] = useState<{p: Pt; x: number; y: number} | null>(null);
  const [doc, setDoc] = useState<{path: string; text: string} | null>(null);
  const [visible, setVisible] = useState(new Set(Object.keys(AREA_COLOR)));
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<string | null>(null);

  // Data
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch('/api/galaxy');
        if (res.status === 202) {
          setStatus('pending');
          if (!stop) setTimeout(load, 10_000);
          return;
        }
        const j = (await res.json()) as {rows: Row[]};
        if (stop) return;
        setPoints(j.rows.map(([area, x, y, z, path, title, section, module, kind]) => ({area, x, y, z, path, title, section, module, kind})));
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    };
    void load();
    return () => {
      stop = true;
    };
  }, []);

  // Scene
  useEffect(() => {
    if (!points || !host.current) return;
    const el = host.current;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x060912, 0.0065);
    const camera = new THREE.PerspectiveCamera(55, el.clientWidth / el.clientHeight, 0.1, 2000);
    camera.position.set(0, 18, 118);
    const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const sprite = glowTexture();

    // Background stars for depth
    const stars = new THREE.BufferGeometry();
    const sp = new Float32Array(1500 * 3);
    for (let i = 0; i < sp.length; i++) sp[i] = (Math.random() - 0.5) * 900;
    stars.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(stars, new THREE.PointsMaterial({size: 0.9, color: 0x8fa3c7, transparent: true, opacity: 0.35, depthWrite: false})));

    // The cloud
    const pos = new Float32Array(points.length * 3);
    const base = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      pos.set([p.x * SCALE, p.y * SCALE, p.z * SCALE], i * 3);
      const c = colorOf(p);
      base.set([c.r, c.g, c.b], i * 3);
    });
    const colors = new Float32Array(base);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const cloud = new THREE.Points(
      geo,
      new THREE.PointsMaterial({size: 2.4, map: sprite, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending}),
    );
    scene.add(cloud);

    // Highlights (search hits), pulses (live reads), hover, the question marker and its threads
    const mk = (size: number, color: number, opacity = 1) =>
      new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({size, color, map: sprite, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending}));
    const hits = mk(6.5, 0xffffff);
    const pulses = mk(9, 0x7fd4ff, 0);
    const hoverPt = mk(8, 0xffffff, 0.9);
    const query = mk(14, 0xffd60a);
    const threads = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color: 0xffd60a, transparent: true, opacity: 0.35}));
    scene.add(hits, pulses, hoverPt, query, threads);
    const setPts = (o: THREE.Points | THREE.LineSegments, arr: number[]) => {
      o.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
      o.geometry.computeBoundingSphere();
    };
    const xyz = (i: number) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.minDistance = 12;
    controls.maxDistance = 260;
    let idle: ReturnType<typeof setTimeout>;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      clearTimeout(idle);
    });
    controls.addEventListener('end', () => {
      idle = setTimeout(() => (controls.autoRotate = true), 8000);
    });

    // Fly the camera to a point
    let fly: {from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t: number} | null = null;
    const flyTo = (target: THREE.Vector3) => {
      const dir = camera.position.clone().sub(controls.target).normalize();
      fly = {from: controls.target.clone(), to: target, camFrom: camera.position.clone(), camTo: target.clone().add(dir.multiplyScalar(55)), t: 0};
      controls.autoRotate = false;
    };

    const hidden = new Set<string>();
    const pulseList: {idx: number[]; at: number}[] = [];
    api.current = {
      highlight: (idx, focus) => {
        setPts(hits, idx.flatMap(xyz));
        if (focus) {
          const f = focus.map(v => v * SCALE);
          setPts(query, f);
          setPts(threads, idx.flatMap(i => [...f, ...xyz(i)]));
          flyTo(new THREE.Vector3(...f));
        } else {
          setPts(query, []);
          setPts(threads, []);
        }
      },
      pulse: idx => {
        if (!idx.length) return;
        pulseList.push({idx, at: performance.now()});
      },
      setVisible: areas => {
        hidden.clear();
        points.forEach((p, i) => {
          const on = areas.has(p.area);
          if (!on) hidden.add(String(i));
          colors.set(on ? [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]] : [base[i * 3] * 0.06, base[i * 3 + 1] * 0.06, base[i * 3 + 2] * 0.06], i * 3);
        });
        geo.attributes.color.needsUpdate = true;
      },
    };

    // Hover and click
    const ray = new THREE.Raycaster();
    ray.params.Points = {threshold: 1.3};
    const ndc = new THREE.Vector2();
    let down: {x: number; y: number} | null = null;
    let hovered = -1;
    const pick = (e: PointerEvent): number => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(cloud).find(h => h.index !== undefined && !hidden.has(String(h.index)));
      return hit?.index ?? -1;
    };
    const onMove = (e: PointerEvent) => {
      const i = pick(e);
      if (i === hovered) return;
      hovered = i;
      setPts(hoverPt, i >= 0 ? xyz(i) : []);
      const r = el.getBoundingClientRect();
      setHover(i >= 0 ? {p: points[i], x: e.clientX - r.left, y: e.clientY - r.top} : null);
      renderer.domElement.style.cursor = i >= 0 ? 'pointer' : 'grab';
    };
    const onDown = (e: PointerEvent) => (down = {x: e.clientX, y: e.clientY});
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const i = pick(e);
      if (i < 0) return;
      const p = points[i];
      void readDoc(p.area as never, p.path).then(text => setDoc({path: `${p.area}/${p.path}`, text: text ?? 'Doküman bulunamadı.'}));
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', () => {
      hovered = -1;
      setPts(hoverPt, []);
      setHover(null);
    });

    const resize = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    resize.observe(el);

    // Loop
    let frame = 0;
    const clock = new THREE.Clock();
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      if (fly) {
        fly.t = Math.min(1, fly.t + 0.018);
        const k = 1 - Math.pow(1 - fly.t, 3);
        controls.target.lerpVectors(fly.from, fly.to, k);
        camera.position.lerpVectors(fly.camFrom, fly.camTo, k);
        if (fly.t >= 1) fly = null;
      }
      (hits.material as THREE.PointsMaterial).size = 6.5 + Math.sin(t * 3) * 1.2;
      (query.material as THREE.PointsMaterial).size = 14 + Math.sin(t * 2.2) * 3;
      // Live reads: a flash that fades over 2.5 s
      const now = performance.now();
      while (pulseList.length && now - pulseList[0].at > 2500) pulseList.shift();
      const live = pulseList.flatMap(p => p.idx);
      const pm = pulses.material as THREE.PointsMaterial;
      if (live.length) {
        setPts(pulses, live.flatMap(xyz));
        const age = (now - pulseList[pulseList.length - 1].at) / 2500;
        pm.opacity = Math.max(0, 1 - age);
        pm.size = 9 + age * 14;
      } else pm.opacity = 0;
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(idle);
      resize.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse(o => {
        if (o instanceof THREE.Points || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      sprite.dispose();
      el.removeChild(renderer.domElement);
      api.current = null;
    };
  }, [points]);

  useEffect(() => api.current?.setVisible(visible), [visible, points]);

  // Live MCP reads light up the documents they touched.
  useEffect(() => {
    if (!points) return;
    let last = '';
    const byPath = new Map<string, number[]>();
    points.forEach((p, i) => {
      const k = `${p.area}/${p.path}`;
      byPath.set(k, [...(byPath.get(k) ?? []), i]);
    });
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/live', {cache: 'no-store'});
        if (!res.ok) return;
        const {events} = (await res.json()) as {events: {id: string; tool: string; text: string}[]};
        const fresh = last ? events.slice(0, Math.max(0, events.findIndex(e => e.id === last))) : [];
        last = events[0]?.id ?? last;
        for (const e of fresh.reverse()) {
          if (e.tool !== 'read_doc' || !e.text) continue;
          const t = e.text.replace(/^\.?\//, '');
          const key = /^(backend|frontend|mac-motoru)\//.test(t) ? t : `backend/${t}`;
          api.current?.pulse(byPath.get(key.endsWith('.md') ? key : `${key}.md`) ?? []);
        }
      } catch {
        // offline for a moment
      }
    };
    void tick();
    const timer = setInterval(tick, 4000);
    return () => clearInterval(timer);
  }, [points]);

  const search = async (q: string) => {
    if (!points || !q.trim()) {
      api.current?.highlight([]);
      setFound(null);
      return;
    }
    setSearching(true);
    try {
      const res = await runSearch({query: q, limit: 12});
      if (!res.ok) {
        setFound(res.error);
        return;
      }
      const {hits} = res;
      const idx: number[] = [];
      const weights: number[] = [];
      for (const h of hits) {
        const exact = points.findIndex(p => p.area === h.area && p.path === h.path && p.section === h.section);
        const i = exact >= 0 ? exact : points.findIndex(p => p.area === h.area && p.path === h.path);
        if (i >= 0 && !idx.includes(i)) {
          idx.push(i);
          weights.push(h.score || 1);
        }
      }
      // Where the question lands: the score-weighted centre of what it found.
      const sum = weights.reduce((a, b) => a + b, 0) || 1;
      const focus = idx.length
        ? ([0, 1, 2].map(k => idx.reduce((s, i, j) => s + [points[i].x, points[i].y, points[i].z][k] * weights[j], 0) / sum) as [number, number, number])
        : undefined;
      api.current?.highlight(idx, focus);
      setFound(idx.length ? `${idx.length} parça · en yakını: ${points[idx[0]].title || points[idx[0]].path}` : 'Sonuç yok');
    } finally {
      setSearching(false);
    }
  };

  const counts = points ? Object.fromEntries(Object.keys(AREA_COLOR).map(a => [a, points.filter(p => p.area === a).length])) : {};

  return (
    <div className="kb-galaxy">
      <div ref={host} className="kb-galaxy-canvas" />
      {status !== 'ready' && (
        <div className="kb-galaxy-overlay">
          {status === 'error' ? (
            <span>Harita yüklenemedi.</span>
          ) : (
            <>
              <Spin />
              <span style={{marginTop: 12}}>{status === 'pending' ? 'Harita sunucuda hesaplanıyor, birkaç dakika içinde hazır olur…' : 'Yükleniyor…'}</span>
            </>
          )}
        </div>
      )}
      <div className="kb-galaxy-top">
        <Input
          allowClear
          size="large"
          prefix={<SearchOutlined />}
          placeholder="Bir soru sor, uzayda nereye düştüğünü gör"
          onPressEnter={e => void search((e.target as HTMLInputElement).value)}
          onChange={e => !e.target.value && void search('')}
          suffix={searching ? <Spin size="small" /> : null}
          className="kb-galaxy-search"
        />
        {found && <div className="kb-galaxy-found">{found}</div>}
      </div>
      <div className="kb-galaxy-legend">
        {Object.keys(AREA_COLOR).map(a => (
          <button
            key={a}
            type="button"
            className={`kb-galaxy-chip${visible.has(a) ? '' : ' off'}`}
            onClick={() =>
              setVisible(v => {
                const n = new Set(v);
                if (n.has(a)) n.delete(a);
                else n.add(a);
                return n;
              })
            }
          >
            <span className="kb-status-dot" style={{background: AREA_COLOR[a]}} />
            {AREA_LABEL[a]} <span style={{opacity: 0.6}}>{counts[a] ?? ''}</span>
          </button>
        ))}
        <span className="kb-galaxy-hint">sürükle: döndür · tekerlek: yakınlaş · tıkla: oku</span>
      </div>
      {hover && (
        <div className="kb-galaxy-tip" style={{left: hover.x + 14, top: hover.y + 14}}>
          <div style={{fontWeight: 600}}>{hover.p.title || hover.p.path}</div>
          {hover.p.section && <div style={{opacity: 0.8, marginTop: 2}}>{hover.p.section}</div>}
          <div style={{opacity: 0.55, marginTop: 4, fontSize: 11}}>
            {AREA_LABEL[hover.p.area]} · {hover.p.module || hover.p.kind} · {hover.p.path}
          </div>
        </div>
      )}
      <Drawer title={doc?.path} open={Boolean(doc)} onClose={() => setDoc(null)} size="large" width="min(736px, 100vw)">
        <Typography.Paragraph style={{whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, SF Mono, Menlo, monospace', fontSize: 12}}>{doc?.text}</Typography.Paragraph>
      </Drawer>
    </div>
  );
}
