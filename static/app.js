// JIRA Test Execution Monitor Dashboard - JavaScript

// Global state
let currentData = null;
let historyData = [];
let passFailChart = null;
let executorChart = null;
let trendChart = null;
let scanPollInterval = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    checkScanStatus();
});

// Data Loading
async function loadData() {
    try {
        // Load cached current data (does NOT trigger a JIRA fetch)
        const timestamp = new Date().getTime();
        const currentResponse = await fetch(`/api/current?t=${timestamp}`, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache'
            }
        });

        if (currentResponse.status === 404) {
            // No scan has ever run yet
            setScanStatusText('No data yet — click "Scan Now" to fetch from JIRA.');
            return;
        }
        if (!currentResponse.ok) {
            throw new Error(`HTTP ${currentResponse.status}: ${currentResponse.statusText}`);
        }
        currentData = await currentResponse.json();

        // Load history data with cache-busting
        const historyResponse = await fetch(`/api/history?t=${timestamp}`, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache'
            }
        });
        if (historyResponse.ok) {
            historyData = await historyResponse.json();
        }

        renderDashboard();
        loadArchives(); // Load archived test executions
        hideError();
    } catch (error) {
        showError(`Failed to load data: ${error.message}`);
    }
}

// Manual Scan
async function triggerScan() {
    const button = document.getElementById('scanButton');
    const icon = document.getElementById('scanButtonIcon');
    const text = document.getElementById('scanButtonText');

    button.disabled = true;
    icon.classList.add('spinning');
    text.textContent = 'Scanning...';
    setScanStatusText('Starting scan...');

    if (scanPollInterval) clearInterval(scanPollInterval);
    scanPollInterval = setInterval(pollScanStatus, 2000);

    try {
        const response = await fetch('/api/scan', { method: 'POST' });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || `HTTP ${response.status}`);
        }

        currentData = data;
        renderDashboard();

        const historyResponse = await fetch(`/api/history?t=${Date.now()}`, { cache: 'no-store' });
        if (historyResponse.ok) {
            historyData = await historyResponse.json();
        }
        loadArchives();

        setScanStatusText(`Last scan completed at ${new Date().toLocaleTimeString()}`);
        hideError();
    } catch (error) {
        showError(`Scan failed: ${error.message}`);
        setScanStatusText('Scan failed — see error above.');
    } finally {
        clearInterval(scanPollInterval);
        scanPollInterval = null;
        resetScanButton();
    }
}

// Reflect an already-running scan if the page is loaded/refreshed mid-scan
async function checkScanStatus() {
    try {
        const response = await fetch(`/api/scan/status?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const progress = await response.json();

        if (progress.scan_active) {
            const button = document.getElementById('scanButton');
            const icon = document.getElementById('scanButtonIcon');
            const text = document.getElementById('scanButtonText');
            button.disabled = true;
            icon.classList.add('spinning');
            text.textContent = 'Scanning...';
            applyScanProgressText(progress);

            if (scanPollInterval) clearInterval(scanPollInterval);
            scanPollInterval = setInterval(pollScanStatus, 2000);
        }
    } catch (error) {
        // ignore — status check is best-effort
    }
}

async function pollScanStatus() {
    try {
        const response = await fetch(`/api/scan/status?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const progress = await response.json();
        applyScanProgressText(progress);

        // Someone else's scan (or one from a prior page load) may have finished
        // while this tab was only observing via checkScanStatus() — reset the
        // button here instead of waiting on a POST /api/scan this tab never sent.
        if (!progress.scan_active && (progress.stage === 'done' || progress.stage === 'error')) {
            resetScanButton();

            if (scanPollInterval) {
                clearInterval(scanPollInterval);
                scanPollInterval = null;
            }

            if (progress.stage === 'done') {
                await loadData();
                setScanStatusText(`Last scan completed at ${new Date().toLocaleTimeString()}`);
            } else {
                showError(`Scan failed: ${progress.message || 'unknown error'}`);
                setScanStatusText('Scan failed — see error above.');
            }
        }
    } catch (error) {
        // ignore transient poll failures
    }
}

function resetScanButton() {
    const button = document.getElementById('scanButton');
    const icon = document.getElementById('scanButtonIcon');
    const text = document.getElementById('scanButtonText');
    button.disabled = false;
    icon.classList.remove('spinning');
    text.textContent = 'Scan Now';
}

function applyScanProgressText(progress) {
    if (progress.stage === 'processing' && progress.total) {
        setScanStatusText(`Processing ${progress.completed}/${progress.total} tests...`);
    } else if (progress.message) {
        setScanStatusText(progress.message);
    }
}

function setScanStatusText(message) {
    const statusText = document.getElementById('scanStatusText');
    if (statusText) statusText.textContent = message;
}

// Dashboard Rendering
function renderDashboard() {
    if (!currentData) return;

    updateHeader();
    updateExecutionStatus();
    updateStats();
    renderLeaderboard();
    renderCharts();
    renderOverallLeaders();
}

function updateHeader() {
    const timestamp = new Date(currentData.timestamp);
    document.getElementById('lastUpdated').textContent = timestamp.toLocaleTimeString();
    document.getElementById('currentDate').textContent = currentData.date;
    document.getElementById('executorCount').textContent = currentData.totals.executors;
}

function updateExecutionStatus() {
    const status = currentData.execution_status;

    if (!status) {
        console.warn('No execution status data available');
        return;
    }

    // Update progress percentage
    const completionRate = status.completion_rate.toFixed(1);
    document.getElementById('executionPercentage').textContent = `${completionRate}%`;
    document.getElementById('executionProgressBar').style.width = `${completionRate}%`;

    // Update progress stats
    document.getElementById('totalExecuted').textContent = status.executed.toLocaleString();
    document.getElementById('totalPending').textContent = status.pending.toLocaleString();
    document.getElementById('totalTestCount').textContent = status.total_tests.toLocaleString();

    // Update status breakdown
    document.getElementById('statusPass').textContent = status.pass.toLocaleString();
    document.getElementById('statusFail').textContent = status.fail.toLocaleString();
    document.getElementById('statusTodo').textContent = status.todo.toLocaleString();
    document.getElementById('statusExecuting').textContent = status.executing.toLocaleString();
    document.getElementById('statusBlocked').textContent = status.blocked.toLocaleString();
    document.getElementById('statusPassRate').textContent = `${status.pass_rate.toFixed(1)}%`;
}

function updateStats() {
    const totals = currentData.totals;

    document.getElementById('totalPassed').textContent = totals.passed === 0 ? '0' : totals.passed.toLocaleString();
    document.getElementById('totalFailed').textContent = totals.failed === 0 ? '0' : totals.failed.toLocaleString();
    document.getElementById('totalTests').textContent = totals.total === 0 ? '0' : totals.total.toLocaleString();

    const passRate = totals.total > 0
        ? ((totals.passed / totals.total) * 100).toFixed(1)
        : '0.0';
    document.getElementById('passRate').textContent = `${passRate}%`;
}

function renderLeaderboard() {
    const leaderboardEl = document.getElementById('leaderboard');

    // Sort executors by total completed (descending)
    const sortedExecutors = Object.entries(currentData.today)
        .sort((a, b) => b[1].total - a[1].total);

    if (sortedExecutors.length === 0) {
        leaderboardEl.innerHTML = `
            <div class="loading-state">
                <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.3;">📊</div>
                <p style="font-size: 1.25rem; color: var(--color-text-secondary);">No test executions completed today</p>
                <p style="font-size: 0.875rem; color: var(--color-text-tertiary); margin-top: 0.5rem;">Date: ${currentData.date}</p>
            </div>
        `;
        return;
    }

    // Render leaderboard items
    leaderboardEl.innerHTML = sortedExecutors.map(([name, data], index) => {
        const rank = index + 1;
        const rankClass = rank <= 3 ? `leaderboard-card--${rank}` : '';
        const cardId = `executor-${name.replace(/\s+/g, '-')}`;

        // Build test details list
        let testDetails = '';
        if (data.tests && data.tests.length > 0) {
            // Sort tests by status (FAIL first, then PASS) and then by finished time
            const sortedTests = [...data.tests].sort((a, b) => {
                if (a.status === 'FAIL' && b.status === 'PASS') return -1;
                if (a.status === 'PASS' && b.status === 'FAIL') return 1;
                return b.finished.localeCompare(a.finished);
            });

            testDetails = `
                <div class="test-details" id="${cardId}-details" style="display: none;">
                    <div class="test-details-header">
                        <h4>Test Executions (${data.tests.length})</h4>
                    </div>
                    <div class="test-list">
                        ${sortedTests.map(test => `
                            <div class="test-item test-item--${test.status.toLowerCase()}">
                                <div class="test-item-status">${test.status === 'PASS' ? '✅' : '❌'}</div>
                                <div class="test-item-content">
                                    <div class="test-item-key">
                                        <a href="https://jira.np.afsp.io/browse/${test.key}" target="_blank">${test.key}</a>
                                    </div>
                                    <div class="test-item-time">${test.finished}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        return `
            <div class="leaderboard-card ${rankClass}" onclick="toggleTestDetails('${cardId}')" style="cursor: pointer;">
                <div class="leaderboard-content">
                    <div class="leaderboard-rank">${rank}</div>
                    <div class="leaderboard-info">
                        <div class="leaderboard-name">${name}</div>
                        <div class="leaderboard-metrics">
                            <span class="leaderboard-metric">✅ <strong>${data.passed}</strong> passed</span>
                            <span class="leaderboard-metric">❌ <strong>${data.failed}</strong> failed</span>
                            <span class="leaderboard-metric">📊 <strong>${data.total}</strong> total</span>
                        </div>
                    </div>
                    <div class="leaderboard-score">
                        <div class="leaderboard-score-value">${data.total}</div>
                        <div class="leaderboard-score-label">Tests</div>
                    </div>
                </div>
                ${testDetails}
            </div>
        `;
    }).join('');
}

function toggleTestDetails(cardId) {
    const detailsEl = document.getElementById(`${cardId}-details`);
    if (detailsEl) {
        if (detailsEl.style.display === 'none') {
            detailsEl.style.display = 'block';
        } else {
            detailsEl.style.display = 'none';
        }
    }
}

function renderCharts() {
    renderPassFailChart();
    renderExecutorChart();
    renderTrendChart();
}

function renderPassFailChart() {
    const ctx = document.getElementById('passFailChart').getContext('2d');
    const totals = currentData.totals;

    if (passFailChart) passFailChart.destroy();

    // Show "No Data" if no tests executed
    if (totals.total === 0) {
        passFailChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['No Data'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['rgba(255, 255, 255, 0.1)'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
        return;
    }

    passFailChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Passed', 'Failed'],
            datasets: [{
                data: [totals.passed, totals.failed],
                backgroundColor: ['#00f0ff', '#ff006e'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: { size: 14, family: 'Outfit' },
                        color: '#a0aec0',
                        padding: 20,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = totals.total;
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderExecutorChart() {
    const ctx = document.getElementById('executorChart').getContext('2d');

    const sortedExecutors = Object.entries(currentData.today)
        .sort((a, b) => b[1].total - a[1].total);

    if (executorChart) executorChart.destroy();

    // Show "No Data" if no executors
    if (sortedExecutors.length === 0) {
        executorChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['No Data'],
                datasets: [{
                    label: 'Tests Completed',
                    data: [0],
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    borderWidth: 2,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 1,
                        ticks: {
                            font: { family: 'JetBrains Mono', size: 12 },
                            color: '#6b7280'
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    },
                    x: {
                        ticks: {
                            font: { family: 'Outfit', size: 12 },
                            color: '#a0aec0'
                        },
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
        return;
    }

    const labels = sortedExecutors.map(([name]) => name);
    const data = sortedExecutors.map(([, d]) => d.total);

    executorChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Tests Completed',
                data: data,
                backgroundColor: '#00f0ff',
                borderColor: '#00f0ff',
                borderWidth: 2,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        font: { family: 'JetBrains Mono', size: 12 },
                        color: '#6b7280'
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                x: {
                    ticks: {
                        font: { family: 'Outfit', size: 12 },
                        color: '#a0aec0'
                    },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderTrendChart() {
    const ctx = document.getElementById('trendChart').getContext('2d');

    if (trendChart) trendChart.destroy();

    // Show "No Data" if no history
    if (!historyData || historyData.length === 0) {
        trendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['No Data'],
                datasets: [{
                    label: 'No historical data available',
                    data: [0],
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    borderWidth: 2,
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 1,
                        ticks: {
                            font: { family: 'JetBrains Mono', size: 12 },
                            color: '#6b7280'
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' }
                    },
                    x: {
                        ticks: {
                            font: { family: 'Outfit', size: 12 },
                            color: '#a0aec0'
                        },
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
        return;
    }

    // Extract historical data
    const dates = historyData.map(entry => entry.date);
    const passedData = historyData.map(entry => entry.totals.passed);
    const failedData = historyData.map(entry => entry.totals.failed);
    const totalData = historyData.map(entry => entry.totals.total);

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                {
                    label: 'Passed',
                    data: passedData,
                    borderColor: '#00f0ff',
                    backgroundColor: 'rgba(0, 240, 255, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Failed',
                    data: failedData,
                    borderColor: '#ff006e',
                    backgroundColor: 'rgba(255, 0, 110, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Total',
                    data: totalData,
                    borderColor: '#ffa500',
                    backgroundColor: 'rgba(255, 165, 0, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        font: { family: 'JetBrains Mono', size: 12 },
                        color: '#6b7280'
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                x: {
                    ticks: {
                        font: { family: 'Outfit', size: 12 },
                        color: '#a0aec0'
                    },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: { size: 14, family: 'Outfit' },
                        color: '#a0aec0',
                        padding: 20,
                        usePointStyle: true
                    }
                }
            }
        }
    });
}

function renderOverallLeaders() {
    const overallEl = document.getElementById('overallLeaders');

    // Check if overall exists
    if (!currentData.overall) {
        overallEl.innerHTML = `
            <div class="loading-state">
                <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.3;">📊</div>
                <p style="font-size: 1.25rem; color: var(--color-text-secondary);">No overall execution data available</p>
            </div>
        `;
        return;
    }

    // Sort executors by total completed (descending)
    const sortedExecutors = Object.entries(currentData.overall)
        .sort((a, b) => b[1].total - a[1].total);

    if (sortedExecutors.length === 0) {
        overallEl.innerHTML = `
            <div class="loading-state">
                <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.3;">📊</div>
                <p style="font-size: 1.25rem; color: var(--color-text-secondary);">No overall execution data available</p>
            </div>
        `;
        return;
    }

    // Render overall leader cards
    overallEl.innerHTML = sortedExecutors.map(([name, data], index) => {
        const rank = index + 1;
        const rankClass = rank <= 3 ? `overall-card--${rank}` : '';
        const passRate = data.total > 0 ? ((data.passed / data.total) * 100).toFixed(1) : '0.0';
        const cardId = `overall-${name.replace(/\s+/g, '-')}`;

        // Build test details list
        let testDetails = '';
        if (data.tests && data.tests.length > 0) {
            // Sort tests by status (FAIL first, then PASS) and then by finished time
            const sortedTests = [...data.tests].sort((a, b) => {
                if (a.status === 'FAIL' && b.status === 'PASS') return -1;
                if (a.status === 'PASS' && b.status === 'FAIL') return 1;
                return b.finished.localeCompare(a.finished);
            });

            testDetails = `
                <div class="test-details" id="${cardId}-details" style="display: none;">
                    <div class="test-details-header">
                        <h4>All Test Executions (${data.tests.length})</h4>
                    </div>
                    <div class="test-list">
                        ${sortedTests.map(test => `
                            <div class="test-item test-item--${test.status.toLowerCase()}">
                                <div class="test-item-status">${test.status === 'PASS' ? '✅' : '❌'}</div>
                                <div class="test-item-content">
                                    <div class="test-item-key">
                                        <a href="https://jira.np.afsp.io/browse/${test.key}" target="_blank">${test.key}</a>
                                    </div>
                                    <div class="test-item-time">${test.finished}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        return `
            <div class="overall-card ${rankClass}" onclick="toggleTestDetails('${cardId}')" style="cursor: pointer;">
                <div class="overall-header">
                    <div class="overall-rank">#${rank}</div>
                    <div class="overall-name">${name}</div>
                </div>
                <div class="overall-metrics">
                    <div class="overall-metric">
                        <div class="overall-metric-value">${data.total}</div>
                        <div class="overall-metric-label">Total</div>
                    </div>
                    <div class="overall-metric">
                        <div class="overall-metric-value">${data.passed}</div>
                        <div class="overall-metric-label">Passed</div>
                    </div>
                    <div class="overall-metric">
                        <div class="overall-metric-value">${data.failed}</div>
                        <div class="overall-metric-label">Failed</div>
                    </div>
                </div>
                ${testDetails}
            </div>
        `;
    }).join('');
}

// Error Handling
function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');
    errorText.textContent = message;
    errorDiv.style.display = 'flex';

    // Auto-hide after 10 seconds
    setTimeout(() => {
        hideError();
    }, 10000);
}

function hideError() {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.style.display = 'none';
}

// Archive Data Loading and Rendering
async function loadArchives() {
    try {
        const timestamp = new Date().getTime();
        const response = await fetch(`/api/archives?t=${timestamp}`, {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const archives = await response.json();

        if (archives.length === 0) {
            document.getElementById('archiveContainer').innerHTML = `
                <div class="loading-state">
                    <p>No archived test executions found</p>
                </div>
            `;
            return;
        }

        // Load history data for each archive
        const archiveData = await Promise.all(
            archives.map(async (archive) => {
                const historyResponse = await fetch(`/api/archives/${archive.id}/history?t=${timestamp}`, {
                    cache: 'no-store',
                    headers: {
                        'Cache-Control': 'no-cache'
                    }
                });

                if (historyResponse.ok) {
                    const history = await historyResponse.json();
                    return { ...archive, history };
                }
                return { ...archive, history: [] };
            })
        );

        renderArchives(archiveData);
    } catch (error) {
        console.error('Failed to load archives:', error);
        document.getElementById('archiveContainer').innerHTML = `
            <div class="loading-state">
                <p>Failed to load archived data</p>
            </div>
        `;
    }
}

function renderArchives(archives) {
    const container = document.getElementById('archiveContainer');

    container.innerHTML = archives.map(archive => {
        const history = archive.history || [];

        // Get final statistics from the last history entry
        const lastEntry = history.length > 0 ? history[history.length - 1] : null;

        if (!lastEntry) {
            return `
                <div class="archive-card">
                    <div class="archive-header">
                        <h3 class="archive-title">${archive.name}</h3>
                        <p class="archive-subtitle">No history data available</p>
                    </div>
                </div>
            `;
        }

        const stats = lastEntry.execution_status || {};
        const totals = lastEntry.totals || {};
        const completionRate = stats.completion_rate || 0;
        const passRate = stats.pass_rate || 0;

        return `
            <div class="archive-card">
                <div class="archive-header">
                    <h3 class="archive-title">${archive.name}</h3>
                    <p class="archive-subtitle">Archived on ${new Date(lastEntry.timestamp).toLocaleDateString()}</p>
                </div>

                <div class="archive-stats">
                    <div class="stat-item">
                        <div class="stat-label">Completion</div>
                        <div class="stat-value">${completionRate.toFixed(1)}%</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Pass Rate</div>
                        <div class="stat-value">${passRate.toFixed(1)}%</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Total Tests</div>
                        <div class="stat-value">${(stats.total_tests || 0).toLocaleString()}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Executed</div>
                        <div class="stat-value">${(stats.executed || 0).toLocaleString()}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Passed</div>
                        <div class="stat-value stat-pass">${(stats.pass || 0).toLocaleString()}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Failed</div>
                        <div class="stat-value stat-fail">${(stats.fail || 0).toLocaleString()}</div>
                    </div>
                </div>

                <div class="archive-progress">
                    <div class="progress-label">
                        <span>Execution Progress</span>
                        <span>${completionRate.toFixed(1)}%</span>
                    </div>
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: ${completionRate}%"></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}
