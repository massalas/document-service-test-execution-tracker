# On-Demand Data Refresh Implementation

## Date: 2026-04-08

## Issue
User expected the website to fetch fresh data from JIRA on EVERY page load and browser refresh, but this was not implemented. The previous "fix" only addressed browser caching, not on-demand data fetching.

## Root Cause
The earlier fix (commit d45ef7c) only added cache-control headers to prevent browsers from caching API responses. It did NOT implement on-demand data fetching from JIRA. The data still relied on the cron schedule (9am-8pm ET, every 2 hours).

## User Expectation
- Access website → fresh data from JIRA
- Click browser refresh → fresh data from JIRA
- No staleness checks, no time-based auto-refresh
- **Synchronous/blocking behavior**: wait for fresh data before displaying

## Solution Implemented

### 1. Synchronous Data Refresh Function
Created `refresh_data_from_jira()` that:
- Runs monitor script synchronously (blocks until complete)
- Uses subprocess.run() with appropriate timeout
- Logs to both console and file (data/refresh.log)
- Returns success/failure status

### 2. Updated /api/current Endpoint
Modified to ALWAYS fetch fresh data:
```python
@app.route('/api/current')
def get_current_data():
    # ALWAYS fetch fresh data (synchronous/blocking)
    refresh_success = refresh_data_from_jira()
    
    if refresh_success:
        # Return fresh data
    else:
        # Return cached data with warning
```

### 3. Critical Timeout Configuration
The monitor script fetches all test execution data from JIRA, which takes time:
- **Measured duration**: ~205 seconds (3 minutes 25 seconds)
- **Required timeout**: 240 seconds (4 minutes) to provide buffer
- **Important**: Timeout must exceed actual script duration or data won't update

### 4. Disabled Flask Reloader
Flask's debug mode reloader interferes with subprocess execution:
```python
app.run(host='0.0.0.0', port=PORT, debug=True, use_reloader=False)
```

## Testing Results

**Before Fix:**
- Data only updated during business hours via cron
- Browser refresh showed stale data

**After Fix:**
- Every API call fetches fresh data from JIRA
- Takes ~3.5 minutes but guarantees freshness
- Browser refresh always triggers new data fetch

**Test Evidence:**
```
Before: 2026-04-08T22:02:17.409295
API call: 210 seconds
After:  2026-04-08T22:12:56.335781
Warning: null (no timeout)
```

## Prevention Rules

### 1. Understand User Requirements
❌ **Wrong**: "Fix browser caching" ≠ "Fetch fresh data on demand"
✅ **Right**: Ask clarifying questions about the expected behavior

### 2. Monitor Script Duration Matters
- Always measure actual script duration before setting timeouts
- Add 20-30 second buffer to timeout value
- Document expected duration in code comments

### 3. Synchronous vs Asynchronous
User said "no auto-refresh" - they meant:
- ❌ No background polling/automatic updates
- ✅ Yes to blocking/waiting for fresh data on demand

### 4. Flask Debug Mode Gotchas
- Reloader can interfere with subprocess calls
- Use `use_reloader=False` when subprocess is critical
- Log to files, not just console (reloader kills stdout)

### 5. Test End-to-End
Don't just test that the code runs - verify:
- [ ] API call returns fresh data
- [ ] Data timestamp actually updates
- [ ] No timeout warnings in response
- [ ] File modification time changes
- [ ] Multiple calls work consistently

## Code Changes

**File**: `app.py`

**Added**:
- `refresh_data_from_jira()` function with 240s timeout
- Logging to `data/refresh.log`
- Synchronous data refresh in `/api/current` endpoint
- `use_reloader=False` flag

**Removed**:
- `is_data_stale()` function (no staleness checks)
- `refresh_data_async()` function (no async behavior)
- Threading imports (not needed)
- Conditional refresh logic (always refresh)

## Usage

When website is accessed:
1. Browser requests `/api/current`
2. Flask calls monitor script (takes ~3.5 min)
3. Monitor fetches all test data from JIRA
4. New data written to `data/current.json`
5. Flask returns fresh data to browser

User sees loading indicator for ~3.5 minutes, then fresh data appears.

## Related Files
- `app.py` - Flask server with on-demand refresh
- `jira-test-monitor.py` - Monitor script that fetches from JIRA
- `data/refresh.log` - Refresh execution log
- `tasks/lessons.md` - Previous fixes documentation

## Impact
User now gets guaranteed fresh data on every page load and browser refresh, 24/7, without relying on cron schedule. Trade-off is 3.5-minute load time, which is acceptable for the use case.
