/* ========= ERP Metric Priority Logic ========= */
export function getMetricPriority(columnName) {
  const name = String(columnName || '').toLowerCase();
  
  // Priority 1: Revenue / Total Price / Amount (highest priority)
  if (/revenue|total.*price|\bamount\b|total.*amount|net.*amount|gross.*amount/.test(name)) return 1;

  // Priority 2: Price/Unit Price
  if (/\bprice\b|unit.*price|selling.*price|cost.*price|retail.*price/.test(name)) return 2;

  // Priority 3: Quantity
  if (/\bqty\b|\bquantity\b|units?|pieces?|count/.test(name)) return 3;

  // Priority 4: Other financial metrics
  if (/cost|value|sum|total|sales/.test(name)) return 4;
  
  // Priority 5: Generic numeric (lowest priority)
  return 5;
}

export function selectBestMetricColumn(columns) {
  if (!columns || !columns.length) return null;
  
  // Sort by priority (lower number = higher priority)
  const sortedColumns = columns.sort((a, b) => {
    const priorityA = getMetricPriority(a);
    const priorityB = getMetricPriority(b);
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // If same priority, prefer total/revenue/amount over unit price
    const aIsTotal = /total|revenue|amount/i.test(a);
    const bIsTotal = /total|revenue|amount/i.test(b);
    if (aIsTotal && !bIsTotal) return -1;
    if (bIsTotal && !aIsTotal) return 1;

    // If still tied, prefer shorter names (e.g., "Price" over "Unit Price")
    if (a.length !== b.length) {
        return a.length - b.length;
    }
    
    // Fallback to alphabetical order
    return a.localeCompare(b);
  });
  
  console.log('📊 Metric priority order:', sortedColumns.map(col => `${col} (priority ${getMetricPriority(col)})`));
  return sortedColumns[0];
}

export function pickPrimaryMetric(profile, rows) {
  const numCols = profile.columns.filter(c => c.type === 'number');
  
  if (!numCols.length) return null;
  
  // Use ERP priority logic: Amount > Price/Unit Price > Quantity > Others
  const numColNames = numCols.map(c => c.name);
  const bestColName = selectBestMetricColumn(numColNames);
  const bestCol = numCols.find(c => c.name === bestColName);
  
  console.log(`[pickPrimaryMetric] ERP Priority Selection: ${bestColName} (priority ${getMetricPriority(bestColName)})`);
  return bestCol || numCols[0];
}

export function buildErpPlan(profile, rows, candidates, topN = 8, excludedDimensions = []) {
  const jobs = [];
  const charts = [];
  
  const metrics = (candidates.amount || []).concat(candidates.qty || []);
  const primaryMetric = selectBestMetricColumn(metrics.map(m => m.name));
  
  if (!primaryMetric) {
    console.log('No primary ERP metric (amount/qty) found, falling back to default autoPlan.');
    return null;
  }

  const dims = [
    ...(candidates.party || []),
    ...(candidates.stock || []),
    ...(candidates.date || []),
    ...(candidates.currency || [])
  ].filter(Boolean);

  dims.forEach(d => {
    
    // Skip excluded dimensions from fallback
    if (excludedDimensions.includes(d.name)) {
      console.log(`Skipping excluded dimension "${d.name}"`);
      return;
    }
    
    // Skip date columns with low completeness (< 50%)
    const isDateCol = (candidates.date || []).some(dateCol => dateCol.name === d.name);
    if (isDateCol && d.completeness < 0.5) {
      console.log(`Skipping date column "${d.name}" with completeness ${(d.completeness * 100).toFixed(1)}%`);
      return;
    }
    
    let dateBucket = '';
    if (isDateCol) {
      dateBucket = autoBucket(rows, d.name);
    }

    jobs.push({ 
      groupBy: d.name, 
      metric: primaryMetric, 
      agg: 'sum',
      dateBucket
    });
    charts.push({
      useJob: jobs.length - 1,
      preferredType: dateBucket ? 'line' : (d.unique <= 8 ? 'pie' : 'bar'),
      title: `sum(${primaryMetric}) by ${d.name}`
    });
  });

  // Add a count if no other jobs were created
  if (jobs.length === 0 && candidates.party) {
      const d = candidates.party[0];
      jobs.push({ groupBy: d.name, metric: null, agg: 'count' });
      charts.push({ useJob: jobs.length - 1, preferredType: 'bar', title: `Count by ${d.name}` });
  }

  // Apply canonical deduplication before returning
  const deduplicatedJobs = deduplicateJobs(jobs);
  return { jobs: deduplicatedJobs.slice(0, topN), charts };
}