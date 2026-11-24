'use client';

import Link from 'next/link';
import { Empty } from '../../components/ui';

export type RowError = { line: number; message: string };
export type AffectedDrug = { id: string; hptCode: string; atcCode: string; genericName: string; strength: string; reason: string };
export type ImportSummary = {
  dryRun: boolean;
  codeSystem?: string;
  mode?: string;
  rowsTotal: number;
  created?: number;
  updated?: number;
  unchanged?: number;
  retired?: number;
  failed: number;
  errors: RowError[];
  skipped?: number;
  skippedRows?: RowError[];
  retiredCodes?: string[];
  affectedDrugs?: AffectedDrug[];
  changes?: { line: number; hptCode: string; action: string; fields: string[] }[];
  importId?: string;
};

export function Errors({ errors, failed }: { errors: RowError[]; failed: number }) {
  if (!errors.length) return null;
  return (
    <details open={errors.length <= 20}>
      <summary>
        {failed} problem{failed === 1 ? '' : 's'} in the file{errors.length < failed ? ` (first ${errors.length} shown)` : ''}
      </summary>
      <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table>
          <thead><tr><th>Line</th><th>Problem</th></tr></thead>
          <tbody>{errors.map((e, i) => <tr key={i}><td className="mono">{e.line}</td><td>{e.message}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

/** Summary of a code-set, formulary or drug master import (dry run or done). */
export function ImportResult({ r, removedLabel = 'Retired' }: { r: ImportSummary; removedLabel?: string }) {
  return (
    <div className="card stack">
      <h3>{r.dryRun ? 'What this file would change' : 'Imported'}</h3>
      <div className="stats">
        <span><strong>{r.rowsTotal}</strong> rows</span>
        {r.created !== undefined && <span><strong>{r.created}</strong> new</span>}
        {r.updated !== undefined && <span><strong>{r.updated}</strong> changed</span>}
        {r.unchanged !== undefined && <span><strong>{r.unchanged}</strong> unchanged</span>}
        {r.retired !== undefined && r.mode === 'FULL' && <span><strong>{r.retired}</strong> {removedLabel.toLowerCase()}</span>}
        <span><strong>{r.failed}</strong> problems</span>
        {!!r.skipped && <span><strong>{r.skipped}</strong> skipped</span>}
      </div>
      <Errors errors={r.errors} failed={r.failed} />
      {!!r.skippedRows?.length && (
        <details>
          <summary>Skipped, not loaded: {r.skipped}{r.skipped && r.skipped > r.skippedRows.length ? ` (first ${r.skippedRows.length} shown)` : ''}</summary>
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table>
              <thead><tr><th>Line</th><th>Why</th></tr></thead>
              <tbody>{r.skippedRows.map((e, i) => <tr key={i}><td className="mono">{e.line}</td><td>{e.message}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
      {!!r.retiredCodes?.length && (
        <details>
          <summary>{removedLabel}: {r.retiredCodes.length}{r.retired && r.retired > r.retiredCodes.length ? ` of ${r.retired}` : ''}</summary>
          <p className="mono">{r.retiredCodes.join(', ')}</p>
        </details>
      )}
      {r.affectedDrugs && r.affectedDrugs.length > 0 && <AffectedDrugs drugs={r.affectedDrugs} title="Drugs in the master that need re-coding" />}
      {r.changes && r.changes.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Line</th><th>HPT code</th><th>Action</th><th>Fields</th></tr></thead>
            <tbody>
              {r.changes.map((c) => (
                <tr key={c.line}><td className="mono">{c.line}</td><td className="mono">{c.hptCode}</td><td>{c.action === 'create' ? 'New drug' : 'Update'}</td><td>{c.fields.join(', ') || '–'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AffectedDrugs({ drugs, title }: { drugs: AffectedDrug[]; title: string }) {
  return (
    <div className="stack">
      <h3>{title}</h3>
      {drugs.length === 0 ? (
        <Empty>None.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Drug</th><th>HPT code</th><th>ATC code</th><th>Why</th></tr></thead>
            <tbody>
              {drugs.map((d) => (
                <tr key={d.id + d.reason}>
                  <td><Link href={`/formulary/${d.id}`}>{d.genericName} {d.strength}</Link></td>
                  <td className="mono">{d.hptCode}</td>
                  <td className="mono">{d.atcCode}</td>
                  <td>{d.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export const KIND_LABEL: Record<string, string> = { INTERACTION: 'Drug interactions', CONTRAINDICATION: 'Drug–disease contraindications', DOSE_LIMIT: 'Dose limits' };

export type Comparison = { name: string; version: string; added: number; removed: number; changed: number; unchanged: number } | null;

export function ComparisonLine({ c }: { c: Comparison }) {
  if (!c) return <p className="small muted">There is no active set from this source yet, so every rule is new.</p>;
  if (c.added + c.removed + c.changed === 0) return <p className="small">This file has the same rules as the active version {c.version} ({c.name}). Saving it would change nothing.</p>;
  return (
    <p className="small">
      Compared with the active version {c.version} ({c.name}): <strong>{c.added}</strong> added, <strong>{c.removed}</strong> removed, <strong>{c.changed}</strong> changed, {c.unchanged} unchanged.
    </p>
  );
}

