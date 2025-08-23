# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

This is a static HTML/JavaScript application. No build process is required.

**Local Development:**
```bash
# Serve the application locally
python -m http.server 8000
# Then navigate to http://localhost:8000
```

**Testing:**
- Manual testing by uploading CSV files and testing features
- Use browser DevTools for debugging and performance profiling
- Test with edge-case CSVs (missing headers, mixed types, large files)

## Architecture Overview

This is a client-side CSV analysis tool built with vanilla JavaScript modules (ESM). Key architectural principles:

- **Client-side processing**: All CSV parsing, profiling, aggregation, and rendering happens in the browser for privacy
- **Modular ESM design**: Functionality split into focused modules in `folder_ai_chart/`  
- **Async-first**: File I/O, web workers, IndexedDB, and API calls use async/await
- **Web worker parsing**: CSV parsing occurs in `ai_chart_parser_worker.js` to prevent UI blocking
- **AI-powered insights**: Uses Gemini API for intelligent analysis and natural language explanations

## Core Data Flow

1. **File Upload → Parsing**
   - UI handles file selection in `index.html`
   - Worker `ai_chart_parser_worker.js` streams CSV parsing (falls back to main thread)
   - Parsed data stored in IndexedDB via `ai_chart_store.js`

2. **Data Profiling → AI Planning**  
   - `ai_chart_profile.js` analyzes column types and roles
   - `ai_chart_api.js` sends profile to Gemini API to generate analysis plan JSON

3. **Task Execution → Visualization**
   - `ai_chart_task_manager.js` manages workflow/progress tracking
   - Aggregation functions in `index.html` process data
   - Chart.js renders interactive visualizations
   - Marked.js renders AI explanations

4. **Persistence**
   - `ai_chart_store.js` handles IndexedDB operations for sessions and chunked CSV data
   - Settings stored in localStorage (`gemini_api_key`, `gemini_model`, `ai_language`)

## Key Files

- `index.html` - Main application with UI logic, aggregation functions, chart rendering
- `folder_ai_chart/ai_chart_api.js` - Gemini API integration with retry/backoff logic
- `folder_ai_chart/ai_chart_profile.js` - Data profiling heuristics (infer types/roles)
- `folder_ai_chart/ai_chart_store.js` - IndexedDB abstraction for persistence
- `folder_ai_chart/ai_chart_parser_worker.js` - Background CSV parsing worker
- `folder_ai_chart/ai_chart_erp_logic.js` - ERP-specific analysis patterns
- `folder_ai_chart/ai_chart_task_manager.js` - Workflow progress tracking

## AI Integration

The application integrates with Google's Gemini API:
- User provides API key via settings modal (🤖 icon)
- API key stored in `localStorage.gemini_api_key`
- Supports multiple languages via `localStorage.ai_language`
- Retry logic with exponential backoff in `ai_chart_api.js`

## Extension Points

- **New aggregation types**: Modify functions in `index.html` and extend `ai_chart_profile.js`
- **Additional AI models**: Update `ai_chart_api.js` prompt templates
- **Custom chart types**: Extend Chart.js configurations in `index.html`  
- **ERP logic**: Extend patterns in `ai_chart_erp_logic.js` and `ai_chart_erp_metrics.js`

## Development Notes

- All modules use ES6 imports/exports
- IndexedDB used for large dataset storage and session persistence  
- Web Workers handle CPU-intensive CSV parsing
- No external dependencies beyond included libraries (Chart.js, PapaParse, Marked.js)
- Privacy-focused: all processing happens client-side except AI API calls