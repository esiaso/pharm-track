'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { SafetyAlerts } from '../../../components/SafetyAlerts';
import { Badge, Dl, Empty, ErrorBox, Field } from '../../../components/ui';
import { api, ApiError, download, useApi } from '../../../lib/api';
import { date, dateTime, label, n } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import type { Alert, DispenseOrder, Drug, PrescriptionItem } from '../../../lib/types';

type Blocked = { blocking: Alert[]; unacknowledged: Alert[] };

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const { data: order, error, reload } = useApi<DispenseOrder>(`/dispensing/orders/${id}`);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const items = useMemo(() => {
    if (!order) return [];
    const all = order.prescription.items;
    return order.kind === 'REFILL' ? all.filter((i) => i.id === order.refillSchedule?.prescriptionItemId) : all;
  }, [order]);

  if (error) return <ErrorBox error={error} />;
  if (!order) return <p className="muted">Loading…</p>;

  const rx = order.prescription;
  const ctx = (rx.clinicalContext ?? {}) as Record<string, any>;
  const dispensedFor = (itemId: string) =>
    order.lines.filter((l) => l.prescriptionItemId === itemId).reduce((s, l) => s + n(l.quantity) - n(l.quantityReturned), 0);
  const itemName = (ref: string) => {
    const it = rx.items.find((i) => i.id === ref);
    return it ? `${it.drug.genericName} ${it.drug.strength}` : ref;
  };

  async function run(fn: () => Promise<unknown>, done: string) {
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  return (
    <section className="stack">
      <div className="row">
        <div>
          <Link href="/dispensing" className="small">← Dispensing queue</Link>
          <h1>
            {rx.patientId} · {order.kind === 'REFILL' ? `Refill ${order.fillSequence}` : 'First fill'}
          </h1>
        </div>
        <span className="spacer" />
        <Badge value={order.priority} /> <Badge value={order.status} />
      </div>

      <div className="card">
        <Dl
          items={[
            ['Prescription', <span className="mono" key="x">{rx.externalId}</span>],
            ['Prescriber', rx.prescriberId],
            ['Signed', dateTime(rx.signedAt)],
            ['Encounter', rx.encounterId],
            ['Store', order.storeId],
            ['Age', ctx.ageMonths != null ? `${Math.floor(ctx.ageMonths / 12)} y` : '–'],
            ['Weight', ctx.weightKg != null ? `${ctx.weightKg} kg` : '–'],
            ['Pregnant / lactating', [ctx.pregnant && 'Pregnant', ctx.lactating && 'Lactating'].filter(Boolean).join(', ') || 'No'],
            ['CrCl', ctx.crClMlMin != null ? `${ctx.crClMlMin} mL/min` : '–'],
            ['Diagnoses', (ctx.diagnoses ?? []).map((d: any) => d.code).join(', ') || '–'],
            ['Verified', order.verifiedBy ? `${order.verifiedBy}, ${dateTime(order.verifiedAt)}` : '–'],
          ]}
        />
        <p className="small" style={{ marginTop: 12 }}><Link href={`/patients/${encodeURIComponent(rx.patientId)}`}>Patient allergies and medication history →</Link></p>
      </div>

      <ErrorBox error={actionError} />
      {notice && <div className="notice">{notice}</div>}

      <h2>Items</h2>
      {items.map((it) => (
        <ItemSummary key={it.id} item={it} dispensed={dispensedFor(it.id)} />
      ))}

      {(order.status === 'PENDING' || order.status === 'IN_VERIFICATION') && (
        <VerifyPanel order={order} itemName={itemName} onDone={() => run(async () => {}, 'Verified. The order is ready to dispense.')} onStart={() => run(() => api(`/dispensing/orders/${id}/start-verification`, { body: {} }), 'Verification started.')} />
      )}

      {(order.status === 'VERIFIED' || order.status === 'PARTIALLY_DISPENSED') && (
        <DispensePanel order={order} items={items} dispensedFor={dispensedFor} onDone={(msg) => run(async () => {}, msg)} />
      )}

      <h2>Dispensed</h2>
      <DispensedLines order={order} onChanged={(msg) => run(async () => {}, msg)} />

      {order.lines.length > 0 && <ZebraLabels orderId={id} storeId={order.storeId} onDone={(msg) => setNotice(msg)} onError={setActionError} />}

      <div className="row no-print">
        {order.lines.length > 0 && <button onClick={() => window.print()}>Print labels (A4 / browser)</button>}
        {order.lines.length > 0 && (
          <button onClick={() => run(() => api(`/dispensing/orders/${id}/notify-ready`, { body: {} }), 'Collection SMS queued (sent only if the patient opted in).')}>
            Send “ready for collection” SMS
          </button>
        )}
        <span className="spacer" />
        {['PENDING', 'IN_VERIFICATION', 'VERIFIED'].includes(order.status) && (
          <CancelButton onCancel={(reason) => run(() => api(`/dispensing/orders/${id}/cancel`, { body: { reason } }), 'Order cancelled.')} />
        )}
      </div>

      {order.lines.length > 0 && (
        <div className="print-only stack">
          {order.lines.map((l) => (
            <div key={l.id} className="label-preview">
              {rx.patientId}{'\n'}{l.labelText}{'\n'}Batch {l.batchNumber} · Exp {date(l.expiryDate)} · Qty {n(l.quantity)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ItemSummary({ item, dispensed }: { item: PrescriptionItem; dispensed: number }) {
  const presc = item.safetyAlerts.filter((a) => a.stage === 'PRESCRIBING');
  const verif = item.safetyAlerts.filter((a) => a.stage === 'VERIFICATION');
  return (
    <div className="card item-card">
      <div className="item-head">
        <strong>{item.drug.genericName} {item.drug.strength} {item.drug.dosageForm.toLowerCase()}</strong>
        <span className="mono muted">ATC {item.atcCode} · HPT {item.hptCode}</span>
        {item.drug.controlledSchedule !== 'NONE' && <Badge value="CONTROLLED" />}
        <span className="spacer" />
        <span>{dispensed} / {n(item.quantity)} {item.drug.unitOfIssue.toLowerCase()}</span>
      </div>
      <div>
        {n(item.dose)} {item.doseUnit} {item.frequency} {item.route.toLowerCase()} for {item.durationDays} days
        {item.refillsAuthorised > 0 && <span className="muted"> · {item.refillsAuthorised} refills</span>}
        {item.instructions && <div className="muted">{item.instructions}</div>}
      </div>
      {[...presc, ...verif].length > 0 && (
        <div className="alerts">
          {[...presc, ...verif].map((a) => (
            <div key={a.id} className={`alert ${a.severity === 'HARD_STOP' ? 'danger' : a.severity === 'WARNING' ? 'warn' : 'info'}`}>
              <div className="alert-head small">
                <Badge value={a.severity} /> {label(a.type)} · {a.stage === 'PRESCRIBING' ? 'at prescribing' : 'at verification'}
              </div>
              <p>{a.message}</p>
              {a.overrideReason && <p className="small muted">Overridden by {a.overriddenBy}: “{a.overrideReason}”</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VerifyPanel({ order, itemName, onDone, onStart }: { order: DispenseOrder; itemName: (r: string) => string; onDone: () => void; onStart: () => void }) {
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = !!blocked && blocked.blocking.length === 0 && blocked.unacknowledged.every((a) => (reasons[a.key] ?? '').trim().length >= 5);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const overrides = Object.entries(reasons).filter(([, r]) => r.trim()).map(([key, reason]) => ({ key, reason }));
      await api(`/dispensing/orders/${order.id}/verify`, { body: { overrides } });
      setBlocked(null);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setBlocked({ blocking: e.body.blocking, unacknowledged: e.body.unacknowledged });
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack no-print">
      <h3>Pharmacist verification</h3>
      <p className="muted small">Safety checks run again against the patient&apos;s current allergies and medicines.</p>
      <ErrorBox error={error} />
      {blocked && (
        <SafetyAlerts
          blocking={blocked.blocking}
          unacknowledged={blocked.unacknowledged}
          reasons={reasons}
          onReason={(k, r) => setReasons({ ...reasons, [k]: r })}
          itemName={itemName}
        />
      )}
      <div className="row">
        {order.status === 'PENDING' && <button onClick={onStart}>Start verification</button>}
        <button className="primary" onClick={verify} disabled={busy || (!!blocked && !ready)}>
          {busy ? 'Checking…' : blocked ? 'Verify with overrides' : 'Run checks and verify'}
        </button>
        {blocked && blocked.blocking.length > 0 && <span className="small muted">Hard stops must be resolved by the prescriber.</span>}
      </div>
    </div>
  );
}

type LineForm = {
  include: boolean;
  quantity: string;
  substituteHptCode: string;
  substitutionNote: string;
  labelText: string;
  counsellingNotes: string;
  witnessedBy: string;
};

function DispensePanel({
  order,
  items,
  dispensedFor,
  onDone,
}: {
  order: DispenseOrder;
  items: PrescriptionItem[];
  dispensedFor: (id: string) => number;
  onDone: (msg: string) => void;
}) {
  const open = items.filter((i) => n(i.quantity) - dispensedFor(i.id) > 0);
  const [forms, setForms] = useState<Record<string, LineForm>>(() =>
    Object.fromEntries(
      open.map((i) => [
        i.id,
        {
          include: true,
          quantity: String(n(i.quantity) - dispensedFor(i.id)),
          substituteHptCode: '',
          substitutionNote: '',
          labelText: `${i.drug.genericName} ${i.drug.strength}. ${n(i.dose)} ${i.doseUnit} ${i.frequency} for ${i.durationDays} days.${i.instructions ? ` ${i.instructions}` : ''}`,
          counsellingNotes: '',
          witnessedBy: '',
        },
      ]),
    ),
  );
  const [priceListCode, setPriceListCode] = useState('DEFAULT');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const set = (id: string, patch: Partial<LineForm>) => setForms({ ...forms, [id]: { ...forms[id]!, ...patch } });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const lines = open
        .filter((i) => forms[i.id]?.include && Number(forms[i.id]!.quantity) > 0)
        .map((i) => {
          const f = forms[i.id]!;
          return {
            prescriptionItemId: i.id,
            quantity: Number(f.quantity),
            substituteHptCode: f.substituteHptCode || undefined,
            substitutionNote: f.substituteHptCode ? f.substitutionNote : undefined,
            labelText: f.labelText || undefined,
            counsellingNotes: f.counsellingNotes || undefined,
            witnessedBy: f.witnessedBy || undefined,
          };
        });
      if (lines.length === 0) throw new Error('Choose at least one item to dispense.');
      await api(`/dispensing/orders/${order.id}/dispense`, { body: { lines, priceListCode }, idempotencyKey: key });
      onDone('Dispensed. Stock deduction and billing are on their way to SupplyTrack and CliniTrack.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (open.length === 0) return null;
  return (
    <div className="card stack no-print">
      <h3>Dispense</h3>
      <p className="muted small">Batches are picked earliest-expiry-first from SupplyTrack. Leave an item unticked to dispense it later.</p>
      <ErrorBox error={error} />
      {open.map((i) => (
        <DispenseItemForm key={i.id} item={i} remaining={n(i.quantity) - dispensedFor(i.id)} form={forms[i.id]!} onChange={(p) => set(i.id, p)} />
      ))}
      <div className="row">
        <Field label="Bill against price list">
          <select value={priceListCode} onChange={(e) => setPriceListCode(e.target.value)}>
            <option value="DEFAULT">Default</option>
            <option value="SHA">SHA</option>
          </select>
        </Field>
        <span className="spacer" />
        <button className="primary" onClick={submit} disabled={busy}>{busy ? 'Dispensing…' : 'Dispense'}</button>
      </div>
    </div>
  );
}

function DispenseItemForm({ item, remaining, form, onChange }: { item: PrescriptionItem; remaining: number; form: LineForm; onChange: (p: Partial<LineForm>) => void }) {
  const { session } = useSession();
  const { data: subs } = useApi<Drug[]>(item.drug.substitutionGroupId ? `/formulary/drugs/${item.drugId}/substitutes` : null);
  const controlled = item.drug.controlledSchedule !== 'NONE';
  return (
    <fieldset className="card item-card" style={{ margin: 0 }}>
      <label className="row">
        <input type="checkbox" checked={form.include} onChange={(e) => onChange({ include: e.target.checked })} />
        <strong>{item.drug.genericName} {item.drug.strength}</strong>
        <span className="muted small">{remaining} {item.drug.unitOfIssue.toLowerCase()} left</span>
        {controlled && <Badge value="CONTROLLED" />}
      </label>
      {form.include && (
        <>
          <div className="row">
            <Field label="Quantity">
              <input type="number" min={1} max={remaining} value={form.quantity} onChange={(e) => onChange({ quantity: e.target.value })} style={{ width: 100 }} />
            </Field>
            {subs && subs.length > 0 && (
              <Field label="Substitute">
                <select value={form.substituteHptCode} onChange={(e) => onChange({ substituteHptCode: e.target.value })}>
                  <option value="">As prescribed</option>
                  {subs.map((s) => (
                    <option key={s.id} value={s.hptCode}>{s.genericName} {s.strength} {s.brandNames.join(', ')} ({s.hptCode})</option>
                  ))}
                </select>
              </Field>
            )}
            {form.substituteHptCode && (
              <Field label="Reason for substitution">
                <input value={form.substitutionNote} onChange={(e) => onChange({ substitutionNote: e.target.value })} required />
              </Field>
            )}
            {controlled && (
              <Field label="Witness (second signatory)">
                <input value={form.witnessedBy} placeholder={`Not ${session.userId}`} onChange={(e) => onChange({ witnessedBy: e.target.value })} />
              </Field>
            )}
          </div>
          <Field label="Label">
            <textarea value={form.labelText} onChange={(e) => onChange({ labelText: e.target.value })} />
          </Field>
          <Field label="Counselling notes">
            <textarea value={form.counsellingNotes} onChange={(e) => onChange({ counsellingNotes: e.target.value })} />
          </Field>
        </>
      )}
    </fieldset>
  );
}

function DispensedLines({ order, onChanged }: { order: DispenseOrder; onChanged: (msg: string) => void }) {
  const [returning, setReturning] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hpt = (id: string) => order.prescription.items.find((i) => i.id === id);

  async function doReturn(lineId: string) {
    setError(null);
    try {
      await api(`/dispensing/lines/${lineId}/returns`, { body: { quantity: Number(qty), reason } });
      setReturning(null);
      setQty('');
      setReason('');
      onChanged('Return recorded. Stock goes back to SupplyTrack and the bill is reversed in CliniTrack.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (order.lines.length === 0) return <div className="card"><Empty>Nothing dispensed yet.</Empty></div>;
  return (
    <>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Drug</th><th>Batch</th><th>Expiry</th><th className="right">Qty</th><th className="right">Unit price</th><th>Billing</th><th>By</th><th /></tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const item = hpt(l.prescriptionItemId);
              const returnable = n(l.quantity) - n(l.quantityReturned);
              return (
                <tr key={l.id}>
                  <td>
                    {item?.drug.genericName} <span className="mono muted">{l.hptCode}</span>
                    {l.substitutionNote && <div className="small muted">Substituted: {l.substitutionNote}</div>}
                    {l.counsellingNotes && <div className="small muted">Counselling: {l.counsellingNotes}</div>}
                  </td>
                  <td className="mono">{l.batchNumber}</td>
                  <td>{date(l.expiryDate)}</td>
                  <td className="right">
                    {n(l.quantity)}
                    {n(l.quantityReturned) > 0 && <div className="small muted">{n(l.quantityReturned)} returned</div>}
                  </td>
                  <td className="right">{l.currency} {n(l.unitPrice).toFixed(2)}</td>
                  <td><Badge value={l.billingStatus} />{l.billingRef && <div className="mono small muted">{l.billingRef}</div>}</td>
                  <td className="small">
                    {l.dispensedBy}
                    {l.controlledEntry && <div className="muted">witness {l.controlledEntry.witnessedBy}</div>}
                    <div className="muted">{dateTime(l.dispensedAt)}</div>
                  </td>
                  <td className="no-print">
                    {returnable > 0 && returning !== l.id && <button className="link" onClick={() => setReturning(l.id)}>Return</button>}
                    {returning === l.id && (
                      <div className="stack" style={{ minWidth: 180 }}>
                        <input type="number" min={1} max={returnable} placeholder={`Qty (max ${returnable})`} value={qty} onChange={(e) => setQty(e.target.value)} />
                        <input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                        <div className="row">
                          <button className="primary" onClick={() => doReturn(l.id)} disabled={!qty || reason.trim().length < 3}>Save</button>
                          <button onClick={() => setReturning(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CancelButton({ onCancel }: { onCancel: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) return <button className="danger" onClick={() => setOpen(true)}>Cancel order</button>;
  return (
    <div className="row">
      <input placeholder="Reason for cancelling" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="danger" disabled={reason.trim().length < 3} onClick={() => onCancel(reason)}>Confirm cancel</button>
      <button onClick={() => setOpen(false)}>Keep</button>
    </div>
  );
}

/** Zebra label printing: straight to the store's network printer, or a .zpl file. */
function ZebraLabels({ orderId, storeId, onDone, onError }: { orderId: string; storeId: string; onDone: (msg: string) => void; onError: (e: string | null) => void }) {
  const printers = useApi<{ stores: string[] }>('/dispensing/label-printers');
  const [patientName, setPatientName] = useState('');
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);
  const hasPrinter = !!printers.data?.stores.includes(storeId);
  const body = { ...(patientName.trim() ? { patientName: patientName.trim() } : {}), copies };

  async function print() {
    setBusy(true);
    onError(null);
    try {
      const r = await api<{ printed: number }>(`/dispensing/orders/${orderId}/labels/print`, { body });
      onDone(`Sent ${r.printed} label${r.printed === 1 ? '' : 's'}${copies > 1 ? ` x${copies}` : ''} to the ${storeId} Zebra printer.`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function downloadZpl() {
    onError(null);
    const q = new URLSearchParams({ copies: String(copies), ...(body.patientName ? { patientName: body.patientName } : {}) });
    download(`/dispensing/orders/${orderId}/labels.zpl?${q}`, `labels-${orderId.slice(0, 8)}.zpl`).catch((e) => onError((e as Error).message));
  }

  return (
    <div className="card stack no-print">
      <h3>Zebra labels</h3>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label="Patient name on the label (optional)"><input value={patientName} maxLength={60} onChange={(e) => setPatientName(e.target.value)} placeholder="Patient id is printed if left blank" /></Field>
        <Field label="Copies"><input type="number" min={1} max={20} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} style={{ width: 80 }} /></Field>
      </div>
      <div className="row">
        {hasPrinter && <button className="primary" disabled={busy} onClick={() => void print()}>Print on Zebra ({storeId})</button>}
        <button onClick={downloadZpl}>Download ZPL file</button>
      </div>
      {!hasPrinter && printers.data && <p className="small muted">No network label printer is set up for {storeId}. Download the file and send it to a USB Zebra printer, or ask an administrator to add the store to LABEL_PRINTERS.</p>}
    </div>
  );
}
