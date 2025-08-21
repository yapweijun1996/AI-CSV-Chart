/* ========= ERP-Specific Auto Plan Logic ========= */

/**
 * NOTE: This is a highly specialized function that is NOT part of the core AI Chart library.
 * It is designed for a specific ERP system's data structure and workflow.
 * It automatically generates an analysis plan based on the detected columns.
 *
 * @param {Array<string>} columns - The column headers from the dataset.
 * @returns {string|null} An auto-generated analysis plan string, or null if no specific ERP pattern is matched.
 */
export function getErpSpecificAutoPlan(columns) {
  // Helper to check if keywords are present with fuzzy matching
  const hasFuzzy = (keywords, threshold = 0.6) => {
    return keywords.some(kw => 
      columns.some(col => {
        const colLower = col.toLowerCase();
        const kwLower = kw.toLowerCase();
        return colLower.includes(kwLower) || 
               kwLower.includes(colLower) || 
               similarity(colLower, kwLower) >= threshold;
      })
    );
  };
  
  // Helper to check if a set of keywords are all present in the columns with fuzzy matching
  const hasAll = (keywords) => keywords.every(kw => hasFuzzy([kw]));
  
  // Simple similarity function (Jaccard similarity)
  const similarity = (str1, str2) => {
    const set1 = new Set(str1.split(''));
    const set2 = new Set(str2.split(''));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
  };

  // --- Pattern 1: Standard Sales Order Data ---
  // Looks for common sales order fields with more flexible matching
  if (hasAll(['Order', 'Customer', 'Item']) && (hasFuzzy(['Qty', 'Quantity']) && hasFuzzy(['Price', 'Cost', 'Amount']))) {
    let plan = "1. **Sales Overview**: Calculate total revenue, number of orders, and total quantity sold.\n";
    plan += "2. **Top Products**: Identify the top 5 products by revenue and by quantity sold.\n";
    plan += "3. **Top Customers**: Identify the top 5 customers by revenue.\n";
    plan += "4. **Sales Trend**: Analyze sales revenue over time. Use the 'OrderDate' column if available, otherwise assume sequential order.\n";
    plan += "5. **Price Analysis**: Analyze the distribution of unit prices. Calculate average, min, and max price.\n";
    return plan;
  }

  // --- Pattern 2: Inventory Snapshot Data ---
  // Looks for inventory-related fields with flexible matching
  if (hasAll(['Item']) && hasFuzzy(['Location', 'Warehouse', 'Site']) && hasFuzzy(['On Hand', 'OnHand', 'Stock', 'Inventory']) && hasFuzzy(['Value', 'Cost', 'Amount'])) {
    let plan = "1. **Inventory Summary**: Calculate the total on-hand quantity and total inventory value across all items.\n";
    plan += "2. **Value Distribution**: Identify the top 10 items that contribute most to the total inventory value.\n";
    plan += "3. **Location Analysis**: Analyze the distribution of inventory value and item count across different locations/warehouses.\n";
    plan += "4. **Zero Stock Items**: List all items with zero on-hand quantity.\n";
    plan += "5. **Valuation Check**: Correlate on-hand quantity with inventory value to spot potential data inconsistencies.\n";
    return plan;
  }
  
  // --- Pattern 3: Financial GL/Journal Data ---
  // Looks for general ledger fields with flexible matching
  if (hasAll(['Account']) && hasFuzzy(['Debit', 'Dr']) && hasFuzzy(['Credit', 'Cr']) && hasFuzzy(['Date', 'Transaction Date', 'Posting Date'])) {
      let plan = "1. **Trial Balance Check**: Sum all debits and credits to ensure they balance.\n";
      plan += "2. **Top Accounts**: Identify the top 5 accounts with the highest total debit and total credit activity.\n";
      plan += "3. **Activity Over Time**: Analyze the volume of transactions (number of entries) over the period covered by the data.\n";
      plan += "4. **Account Analysis**: For the top 3 accounts by activity, plot their debit and credit totals over time.\n";
      plan += "5. **Unusual Entries**: Look for entries with exceptionally high debit or credit amounts that might be outliers.\n";
      return plan;
  }

  // --- Pattern 4: Purchase Order Data ---
  // Looks for common PO fields with flexible matching
  if (hasFuzzy(['PO', 'Purchase Order', 'Purchase']) && hasAll(['Vendor', 'Item']) && hasFuzzy(['Cost', 'Price', 'Amount']) && hasFuzzy(['Qty', 'Quantity'])) {
      let plan = "1. **Purchasing Overview**: Calculate total purchase value, number of purchase orders, and total quantity of items purchased.\n";
      plan += "2. **Top Vendors**: Identify the top 5 vendors by total purchase value.\n";
      plan += "3. **Top Purchased Items**: Identify the top 5 items by purchase value and by quantity.\n";
      plan += "4. **Cost Analysis**: Analyze the average cost per item. Identify items with significant cost variations.\n";
      plan += "5. **Vendor Performance**: Analyze the number of POs and total spend per vendor.\n";
      return plan;
  }

  // Enhanced fallback: try to detect any business data patterns
  if (hasFuzzy(['Customer', 'Client']) || hasFuzzy(['Item', 'Product']) || hasFuzzy(['Account', 'GL'])) {
    let plan = "1. **Data Overview**: Analyze the structure and content of the dataset.\n";
    plan += "2. **Key Metrics**: Calculate totals and counts for main numerical columns.\n";
    plan += "3. **Distribution Analysis**: Examine the distribution of key categorical fields.\n";
    plan += "4. **Trend Analysis**: Look for patterns over time if date columns are present.\n";
    plan += "5. **Top Items**: Identify top performers by relevant metrics.\n";
    return plan;
  }
  
  // If no patterns are matched, return null
  return null;
}

/* ========= ERP Metric Priority Logic ========= */

/**
 * NOTE: This is a highly specialized function for a specific ERP workflow.
 * It suggests primary metrics and dimensions based on detected data patterns.
 * This helps the AI prioritize the most impactful analyses first.
 *
 * @param {Array<string>} columns - The column headers from the dataset.
 * @returns {object|null} An object with suggested { metrics: [], dimensions: [] }, or null.
 */
export function getErpMetricPriority(columns) {
    const router = getErpAnalysisPriority(columns);
    if (!router) return null;

    // This function can now be a simple wrapper or contain additional logic if needed.
    return router;
}

/**
 * ERP Analysis Priority Router
 *
 * This function acts as a router to determine the best analysis priority based on column keywords.
 * It addresses the issue of metric prioritization (e.g., preferring total revenue over unit price).
 *
 * @param {Array<string>} columns - The column headers from the dataset.
 * @returns {object|null} An object with suggested { metrics: [], dimensions: [] }, or null.
 */
export function getErpAnalysisPriority(columns) {
    const lowerCaseColumns = columns.map(c => c.toLowerCase());
    const findCol = (kws) => columns.find(c => kws.some(kw => c.toLowerCase().includes(kw)));
    const has = (kw) => lowerCaseColumns.some(col => col.includes(kw));
    const hasAll = (kws) => kws.every(kw => has(kw));
    
    // Enhanced fuzzy matching for better column detection
    const findColByPriority = (priorityKwList) => {
        for (const kw of priorityKwList) {
            const col = columns.find(c => c.toLowerCase().includes(kw));
            if (col) return col;
        }
        return null;
    };
    
    const hasFuzzy = (keywords, threshold = 0.6) => {
        return keywords.some(kw => 
            columns.some(col => {
                const colLower = col.toLowerCase();
                const kwLower = kw.toLowerCase();
                return colLower.includes(kwLower) || 
                       kwLower.includes(colLower) || 
                       similarity(colLower, kwLower) >= threshold;
            })
        );
    };
    
    const similarity = (str1, str2) => {
        const set1 = new Set(str1.split(''));
        const set2 = new Set(str2.split(''));
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);
        return intersection.size / union.size;
    };

    // --- Define Analysis Patterns with Priority ---
    console.log('[ERP] Checking ERP patterns against columns:', columns);
    const patterns = [
        // 1. Sales Analysis (Highest Priority)
        {
            name: "Sales Analysis",
            condition: () => {
                const hasCustomer = hasFuzzy(['customer', 'client', 'buyer']);
                const hasQty = hasFuzzy(['qty', 'quantity', 'units']);
                const hasPrice = hasFuzzy(['price', 'cost', 'revenue', 'total', 'amount']);
                const hasItem = hasFuzzy(['item', 'product', 'sku']);
                const result = hasCustomer && hasQty && hasPrice && hasItem;
                console.log(`[ERP] Pattern 'Sales Analysis' condition check: ${result}`);
                return result;
            },
            getData: () => {
                const qtyCol = findCol(['qty', 'quantity', 'units']);
                const priceCol = findCol(['price', 'cost', 'unit price']);
                // Prefer 'Total Amount' > 'Amount' > 'Total' > 'Revenue'
                const totalCol = findColByPriority(['total amount', 'line total', 'amount', 'total', 'revenue', 'sales']);
                
                let metrics = [];
                // Smart metric selection: Prioritize provided total columns if present; otherwise fall back to derived
                if (totalCol) {
                    metrics.push({ name: totalCol, type: 'direct' });
                } else if (qtyCol && priceCol) {
                    metrics.push({
                        name: `Total Revenue/Cost`,
                        type: 'derived',
                        expression: `${priceCol} * ${qtyCol}`,
                        baseMetric: priceCol
                    });
                }
                
                if (qtyCol) metrics.push({ name: qtyCol, type: 'direct' });

                const dimensions = [
                    findCol(['customer', 'client', 'buyer']),
                    findCol(['item', 'product', 'sku']),
                    findCol(['date', 'order date', 'transaction date']),
                    findCol(['region', 'location', 'territory'])
                ].filter(Boolean);
                
                return {
                    metrics: metrics,
                    dimensions: dimensions
                };
            }
        },
        // 2. Inventory Analysis
        {
            name: "Inventory Analysis",
            condition: () => {
                const hasItem = hasFuzzy(['item', 'product', 'sku']);
                const hasQty = hasFuzzy(['on hand', 'onhand', 'stock', 'inventory', 'qty']);
                const hasLocation = hasFuzzy(['location', 'warehouse', 'site', 'bin']);
                const result = hasItem && hasQty && hasLocation;
                console.log(`[ERP] Pattern 'Inventory Analysis' condition check: ${result}`);
                return result;
            },
            getData: () => ({
                metrics: [
                    { name: findCol(['value', 'cost', 'total value', 'inventory value']), type: 'direct' }, 
                    { name: findCol(['on hand', 'onhand', 'stock', 'qty', 'quantity']), type: 'direct' }
                ].filter(m => m.name),
                dimensions: [
                    findCol(['item', 'product', 'sku']), 
                    findCol(['location', 'warehouse', 'site', 'bin']), 
                    findCol(['category', 'class', 'type'])
                ].filter(Boolean)
            })
        },
        // 3. Financial GL Analysis
        {
            name: "Financial GL Analysis",
            condition: () => {
                const hasAccount = hasFuzzy(['account', 'gl account', 'ledger']);
                const hasDebit = hasFuzzy(['debit', 'dr', 'debit amount']);
                const hasCredit = hasFuzzy(['credit', 'cr', 'credit amount']);
                const result = hasAccount && hasDebit && hasCredit;
                console.log(`[ERP] Pattern 'Financial GL Analysis' condition check: ${result}`);
                return result;
            },
            getData: () => ({
                metrics: [
                    { name: findCol(['debit', 'dr', 'debit amount']), type: 'direct' }, 
                    { name: findCol(['credit', 'cr', 'credit amount']), type: 'direct' }
                ].filter(m => m.name),
                dimensions: [
                    findCol(['account', 'gl account', 'ledger']), 
                    findCol(['date', 'posting date', 'transaction date']), 
                    findCol(['type', 'transaction type', 'entry type'])
                ].filter(Boolean)
            })
        },
        // 4. Purchasing Analysis
        {
            name: "Purchasing Analysis",
            condition: () => {
                const hasPO = hasFuzzy(['po', 'purchase order', 'purchase']);
                const hasVendor = hasFuzzy(['vendor', 'supplier', 'seller']);
                const hasItem = hasFuzzy(['item', 'product', 'sku']);
                const hasQty = hasFuzzy(['qty', 'quantity', 'units']);
                const hasCost = hasFuzzy(['cost', 'price', 'amount', 'total']);
                const result = hasPO && hasVendor && hasItem && hasQty && hasCost;
                console.log(`[ERP] Pattern 'Purchasing Analysis' condition check: ${result}`);
                return result;
            },
            getData: () => ({
                metrics: [
                    { name: findCol(['cost', 'total cost', 'line total', 'amount']), type: 'direct' }, 
                    { name: findCol(['qty', 'quantity', 'units']), type: 'direct' }
                ].filter(m => m.name),
                dimensions: [
                    findCol(['vendor', 'supplier', 'seller']), 
                    findCol(['item', 'product', 'sku']), 
                    findCol(['date', 'po date', 'order date'])
                ].filter(Boolean)
            })
        }
    ];

    // --- Find the first matching pattern (Priority Router) ---
    for (const pattern of patterns) {
        if (pattern.condition()) {
            const data = pattern.getData();
            console.log(`[ERP] Matched pattern: '${pattern.name}'. Returning priority data.`, data);
            return data;
        }
    }

    console.log('[ERP] No specific ERP pattern matched.');
    return null; // No specific pattern matched
}