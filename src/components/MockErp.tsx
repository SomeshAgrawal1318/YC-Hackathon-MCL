import type { ClipboardEvent } from 'react';
import { FIELD_LABEL, FORM_FIELDS, T } from '../data/desktop';
import { RECENT_POS } from '../data/scenario';
import type { Action, ErpState, FieldKey } from '../data/schema';

interface Props {
  state: ErpState;
  interactive?: boolean;
  /** Field that just received a value (replay only), for a brief highlight. */
  flash?: FieldKey | null;
  /** Field currently being typed into (replay only), shows a caret. */
  typing?: FieldKey | null;
  onAction?: (a: Action) => void;
}

const PLACEHOLDER: Partial<Record<FieldKey, string>> = {
  supplier: 'Search suppliers',
  po_number: 'PO-0000',
  item_sku: 'Search items',
  delivery_date: 'YYYY-MM-DD',
};

export function MockErp({ state, interactive, flash, typing, onAction }: Props) {
  const act = (a: Action) => interactive && onAction?.(a);

  const onPaste = (field: FieldKey) => (e: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.preventDefault();
    const value = e.clipboardData.getData('text').trim();
    act({ kind: 'paste', app: 'erp', target: T.field(field), field, value });
  };

  const field = (key: FieldKey) => {
    const value = state.fields[key] ?? '';
    const cls = `erp-input${state.focused === key ? ' is-focused' : ''}${flash === key ? ' is-flash' : ''}${key === 'notes' ? ' is-notes' : ''}`;
    return (
      <label key={key} className={`erp-field${key === 'notes' ? ' is-wide' : ''}`}>
        <span className="erp-label">{FIELD_LABEL[key]}</span>
        {interactive ? (
          key === 'notes' ? (
            <textarea
              className={cls}
              aria-label={FIELD_LABEL[key]}
              data-tid={`erp:field:${key}`}
              value={value}
              onFocus={() => state.focused !== key && act({ kind: 'click', app: 'erp', target: T.field(key), field: key })}
              onChange={(e) => act({ kind: 'type', app: 'erp', target: T.field(key), field: key, value: e.target.value })}
              onPaste={onPaste(key)}
            />
          ) : (
            <input
              className={cls}
              aria-label={FIELD_LABEL[key]}
              data-tid={`erp:field:${key}`}
              value={value}
              placeholder={PLACEHOLDER[key]}
              onFocus={() => state.focused !== key && act({ kind: 'click', app: 'erp', target: T.field(key), field: key })}
              onChange={(e) => act({ kind: 'type', app: 'erp', target: T.field(key), field: key, value: e.target.value })}
              onPaste={onPaste(key)}
            />
          )
        ) : (
          <div className={cls} aria-label={FIELD_LABEL[key]} data-tid={`erp:field:${key}`}>
            {value ? <span>{value}</span> : <span className="erp-placeholder">{PLACEHOLDER[key] ?? ''}</span>}
            {typing === key && <span className="erp-caret" />}
          </div>
        )}
      </label>
    );
  };

  return (
    <div className={`erp${interactive ? ' is-live' : ''}`}>
      <header className="erp-top">
        <span className="erp-logo">NorthStar</span>
        <span className="erp-module">Purchasing</span>
        <span className="erp-user">Buyer, Plant 2</span>
      </header>
      <div className="erp-body">
        <nav className="erp-nav" aria-label="Purchasing">
          <span className="erp-nav-item is-active">Purchase orders</span>
          <span className="erp-nav-item">Suppliers</span>
          <span className="erp-nav-item">Items</span>
          <span className="erp-nav-item">Receiving</span>
          <span className="erp-nav-item">Invoices</span>
        </nav>
        <main className="erp-main">
          {state.screen === 'list' ? (
            <>
              <div className="erp-head">
                <h2>Purchase orders</h2>
                <button
                  type="button"
                  className="erp-btn is-primary"
                  data-tid="erp:new-po"
                  onClick={() => act({ kind: 'click', app: 'erp', target: T.newPo() })}
                >
                  New purchase order
                </button>
              </div>
              <table className="erp-table">
                <thead>
                  <tr><th>PO number</th><th>Supplier</th><th>Item</th><th>Qty</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {RECENT_POS.map((r) => (
                    <tr key={r.po}><td>{r.po}</td><td>{r.supplier}</td><td>{r.item}</td><td>{r.qty}</td><td>{r.status}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <>
              <div className="erp-crumbs">Purchase orders / New purchase order</div>
              <div className="erp-head">
                <h2>New purchase order</h2>
              </div>
              {state.banner && (
                <div className={`erp-banner is-${state.banner.kind}`} role="status">
                  {state.banner.title}
                  {interactive && state.saved && (
                    <button type="button" className="erp-link" onClick={() => act({ kind: 'click', app: 'erp', target: T.cancel() })}>
                      Back to purchase orders
                    </button>
                  )}
                </div>
              )}
              <div className="erp-form">{FORM_FIELDS.map(field)}</div>
              <div className="erp-actions">
                <button
                  type="button"
                  className="erp-btn is-primary"
                  data-tid="erp:save"
                  disabled={interactive ? state.saved : undefined}
                  onClick={() => act({ kind: 'save', app: 'erp', target: T.save() })}
                >
                  Save
                </button>
                <button type="button" className="erp-btn" data-tid="erp:cancel" onClick={() => act({ kind: 'click', app: 'erp', target: T.cancel() })}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
