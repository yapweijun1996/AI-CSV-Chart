# AI Chart Summary Application Cookbook

This document provides a comprehensive guide to the AI Chart Summary application, covering its features, how to use them, and underlying technical details.

## 1. Overview

The AI Chart Summary application is a powerful web-based tool designed to help users analyze CSV data efficiently. It allows for quick parsing of CSV files, automatic profiling and aggregation of data, generation of interactive charts and data tables, and management of analysis sessions through a history feature. It also integrates with AI models (like Gemini) for potential future enhancements, though the current implementation focuses on data visualization and manipulation.

## 2. Core Functionality

The application streamlines the process of transforming raw CSV data into actionable insights through several key steps:

*   **CSV Parsing**: Reads and interprets CSV files, handling various delimiters and header configurations.
*   **Data Profiling**: Automatically identifies column types (number, string, date, empty) and calculates uniqueness and completeness metrics.
*   **Data Aggregation**: Groups data based on selected dimensions and performs calculations (sum, average, count, min, max, distinct count) on metrics.
*   **Chart Generation**: Visualizes aggregated data using various chart types (bar, line, area, pie, doughnut, polar area, radar) powered by Chart.js.
*   **Interactive Data Tables**: Displays raw and aggregated data in sortable, searchable, and paginated tables.

## 3. Key Features

### 3.1. CSV Upload & Parsing

The application supports loading CSV or TXT files from your local system.

*   **File Input**: The application can be initiated in two ways: 1) By receiving a `postMessage` with CSV data from an integrated ERP report (e.g., from `inc_report_main_heading.cfm`). 2) By manually selecting a file through the hidden [`<input id="file" type="file">`](fr_ai_chart.cfm:1103) element, which is intended for development and testing.
*   **Delimiter Detection**: Automatically detects the most suitable delimiter (comma, semicolon, tab, pipe) or allows manual selection via [`<select id="delimiter">`](fr_ai_chart.cfm:1112).
*   **Header Row**: Option to specify if the first row contains headers via [`<input id="hasHeader" type="checkbox">`](fr_ai_chart.cfm:1120).
*   **Date Format**: Auto-detects or allows manual selection of date formats (dd/mm/yyyy, mm/dd/yyyy, yyyy-mm-dd) for accurate date parsing via [`<select id="dateFormat">`](fr_ai_chart.cfm:1125).
*   **BOM Handling**: Automatically strips Byte Order Mark (BOM) from CSV files for consistent parsing.

**Code Reference:**
*   [`parseCSV()`](fr_ai_chart.cfm:2083) function in `fr_ai_chart.cfm`
*   [`parser.worker.js`](parser.worker.js) for background parsing.

### 3.2. Data Profiling

After loading a CSV, the application profiles each column to understand its characteristics.

*   **Column Type Inference**: Determines if a column contains numbers, dates, strings, or is empty.
*   **Uniqueness & Completeness**: Calculates the number of unique values and the percentage of non-empty cells for each column.
*   **Schema Display**: Presents a summary of the detected schema in the "Schema / Parser Info" section.

**Code Reference:**
*   [`profile()`](fr_ai_chart.cfm:2387) function in `fr_ai_chart.cfm`
*   [`inferType()`](fr_ai_chart.cfm:2380) function in `fr_ai_chart.cfm`

### 3.3. Auto vs. Manual Mode for Aggregation

The application offers two modes for data aggregation:

*   **Auto Mode (Default)**: Uses intelligent heuristics and ERP-specific logic to automatically infer column roles (metric, dimension, date, ID, ignore) and generate a set of relevant aggregate charts. This mode prioritizes common business metrics like 'Amount', 'Price', and 'Quantity'.
*   **Manual Mode**: Provides granular control, allowing users to explicitly define column roles and create custom aggregations.

**Code Reference:**
*   [`switchMode()`](fr_ai_chart.cfm:4558) function
*   [`autoPlan()`](fr_ai_chart.cfm:3083) function for auto-detection logic.
*   [`buildErpPlan()`](fr_ai_chart.cfm:3016) for ERP-specific planning.
*   [`planFromManualRoles()`](fr_ai_chart.cfm:4440) for manual mode planning.

### 3.4. Column Role Management (Manual Mode)

In manual mode, users can override the automatically detected column roles.

*   **Role Editor Modal**: Accessed via the "Edit column roles" button, this modal allows users to assign roles to each column:
    *   **metric**: Numeric columns for calculations (sum, avg, count).
    *   **dimension**: Categorical columns for grouping data.
    *   **date**: Time-based fields for time series analysis.
    *   **id**: Unique identifiers (excluded from aggregations).
    *   **ignore**: Columns to exclude from all processing.

**Code Reference:**
*   [`openRoleEditor()`](fr_ai_chart.cfm:4410) function
*   [`saveRoles()`](fr_ai_chart.cfm:4430) function

### 3.5. Custom Aggregate Creation (Manual Mode)

Users can define their own aggregations in manual mode.

*   **Add Aggregate Modal**: Accessed via the "Add aggregate" button, this modal allows defining:
    *   **Group by**: The dimension or date column to group data by.
    *   **Date bucket**: For date columns, group by day, week, month, quarter, or year.
    *   **Metric**: The numeric column to aggregate.
    *   **Function**: The aggregation function (sum, avg, min, max, count, distinct\_count).
    *   **Chart Type**: Preferred chart visualization.
    *   **Top-N**: Limit circular charts to the top N categories.

**Code Reference:**
*   [`openAddAgg()`](fr_ai_chart.cfm:4467) function
*   [`addAggConfirm()`](fr_ai_chart.cfm:4482) function

### 3.6. Interactive Data Table (Raw Data)

The "Raw Data" section provides a dynamic view of the loaded CSV data.

*   **Search**: Filter rows across all columns using a text input.
*   **Pagination**: Navigate through large datasets with configurable rows per page.
*   **Sorting**: Sort columns by clicking on their headers (ascending/descending).
*   **Row Inclusion/Exclusion**: Checkboxes next to each row allow users to include or exclude specific rows from aggregations. The application also attempts to auto-exclude rows that appear to be totals or subtotals.
*   **Footer Sums**: Displays sums for numeric columns based on the currently filtered and included rows.
*   **Download Filtered CSV**: Export the currently filtered and sorted data to a new CSV file.

**Code Reference:**
*   [`buildRawHeader()`](fr_ai_chart.cfm:2546)
*   [`renderRawBody()`](fr_ai_chart.cfm:2663)
*   [`applyFilter()`](fr_ai_chart.cfm:2600)
*   [`sortRows()`](fr_ai_chart.cfm:2611)
*   [`initializeRowInclusion()`](fr_ai_chart.cfm:2511)
*   [`isLikelyNonDataRow()`](fr_ai_chart.cfm:2432) for auto-exclusion logic.

### 3.7. Chart Generation

The "Aggregates" section displays interactive charts and tables based on the defined aggregations.

*   **Dynamic Chart Types**: Charts can be switched between various types (bar, line, pie, etc.) on the fly.
*   **Top-N Filtering**: Limit the number of categories displayed in charts (especially useful for pie/doughnut charts).
*   **Download PNG**: Export charts as PNG images.
*   **Edit Aggregate**: Each chart card has an "Edit" button to modify its specific aggregation parameters (group by, metric, function, date bucket).
*   **Filter Slider**: Filter groups within a specific chart/table based on their share of the total sum or an absolute value.
*   **Missing Data Warning**: Alerts users if a significant portion of data was excluded due to missing group keys.

**Code Reference:**
*   [`renderAggregates()`](fr_ai_chart.cfm:4980)
*   [`renderChartCard()`](fr_ai_chart.cfm:3756)
*   [`computeChartConfig()`](fr_ai_chart.cfm:3587)
*   [`ensureChart()`](fr_ai_chart.cfm:3722) for Chart.js management.
*   [`renderAggTable()`](fr_ai_chart.cfm:4033) for aggregate tables.

### 3.8. History Management

The application allows users to save and restore their analysis sessions.

*   **Sidebar History**: A collapsible sidebar displays a list of saved reports.
*   **Save as New**: Saves the current state of the application (loaded data, UI settings, charts) as a new report.
*   **Update Report**: Overwrites the currently loaded report in history.
*   **Load Report**: Restores a previously saved report, including all data, settings, and generated charts.
*   **Search History**: Filter saved reports by name.
*   **Manage History Modal**: Allows renaming, deleting individual reports, or clearing all history.

**Code Reference:**
*   [`ai_chart_store.js`](ai_chart_store.js) for IndexedDB operations.
*   [`saveCurrentStateToHistory()`](fr_ai_chart.cfm:5321)
*   [`loadHistoryState()`](fr_ai_chart.cfm:5436)
*   [`renderHistorySidebar()`](fr_ai_chart.cfm:5179)
*   [`openHistoryManager()`](fr_ai_chart.cfm:5546)

### 3.9. AI Integration (Gemini API)

The application includes a modal for configuring AI settings, specifically for the Gemini API.

*   **API Key Input**: Users can enter and save their Gemini API key locally in the browser's local storage.
*   **Model Selection**: Choose between different Gemini models (e.g., Gemini 1.5 Flash, Gemini 1.5 Pro).
*   **Test API Connection**: A button to verify the API key and model connection.

**Code Reference:**
*   [`openAiSettings()`](fr_ai_chart.cfm:5650)
*   [`testGeminiAPI()`](fr_ai_chart.cfm:5673)

#### 3.9.1. API Rate Limit Handling

To improve reliability, the application automatically handles API rate limit errors (HTTP 429).

*   **Automatic Retries**: If a request to the Gemini API fails due to rate limiting, the application will automatically wait for 10 seconds and then retry the request.
*   **Retry Limit**: This process is repeated up to a maximum of 3 times.
*   **User Feedback**: Toast notifications are displayed to inform the user of the retry attempts. If all retries fail, a final error message is shown.

**Code Reference:**
*   [`ai_chart_api.js`](ai_chart_api.js): This module contains the `fetchWithRetry` function that wraps the API call with the retry logic.

### 3.10. AI-Powered Chart Explanations

The application can generate textual explanations for the charts using the configured Gemini API.

*   **Automatic Generation**: When a chart is created, the application automatically calls the Gemini API to generate an explanation.
*   **Content**: The explanation typically includes a description of what the chart shows, any notable anomalies, and suggestions for follow-up analyses.
*   **Regeneration**: Each explanation card has a "Regenerate" button to get a new explanation from the AI.
*   **Persistence**: The generated explanations are saved as part of the report history.

**Code Reference:**
*   [`generateExplanation()`](fr_ai_chart.cfm:4717)
*   [`renderExplanationCard()`](fr_ai_chart.cfm:4681)

### 3.11. Enhanced AI Task Workflow

The redesigned AI Task Workflow provides comprehensive real-time tracking of AI agent operations with dynamic todo list management and Gemini API integration.

#### 3.11.1. Dynamic AI Agent Management

*   **Multi-Agent Support**: Create multiple AI agents, each with their own dynamic todo lists
*   **Agent-Specific Tasks**: Each agent can independently manage tasks based on their specific role
*   **Real-Time Task Creation**: Agents can dynamically add new tasks based on AI decision-making
*   **Task Categorization**: Tasks are grouped by type (analysis, ai-generation, api-call, rendering, etc.)

#### 3.11.2. Gemini API Integration & Tracking

*   **API Call Monitoring**: Every Gemini API request is tracked with detailed status information
*   **Automatic Retry Logic**: Failed API calls automatically retry up to 3 times with exponential backoff
*   **Rate Limit Handling**: Intelligent handling of HTTP 429 errors with automatic retry delays
*   **API Statistics Dashboard**: Real-time statistics showing total, completed, failed, and retrying API calls

#### 3.11.3. Enhanced UI Features

*   **Smart Progress Visualization**: Color-coded progress bars (green for success, red for errors, blue for active)
*   **Task Type Icons**: Visual indicators for different task types (🤖 AI generation, 📊 analysis, 🌐 API calls)
*   **Timestamp Tracking**: All tasks show start times and completion metrics
*   **Contextual Task Messages**: Detailed status messages with actual progress information
*   **API Call Badges**: Special badges for API-related tasks with retry status

#### 3.11.4. Common Sense Workflow Logic

*   **Adaptive Task Lists**: Tasks adapt based on actual AI operations rather than static predefined steps
*   **Intelligent Error Recovery**: Failed tasks can spawn follow-up recovery tasks automatically
*   **Performance Metrics**: Total execution time, completion rates, and API efficiency tracking
*   **User Control**: Enhanced cancel, retry, and restart options with clear workflow state management

#### 3.11.5. Developer Features

*   **Agent Creation API**: `WorkflowManager.createAgent(name, initialTasks)`
*   **Dynamic Task Addition**: `WorkflowManager.addTaskToAgent(agentId, description, type)`
*   **Gemini API Wrapper**: `GeminiAPI.callGemini(agentId, taskId, endpoint, payload, apiType)`
*   **Progress Tracking**: `WorkflowManager.getAgentProgress(agentId)`

**Code Reference:**
*   [`AITaskManager`](fr_ai_chart.cfm:1512) class for enhanced task management
*   [`WorkflowManager`](fr_ai_chart.cfm:1748) enhanced with AI agent integration  
*   [`updateAiTodoList()`](fr_ai_chart.cfm:1886) for rendering the enhanced UI
*   [`GeminiAPI`](fr_ai_chart.cfm:2139) wrapper for API tracking
*   [`ai_chart_workflow.css`](ai_chart_workflow.css) for modern UI styling

### 3.12. ERP-Specific Logic

The application contains special logic to handle data typically found in ERP systems.

*   **Metric Priority**: The auto-charting feature prioritizes common ERP metrics like 'Amount', 'Price', and 'Quantity' when deciding which columns to aggregate.
*   **Column Role Inference**: The application uses a set of patterns to identify common ERP column types, such as `partyCode`, `stockCode`, and `currency`.
*   **Auto-Plan**: The `buildErpPlan()` function creates a set of default charts based on the detected ERP columns, such as "Amount by Customer" or "Quantity by Product".

**Code Reference:**
*   [`getMetricPriority()`](fr_ai_chart.cfm:1900)
*   [`buildErpPlan()`](fr_ai_chart.cfm:3016)
*   [`findErpCandidates()`](fr_ai_chart.cfm:2993)

### 3.13. Exporting Data (from `inc_report_main_heading.cfm`)

The `inc_report_main_heading.cfm` file, typically used for ERP reports, includes functionality to export the displayed report data.

*   **Export to Excel**: Converts the HTML table content into an Excel-compatible format. It includes logic to handle large file sizes and cross-browser compatibility.
*   **Export to CSV**: Converts the HTML table content into a CSV format. It includes logic for handling multi-page reports and two-header displays.
*   **AI Chart Button**: A special button (`openAiTableBtn`) that extracts the current report's table data and sends it to `fr_ai_chart.cfm` (this application) for further analysis and charting. This is a key integration point.

**Code Reference:**
*   [`ExportExcel()`](inc_report_main_heading.cfm:619) function
*   [`ExportCSV()`](inc_report_main_heading.cfm:856) function
*   `openAiTableBtn` event listener and `tableToCsv()` function in `inc_report_main_heading.cfm` (lines 1557-1687).

## 4. Technical Details / Architecture

### 4.1. Frontend Technologies

*   **HTML5**: Structure of the web page.
*   **CSS3**: Styling, including responsive design, modern UI elements (cards, sections, tooltips, toasts), and a custom color palette.
*   **JavaScript (ES Modules)**: Core logic, DOM manipulation, event handling, data processing, and API interactions.
*   **Chart.js v4**: A popular JavaScript charting library used for rendering various types of interactive charts.
*   **PapaParse**: A robust CSV parser for handling large CSV files efficiently.
*   **marked.js**: A markdown parser used for rendering AI-generated explanations.
*   **jQuery**: Used in `inc_report_main_heading.cfm` for DOM manipulation and cross-browser compatibility.

### 4.2. Data Storage

*   **IndexedDB (`ai_chart_store.js`)**: Client-side database used for persistent storage of user's report history. This includes metadata about the reports and the actual CSV data, which is stored in chunks to handle large files.

### 4.3. Performance Optimization

*   **Web Workers (`parser.worker.js`)**: Heavy computational tasks like CSV parsing and data aggregation are offloaded to a Web Worker. This prevents the main browser thread from freezing, ensuring a smooth user experience even with large datasets.
*   **Debouncing**: Input events (like search and auto-save) are debounced to limit the frequency of expensive operations.
*   **Chart.js Optimizations**: Uses `update('none')` for snappier redraws without animation and `decimation` for line charts with many points.
*   **Masonry Layout**: Dynamically adjusts card heights in the "Aggregates" grid for optimal visual presentation.

### 4.4. Backend (Implied)

*   **ColdFusion Markup Language (CFML)**: The `.cfm` files suggest a ColdFusion backend environment. `inc_report_main_heading.cfm` is a server-side include that generates parts of the HTML and JavaScript, indicating that the application might be part of a larger ERP or reporting system.

### 4.5. UI/UX Enhancements

*   **Tooltips**: Provides helpful context for various UI elements.
*   **Modals**: Used for column role editing, adding aggregates, history management, and AI settings.
*   **Toasts**: Non-intrusive notifications for user feedback (e.g., "CSV data loaded successfully").
*   **Collapsible Sections**: Allows users to hide/show sections of the report for better focus.
*   **Accessibility (A11y)**: Includes ARIA attributes and keyboard navigation support for improved usability.

## 5. Integration Points

The primary integration point is between `inc_report_main_heading.cfm` (likely part of an existing ERP system) and `fr_ai_chart.cfm` (this application).

*   **`openAiTableBtn`**: When clicked in the ERP report, this button in `inc_report_main_heading.cfm` collects all visible HTML table data, converts it to CSV, and sends it via `window.postMessage` to a newly opened `fr_ai_chart.cfm` tab.
*   **`window.addEventListener('message')`**: In `fr_ai_chart.cfm`, this listener receives the CSV data from the ERP report, processes it, and then renders the charts and tables.

This allows users to seamlessly transition from a standard ERP report to an interactive data analysis and charting environment.
## 6. Setup and Configuration

This section provides instructions on how to set up the application, configure the AI settings, and manage the report history.

### 6.1. Initial Setup

The application is designed to be a part of a larger ERP or reporting system. The primary integration point is between `inc_report_main_heading.cfm` and `fr_ai_chart.cfm`. To set up the application, ensure that both files are deployed on the same web server and that the `openAiTableBtn` in `inc_report_main_heading.cfm` correctly points to `fr_ai_chart.cfm`.

### 6.2. AI Settings

The application uses the Gemini API for generating chart explanations. To use this feature, you need to configure your API key and select a model.

1.  Click on the "AI Settings" button (🤖) in the history sidebar to open the AI Settings modal.
2.  Enter your Gemini API key in the "Gemini API Key" input field.
3.  Select a model from the "Model" dropdown.
4.  Click "Save" to save your settings. Your API key will be stored locally in your browser's local storage.

### 6.3. Managing Report History

The application allows you to save and manage your analysis sessions.

*   **Saving a Report**: Click the "Save as New" button to save the current state of the application as a new report.
*   **Updating a Report**: Click the "Update Report" button to overwrite the currently loaded report in history.
*   **Loading a Report**: Click on a report in the history sidebar to load a previously saved session.
*   **Managing History**: Click the "Manage history" button (⚙️) to open the History Management modal, where you can rename, delete, or clear all reports.