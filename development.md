# Development Guide (开发指南)

This is a quick guide to the AI Chart application's architecture.
(这是一个关于 AI Chart 应用架构的快速指南。)

## Core Architecture (核心架构)

The application is a **vanilla JS** (原生JS) Single-Page Application. It uses an `importmap` in `index.html` to load modules, so there is **no build step** (没有构建步骤).

### Key Files (关键文件)

-   **`index.html`**:
    -   **Entry Point** (入口点).
    -   Defines all UI elements (定义所有UI元素).
    -   Loads all JS modules using `importmap`.

-   **`folder_ai_chart/ai_chart_ui.js`**:
    -   **Main Controller** (主控制器).
    -   Handles user input and connects UI to logic (处理用户输入，连接UI与逻辑).
    -   Manages application state (管理应用状态).

-   **`folder_ai_chart/ai_chart_engine.js`**:
    -   **Core Logic** (核心逻辑).
    -   Parses CSV with a **Web Worker** (使用Web Worker解析CSV).
    -   Handles API calls (处理API调用).

-   **`folder_ai_chart/ai_chart_store.js`**:
    -   **Persistence Layer** (持久化层).
    -   Uses **IndexedDB** to save and load history/data (使用IndexedDB保存和加载历史/数据).

## Workflow (工作流程)

1.  **Load (加载)**: `index.html` -> `ai_chart_ui.js` receives a file. (接收文件)
2.  **Parse (解析)**: `ai_chart_engine.js` parses the CSV in a background worker. (在后台解析CSV)
3.  **Profile (分析)**: `ai_chart_profile.js` analyzes data types and stats. (分析数据类型和统计信息)
4.  **Render (渲染)**: `ai_chart_aggregates.js` computes data and `ai_chart_ui_helpers.js` renders charts. (计算数据并渲染图表)
5.  **Save (保存)**: `ai_chart_store.js` saves the session to IndexedDB. (将 session 保存到 IndexedDB)

## Strategic Goals (战略目标)

-   **Serverless Architecture (无服务器架构)**:
    -   The application is **100% client-side** (100% 客户端运行). It runs entirely in the browser with no backend required, making it cheap to host and highly scalable. (完全在浏览器中运行，无需后端，托管成本低且可扩展性强。)

-   **Adaptive CSV Parsing (自适应CSV解析)**:
    -   The engine is designed to handle various CSV formats, including standard **long format** and complex **cross-tab** layouts. (引擎设计用于处理各种CSV格式，包括标准长格式和复杂的交叉表布局。)
    -   `ai_chart_transformers.js` contains logic to automatically detect and convert cross-tab data. (包含自动检测和转换交叉表数据的逻辑。)

-   **AI Agent for Data Management (AI代理进行数据管理)**:
    -   The "AI Agent" mode (`ai_agent`) is built to intelligently analyze data, create analysis plans, and manage aggregations automatically. (AI代理模式旨在智能分析数据、创建分析计划并自动管理聚合。)
    -   `ai_chart_task_manager.js` and `ai_chart_ui_workflow.js` manage the AI's multi-step tasks. (管理AI的多步任务。)

-   **Low Maintenance Cost (低维护成本)**:
    -   Built with **vanilla JavaScript** (原生JS) and a modular structure. (采用原生JS和模块化结构构建。)
    -   **No build step** means the code is easy to read, debug, and deploy, keeping maintenance costs low. (无构建步骤意味着代码易于阅读、调试和部署，从而保持较低的维护成本。)

## Guiding Principle: No Regressions (指导原则：无回归)

-   **Stability is Priority 1** (稳定性是第一要务).
-   Any amendment or new feature **must not crash existing logic** or cause bugs in features that are already working. (任何修改或新功能都**不得破坏现有逻辑**或导致现有功能出现错误。)
-   For example, the software's ability to support different CSV formats is a core feature. Any change must be tested to ensure it does not break support for previously working files. (例如，软件对不同CSV格式的支持是一项核心功能。任何更改都必须经过测试，以确保不会破坏对先前可正常使用文件的支持。)