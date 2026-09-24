# JIRA Monitor Deployment Checklist

## Pre-Deployment Requirements

Before deploying any changes to the JIRA monitor system, complete this checklist to ensure performance and functionality requirements are met.

---

## ✅ Performance Requirements

### Critical Thresholds
- [ ] **Monitor script execution**: Must complete within 30 seconds
- [ ] **API endpoint response**: Must respond within 30 seconds  
- [ ] **Data refresh**: Timestamp must update on every API call
- [ ] **No timeout warnings**: Response should not contain `_warning` field

### Why These Matter
- **3-minute wait time is unacceptable** for user-facing applications
- Users expect near real-time data updates
- Slow performance leads to frustrated users and system distrust

---

## ✅ Functionality Requirements

### Data Freshness
- [ ] Every page load fetches fresh data from JIRA
- [ ] Every browser refresh fetches fresh data from JIRA
- [ ] No reliance on cron schedules for user-facing updates
- [ ] Works 24/7, not limited to business hours

### Data Accuracy
- [ ] All required fields present in JSON output
- [ ] Test execution counts match JIRA
- [ ] Executor statistics are correct
- [ ] Date/time conversions (UTC → ET) work correctly

---

## ✅ Testing Protocol

### Step 1: Run Automated Tests
```bash
./test-performance.sh
```

**Expected Result**: All tests pass (6/6)

If any tests fail:
1. Do NOT deploy
2. Fix the failing tests first
3. Re-run test suite
4. Only deploy when all tests pass

### Step 2: Manual Verification
1. **Start Flask server**:
   ```bash
   python3 app.py
   ```

2. **Open browser**: http://localhost:5003

3. **Test page load**:
   - Should complete in ~10-15 seconds
   - Should show current data
   - Check timestamp in dashboard

4. **Test browser refresh** (F5 or Cmd+R):
   - Should take ~10-15 seconds
   - Timestamp should update
   - Data should reflect latest JIRA state

5. **Test multiple refreshes**:
   - Refresh 3 times in a row
   - Each should fetch fresh data
   - Performance should remain consistent

### Step 3: Verify Concurrent Requests
```bash
# Terminal 1
curl http://localhost:5003/api/current

# Terminal 2 (start immediately)
curl http://localhost:5003/api/current
```

**Expected**: Both complete successfully, even if started simultaneously

---

## ✅ Code Quality Checks

### Performance Anti-Patterns to Avoid

#### ❌ NEVER: Sequential API Calls
```python
# BAD - Takes 3+ minutes for 244 tests
for test in test_runs:
    response = requests.get(url)  # Sequential
```

#### ✅ ALWAYS: Concurrent API Calls
```python
# GOOD - Takes 10 seconds for 244 tests
with ThreadPoolExecutor(max_workers=20) as executor:
    futures = [executor.submit(fetch, test) for test in test_runs]
```

### Timeout Configuration

**Monitor Script Performance → Flask Timeout**
- If script takes X seconds, Flask timeout should be X + 10 seconds buffer
- Current: Script = 10s, Timeout = 30s ✅
- If script slows down, update timeout accordingly

### Documentation Requirements
- [ ] Update timeout comments if values change
- [ ] Document performance optimizations in commit messages
- [ ] Update DEPLOYMENT-CHECKLIST.md if thresholds change
- [ ] Add entries to tasks/lessons.md for significant issues

---

## ✅ Deployment Steps

### 1. Pre-Deployment
- [ ] All tests pass (`./test-performance.sh`)
- [ ] Code changes committed with descriptive messages
- [ ] Performance documented in commit message
- [ ] No credentials in code/commits

### 2. Deployment
- [ ] Stop existing Flask server
- [ ] Pull latest code (if using git)
- [ ] Restart Flask server
- [ ] Verify server starts successfully

### 3. Post-Deployment Verification
- [ ] Run `./test-performance.sh` in production
- [ ] Test from actual browser
- [ ] Monitor logs for errors
- [ ] Check data accuracy against JIRA

### 4. Rollback Plan
If deployment fails:
```bash
# Revert to previous commit
git revert HEAD

# Or reset to last known good commit
git reset --hard <previous-commit-hash>

# Restart server
kill $(cat flask.pid)
python3 app.py &
```

---

## ✅ Monitoring and Maintenance

### Daily Checks
- [ ] Check `data/refresh.log` for errors
- [ ] Verify Flask server is running (`ps aux | grep app.py`)
- [ ] Spot-check data accuracy vs JIRA

### Weekly Checks
- [ ] Run `./test-performance.sh` to verify performance
- [ ] Review `flask.log` for warnings/errors
- [ ] Check disk space in `data/` directory

### Performance Degradation Signs
⚠️ If you notice any of these, investigate immediately:
- API responses taking > 30 seconds
- Browser refresh timing out
- `_warning` field appearing in API responses
- `refresh.log` showing timeout messages
- Users reporting stale data

**Investigation Steps**:
1. Run `time python3 jira-test-monitor.py` to measure script duration
2. Check JIRA API response times
3. Review network connectivity
4. Check for JIRA server issues
5. Consider reducing concurrent workers if JIRA throttles requests

---

## ✅ Common Issues and Solutions

### Issue: Script takes > 30 seconds
**Cause**: Too many sequential API calls, JIRA throttling, or network issues
**Solution**: 
- Verify concurrent requests are enabled
- Check ThreadPoolExecutor worker count (currently 20)
- Test network latency to JIRA server
- Consider caching unchanging data

### Issue: Data not refreshing
**Cause**: Script not being triggered, caching issues, or Flask not calling refresh function
**Solution**:
- Verify `refresh_data_from_jira()` is called in `/api/current` endpoint
- Check `data/refresh.log` for execution records
- Ensure no browser caching (cache-control headers set)
- Test with `curl` to bypass browser cache

### Issue: Flask timeout errors
**Cause**: Timeout too short for script duration
**Solution**:
- Measure actual script duration: `time python3 jira-test-monitor.py`
- Update timeout in `app.py` to duration + 10 seconds
- Document change in commit message

### Issue: Concurrent requests failing
**Cause**: Too many parallel workers overwhelming JIRA server
**Solution**:
- Reduce `max_workers` from 20 to 10-15
- Add rate limiting/delays between requests
- Check JIRA server capacity

---

## ✅ Emergency Contacts

**JIRA Server Issues**: Contact JIRA admin team
**Flask/Python Issues**: Review logs in `flask.log` and `data/refresh.log`
**Performance Issues**: Run `./test-performance.sh` to diagnose

---

## Document History

- **2026-04-08**: Created checklist after performance optimization (3.5min → 10s)
- Performance thresholds set at 30 seconds based on user requirements
- Automated test suite created to prevent regression
