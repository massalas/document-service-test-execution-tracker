#!/usr/bin/env python3
"""
JIRA Test Execution Monitor - Python Version
Monitors SA-164329 and reports daily test execution progress via email
"""

import requests
import json
from datetime import datetime, timedelta
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from collections import defaultdict
import pytz
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

# Configuration
JIRA_TOKEN = os.getenv("JIRA_TOKEN", "")
JIRA_URL = os.getenv("JIRA_URL", "https://jira.np.afsp.io")
ISSUE_KEY = os.getenv("ISSUE_KEY", "SA-164329")
EMAIL_TO = os.getenv("EMAIL_TO", "")

# Gmail SMTP Configuration
GMAIL_USER = os.getenv("GMAIL_USER", "")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")

# Prepare authorization headers
HEADERS = {
    'Authorization': f'Bearer {JIRA_TOKEN}',
    'Content-Type': 'application/json'
}

def write_scan_progress(stage, completed=None, total=None, message=None):
    """Write scan progress to a small JSON file so the dashboard can poll it during a scan"""
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    os.makedirs(data_dir, exist_ok=True)
    progress_file = os.path.join(data_dir, 'scan_progress.json')
    progress = {
        'stage': stage,
        'completed': completed,
        'total': total,
        'message': message,
        'timestamp': datetime.now().isoformat()
    }
    try:
        with open(progress_file, 'w', encoding='utf-8') as f:
            json.dump(progress, f)
    except Exception:
        pass

def fetch_test_runs():
    """Fetch all test runs from Xray API"""
    url = f"{JIRA_URL}/rest/raven/1.0/api/testexec/{ISSUE_KEY}/test"
    try:
        response = requests.get(url, headers=HEADERS, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"❌ Error fetching test runs: {e}")
        return None

def fetch_test_run_details(test):
    """Fetch details for a single test run (for concurrent execution)"""
    test_key = test.get('key')
    test_run_id = test.get('id')
    status = test.get('status')

    # Add delay to avoid 429 rate limiting
    time.sleep(0.5)

    run_url = f"{JIRA_URL}/rest/raven/1.0/api/testrun/{test_run_id}"
    try:
        run_response = requests.get(run_url, headers=HEADERS, timeout=5)
        if run_response.status_code == 200:
            run_data = run_response.json()
            finished_on_utc = run_data.get('finishedOn', '')
            executed_by = run_data.get('executedBy', 'Unknown')

            if finished_on_utc:
                try:
                    utc_time = datetime.strptime(finished_on_utc, "%Y-%m-%dT%H:%M:%SZ")
                    utc_time = pytz.utc.localize(utc_time)
                    et_time = utc_time.astimezone(pytz.timezone('America/New_York'))
                    et_date = et_time.strftime("%Y-%m-%d")

                    return {
                        'key': test_key,
                        'status': status,
                        'finished': et_time.strftime("%Y-%m-%d %H:%M:%S ET"),
                        'date': et_date,
                        'executed_by': executed_by
                    }
                except Exception:
                    pass
    except Exception:
        pass

    return None

def analyze_test_executions(test_runs, target_date):
    """Analyze test executions for a specific date using Xray API with concurrent requests"""
    if not test_runs:
        return {}, {}

    today_stats = defaultdict(lambda: {'passed': 0, 'failed': 0, 'total': 0, 'tests': []})
    overall_stats = defaultdict(lambda: {'passed': 0, 'failed': 0, 'total': 0, 'tests': []})

    print(f"🔍 Fetching details for {len(test_runs)} test runs (sequential with rate limiting)...")

    # Fetch all test run details with single worker to avoid rate limiting
    completed = 0
    with ThreadPoolExecutor(max_workers=1) as executor:
        future_to_test = {executor.submit(fetch_test_run_details, test): test for test in test_runs}

        for future in as_completed(future_to_test):
            completed += 1
            write_scan_progress('processing', completed=completed, total=len(test_runs),
                                 message=f'Processing {completed}/{len(test_runs)} tests...')
            if completed % 50 == 0:
                print(f"   Processed {completed}/{len(test_runs)} tests...")

            result = future.result()
            if result:
                test_key = result['key']
                status = result['status']
                executed_by = result['executed_by']
                et_date = result['date']

                test_detail = {
                    'key': test_key,
                    'status': status,
                    'finished': result['finished'],
                    'date': et_date
                }

                # Track overall stats
                if status == 'PASS':
                    overall_stats[executed_by]['passed'] += 1
                    overall_stats[executed_by]['total'] += 1
                    overall_stats[executed_by]['tests'].append(test_detail)
                elif status == 'FAIL':
                    overall_stats[executed_by]['failed'] += 1
                    overall_stats[executed_by]['total'] += 1
                    overall_stats[executed_by]['tests'].append(test_detail)

                # Track today's stats
                if et_date == target_date:
                    if status == 'PASS':
                        today_stats[executed_by]['passed'] += 1
                        today_stats[executed_by]['total'] += 1
                        today_stats[executed_by]['tests'].append(test_detail)
                    elif status == 'FAIL':
                        today_stats[executed_by]['failed'] += 1
                        today_stats[executed_by]['total'] += 1
                        today_stats[executed_by]['tests'].append(test_detail)

    print(f"✅ Completed processing {len(test_runs)} tests")
    return dict(today_stats), dict(overall_stats)

def generate_report(stats, date):
    """Generate text report from statistics"""
    if not stats:
        return f"No completed test executions on {date}."

    report_lines = [
        f"TEST EXECUTION SUMMARY - {date}",
        f"Issue: {ISSUE_KEY} - AFS004 Document Service Test Execution",
        ""
    ]

    # Sort by total completed (descending) to show most productive first
    sorted_authors = sorted(stats.items(), key=lambda x: x[1]['total'], reverse=True)

    for author, data in sorted_authors:
        report_lines.append(f"{author}:")
        report_lines.append(f"  ✅ Passed: {data['passed']}")
        report_lines.append(f"  ❌ Failed: {data['failed']}")
        report_lines.append(f"  📊 Total Completed: {data['total']}")
        report_lines.append("")

    return "\n".join(report_lines)

def get_test_execution_status():
    """Get overall test execution status breakdown for SA-164329"""
    test_runs = fetch_test_runs()

    if not test_runs:
        return None

    from collections import Counter
    statuses = [test.get('status', 'UNKNOWN') for test in test_runs]
    status_counts = Counter(statuses)

    total_tests = len(test_runs)
    executed = status_counts.get('PASS', 0) + status_counts.get('FAIL', 0)
    pending = status_counts.get('TODO', 0) + status_counts.get('BLOCKED', 0) + status_counts.get('EXECUTING', 0)

    return {
        'total_tests': total_tests,
        'executed': executed,
        'pending': pending,
        'pass': status_counts.get('PASS', 0),
        'fail': status_counts.get('FAIL', 0),
        'todo': status_counts.get('TODO', 0),
        'blocked': status_counts.get('BLOCKED', 0),
        'executing': status_counts.get('EXECUTING', 0),
        'completion_rate': (executed / total_tests * 100) if total_tests > 0 else 0,
        'pass_rate': (status_counts.get('PASS', 0) / executed * 100) if executed > 0 else 0
    }

def save_to_json(today_stats, overall_stats, date):
    """Save current statistics to JSON file for web dashboard"""
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    os.makedirs(data_dir, exist_ok=True)

    # Get overall test execution status
    execution_status = get_test_execution_status()

    # Prepare data structure (using 'today' and 'overall' for dashboard compatibility)
    current_data = {
        'timestamp': datetime.now().isoformat(),
        'date': date,
        'issue_key': ISSUE_KEY,
        'execution_status': execution_status,
        'today': {},
        'overall': {}
    }

    # Add today's executor stats
    for executor, data in today_stats.items():
        current_data['today'][executor] = {
            'passed': data['passed'],
            'failed': data['failed'],
            'total': data['total'],
            'tests': data['tests']
        }

    # Add overall executor stats
    for executor, data in overall_stats.items():
        current_data['overall'][executor] = {
            'passed': data['passed'],
            'failed': data['failed'],
            'total': data['total'],
            'tests': data['tests']
        }

    # Calculate totals for today
    current_data['totals'] = {
        'passed': sum(d['passed'] for d in today_stats.values()),
        'failed': sum(d['failed'] for d in today_stats.values()),
        'total': sum(d['total'] for d in today_stats.values()),
        'executors': len(today_stats)
    }

    # Calculate overall totals
    current_data['overall_totals'] = {
        'passed': sum(d['passed'] for d in overall_stats.values()),
        'failed': sum(d['failed'] for d in overall_stats.values()),
        'total': sum(d['total'] for d in overall_stats.values()),
        'executors': len(overall_stats)
    }

    # Save current data
    current_file = os.path.join(data_dir, 'current.json')
    with open(current_file, 'w', encoding='utf-8') as f:
        json.dump(current_data, f, indent=2)

    print(f"✅ Saved current data to {current_file}")

    # Append to history
    save_historical_data(current_data)

def save_historical_data(current_data):
    """Append current data to historical data file"""
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    history_file = os.path.join(data_dir, 'history.json')

    # Load existing history
    history = []
    if os.path.exists(history_file):
        try:
            with open(history_file, 'r', encoding='utf-8') as f:
                history = json.load(f)
        except:
            history = []

    # Append current data
    history.append(current_data)

    # Keep only last 30 days
    thirty_days_ago = (datetime.now() - timedelta(days=30)).isoformat()
    history = [entry for entry in history if entry.get('timestamp', '') >= thirty_days_ago]

    # Save history
    with open(history_file, 'w', encoding='utf-8') as f:
        json.dump(history, f, indent=2)

    print(f"✅ Saved historical data to {history_file}")

def send_email(subject, body):
    """Send email via Gmail SMTP"""
    if not GMAIL_USER or not GMAIL_APP_PASSWORD:
        print("⚠️  Gmail credentials not configured!")
        print("📧 Email content that would be sent:")
        print("=" * 50)
        print(f"Subject: {subject}")
        print(f"To: {EMAIL_TO}")
        print(f"\n{body}")
        print("=" * 50)
        return False

    try:
        # Create message
        msg = MIMEMultipart()
        msg['From'] = GMAIL_USER
        msg['To'] = EMAIL_TO
        msg['Subject'] = subject

        # Attach body
        msg.attach(MIMEText(body, 'plain'))

        # Connect to Gmail SMTP server
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_APP_PASSWORD)

        # Send email
        server.send_message(msg)
        server.quit()

        print(f"✅ Email sent successfully to {EMAIL_TO}")
        return True

    except Exception as e:
        print(f"❌ Error sending email: {e}")
        print("\n📧 Email content that would be sent:")
        print("=" * 50)
        print(f"Subject: {subject}")
        print(f"To: {EMAIL_TO}")
        print(f"\n{body}")
        print("=" * 50)
        return False

def main():
    """Main execution function"""
    print("=" * 50)
    print("JIRA Test Execution Monitor (Python)")
    print(f"Issue: {ISSUE_KEY}")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S ET')}")
    print("=" * 50)
    print()

    # Get today's date in local time (ET)
    today = datetime.now().strftime("%Y-%m-%d")

    # Fetch test runs from Xray API
    print(f"📡 Fetching test runs from Xray API...")
    write_scan_progress('fetching_list', message='Fetching test run list from JIRA...')
    test_runs = fetch_test_runs()

    if not test_runs:
        print("❌ Failed to fetch test runs. Exiting.")
        write_scan_progress('error', message='Failed to fetch test runs from JIRA (check credentials/permissions).')
        return

    print(f"✅ Fetched {len(test_runs)} test runs")
    print()
    write_scan_progress('processing', completed=0, total=len(test_runs),
                         message=f'Fetched {len(test_runs)} test runs, starting detail lookups...')

    # Analyze test executions
    today_stats, overall_stats = analyze_test_executions(test_runs, today)

    # Generate report
    report = generate_report(today_stats, today)
    print()
    print(report)
    print()

    # Save data to JSON for web dashboard
    write_scan_progress('saving', completed=len(test_runs), total=len(test_runs), message='Saving results...')
    save_to_json(today_stats, overall_stats, today)
    print()
    write_scan_progress('done', completed=len(test_runs), total=len(test_runs), message='Scan complete.')

    # Email disabled - view dashboard at http://localhost:5003
    # subject = f"JIRA Test Execution Report - {ISSUE_KEY} - {datetime.now().strftime('%Y-%m-%d %H:%M ET')}"
    # send_email(subject, report)

    print()
    print("=" * 50)
    print(f"Monitor run completed at {datetime.now().strftime('%Y-%m-%d %H:%M:%S ET')}")
    print("=" * 50)

if __name__ == "__main__":
    main()
