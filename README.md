# AI-Powered CSV Analysis and Visualization Tool

This is a powerful, client-side CSV analysis tool that allows you to upload a CSV file and automatically generate aggregates, charts, and a data table. It features both automatic and manual modes for data analysis, a variety of chart types, and a history system to save and load your analysis sessions. The application is designed with a modular architecture and leverages AI to provide intelligent insights and streamline the data analysis process.

## Core Features

-   **Advanced CSV Parsing**: Upload CSV files with automatic delimiter detection. The application uses a web worker for parsing to ensure the UI remains responsive, even with large files.
-   **Intelligent Data Profiling**: The application profiles your data to infer column types (number, date, string) and roles (metric, dimension, ID), with specialized logic for ERP data patterns.
-   **AI-Powered Analysis**: In "Auto" mode, the application uses an AI-driven workflow to generate up to 10 aggregates and charts, complete with natural language explanations.
-   **Multi-Language Support**: Select from 20 languages for the AI's responses, making the analysis accessible to a global audience.
-   **Interactive Visualizations**: The application uses **Chart.js** to generate a variety of interactive charts, including bar charts, line charts, pie charts, and more.
-   **Comprehensive Data Table**: View the raw data in a searchable and sortable table with pagination and the ability to download filtered data.
-   **Persistent History**: Save your analysis sessions and load them later. The history is stored in your browser's **IndexedDB**, ensuring that your work is preserved across sessions.

## Architecture and Key Concepts

The application is built with a modular architecture that promotes separation of concerns and maintainability. The core logic is organized into several key modules:

-   **`ai_chart_store.js`**: Manages client-side storage using IndexedDB for session history and chunked CSV data, ensuring data persistence.
-   **`ai_chart_api.js`**: Handles communication with the Gemini API, featuring a `fetchWithRetry` function with exponential backoff to manage rate limits.
-   **`ai_chart_profile.js`**: Contains the logic for data profiling, including `inferType` and `inferRole` functions that automatically analyze and categorize columns.
-   **`ai_chart_task_manager.js`**: Manages the state of the AI analysis workflow, tracking tasks from initialization to completion and updating the UI accordingly.
-   **`ai_chart_erp_logic.js`**: Provides specialized logic for identifying and analyzing ERP data patterns, enabling more accurate and relevant insights for business data.
-   **`ai_chart_ai_settings_handlers.js`**: Manages the AI settings modal, allowing users to configure their API key, select a model, and choose a response language.

## AI-Powered Workflow

The application's AI workflow is designed to automate the data analysis process and provide users with actionable insights. Here's how it works:

1.  **Analysis Plan Generation**: When you upload a CSV file, the application sends the data profile to the Gemini API, which generates a customized analysis plan.
2.  **Task Management**: The `AITaskManager` class tracks the execution of the analysis plan, updating the UI with the current status of each task.
3.  **Chart Explanations**: For each chart generated, the application sends the aggregated data to the Gemini API to produce a natural language explanation of the findings.
4.  **Final Summary**: Once all charts and explanations are generated, the application creates a final summary of the entire analysis.

## How to Use

1.  **Configure AI Settings**: Click the robot icon (🤖) in the sidebar to open the AI Settings modal. Enter your Gemini API key, select a model, and choose a response language.
2.  **Select a CSV File**: Click the "Select CSV File" button to upload your CSV file.
3.  **Configure Options**: Set the delimiter, header, and date format options as needed.
4.  **Choose a Mode**:
    *   **Auto**: The application will automatically analyze your data and generate aggregates and charts.
    *   **Manual**: You can define column roles and create custom aggregates.
5.  **Generate Cards**: Click the "Generate Cards" button to create the aggregates and charts.
6.  **Interact with the Data**:
    *   View the aggregates and charts in the "Aggregates" section.
    *   Explore the raw data in the "Raw Data" table.
    *   Save your session using the "Save as New" button.
    *   Load previous sessions from the history sidebar.

## Workflow Diagram

```mermaid
graph TD
    A[Start] --> B{Configure AI Settings};
    B --> C{Select CSV File};
    C --> D{Configure Options};
    D --> E{Choose Mode};
    E --> F[Generate Cards];
    F --> G{View Aggregates & Charts};
    G --> H{Explore Raw Data};
    H --> I{Save Session};
    I --> J[End];
```

## Technologies Used

-   **HTML5**
-   **CSS3**
-   **JavaScript (ESM)**
-   **Chart.js**: For data visualization.
- **PapaParse**: For CSV parsing.
- **Marked.js**: For rendering Markdown content.
- **IndexedDB**: For client-side storage of history.

## Business Use and Licensing

This project is a powerful, client-side tool ideal for business intelligence, data analysis, and reporting. Its modular design and AI capabilities make it a valuable asset for any organization looking to derive insights from their data.

### Business Applications

-   **Internal Data Analysis**: Empower your teams to analyze sales data, marketing campaigns, and operational metrics without the need for complex software.
-   **Client Reporting**: Quickly generate and share insightful reports with clients, complete with charts and AI-generated explanations.
-   **Prototyping and Demos**: Use the tool to prototype data-driven features or demonstrate the power of AI in data analysis.

### Licensing

This project is built using open-source libraries, all of which are under the **MIT License**. This permissive license allows for:

-   **Commercial Use**: You can use, modify, and distribute this application for commercial purposes without any fees or royalties.
-   **Private Use**: You are free to use and modify the application for your own purposes.
-   **Distribution**: You can distribute the original or modified versions of the application, as long as you include the original copyright and license notice.

This makes the project a safe and flexible choice for business use, with no restrictive licensing to worry about.