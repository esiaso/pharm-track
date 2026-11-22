'use client';

import type { Alert } from '../lib/types';
import { label } from '../lib/format';
import { Badge } from './ui';

/**
 * Shows alerts returned by a blocked verify call. HARD_STOPs cannot be overridden.
 * WARNINGs need a reason (5+ characters) before the pharmacist can continue.
 */
export function SafetyAlerts({
  blocking,
  unacknowledged,
  reasons,
  onReason,
  itemName,
}: {
  blocking: Alert[];
  unacknowledged: Alert[];
  reasons: Record<string, string>;
  onReason: (key: string, reason: string) => void;
  itemName: (ref: string) => string;
}) {
  return (
    <div className="alerts">
      {blocking.map((a) => (
        <div key={a.key} className="alert danger">
          <div className="alert-head"><Badge value={a.severity} /> <strong>{label(a.type)}</strong> · {itemName(a.itemRef)}</div>
          <p>{a.message}</p>
          <p className="small">This is a hard stop and cannot be overridden. Contact the prescriber to change the prescription.</p>
        </div>
      ))}
      {unacknowledged.map((a) => (
        <div key={a.key} className="alert warn">
          <div className="alert-head"><Badge value={a.severity} /> <strong>{label(a.type)}</strong> · {itemName(a.itemRef)}</div>
          <p>{a.message}</p>
          <input
            aria-label={`Override reason for ${label(a.type)}`}
            placeholder="Reason for overriding (required)"
            value={reasons[a.key] ?? ''}
            onChange={(e) => onReason(a.key, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}
