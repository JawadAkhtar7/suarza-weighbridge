/** Shared UI kit — both PWAs import from here so they look identical (brief §9). */

export * from './lib/utils.js';

export * from './components/ui/autocomplete.js';
export * from './components/ui/badge.js';
export * from './components/ui/button.js';
export * from './components/ui/card.js';
export * from './components/ui/dialog.js';
export * from './components/ui/input.js';
export * from './components/ui/label.js';
export * from './components/ui/select.js';
export * from './components/ui/separator.js';
export * from './components/ui/skeleton.js';
export * from './components/ui/sonner.js';
export * from './components/ui/table.js';
export * from './components/ui/tabs.js';
export * from './components/ui/textarea.js';

// Domain component, shared because the operator printout, the manager
// dashboard reprint and the public QR page must all render the same receipt.
export * from './receipt/index.js';
