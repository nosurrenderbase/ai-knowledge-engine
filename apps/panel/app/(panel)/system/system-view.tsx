'use client';

import {LockOutlined, ReloadOutlined} from '@ant-design/icons';
import {Alert, App, Button, Card, Col, Input, Modal, Popconfirm, Row, Segmented, Tag, Tooltip} from 'antd';
import {usePathname, useRouter} from 'next/navigation';
import {useEffect, useState, useTransition} from 'react';
import {ago, fullDate} from '@/components/time';
import type {SettingRow, SettingsView} from '@/lib/settings-view';
import type {Health, SystemView as System} from '@/lib/system';
import {changeSetting, restartService, type Result} from './actions';

const DOT: Record<Health, string> = {ok: '#30d158', warn: '#ff9f0a', bad: '#ff453a', off: '#c7c7cc'};
const KIND: Record<string, [string, Health]> = {
  idle: ['güncel, bekliyor', 'ok'],
  drained: ['iş bitirdi', 'ok'],
  failed: ['geçici hata, tekrar denenecek', 'warn'],
  blocked: ['sıra durdu, müdahale gerekli', 'bad'],
  limited: ['abonelik limiti, bekliyor', 'warn'],
};
const TARGET_LABEL: Record<string, string> = {mcp: 'MCP', panel: 'Panel', worker: 'İşçi', cloudflared: 'Tünel'};

function StatusTab({s}: {s: System}) {
  const router = useRouter();
  // The page refreshes itself every 20 s while open.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && router.refresh(), 20_000);
    return () => clearInterval(t);
  }, [router]);
  const bad = s.checks.filter(c => c.health === 'bad').length;
  return (
    <Row gutter={[18, 18]}>
      <Col xs={24} xl={14}>
        <Card title="Servisler" extra={<span className="kb-meta">{bad ? `${bad} sorun` : 'hepsi çalışıyor'}</span>}>
          {s.checks.map(c => (
            <div key={c.name} className="kb-row">
              <span className="kb-status-dot" style={{background: DOT[c.health]}} />
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{fontWeight: 600}}>{c.name}</div>
                <div className="kb-meta" style={{marginTop: 2, wordBreak: 'break-word'}}>
                  {c.detail}
                </div>
              </div>
              {c.ms !== undefined && <span className="kb-meta kb-mono">{c.ms} ms</span>}
            </div>
          ))}
        </Card>
      </Col>
      <Col xs={24} xl={10}>
        <Card title="Senkron sıraları" extra={<span className="kb-meta">{s.heartbeatAt ? `son tur ${ago(s.heartbeatAt)}` : '—'}</span>}>
          {s.areas.length === 0 && <span className="kb-meta">İşçi henüz tur bilgisi yazmadı.</span>}
          {s.areas.map(a => {
            const [text, h] = KIND[a.kind] ?? [a.kind, 'warn'];
            return (
              <div key={a.area} className="kb-row">
                <span className="kb-status-dot" style={{background: DOT[h]}} />
                <div style={{flex: 1}}>
                  <div style={{fontWeight: 600}}>{a.area}</div>
                  <div className="kb-meta">
                    {text}
                    {a.until ? ` · ${fullDate(a.until)}'e kadar` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </Card>
      </Col>
      <Col xs={24}>
        <Card title="Son uyarılar ve hatalar" extra={<span className="kb-meta">işçi ve deploy logları</span>}>
          {s.logs.length === 0 && <span className="kb-meta">Son kayıtlarda uyarı yok.</span>}
          {s.logs.map((l, i) => (
            <div key={`${l.time}${i}`} className="kb-row" style={{alignItems: 'flex-start'}}>
              <span className="kb-status-dot" style={{marginTop: 7, background: l.level === 'error' ? DOT.bad : DOT.warn}} />
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{display: 'flex', justifyContent: 'space-between', gap: 8}}>
                  <span style={{fontWeight: 600}}>
                    {l.msg}
                    <span className="kb-meta">
                      {' '}
                      · {l.source}
                      {l.area ? ` · ${l.area}` : ''}
                    </span>
                  </span>
                  <Tooltip title={fullDate(l.time)}>
                    <span className="kb-meta" style={{whiteSpace: 'nowrap'}}>
                      {ago(l.time)}
                    </span>
                  </Tooltip>
                </div>
                {l.error && (
                  <div className="kb-meta kb-mono" style={{marginTop: 4, wordBreak: 'break-word', fontSize: 11}}>
                    {l.error}
                  </div>
                )}
              </div>
            </div>
          ))}
        </Card>
      </Col>
    </Row>
  );
}

function SettingsTab({v}: {v: SettingsView}) {
  const {message} = App.useApp();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<SettingRow | null>(null);
  const [value, setValue] = useState('');
  const canWrite = Boolean(v.identity && v.keyReady);
  const groups = [...new Set(v.rows.map(r => r.group))];

  const run = (fn: () => Promise<Result>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        message.success(ok);
        setEditing(null);
      } else message.error(r.error);
    });

  return (
    <Row gutter={[18, 18]}>
      <Col xs={24}>
        {!v.accessConfigured ? (
          <Alert
            type="info"
            showIcon
            icon={<LockOutlined />}
            message="Ayarlar şimdilik salt okunur"
            description="Değiştirmek için panelin önüne Cloudflare Access konmalı ve CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD sunucuda tanımlanmalı. Böylece her değişiklik gerçek kişiyle kaydedilir."
          />
        ) : !v.identity ? (
          <Alert type="warning" showIcon message="Cloudflare Access kimliği doğrulanamadı" description="Paneli panel.efsanebaskan.com üzerinden (Access girişiyle) açınca ayarlar değiştirilebilir." />
        ) : !v.keyReady ? (
          <Alert type="warning" showIcon message="Sunucu anahtarı henüz hazır değil" description="Deploy ajanı ilk turunda şifreleme anahtarını üretir; birkaç dakika içinde açılır." />
        ) : (
          <Alert
            type="success"
            showIcon
            message={`${v.identity} olarak değiştiriyorsun`}
            description="Değer şifrelenip sıraya yazılır; sunucu ≈2 dakika içinde uygular, ilgili servisi yeniden başlatır ve sağlık kontrolü yapar. Sorun çıkarsa eski değere döner."
          />
        )}
      </Col>
      {groups.map(g => (
        <Col key={g} xs={24} lg={12}>
          <Card title={g} style={{height: '100%'}}>
            {v.rows
              .filter(r => r.group === g)
              .map(r => (
                <div key={r.key} className="kb-row">
                  <div style={{flex: 1, minWidth: 0}}>
                    <div className="kb-mono" style={{fontSize: 12, fontWeight: 600}}>
                      {r.key}
                      {r.pending && (
                        <Tag color="processing" style={{marginLeft: 8}}>
                          uygulanıyor
                        </Tag>
                      )}
                    </div>
                    <div className="kb-meta" style={{marginTop: 2}}>
                      {r.about}
                    </div>
                    <div className="kb-mono" style={{fontSize: 12, marginTop: 4, wordBreak: 'break-all', color: r.value ? undefined : '#8e8e93'}}>
                      {r.value ?? 'tanımlı değil'}
                    </div>
                  </div>
                  {r.readOnly ? (
                    <Tooltip title="Sunucuda değiştirilir">
                      <LockOutlined style={{color: '#8e8e93'}} />
                    </Tooltip>
                  ) : (
                    <Button
                      size="small"
                      disabled={!canWrite || r.pending}
                      onClick={() => {
                        setValue(r.secret ? '' : (r.value ?? ''));
                        setEditing(r);
                      }}
                    >
                      Değiştir
                    </Button>
                  )}
                </div>
              ))}
          </Card>
        </Col>
      ))}
      <Col xs={24} lg={12}>
        <Card title="Yeniden başlat">
          <div style={{display: 'flex', flexWrap: 'wrap', gap: 10}}>
            {(['worker', 'mcp', 'panel', 'cloudflared'] as const).map(t => (
              <Popconfirm
                key={t}
                title={`${TARGET_LABEL[t]} yeniden başlatılsın mı?`}
                description={t === 'worker' ? 'Süren bir iş varsa iş bitince başlar.' : t === 'cloudflared' ? 'Dış erişim birkaç saniye kesilir.' : undefined}
                onConfirm={() => run(() => restartService(t), `${TARGET_LABEL[t]} sıraya alındı`)}
                disabled={!canWrite}
              >
                <Button icon={<ReloadOutlined />} disabled={!canWrite}>
                  {TARGET_LABEL[t]}
                </Button>
              </Popconfirm>
            ))}
          </div>
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card title="Değişiklik kaydı" extra={<span className="kb-meta">kim, ne, ne zaman (değer saklanmaz)</span>}>
          {v.changes.length === 0 && <span className="kb-meta">Henüz değişiklik yok.</span>}
          {v.changes.map(c => (
            <div key={c.id} className="kb-row">
              <span className="kb-status-dot" style={{background: c.status === 'applied' ? DOT.ok : c.status === 'failed' ? DOT.bad : '#0a84ff'}} />
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{fontWeight: 600, fontSize: 13}}>
                  {c.what}
                  {c.hint && <span className="kb-meta kb-mono"> → {c.hint}</span>}
                </div>
                <div className="kb-meta">
                  {c.by} · {c.status === 'pending' ? 'sırada' : c.status === 'applied' ? 'uygulandı' : `başarısız: ${c.error}`}
                </div>
              </div>
              <Tooltip title={fullDate(c.at)}>
                <span className="kb-meta" style={{whiteSpace: 'nowrap'}}>
                  {ago(c.at)}
                </span>
              </Tooltip>
            </div>
          ))}
        </Card>
      </Col>

      <Modal
        open={Boolean(editing)}
        title={editing?.key}
        okText="Kaydet ve uygula"
        cancelText="Vazgeç"
        confirmLoading={pending}
        onCancel={() => setEditing(null)}
        onOk={() => editing && run(() => changeSetting(editing.key, value), `${editing.key} sıraya alındı`)}
        footer={(orig, {OkBtn, CancelBtn}) => (
          <>
            {editing && !editing.required && editing.value && (
              <Popconfirm title={`${editing.key} silinsin mi?`} onConfirm={() => run(() => changeSetting(editing.key, null), `${editing.key} silinmek üzere sıraya alındı`)}>
                <Button danger style={{float: 'left'}}>
                  Sil
                </Button>
              </Popconfirm>
            )}
            <CancelBtn />
            <OkBtn />
          </>
        )}
      >
        <p className="kb-meta">{editing?.about}</p>
        {editing?.secret ? (
          <Input.Password autoFocus value={value} onChange={e => setValue(e.target.value)} placeholder={editing.value ? `şu anki: ${editing.value}` : 'yeni değer'} autoComplete="off" />
        ) : (
          <Input autoFocus value={value} onChange={e => setValue(e.target.value)} className="kb-mono" />
        )}
        <p className="kb-meta" style={{marginTop: 12}}>
          Uygulanınca yeniden başlar: {editing?.restart.map(t => TARGET_LABEL[t]).join(', ') || '—'}
        </p>
      </Modal>
    </Row>
  );
}

export function SystemView({tab, system, settings}: {tab: 'durum' | 'ayarlar'; system: System; settings: SettingsView}) {
  const router = useRouter();
  const path = usePathname();
  return (
    <>
      <Segmented
        style={{marginBottom: 18}}
        value={tab}
        onChange={v => router.push(`${path}${v === 'ayarlar' ? '?tab=ayarlar' : ''}`)}
        options={[
          {label: 'Durum', value: 'durum'},
          {label: 'Ayarlar', value: 'ayarlar'},
        ]}
      />
      {tab === 'durum' ? <StatusTab s={system} /> : <SettingsTab v={settings} />}
    </>
  );
}
