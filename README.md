# JIRA Test Execution Monitor - SA-164329

Real-time monitoring dashboard for AFS004 Document Service test execution progress.

## 🚀 Quick Start

```bash
# 1. Install dependencies
pip3 install flask requests pytz

# 2. Configure environment variables
cp .env.example .env
# Edit .env and add your JIRA_TOKEN

# 3. Export environment variables
export $(cat .env | xargs)

# 4. Start the dashboard
python3 app.py

# 5. Open in browser
open http://localhost:5003
```

**Expected:** Page loads instantly with the last scanned data. Click "Scan Now" to pull fresh data from JIRA (~2-5 minutes, rate-limited to avoid 429 errors).

## ✨ Features

- ✅ **On-demand data**: Page loads show cached data instantly; click "Scan Now" to fetch fresh data from JIRA
- ⚡ **Rate-limited**: Sequential requests to avoid 429 rate limits (a scan takes a few minutes)
- 🔒 **Scan lock**: Only one scan can run at a time — a second click/tab won't start an overlapping fetch
- 🌐 **24/7 availability**: Not limited to business hours
- 📊 **Comprehensive stats**: Execution status, pass rates, executor leaderboard
- 🎨 **Dark theme**: Command center aesthetic

## 📋 Performance

| Metric | Value |
|--------|-------|
| Page load time | Instant (reads cached data) |
| Scan duration | ~2-5 minutes (depends on test count) |
| Concurrent workers | 1 (sequential) |
| Request delay | 0.5s between requests |

## 🧪 Testing

```bash
# Run automated test suite
./test-performance.sh
```

**Expected:** All tests pass (6/6)

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| [QUICK-START.md](QUICK-START.md) | Get started in 2 minutes |
| [SYSTEM-OVERVIEW.md](SYSTEM-OVERVIEW.md) | Complete architecture guide |
| [DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md) | Pre-deployment validation |
| [tasks/lessons.md](tasks/lessons.md) | Historical issues & solutions |

## 🏗️ Architecture

```
Browser → Flask (app.py) → Monitor Script → JIRA API
                ↓
          data/current.json
```

**Key Optimization:** 20 concurrent API requests (was sequential, 20x faster)

## 🔧 Common Tasks

### Check Performance
```bash
time python3 jira-test-monitor.py
```
Should complete in < 30 seconds (typically ~10s)

### View Latest Data
```bash
cat data/current.json | jq '.timestamp'
```

### Check Logs
```bash
tail -f flask.log
tail -f data/refresh.log
```

## 🛠️ Troubleshooting

### Slow Performance (> 30s)
```bash
./test-performance.sh  # Diagnose issues
```

### Data Not Refreshing
```bash
tail data/refresh.log  # Check refresh execution
```

### Server Won't Start
```bash
lsof -i :5003  # Check port usage
```

See [SYSTEM-OVERVIEW.md](SYSTEM-OVERVIEW.md) for detailed troubleshooting.

## 📦 Requirements

```bash
pip3 install flask requests pytz
```

## 🔒 Security Notes

- ✅ JIRA credentials use environment variables (never commit `.env` file)
- ⚠️ No authentication on Flask server
- ⚠️ Debug mode enabled (disable for production)
- ⚠️ Add `.env` to `.gitignore` to prevent credential leaks

## 📈 Version History

- **v2.0** (2026-04-08): Performance optimization - 20x faster (3.5min → 10s)
- **v1.1** (2026-04-08): On-demand refresh on every page load
- **v1.0** (2026-04-08): Initial version

## 🤝 Contributing

Before making changes:

1. Read [DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md)
2. Run `./test-performance.sh` before and after changes
3. Update documentation if behavior changes
4. All tests must pass before committing

## 📞 Support

1. Check logs: `flask.log` and `data/refresh.log`
2. Run diagnostics: `./test-performance.sh`
3. Review documentation: [SYSTEM-OVERVIEW.md](SYSTEM-OVERVIEW.md)
4. Check past issues: [tasks/lessons.md](tasks/lessons.md)

## 📄 License

Internal AFS project - SA-164329

---

**Last Updated:** 2026-04-08  
**Status:** ✅ Production Ready
