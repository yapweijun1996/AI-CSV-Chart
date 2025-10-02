import { isNum, parseDateSafe } from './ai_chart_utils.js';

const DEFAULT_CURRENCY_TOKENS = new Set(['USD','US DOLLAR','SGD','MYR','RM','EUR','GBP','JPY','CNY','RMB','AUD','CAD','CHF','HKD','INR','KRW','THB','VND','PHP','IDR','TWD','AED','SAR','NZD','ZAR','SEK','NOK','DKK','PLN','TRY','MXN','BRL']);
const CURRENCY_SYMBOLS = new Set(['$', '€', '£', '¥', '₩', '₹', '₱', '฿']);
const KNOWN_UNIT_TOKENS = new Set(['EA','PCS','PC','QTY','UNIT','UNITS','SET','SETS','LOT','LOTS','BOX','BAG','CTN','CARTON','KG','G','GRAM','L','ML','PACK','PAIR','ROLL']);
const PLACEHOLDER_NAME_REGEX = /^(_+\d*|col(?:umn)?\s*\d+|unnamed[:]?\s*\d*)$/i;

function isPlaceholderColumnName(name) {
  if (name == null) return true;
  const trimmed = String(name).trim();
  if (!trimmed) return true;
  return PLACEHOLDER_NAME_REGEX.test(trimmed);
}

function detectValueHint(nonEmptyValues = []) {
  if (!Array.isArray(nonEmptyValues) || nonEmptyValues.length === 0) return 'empty';
  const trimmed = nonEmptyValues.map(v => String(v).trim()).filter(Boolean);
  if (!trimmed.length) return 'empty';
  const upper = trimmed.map(v => v.toUpperCase());

  const allCurrencyTokens = upper.every(v => DEFAULT_CURRENCY_TOKENS.has(v)) ||
    trimmed.every(v => (/^[A-Z]{2,4}$/.test(v) && v === v.toUpperCase()) || CURRENCY_SYMBOLS.has(v));
  if (allCurrencyTokens && new Set(upper).size <= 12) return 'currencyToken';

  const allUnitTokens = upper.every(v => KNOWN_UNIT_TOKENS.has(v));
  if (allUnitTokens) return 'unitToken';

  if (trimmed.every(v => /^[A-Z]{1,3}$/.test(v)) && new Set(upper).size <= 25) {
    return 'shortCode';
  }

  return 'textual';
}
/* ========= profiling ========= */
export function inferType(v, dateFormat = 'auto'){
  if (v==null || v==='') return 'empty';
  if (isNum(v)) return 'number';
  const t = parseDateSafe(v, dateFormat);
  if (!Number.isNaN(t)) return 'date';
  return 'string';
}
export function profile(rows, dateFormat = 'auto'){
  const cols = Object.keys(rows[0]||{});
  const sample = rows.slice(0, Math.min(500, rows.length));
  const out = cols.map(name=>{
    const vals = sample.map(r=>r[name]);
    const counts = {number:0,date:0,string:0,empty:0};
    let failedDateParses = [];
    for (const v of vals){
      const t = inferType(v, dateFormat);
      counts[t] = (counts[t]||0)+1;
      if (t === 'string' && v && v.match(/(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})|(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/)) {
        if (isNaN(parseDateSafe(v, dateFormat))) {
          failedDateParses.push(v);
        }
      }
    }
    const type = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
    if (type === 'string' && counts.date > 0 && failedDateParses.length > 0) {
      console.warn(`Column "${name}" has mixed date formats. ${failedDateParses.length} out of ${sample.length} sampled rows failed to parse with format "${dateFormat}".\nProblematic values:`, [...new Set(failedDateParses)].slice(0, 5));
      const schemaEl = document.querySelector('#schema');
      if (schemaEl) {
        const warning = document.createElement('div');
        warning.style.color = '#f97316';
        warning.style.marginTop = '8px';
        warning.innerHTML = `<strong>Warning:</strong> Column '<strong>${name}</strong>' may contain mixed or invalid date formats. <a href="#" onclick="document.getElementById('dateFormat').focus(); return false;">Try a different date format</a>.`;
        schemaEl.appendChild(warning);
      }
    }
    const nonEmptyVals = vals.filter(x=>x!=null&&x!=='');
    const uniq = new Set(nonEmptyVals.map(String)).size;
    const samples = nonEmptyVals.slice(0,3).map(String);
    const completeness = sample.length > 0 ? (sample.length - counts.empty) / sample.length : 0;
    const placeholderName = isPlaceholderColumnName(name);
    const hint = detectValueHint(nonEmptyVals);
    return { name, type, unique: uniq, samples, completeness, placeholderName, hint };
  });
  return { columns: out, rowCount: rows.length };
}
export function renderProfile(p, LAST_PARSE_META){
  const lines = p.columns.map(c=>{
    const extras = [];
    if (c.placeholderName) extras.push('placeholder');
    if (c.hint && c.hint !== 'textual' && c.hint !== 'empty') extras.push(`hint=${c.hint}`);
    const suffix = extras.length ? ` (${extras.join(', ')})` : '';
    return `${c.name} — ${c.type} · unique=${c.unique} · samples=[${c.samples.join(', ')}]${suffix}`;
  });
  const meta = LAST_PARSE_META ? `\nmeta: delimiter="${LAST_PARSE_META.delimiter}" linebreak="${LAST_PARSE_META.linebreak}"` : '';
  document.querySelector('#schema').textContent = `rows=${p.rowCount}\n` + lines.join('\n') + meta;
}

const NAME_PATTERNS = {
  // Core metric patterns with expanded business terminology
  metric: /(amount|total|revenue|sales|price|unit[_\s-]*price|cost|profit|margin|rate|percent|%|tax|fee|value|worth|balance|qty|quantity|金额|总额|数量|单价|价格|费|税|值|余额)/i,
  
  // Comprehensive code/ID patterns for ERP/CRM systems
  code: /(code|id|sku|account|acct|ref|reference|key|编号|编码|货号|料号|单号|订单号|客户号|编号$|代码$|no\.?$|number$|num$)/i,
  
  // Enhanced date/time patterns with business contexts
  date: /(date|time|day|month|quarter|year|created|updated|modified|issued|due|expired|日期|时间|月份|季度|年份)/i,
  
  // Financial metrics (highest priority for business data)
  financial: /(amount|total|price|cost|revenue|sales|profit|margin|balance|budget|forecast|target|actual|variance|金额|总额|收入|成本|利润|预算)/i,
  
  // Quantity and measurement patterns
  quantity: /(qty|quantity|count|units|pieces|volume|weight|size|length|width|height|数量|件数|重量|体积)/i,
  
  // Business entity identifiers
  entityId: /(customer[_\s-]*id|client[_\s-]*id|vendor[_\s-]*id|supplier[_\s-]*id|employee[_\s-]*id|product[_\s-]*id|order[_\s-]*id|invoice[_\s-]*id|客户号|供应商号|员工号|产品号)/i,
  
  // Address and location patterns
  location: /(address|street|city|state|province|country|zip|postal|region|territory|location|地址|城市|省份|国家|邮编)/i,
  
  // Contact information patterns
  contact: /(email|phone|tel|mobile|fax|contact|website|url|邮箱|电话|手机|传真|联系)/i,
  
  // Status and category patterns
  status: /(status|state|stage|phase|type|category|class|group|level|priority|rank|状态|类型|分类|等级|优先级)/i,
  
  // Hierarchical relationship patterns
  hierarchy: /(parent|child|level|tier|dept|department|division|team|manager|supervisor|superior|subordinate|上级|下级|部门|团队|经理)/i,
  
  // Temporal series patterns
  temporal: /(period|quarter|month|week|day|fiscal|year|season|cycle|trend|sequence|时期|季度|月份|周|年|趋势)/i
};
const CODE_LIKE_NUM = /(zip|postal|phone|tel|nid|ic|passport|order|invoice|po|so)$/i;

// Enhanced role detection with hierarchical and temporal analysis
export function detectHierarchicalRelationships(profile) {
  const relationships = {};
  const columns = profile.columns.map(c => c.name.toLowerCase());
  
  // Look for parent-child relationships
  columns.forEach(colName => {
    if (NAME_PATTERNS.hierarchy.test(colName)) {
      if (colName.includes('parent') || colName.includes('manager') || colName.includes('上级')) {
        const childCol = columns.find(c => 
          (c.includes('child') || c.includes('subordinate') || c.includes('下级')) ||
          c.includes(colName.replace(/parent|manager|上级/g, ''))
        );
        if (childCol) {
          relationships[colName] = { type: 'parent', child: childCol };
          relationships[childCol] = { type: 'child', parent: colName };
        }
      }
    }
  });
  
  return relationships;
}

export function detectTemporalPatterns(col, rows) {
  const name = col.name.toLowerCase();
  const isTemporalSeries = NAME_PATTERNS.temporal.test(name);
  
  if (!isTemporalSeries || col.type !== 'string') return null;
  
  // Sample data to detect patterns
  const samples = rows.slice(0, Math.min(100, rows.length)).map(row => row[col.name]).filter(v => v);
  
  // Check for sequential patterns (Q1, Q2, Q3, Q4 or Month1, Month2, etc.)
  const hasSequentialPattern = samples.some(val => 
    /^(q|quarter|month|week|period|season)[_\s-]*\d+$/i.test(val) ||
    /^\d+[_\s-]*(q|quarter|month|week|period|season)$/i.test(val)
  );
  
  // Check for fiscal year patterns (FY2024, 2024Q1, etc.)
  const hasFiscalPattern = samples.some(val =>
    /^(fy|fiscal)[_\s-]*\d{4}$/i.test(val) ||
    /^\d{4}[_\s-]*(q\d|quarter\d)$/i.test(val)
  );
  
  return {
    isSequential: hasSequentialPattern,
    isFiscal: hasFiscalPattern,
    pattern: hasSequentialPattern ? 'sequential' : hasFiscalPattern ? 'fiscal' : 'none'
  };
}

export function inferRole(col, profile, rows) {
  const name = col.name || '';
  const type = col.type;
  const uniq = col.unique || 0;
  const rowCount = profile.rowCount || Math.max(1, rows.length);
  const uniqRatio = rowCount ? uniq / rowCount : 0;
  const completeness = col.completeness || 0;
  const completenessThreshold = Number(document.querySelector('#completenessThreshold').value) || 0.6;
  const cardinalityLimitRatio = Number(document.querySelector('#cardinalityLimitRatio').value) || 0.5;
  const cardinalityAbsoluteLimit = Number(document.querySelector('#cardinalityAbsoluteLimit').value) || 100;
  const isUnsuitable = (completeness < completenessThreshold) || (uniq > cardinalityAbsoluteLimit && uniqRatio > cardinalityLimitRatio);
  const placeholderName = Boolean(col.placeholderName) || isPlaceholderColumnName(name);
  const valueHint = col.hint || 'textual';

  if (placeholderName) {
    if (type === 'number') {
      return {
        role: 'metric:strong',
        category: 'general',
        priority: 'low',
        placeholder: true,
        unsuitable: completeness < completenessThreshold,
        completeness,
        cardinality: uniq
      };
    }

    if (valueHint === 'currencyToken') {
      return {
        role: 'dimension',
        category: 'currency',
        priority: 'low',
        unsuitable: uniq <= 1 || completeness < 0.2,
        completeness,
        cardinality: uniq
      };
    }

    if (valueHint === 'unitToken') {
      return {
        role: 'dimension',
        category: 'unit',
        priority: 'low',
        unsuitable: true,
        completeness,
        cardinality: uniq
      };
    }

    if (valueHint === 'empty' || uniq === 0 || completeness < 0.05) {
      return {
        role: 'ignore',
        category: 'empty',
        priority: 'low',
        unsuitable: true,
        completeness,
        cardinality: uniq
      };
    }

    return {
      role: 'dimension',
      category: 'general',
      priority: 'low',
      unsuitable: true,
      completeness,
      cardinality: uniq
    };
  }

  // Enhanced pattern matching with priority scoring
  const patterns = {
    financial: NAME_PATTERNS.financial.test(name),
    quantity: NAME_PATTERNS.quantity.test(name),
    entityId: NAME_PATTERNS.entityId.test(name),
    location: NAME_PATTERNS.location.test(name),
    contact: NAME_PATTERNS.contact.test(name),
    status: NAME_PATTERNS.status.test(name),
    hierarchy: NAME_PATTERNS.hierarchy.test(name),
    temporal: NAME_PATTERNS.temporal.test(name),
    code: NAME_PATTERNS.code.test(name),
    date: NAME_PATTERNS.date.test(name),
    metric: NAME_PATTERNS.metric.test(name)
  };
  
  // Detect temporal patterns for enhanced time-series recognition
  const temporalInfo = detectTemporalPatterns(col, rows);
  
  // Date/Time detection with enhanced temporal patterns
  if (type === 'date' || patterns.date || (temporalInfo && temporalInfo.pattern !== 'none')) {
    return {
      role: 'date',
      temporal: temporalInfo,
      priority: patterns.temporal ? 'high' : 'normal',
      unsuitable: isUnsuitable,
      completeness,
      cardinality: uniq
    };
  }
  
  // Enhanced numeric role detection - ERP-focused
  if (type === 'number') {
    // Check if column contains only numeric values without any meaningful text/categories
    // For ERP: pure numeric columns should NOT be used as dimensions
    const isAllNumeric = rows.every(row => {
      const val = row[name];
      return val === null || val === '' || (!isNaN(Number(val)));
    });

    // For ERP: If it's all numeric, treat as metric only (no dimension possibility)
    if (isAllNumeric) {
      // Codes/IDs that are stored as pure numbers should still behave like dimensions
      if (patterns.code || patterns.entityId || CODE_LIKE_NUM.test(name)) {
        return {
          role: 'dimension',
          category: 'code',
          priority: 'high',
          unsuitable: isUnsuitable,
          completeness,
          cardinality: uniq,
          identifier: true
        };
      }
      // Absolute highest priority for 'Amount', 'Total', or 'Revenue' in ERP systems
      if (/amount|total|revenue/i.test(name)) return { role: 'metric:strong', category: 'financial', priority: 'critical', erp: true };

      // Highest priority: Financial metrics (like price)
      if (patterns.financial) return { role: 'metric:strong', category: 'financial', priority: 'high', erp: true };
      
      // High priority: Quantity metrics
      if (patterns.quantity) return { role: 'metric:strong', category: 'quantity', priority: 'normal', erp: true };
      
      // Standard metrics - all numeric columns default to sum-based metrics for ERP
      if (patterns.metric) return { role: 'metric:strong', category: 'general', priority: 'normal', erp: true };
      
      // Even generic numeric columns in ERP should be summed, not counted
      return { role: 'metric:strong', category: 'amount', priority: 'normal', erp: true };
    }

    // ID-like numbers (codes, postal codes, etc.) - mixed content
    if (patterns.code || patterns.entityId || CODE_LIKE_NUM.test(name)) {
      return {
        role: 'dimension',
        category: 'code',
        priority: 'normal',
        unsuitable: isUnsuitable,
        completeness,
        cardinality: uniq,
        identifier: true
      };
    }

    // Fallback for mixed numeric content
    return { role: 'metric', category: 'general', priority: 'low' };
  }
  
  // Enhanced string role detection
  if (type === 'string') {
    // Entity identifiers (highest priority for IDs)
    if (patterns.entityId) return { role: 'id', category: 'entity', priority: 'high', unsuitable: isUnsuitable, completeness };
    
    // General codes and IDs
    if (patterns.code) return { role: 'id', category: 'code', priority: 'normal', unsuitable: isUnsuitable, completeness };
    
    // High uniqueness ratio suggests ID
    if (uniqRatio > 0.95) return { role: 'id', category: 'unique', priority: 'normal', unsuitable: isUnsuitable, completeness };
    
    // Contact information (special handling for CRM data)
    if (patterns.contact) return { role: 'dimension', category: 'contact', priority: 'high', unsuitable: isUnsuitable, completeness, cardinality: uniq };
    
    // Location data (important for geographic analysis)
    if (patterns.location) return { role: 'dimension', category: 'location', priority: 'high', unsuitable: isUnsuitable, completeness, cardinality: uniq };
    
    // Status/Category fields (important for filtering)
    if (patterns.status) return { role: 'dimension', category: 'status', priority: 'high', unsuitable: isUnsuitable, completeness, cardinality: uniq };
    
    // Hierarchical data (special handling for org charts)
    if (patterns.hierarchy) return { role: 'dimension', category: 'hierarchy', priority: 'high', unsuitable: isUnsuitable, completeness, cardinality: uniq };
    
    // Temporal categories (quarters, periods, etc.)
    if (patterns.temporal || temporalInfo) {
      return {
        role: 'dimension',
        category: 'temporal',
        priority: 'high',
        temporal: temporalInfo,
        unsuitable: isUnsuitable,
        completeness,
        cardinality: uniq
      };
    }
    
    // Default string handling
    return { role: 'dimension', category: 'general', priority: 'normal', unsuitable: isUnsuitable, completeness, cardinality: uniq };
  }
  
  const result = { role: 'ignore', category: 'unknown', priority: 'none' };
  console.log(`[inferRole] Finished ${name}:`, result);
  return result;
}
