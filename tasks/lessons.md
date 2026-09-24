# Lessons Learned - Test Execution Monitor

> **Note:** This document contains lessons from CP-350826 monitoring (archived). Now tracking SA-164329.

## Table of Contents
1. [2026-04-08: Performance Optimization (3.5min → 10s)](#2026-04-08-performance-optimization)
2. [2026-04-08: On-Demand Refresh vs Conditional Auto-Refresh](#2026-04-08-on-demand-refresh)
3. [2026-04-08: Browser Cache Preventing Fresh Data](#2026-04-08-browser-cache)
4. [2026-04-08: Incorrect Pending Calculation](#2026-04-08-pending-calculation)

---

## 2026-04-08: Performance Optimization (3.5min → 10s) {#2026-04-08-performance-optimization}

### Issue
Monitor script took 205 seconds (3 minutes 25 seconds) to execute, making the website unusable. User correctly identified that fetching data for a single test execution should not take this long.

### Root Cause
The script was making **244 sequential API calls** to JIRA (one per test run). Each call had network latency of ~0.5-1 second:
```
244 calls × 0.5-1s each = 120-244 seconds minimum
```

**Code Pattern (WRONG)**:
```python
# Sequential execution - SLOW
for test in test_runs:  # 244 iterations
    response = requests.get(url)  # Each takes 0.5-1s
    process(response)
```

### Impact
- Website took 3.5 minutes to load/refresh
- Completely unusable for users
- Appeared broken or frozen
- Timeout errors in production

### Solution
Implemented **concurrent API requests** using ThreadPoolExecutor:

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

def fetch_test_run_details(test):
    """Fetch single test run (can be parallelized)"""
    response = requests.get(url, auth=auth, timeout=5)
    return process_data(response)

def analyze_test_executions(test_runs, target_date):
    """Fetch all test runs concurrently"""
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(fetch_test_run_details, test): test 
                   for test in test_runs}
        
        for future in as_completed(futures):
            result = future.result()
            if result:
                aggregate_stats(result)
```

**Key Changes**:
1. Split data fetching into separate function for concurrent execution
2. Used ThreadPoolExecutor with 20 workers
3. Workers fetch test details in parallel
4. as_completed() processes results as they arrive
5. Progress reporting maintained for user feedback

### Results
- **Before**: 205 seconds (3.5 minutes)
- **After**: 10 seconds
- **Improvement**: 20x faster (95% reduction)

### Prevention Rules

#### 1. Always Profile Before Deploying User-Facing Features
```bash
# Measure execution time
time python3 script.py

# If > 30 seconds for interactive features, optimize first
```

#### 2. Use Concurrent Requests for I/O-Bound Operations
- Network calls are I/O-bound (waiting for response)
- CPU sits idle during network wait
- ThreadPoolExecutor perfect for parallelizing I/O
- Use 10-20 workers for optimal throughput

#### 3. Never Accept Minutes for User-Facing Operations
- Interactive web apps: < 10 seconds ideal, < 30 seconds maximum
- Batch jobs: Minutes acceptable
- Real-time updates: < 5 seconds
- If too slow, it's broken - optimize or redesign

#### 4. Test with Production-Scale Data
- Don't test with 10 records if production has 244
- Performance doesn't scale linearly
- O(n) sequential vs O(1) parallel makes huge difference

#### 5. Update Timeouts When Performance Changes
- Flask timeout was 240s for 205s script (correct)
- After optimization to 10s, timeout updated to 30s
- Formula: `timeout = script_duration + buffer(10-20s)`

### Testing Checklist
- [ ] Run `time python3 jira-test-monitor.py` - should be < 30s
- [ ] Test Flask API: `time curl http://localhost:5003/api/current` - should be < 30s
- [ ] Run `./test-performance.sh` - all tests should pass
- [ ] Test multiple consecutive refreshes - performance should be consistent
- [ ] Verify data accuracy hasn't changed

### Technical Details
**Why ThreadPoolExecutor?**
- I/O-bound work (network requests) benefits from threads
- Python GIL doesn't matter for I/O operations
- 20 workers = 20 simultaneous API requests
- Each worker independent - one timeout doesn't block others

**Worker Count Selection**:
- Too few (5): Still slow, under-utilizing network
- Optimal (20): Fast, doesn't overwhelm JIRA server
- Too many (100): May hit JIRA rate limits, connection pool exhaustion

**Error Handling**:
- Each worker handles own exceptions
- Failed requests return None
- Main loop skips None results
- One failure doesn't break entire batch

### Related Files
- `jira-test-monitor.py`: Optimized with concurrent requests
- `app.py`: Timeout reduced from 240s to 30s
- `test-performance.sh`: Automated performance validation
- `DEPLOYMENT-CHECKLIST.md`: Pre-deployment performance checks

### Measuring Success
Run performance test suite:
```bash
./test-performance.sh
```

Should see:
```
✅ PASS - Script completed in 10s (threshold: 30s)
✅ PASS - API responded in 10s (threshold: 30s)
✅ ALL TESTS PASSED
```

---

## 2026-04-08: On-Demand Refresh vs Conditional Auto-Refresh {#2026-04-08-on-demand-refresh}

### Issue
User expected website to fetch fresh data on EVERY page load and browser refresh, but earlier implementation only refreshed if data was "stale" (> 5 minutes old).

### Misunderstanding
**User said**: "No auto-refresh"
**I initially thought**: "No background polling/timers"
**User actually meant**: "No conditional/time-based refresh - ALWAYS fetch fresh data"

**Wrong Implementation**:
```python
# Conditional refresh - NOT what user wanted
if is_data_stale(max_age_minutes=5):
    refresh_data_async()  # Only refresh if old
```

**Correct Implementation**:
```python
# Always refresh - what user wanted
def get_current_data():
    refresh_data_from_jira()  # ALWAYS, no conditions
    return load_data()
```

### Prevention Rules
1. **Clarify "auto-refresh" terminology**:
   - Background polling? (runs without user action)
   - Conditional refresh? (only if data stale)
   - Always refresh? (every request)

2. **Ask explicit questions**:
   - "Should it check data age before refreshing?"
   - "Or refresh on every single page load?"

3. **Test with user present**: 
   - Show behavior: "It checks if data is old, then refreshes"
   - Get confirmation: "Is this what you wanted?"

### Related
See `tasks/on-demand-refresh-fix.md` for full details

---

# Lessons Learned - CP-350826 Test Execution Monitor

## 2026-04-08: Incorrect "Pending" Calculation in Execution Status

### Issue
The dashboard displayed incorrect "executed" and "pending" counts:
- **Displayed**: 146 executed, 88 pending
- **Actual**: 149 executed, 95 pending

This caused confusion about the true test execution progress.

### Root Cause
The `get_test_execution_status()` function in `jira-test-monitor.py` (line 150) only counted `TODO` status as "pending", ignoring `BLOCKED` and `EXECUTING` statuses.

```python
# WRONG - Only counts TODO
pending = status_counts.get('TODO', 0)
```

However, tests in `BLOCKED` and `EXECUTING` states are also not complete, so they should be included in the "pending" count.

### Fix Applied
Updated line 150 in `jira-test-monitor.py`:

```python
# CORRECT - Counts TODO + BLOCKED + EXECUTING
pending = status_counts.get('TODO', 0) + status_counts.get('BLOCKED', 0) + status_counts.get('EXECUTING', 0)
```

### Results After Fix
- **pass**: 142 ✅
- **fail**: 7 ✅
- **executed**: 149 (142 + 7) ✅
- **todo**: 88 ✅
- **blocked**: 2 ✅
- **executing**: 5 ✅
- **pending**: 95 (88 + 2 + 5) ✅
- **total_tests**: 244 ✅

### Prevention Rules

1. **Define "pending" clearly**: In test execution, "pending" means ANY test not yet completed (TODO, BLOCKED, EXECUTING, etc.)
2. **Verify calculations match business logic**: Just because a status exists in the data doesn't mean it should be excluded from aggregates
3. **Test with real data**: Always verify calculated totals match manual counts from JIRA
4. **Document status definitions**: Create a table showing which statuses contribute to which aggregates

### Status Definition Table
| Status | Category | Included in "executed" | Included in "pending" |
|--------|----------|------------------------|----------------------|
| PASS | Complete | ✅ Yes | ❌ No |
| FAIL | Complete | ✅ Yes | ❌ No |
| TODO | Incomplete | ❌ No | ✅ Yes |
| BLOCKED | Incomplete | ❌ No | ✅ Yes |
| EXECUTING | Incomplete | ❌ No | ✅ Yes |

### Testing Checklist
- [ ] Run script and check execution_status in data/current.json
- [ ] Manually count PASS + FAIL in JIRA = executed
- [ ] Manually count TODO + BLOCKED + EXECUTING in JIRA = pending
- [ ] Verify: executed + pending = total_tests
- [ ] Check dashboard displays match JSON data
- [ ] Verify completion_rate = (executed / total_tests) * 100

### Impact
Users were making decisions based on incorrect progress metrics. They thought 88 tests were pending when actually 95 were, leading to underestimation of remaining work.

---

## 2026-04-08: Browser Cache Preventing Fresh Data on Refresh

### Issue
When users manually refreshed the browser (F5 or Cmd+R), the dashboard was not showing updated test execution results. The data remained stale even though the backend was reading fresh data from disk.

### Root Cause
The Flask API endpoints (`/api/current` and `/api/history`) were not setting any cache-control headers in the HTTP response. This caused browsers to cache the API responses, so when users refreshed the page:

1. The HTML page would reload (fresh)
2. The JavaScript would execute and call `loadData()`
3. The fetch request would include cache-busting timestamp
4. BUT the browser would return cached API response anyway

Flask's `jsonify()` does not set cache-prevention headers by default.

### Fix Applied
Added explicit cache-control headers to both API endpoints in `app.py`:

```python
response = jsonify(data)
# Disable caching to ensure fresh data on browser refresh
response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
response.headers['Pragma'] = 'no-cache'
response.headers['Expires'] = '0'
return response
```

**Files Modified**:
- `/api/current` endpoint (lines 44-49)
- `/api/history` endpoint (lines 67-72)

### Why These Headers Are Needed

| Header | Purpose |
|--------|---------|
| `Cache-Control: no-store` | Prevents storing response in cache at all |
| `Cache-Control: no-cache` | Requires revalidation before using cached response |
| `Cache-Control: must-revalidate` | Forces cache to check with server |
| `Cache-Control: max-age=0` | Marks response as immediately stale |
| `Pragma: no-cache` | HTTP/1.0 backward compatibility |
| `Expires: 0` | HTTP/1.0 backward compatibility |

### Prevention Rules

1. **Always set cache headers for dynamic data APIs**: Any Flask endpoint serving dynamic JSON data must explicitly set no-cache headers
2. **Never rely on client-side cache busting alone**: Query parameters (`?t=timestamp`) are not sufficient - server MUST send proper headers
3. **Test browser refresh behavior**: When building dashboards, always test that manual browser refresh shows fresh data
4. **Verify with curl**: Use `curl -I` to check response headers during development

### Testing Checklist for API Endpoints
- [ ] `curl -I /api/endpoint` shows `Cache-Control: no-store, no-cache`
- [ ] Browser Network tab shows no cached (disk cache) responses
- [ ] Manual browser refresh shows updated data
- [ ] Hard refresh (Ctrl+Shift+R / Cmd+Shift+R) shows updated data
- [ ] Different browsers tested (Chrome, Firefox, Safari)

### Common Mistakes to Avoid
❌ Assuming `jsonify()` automatically prevents caching
❌ Relying only on client-side cache-busting parameters
❌ Setting cache headers only in middleware (endpoint-specific is clearer)
❌ Forgetting that Flask development server in debug mode doesn't represent production behavior

### Impact
Users were getting frustrated seeing stale data and losing trust in the dashboard accuracy. They would refresh multiple times expecting new test execution results but seeing the same old data, leading them to question whether the cron job was working or if the system was broken.

### Related Code Patterns
When creating similar Flask APIs in the future, use this pattern:

```python
@app.route('/api/data')
def get_data():
    data = load_from_disk_or_db()
    response = jsonify(data)
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response
```

Or create a decorator:
```python
from functools import wraps

def no_cache(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        response = f(*args, **kwargs)
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    return decorated_function

@app.route('/api/data')
@no_cache
def get_data():
    return jsonify(load_data())
```
