import { showToast } from './ai_chart_toast_system.js';

const ROLE_ALIASES = new Map([
  ['metric', 'metric'],
  ['measure', 'metric'],
  ['value', 'metric'],
  ['sum', 'metric'],
  ['dimension', 'dimension'],
  ['category', 'dimension'],
  ['group', 'dimension'],
  ['date', 'date'],
  ['time', 'date'],
  ['temporal', 'date'],
  ['id', 'id'],
  ['identifier', 'id'],
  ['key', 'id'],
  ['ignore', 'ignore'],
  ['skip', 'ignore'],
  ['auto', null],
  ['clear', null]
]);

const VALID_ROLES = new Set(['metric', 'dimension', 'date', 'id', 'ignore']);

const NUMERIC_ROLES = new Set(['metric']);
const DATE_ROLES = new Set(['date']);

function findColumnMeta(columnName, profile) {
  if (!profile || !Array.isArray(profile.columns)) return null;
  const map = new Map();
  profile.columns.forEach(col => {
    map.set(col.name, col);
    map.set(String(col.name || '').toLowerCase(), col);
  });
  return map.get(columnName) || map.get(String(columnName || '').toLowerCase()) || null;
}

function canonicalRole(inputRole) {
  if (inputRole == null) return null;
  const raw = String(inputRole).trim().toLowerCase();
  if (ROLE_ALIASES.has(raw)) return ROLE_ALIASES.get(raw);
  if (VALID_ROLES.has(raw)) return raw;
  return null;
}

function canApplyRole(role, columnMeta) {
  if (!role) return true;
  if (!columnMeta) return false;
  if (NUMERIC_ROLES.has(role)) {
    return columnMeta.type === 'number';
  }
  if (DATE_ROLES.has(role)) {
    return columnMeta.type === 'date' || columnMeta.type === 'string';
  }
  return true;
}

export function normalizeAgentActions(actions, context = {}) {
  const normalized = [];
  const rejected = [];
  if (!Array.isArray(actions)) return { normalized, rejected };
  const profile = context.profile || null;

  actions.forEach((rawAction, idx) => {
    if (!rawAction || typeof rawAction !== 'object') {
      rejected.push({ action: rawAction, reason: 'invalid-structure', index: idx });
      return;
    }
    const type = String(rawAction.type || rawAction.action || '').trim().toLowerCase();
    if (!type) {
      rejected.push({ action: rawAction, reason: 'missing-type', index: idx });
      return;
    }

    if (type === 'setrole' || type === 'set_role' || type === 'role') {
      const columnName = rawAction.column || rawAction.col || rawAction.field;
      if (!columnName) {
        rejected.push({ action: rawAction, reason: 'missing-column', index: idx });
        return;
      }
      const columnMeta = findColumnMeta(columnName, profile);
      if (!columnMeta) {
        rejected.push({ action: rawAction, reason: 'unknown-column', index: idx });
        return;
      }
      const role = canonicalRole(rawAction.role);
      if (role === undefined) {
        rejected.push({ action: rawAction, reason: 'invalid-role', index: idx });
        return;
      }
      if (role && !canApplyRole(role, columnMeta)) {
        rejected.push({ action: rawAction, reason: 'role-type-mismatch', index: idx, column: columnMeta.name });
        return;
      }
      normalized.push({ type: 'setRole', column: columnMeta.name, role });
      return;
    }

    rejected.push({ action: rawAction, reason: 'unsupported-type', index: idx });
  });

  return { normalized, rejected };
}

export function applyAgentActions(actions, context = {}) {
  const profile = context.profile || null;
  const { normalized, rejected } = normalizeAgentActions(actions, { profile });
  if (!normalized.length) {
    if (rejected.length) {
      console.log('[AgentActions] All actions rejected:', rejected);
    }
    return { applied: [], rejected, changed: false };
  }

  const getManualRoles = context.getManualRoles || (() => (window.MANUAL_ROLES || {}));
  const setManualRoles = context.setManualRoles || (next => { window.MANUAL_ROLES = next; });
  const manualRoles = { ...getManualRoles() };
  let changed = false;

  normalized.forEach(action => {
    if (action.type === 'setRole') {
      if (!action.role) {
        if (manualRoles[action.column]) {
          delete manualRoles[action.column];
          changed = true;
        }
      } else if (manualRoles[action.column] !== action.role) {
        manualRoles[action.column] = action.role;
        changed = true;
      }
    }
  });

  if (!changed) {
    return { applied: [], rejected, changed: false };
  }

  setManualRoles(manualRoles);

  if (typeof context.onRolesApplied === 'function') {
    try {
      context.onRolesApplied({ manualRoles, actions: normalized });
    } catch (err) {
      console.warn('applyAgentActions:onRolesApplied failed:', err);
    }
  }

  if (typeof context.debouncedAutoSave === 'function') {
    try { context.debouncedAutoSave(); } catch (err) { console.warn('applyAgentActions:autoSave failed:', err); }
  }

  const summary = normalized.map(act => {
    if (act.type === 'setRole') {
      return act.role ? `${act.column} → ${act.role}` : `${act.column} → auto`;
    }
    return act.type;
  });

  if (summary.length) {
    try {
      showToast(`AI Agent updated column roles: ${summary.join(', ')}`, 'success');
    } catch (err) {
      console.warn('applyAgentActions:toast failed:', err);
    }
  }

  return { applied: normalized, rejected, changed: true };
}

