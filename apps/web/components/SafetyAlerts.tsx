'use client';

import type { Alert } from '../lib/types';
import { label } from '../lib/format';
import { Badge } from './ui';

/** Shortest reason accepted for a consultant override of a hard stop (matches the API). */
export const HARD_STOP_REASON_MIN = 15;

/**
 * Shows alerts returned by a blocked verify call. WARNINGs need a reason (5+
 * characters). HARD_STOPs block, except where the facility allows a consultant
 * override: then the authorising consultant and a reason (15+ characters) are needed.
 */
export function SafetyAlerts({
  blocking,
  unacknowledged,
  overridable = [],
  reasons,
  onReason,
  consultants = {},
  onConsultant,
  itemName,
}: {
  blocking: Alert[];
  unacknowledged: Alert[];
  overridable?: string[];
  reasons: Record<string, string>;
  onReason: (key: string, reason: string) => void;
  consultants?: Record<string, string>;
  onConsultant?: (key: string, consultant: string) => void;
  itemName: (ref: string) => string;
}) {
  return (
    <div className="alerts">
      {blocking.map((a) => {
        const canOverride = overridable.includes(a.key) && !!onConsultant;
        const reason = reasons[a.key] ?? '';
        return (
          <div key={a.key} className="alert danger">
            <div className="alert-head"><Badge value={a.severity} /> <strong>{label(a.type)}</strong> · {itemName(a.itemRef)}</div>
            <p>{a.message}</p>
            {canOverride ? (
              <>
                <p className="small">
                  This is a hard stop. This facility lets a consultant authorise an override. Record who authorised it and why; it is audited.
                </p>
                <input
                  aria-label={`Consultant who authorised overriding ${label(a.type)}`}
                  placeholder="Consultant who authorised it (name or staff id, not you)"
                  value={consultants[a.key] ?? ''}
                  onChange={(e) => onConsultant!(a.key, e.target.value)}
                />
                <input
                  aria-label={`Clinical reason for overriding ${label(a.type)}`}
                  placeholder={`Clinical reason (at least ${HARD_STOP_REASON_MIN} characters)`}
                  value={reason}
                  onChange={(e) => onReason(a.key, e.target.value)}
                />
                {reason.trim().length > 0 && reason.trim().length < HARD_STOP_REASON_MIN && (
                  <p className="small">{HARD_STOP_REASON_MIN - reason.trim().length} more characters needed.</p>
                )}
              </>
            ) : (
              <p className="small">This is a hard stop and cannot be overridden. Contact the prescriber to change the prescription.</p>
            )}
          </div>
        );
      })}
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
