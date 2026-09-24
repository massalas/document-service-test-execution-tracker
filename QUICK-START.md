# JIRA Monitor - Quick Start Guide

## What This System Does
Displays real-time test execution progress for SA-164329 (AFS004 Document Service) with fresh data from JIRA on every page load/refresh.

## Start the System

```bash
# Start Flask server
python3 app.py

# Open browser
open http://localhost:5003
```

**Expected behavior**: Page loads in ~10 seconds with fresh JIRA data

## Verify Everything Works

```bash
# Run automated test suite
./test-performance.sh
```

**Expected output**: All tests pass (6/6)

## Common Tasks

### Check if Server is Running
```bash
ps aux | grep app.py
# or
curl http://localhost:5003/health
```

### Test Performance
```bash
# Monitor script only
time python3 jira-test-monitor.py

# Full API endpoint
time curl http://localhost:5003/api/current
```

**Should complete in < 30 seconds** (typically ~10s)

### View Latest Data
```bash
cat data/current.json | jq '.'
```

### Check Logs
```bash
# Flask server logs
tail -f flask.log

# Data refresh logs
tail -f data/refresh.log
```

## Troubleshooting

### Problem: Slow (> 30 seconds)
```bash
# Measure performance
time python3 jira-test-monitor.py

# Run diagnostics
./test-performance.sh
```

**Fix**: See DEPLOYMENT-CHECKLIST.md → Common Issues

### Problem: Data Not Refreshing
```bash
# Check refresh log
tail data/refresh.log

# Test directly
curl http://localhost:5003/api/current | jq '.timestamp'
```

**Fix**: Verify Flask server is running and calling refresh function

### Problem: Server Not Starting
```bash
# Check port availability
lsof -i :5003

# View error logs
cat flask.log
```

**Fix**: Kill process on port 5003 or change port in app.py

## Performance Requirements

| Metric | Threshold | Current |
|--------|-----------|---------|
| Monitor script | < 30s | ~10s ✅ |
| API response | < 30s | ~10s ✅ |
| Page load | < 30s | ~10s ✅ |

## Before Deploying Changes

```bash
# 1. Run tests
./test-performance.sh

# 2. Review checklist
cat DEPLOYMENT-CHECKLIST.md

# 3. Only deploy if all tests pass
```

## Documentation

- **Quick Start** (this file) - Get started fast
- **SYSTEM-OVERVIEW.md** - Complete system architecture
- **DEPLOYMENT-CHECKLIST.md** - Pre-deployment validation
- **tasks/lessons.md** - Historical issues and solutions

## Key Facts

✅ Fetches fresh data on **every** page load/refresh  
✅ Takes ~10 seconds (optimized with concurrent requests)  
✅ No caching, no conditions - always fresh  
✅ Works 24/7, not limited to cron schedule  
✅ Automated tests prevent regression  

## Emergency

If system is completely broken:

```bash
# 1. Stop server
kill $(cat flask.pid)

# 2. Revert to last good commit
git log --oneline -5
git reset --hard <good-commit-hash>

# 3. Restart
python3 app.py
```

## Questions?

1. Check `flask.log` and `data/refresh.log`
2. Run `./test-performance.sh`
3. Review `SYSTEM-OVERVIEW.md`
4. Check `tasks/lessons.md` for similar issues
