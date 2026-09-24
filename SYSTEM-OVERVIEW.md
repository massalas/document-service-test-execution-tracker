# JIRA Test Execution Monitor - System Overview

## Purpose
Real-time monitoring dashboard for SA-164329 (AFS004 Document Service Test Execution) that displays test execution progress, executor statistics, and completion rates.

## Architecture

```
┌─────────────────┐
│   Browser       │
│  (User loads    │
│   or refreshes) │
└────────┬────────┘
         │ HTTP Request
         ↓
┌─────────────────────────┐
│   Flask Web Server      │
│   (app.py)              │
│   - Receives request    │
│   - Triggers refresh    │
│   - Returns JSON data   │
└────────┬────────────────┘
         │ subprocess.run()
         ↓
┌──────────────────────────────┐
│  Monitor Script              │
│  (jira-test-monitor.py)      │
│  - Fetches from JIRA API     │
│  - Concurrent requests (20x) │
│  - Processes test data       │
│  - Writes JSON files         │
└────────┬─────────────────────┘
         │ HTTPS API Calls
         ↓
┌──────────────────────────────┐
│   JIRA / Xray API            │
│   - Test execution data      │
│   - Test run details         │
│   - Executor information     │
└──────────────────────────────┘
```

## Key Components

### 1. Flask Web Server (`app.py`)
**Purpose**: Serves dashboard and API endpoints

**Endpoints**:
- `GET /` - Dashboard HTML page
- `GET /api/current` - Current test execution data (ALWAYS fetches fresh)
- `GET /api/history` - Historical data (30 days)
- `GET /health` - Health check

**Behavior**:
- **On every `/api/current` request**: Runs monitor script synchronously
- **Blocks** until fresh data is fetched (~10 seconds)
- Returns fresh JSON data to browser
- No caching, no staleness checks - ALWAYS fresh

**Configuration**:
- Port: 5003
- Timeout: 30 seconds
- Debug mode: Enabled (reloader disabled)

### 2. Monitor Script (`jira-test-monitor.py`)
**Purpose**: Fetches test execution data from JIRA and processes it

**Performance**: ~10 seconds (optimized with concurrent requests)

**Process**:
1. Fetch all test runs for SA-164329
2. Concurrently fetch details for each test run (20 parallel workers)
3. Analyze execution status by date and executor
4. Calculate statistics (pass/fail rates, completion %)
5. Write `data/current.json` and `data/history.json`

**Optimization**: Uses ThreadPoolExecutor with 20 workers to parallelize 244 API calls

**Data Collected**:
- Test execution status (PASS/FAIL/TODO/BLOCKED)
- Executor information (who ran each test)
- Timestamp and date information (UTC → ET conversion)
- Today's completions vs overall completions

### 3. Dashboard (`templates/dashboard.html`)
**Purpose**: Visual interface showing test execution progress

**Features**:
- Real-time execution statistics
- Progress bars and completion percentages
- Executor leaderboard (today's completions)
- Overall test status breakdown
- Last update timestamp

**Styling**: Dark command center theme (cyberpunk aesthetic)

### 4. Data Files
**Location**: `data/` directory

**Files**:
- `current.json` - Latest test execution snapshot
- `history.json` - Historical data (30 days retention)
- `refresh.log` - API refresh execution log

**Schema** (`current.json`):
```json
{
  "timestamp": "2026-04-08T22:19:01.353792",
  "date": "2026-04-08",
  "issue_key": "SA-164329",
  "execution_status": {
    "total_tests": 244,
    "executed": 153,
    "pending": 91,
    "pass": 146,
    "fail": 7,
    "completion_rate": 62.7,
    "pass_rate": 95.4
  },
  "today": {
    "executor_name": {
      "passed": 10,
      "failed": 0,
      "total": 10,
      "tests": [...]
    }
  },
  "overall": {
    "executor_name": {
      "passed": 50,
      "failed": 2,
      "total": 52,
      "tests": [...]
    }
  }
}
```

## Performance Characteristics

| Metric | Value | Threshold |
|--------|-------|-----------|
| Monitor script execution | ~10s | < 30s |
| Flask API response | ~10s | < 30s |
| Browser page load | ~10s | < 30s |
| Concurrent API workers | 20 | 10-20 optimal |
| Total API calls per refresh | 244 | N/A |

## User Workflow

### Normal Usage
1. User opens http://localhost:5003
2. Browser displays loading indicator
3. Backend runs monitor script (~10 seconds)
4. Fresh data fetched from JIRA
5. Dashboard displays current statistics

### Refresh Data
1. User clicks browser refresh (F5 / Cmd+R)
2. Browser makes new API request
3. Backend runs monitor script again (~10 seconds)
4. Fresh data fetched from JIRA
5. Dashboard updates with latest statistics

**Note**: Every page load and every refresh fetches fresh data. No caching, no conditions.

## Configuration

### JIRA Credentials
**File**: `jira-test-monitor.py`
```python
JIRA_TOKEN = os.getenv("JIRA_TOKEN", "")
JIRA_URL = os.getenv("JIRA_URL", "https://jira.np.afsp.io")
ISSUE_KEY = os.getenv("ISSUE_KEY", "SA-164329")
```

✅ **Security Note**: Credentials are read from environment variables (see `.env.example`) — never commit a `.env` file.

### Flask Configuration
**File**: `app.py`
```python
PORT = 5003
SCAN_TIMEOUT = 400  # seconds — rate-limited fetch takes several minutes
MAX_WORKERS = 1  # sequential requests to avoid 429 rate limits
```

## Deployment

### Start Flask Server
```bash
python3 app.py
```

Server starts on:
- Local: http://localhost:5003
- Network: http://<your-ip>:5003

### Run Monitor Script Manually
```bash
python3 jira-test-monitor.py
```

Generates fresh `data/current.json` and `data/history.json`

### Run Performance Tests
```bash
./test-performance.sh
```

Validates:
- Script execution time < 30s
- API response time < 30s
- Data refresh functionality
- Multiple consecutive refreshes
- Data structure completeness

## Monitoring and Debugging

### Check Flask Logs
```bash
tail -f flask.log
```

Look for:
- API request timestamps
- Refresh execution messages
- Error messages

### Check Refresh Log
```bash
tail -f data/refresh.log
```

Format:
```
[HH:MM:SS] Fetching fresh data from JIRA...
[HH:MM:SS] ✅ Data refreshed successfully
```

Or errors:
```
[HH:MM:SS] ⏱️ Monitor script timed out
[HH:MM:SS] ❌ Monitor script failed: <error>
```

### Check Data Age
```bash
cat data/current.json | jq '.timestamp'
ls -lah data/current.json
```

### Test API Directly
```bash
# Health check
curl http://localhost:5003/health | jq

# Current data (triggers refresh)
time curl http://localhost:5003/api/current | jq '.timestamp'
```

## Troubleshooting

### Issue: Slow Performance (> 30s)
**Symptoms**: Page takes too long to load, timeout errors

**Debug**:
```bash
# Measure script duration
time python3 jira-test-monitor.py

# Check for sequential API calls
grep -n "requests.get" jira-test-monitor.py
```

**Solution**:
- Ensure concurrent requests are enabled (ThreadPoolExecutor)
- Check JIRA API response times
- Verify network connectivity
- Review concurrent worker count (currently 20)

### Issue: Data Not Refreshing
**Symptoms**: Timestamp doesn't change, stale data

**Debug**:
```bash
# Check if refresh function is being called
tail -f data/refresh.log

# Verify Flask is calling refresh
grep "refresh_data_from_jira" app.py

# Test browser cache
curl -I http://localhost:5003/api/current | grep Cache-Control
```

**Solution**:
- Verify `refresh_data_from_jira()` is called in `/api/current`
- Check `data/refresh.log` for execution records
- Hard refresh browser (Ctrl+Shift+R / Cmd+Shift+R)
- Test with `curl` to bypass browser

### Issue: Timeout Errors
**Symptoms**: `_warning` field in response, timeout in logs

**Debug**:
```bash
# Check actual script duration
time python3 jira-test-monitor.py

# Check Flask timeout setting
grep "timeout=" app.py
```

**Solution**:
- Measure actual script duration
- Update Flask timeout to duration + 10s buffer
- Currently: script = 10s, timeout = 30s

### Issue: Missing Data Fields
**Symptoms**: `null` values in JSON, JavaScript errors

**Debug**:
```bash
# Validate JSON structure
cat data/current.json | jq empty

# Check required fields
cat data/current.json | jq '{timestamp, executed: .execution_status.executed, today: .today}'
```

**Solution**:
- Review `get_test_execution_status()` function
- Check JIRA API response format
- Verify data aggregation logic

## Maintenance

### Daily
- [ ] Verify Flask server is running
- [ ] Spot-check data accuracy vs JIRA
- [ ] Review `data/refresh.log` for errors

### Weekly
- [ ] Run `./test-performance.sh`
- [ ] Check disk space in `data/` directory
- [ ] Review `flask.log` for warnings

### Monthly
- [ ] Clean old logs if needed
- [ ] Verify JIRA credentials still valid
- [ ] Update dependencies if needed

## Dependencies

### Python Packages
- `flask` - Web server framework
- `requests` - HTTP client for JIRA API
- `pytz` - Timezone conversions (UTC → ET)
- Standard library: `json`, `os`, `subprocess`, `datetime`, `concurrent.futures`

### Installation
```bash
pip3 install flask requests pytz
```

## Security Considerations

⚠️ **Hardcoded Credentials**: JIRA username/password in source code
- **Risk**: Credentials exposed in git history, code review
- **Mitigation**: Move to environment variables or secrets manager

⚠️ **No Authentication**: Flask server has no auth
- **Risk**: Anyone on network can access dashboard
- **Mitigation**: Add basic auth or SSO if needed

⚠️ **Debug Mode**: Flask running in debug mode
- **Risk**: Stack traces exposed, debugger accessible
- **Mitigation**: Disable for production deployment

## Related Documentation

- `DEPLOYMENT-CHECKLIST.md` - Pre-deployment validation steps
- `tasks/lessons.md` - Historical issues and solutions
- `tasks/on-demand-refresh-fix.md` - On-demand refresh implementation details
- `test-performance.sh` - Automated performance test suite

## Support

For issues or questions:
1. Check `flask.log` and `data/refresh.log`
2. Run `./test-performance.sh` to diagnose
3. Review `tasks/lessons.md` for similar past issues
4. Check JIRA server status
5. Verify network connectivity to JIRA

## Version History

- **v2.0** (2026-04-08): Performance optimization (3.5min → 10s), concurrent requests
- **v1.1** (2026-04-08): On-demand refresh on every page load
- **v1.0** (2026-04-08): Initial version with cache-control headers
