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
  // Helper to check if a set of keywords are all present in the columns
  const hasAll = (keywords) => keywords.every(kw => columns.some(col => col.toLowerCase().includes(kw.toLowerCase())));

  // --- Pattern 1: Standard Sales Order Data ---
  // Looks for common sales order fields like Order Number, Customer, Item, Quantity, Price.
  if (hasAll(['Order', 'Customer', 'Item', 'Qty', 'Price'])) {
    let plan = "1. **Sales Overview**: Calculate total revenue, number of orders, and total quantity sold.\n";
    plan += "2. **Top Products**: Identify the top 5 products by revenue and by quantity sold.\n";
    plan += "3. **Top Customers**: Identify the top 5 customers by revenue.\n";
    plan += "4. **Sales Trend**: Analyze sales revenue over time. Use the 'OrderDate' column if available, otherwise assume sequential order.\n";
    plan += "5. **Price Analysis**: Analyze the distribution of unit prices. Calculate average, min, and max price.\n";
    return plan;
  }

  // --- Pattern 2: Inventory Snapshot Data ---
  // Looks for inventory-related fields like Item, Warehouse/Location, On-Hand Quantity.
  if (hasAll(['Item', 'Location', 'On Hand', 'Value'])) {
    let plan = "1. **Inventory Summary**: Calculate the total on-hand quantity and total inventory value across all items.\n";
    plan += "2. **Value Distribution**: Identify the top 10 items that contribute most to the total inventory value.\n";
    plan += "3. **Location Analysis**: Analyze the distribution of inventory value and item count across different locations/warehouses.\n";
    plan += "4. **Zero Stock Items**: List all items with zero on-hand quantity.\n";
    plan += "5. **Valuation Check**: Correlate on-hand quantity with inventory value to spot potential data inconsistencies.\n";
    return plan;
  }
  
  // --- Pattern 3: Financial GL/Journal Data ---
  // Looks for general ledger fields like Account, Debit, Credit, Date.
  if (hasAll(['Account', 'Debit', 'Credit', 'Date'])) {
      let plan = "1. **Trial Balance Check**: Sum all debits and credits to ensure they balance.\n";
      plan += "2. **Top Accounts**: Identify the top 5 accounts with the highest total debit and total credit activity.\n";
      plan += "3. **Activity Over Time**: Analyze the volume of transactions (number of entries) over the period covered by the data.\n";
      plan += "4. **Account Analysis**: For the top 3 accounts by activity, plot their debit and credit totals over time.\n";
      plan += "5. **Unusual Entries**: Look for entries with exceptionally high debit or credit amounts that might be outliers.\n";
      return plan;
  }

  // --- Pattern 4: Purchase Order Data ---
  // Looks for common PO fields like PO Number, Vendor, Item, Cost.
  if (hasAll(['PO', 'Vendor', 'Item', 'Cost', 'Qty'])) {
      let plan = "1. **Purchasing Overview**: Calculate total purchase value, number of purchase orders, and total quantity of items purchased.\n";
      plan += "2. **Top Vendors**: Identify the top 5 vendors by total purchase value.\n";
      plan += "3. **Top Purchased Items**: Identify the top 5 items by purchase value and by quantity.\n";
      plan += "4. **Cost Analysis**: Analyze the average cost per item. Identify items with significant cost variations.\n";
      plan += "5. **Vendor Performance**: Analyze the number of POs and total spend per vendor.\n";
      return plan;
  }

  // If no specific pattern is matched, return null.
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

    // --- Define Analysis Patterns with Priority ---
    console.log('[ERP] Checking ERP patterns against columns:', columns);
    const patterns = [
        // 1. Sales Analysis (Highest Priority)
        {
            name: "Sales Analysis",
            condition: () => {
                const result = hasAll(['customer', 'qty']) && (has('price') || has('cost') || has('revenue') || has('total')) && (has('item') || has('product'));
                console.log(`[ERP] Pattern 'Sales Analysis' condition check: ${result}`);
                return result;
            },
            getData: () => {
                const qtyCol = findCol(['qty', 'quantity']);
                const priceCol = findCol(['price', 'cost']);
                const totalCol = findCol(['revenue', 'total', 'amount']);
                
                let metrics = [];
                // Smart metric selection: Prioritize total revenue/cost if possible
                if (qtyCol && priceCol) {
                    metrics.push({
                        name: `Total Revenue/Cost`,
                        type: 'derived',
                        expression: `${priceCol} * ${qtyCol}`,
                        baseMetric: priceCol // For aggregation, we sum the price col, then multiply by qty later if needed
                    });
                } else if (totalCol) {
                    metrics.push({ name: totalCol, type: 'direct' });
                }
                
                if (qtyCol) metrics.push({ name: qtyCol, type: 'direct' });

                const dimensions = [
                    findCol(['customer']),
                    findCol(['item', 'product']),
                    findCol(['date']),
                    findCol(['region', 'location'])
                ].filter(Boolean); // Filter out nulls if a column isn't found
                
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
                const result = hasAll(['item', 'on hand', 'location']);
                console.log(`[ERP] Pattern 'Inventory Analysis' condition check: ${result}`);
                return result;
            },
            getData: () => ({
                metrics: [{ name: findCol(['value', 'cost']), type: 'direct' }, { name: findCol(['on hand', 'qty']), type: 'direct' }],
                dimensions: [findCol(['item']), findCol(['location', 'warehouse']), findCol(['category'])]
            })
        },
        // 3. Financial GL Analysis
        {
            name: "Financial GL Analysis",
            condition: () => {
                const result = hasAll(['account', 'debit', 'credit']);
                console.log(`[ERP] Pattern 'Financial GL Analysis' condition check: ${result}`);
                return result;
            },
            getData: () => ({
                metrics: [{ name: findCol(['debit']), type: 'direct' }, { name: findCol(['credit']), type: 'direct' }],
                dimensions: [findCol(['account']), findCol(['date']), findCol(['type'])]
            })
        },
        // 4. Purchasing Analysis
        {
            name: "Purchasing Analysis",
            condition: () => {
                const result = hasAll(['po', 'vendor', 'item', 'qty', 'cost']);
                console.log(`[ERP] Pattern 'Purchasing Analysis' condition check: ${result}`);
                return result;
            },
            getData: () => ({
                metrics: [{ name: findCol(['cost', 'total']), type: 'direct' }, { name: findCol(['qty']), type: 'direct' }],
                dimensions: [findCol(['vendor']), findCol(['item']), findCol(['date'])]
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