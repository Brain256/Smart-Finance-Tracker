# Technical Architecture & Coding Standards

## 1. Stack Specifications
- **Runtime:** Python 3.11+
- **Framework:** FastAPI (Asynchronous execution paths via `async def`)
- **Validation Engine:** Pydantic v2 (Strict structural layout enforcement)
- **AI Extraction Layer:** `instructor` patching the standard OpenAI SDK client
- **Database Engine:** Supabase PostgreSQL client (`supabase-py`)

## 2. Code Engineering Rules
- **Explicit Typing:** Every single function signature MUST include full type hints for arguments and explicit return types. Never use naked `dict` or `Any` objects for data passing.
- **Async Hygiene:** All external network I/O calls (database transactions, API calls to Groq/Gemini, security token validations) must be explicitly non-blocking using `async` / `await`.
- **Pydantic Model Discipline:** Never declare raw JSON dict mappings inside endpoints. Map all external payloads instantly into a Pydantic schema model.

## 3. Database Integrity & Idempotency
- When inserting items into Supabase PostgreSQL tables, you must utilize an upsert payload that references the table's composite unique key boundaries: `(merchant_name, amount, timestamp)`.
- If an insert fails due to a unique key collision constraint, trap the error gracefully and return an HTTP 200 indicating success without modifying historic data states.

## 4. Inline Documentation & Style Conventions
- **Google-Style Docstrings:** Every function, class, and method MUST include a triple-quoted descriptive docstring adhering to PEP 257 and Google Style specifications. It must explicitly document the function's purpose, input parameters (with types), and return types.
- **Complexity Documentation:** If an internal execution path relies on complex logic (such as raw database upsert exceptions or asynchronous client patches), it must feature a concise, single-line `#` tracking comment explaining the system's "why" rather than the "what."
- **Strict Linting Standards:** All code formatting must strictly match modern formatting parameters (88-character line boundaries, precise block groupings).

### Multi-Line Implementation Template
When writing new modules or endpoints, you must adhere to this exact structural block layout:

```python
def parse_notification_payload(raw_text: str, received_at: datetime) -> CleanTransaction:
    """Parses an unstructured banking text string into a type-safe transaction layout.

    This function utilizes our AI parsing layer to isolate core entity targets 
    from erratic mobile push strings.

    Args:
        raw_text: The unmodified body text passed from the mobile push notification.
        received_at: The precise ISO timestamp tracking when the webhook resolved.

    Returns:
        A validated CleanTransaction Pydantic object ready for database ingestion.

    Raises:
        ValidationError: If the incoming attributes break Pydantic structural schema limits.
    """
    # Initialize our parsing runtime structures
    log.info("Processing execution path for payload target")
    
    # Execution pipeline steps go here...