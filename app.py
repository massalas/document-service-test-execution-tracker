#!/usr/bin/env python3
"""
Flask Web Server for JIRA Test Execution Monitor Dashboard

Serves an interactive dashboard showing SA-164329 test execution progress
with dark command center theme.
"""

from flask import Flask, render_template, jsonify
import json
import os
import subprocess
import threading
from datetime import datetime

app = Flask(__name__)

# Configuration
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
CURRENT_DATA_FILE = os.path.join(DATA_DIR, 'current.json')
HISTORY_DATA_FILE = os.path.join(DATA_DIR, 'history.json')
ARCHIVE_DIR = os.path.join(DATA_DIR, 'archive')
MONITOR_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'jira-test-monitor.py')
SCAN_PROGRESS_FILE = os.path.join(DATA_DIR, 'scan_progress.json')

# Guards against overlapping scans (e.g. a second browser tab triggering
# another fetch while one is already in flight against JIRA)
scan_lock = threading.Lock()

def refresh_data_from_jira():
    """
    Run monitor script synchronously to fetch fresh data from JIRA.
    This blocks until data is updated, ensuring fresh data on every request.
    """
    log_file = os.path.join(DATA_DIR, 'refresh.log')
    try:
        log_msg = f"[{datetime.now().strftime('%H:%M:%S')}] Fetching fresh data from JIRA...\n"
        with open(log_file, 'a') as f:
            f.write(log_msg)
        print(log_msg, flush=True)

        result = subprocess.run(
            ['/usr/bin/python3', MONITOR_SCRIPT],
            cwd=os.path.dirname(MONITOR_SCRIPT),
            timeout=400,  # rate-limited sequential fetch (1 worker, 0.5s delay) takes several minutes
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            log_msg = f"[{datetime.now().strftime('%H:%M:%S')}] ✅ Data refreshed successfully\n"
            with open(log_file, 'a') as f:
                f.write(log_msg)
            print(log_msg, flush=True)
            return True
        else:
            log_msg = f"[{datetime.now().strftime('%H:%M:%S')}] ❌ Monitor script failed: {result.stderr}\n"
            with open(log_file, 'a') as f:
                f.write(log_msg)
            print(log_msg, flush=True)
            return False
    except subprocess.TimeoutExpired:
        log_msg = f"[{datetime.now().strftime('%H:%M:%S')}] ⏱️ Monitor script timed out\n"
        with open(log_file, 'a') as f:
            f.write(log_msg)
        print(log_msg, flush=True)
        return False
    except Exception as e:
        log_msg = f"[{datetime.now().strftime('%H:%M:%S')}] ❌ Error running monitor script: {e}\n"
        with open(log_file, 'a') as f:
            f.write(log_msg)
        print(log_msg, flush=True)
        return False

@app.route('/')
def index():
    """Serve the main dashboard page"""
    return render_template('dashboard.html')

@app.route('/api/current')
def get_current_data():
    """
    Return the last saved test execution data.

    Does NOT contact JIRA — this only reads the cached data on disk, so page
    loads and refreshes are instant. Use POST /api/scan to pull fresh data.

    Returns:
        JSON response with cached data or error message
    """
    try:
        if not os.path.exists(CURRENT_DATA_FILE):
            return jsonify({
                'error': 'No data available',
                'message': 'No data has been scanned yet. Click "Scan Now" to fetch from JIRA.'
            }), 404

        with open(CURRENT_DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        response = jsonify(data)

        # Disable caching to ensure fresh data on browser refresh
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response

    except Exception as e:
        return jsonify({
            'error': 'Failed to load data',
            'message': str(e)
        }), 500

@app.route('/api/scan', methods=['POST'])
def scan_now():
    """
    Trigger a fresh fetch from JIRA (blocking).

    Rejects the request with 409 if a scan is already in progress, so
    concurrent browser tabs/refreshes can't start overlapping JIRA fetches.

    Returns:
        JSON response with freshly scanned data or error message
    """
    if not scan_lock.acquire(blocking=False):
        return jsonify({
            'error': 'Scan already in progress',
            'message': 'A scan is already running. Please wait for it to finish.'
        }), 409

    try:
        refresh_success = refresh_data_from_jira()

        if not refresh_success:
            return jsonify({
                'error': 'Scan failed',
                'message': 'Failed to fetch data from JIRA. Check flask.log and data/refresh.log.'
            }), 502

        with open(CURRENT_DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        response = jsonify(data)
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    except Exception as e:
        return jsonify({
            'error': 'Scan failed',
            'message': str(e)
        }), 500
    finally:
        scan_lock.release()

@app.route('/api/scan/status')
def scan_status():
    """
    Return the progress of the current or most recent scan.

    Cheap, non-blocking read of the progress file the monitor script
    updates as it works through test runs. Used by the dashboard to poll
    for status while a scan is running.
    """
    try:
        if os.path.exists(SCAN_PROGRESS_FILE):
            with open(SCAN_PROGRESS_FILE, 'r', encoding='utf-8') as f:
                progress = json.load(f)
        else:
            progress = {'stage': 'idle'}

        progress['scan_active'] = scan_lock.locked()

        response = jsonify(progress)
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        return response
    except Exception as e:
        return jsonify({
            'stage': 'unknown',
            'scan_active': scan_lock.locked(),
            'error': str(e)
        })

@app.route('/api/history')
def get_history_data():
    """Return historical test execution data

    Returns:
        JSON response with history data or empty list
    """
    try:
        if not os.path.exists(HISTORY_DATA_FILE):
            return jsonify([])

        with open(HISTORY_DATA_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)

        response = jsonify(data)
        # Disable caching to ensure fresh data on browser refresh
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response

    except Exception as e:
        return jsonify({
            'error': 'Failed to load history',
            'message': str(e)
        }), 500

@app.route('/api/archives')
def get_archives():
    """List all archived test executions

    Returns:
        JSON response with list of archived test execution IDs
    """
    try:
        if not os.path.exists(ARCHIVE_DIR):
            return jsonify([])

        archives = []
        for item in os.listdir(ARCHIVE_DIR):
            archive_path = os.path.join(ARCHIVE_DIR, item)
            if os.path.isdir(archive_path):
                # Get the most recent history file for this archive
                history_files = [f for f in os.listdir(archive_path) if f.startswith('history_')]
                if history_files:
                    # Sort by filename (which includes timestamp) and get the latest
                    latest_history = sorted(history_files)[-1]
                    archives.append({
                        'id': item,
                        'name': item,
                        'history_file': latest_history
                    })

        response = jsonify(archives)
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response

    except Exception as e:
        return jsonify({
            'error': 'Failed to load archives',
            'message': str(e)
        }), 500

@app.route('/api/archives/<archive_id>/history')
def get_archive_history(archive_id):
    """Return historical data for a specific archived test execution

    Args:
        archive_id: The archive identifier (e.g., 'CP-350826')

    Returns:
        JSON response with archived history data
    """
    try:
        archive_path = os.path.join(ARCHIVE_DIR, archive_id)

        if not os.path.exists(archive_path):
            return jsonify({
                'error': 'Archive not found',
                'message': f'No archive exists for {archive_id}'
            }), 404

        # Find the most recent history file
        history_files = [f for f in os.listdir(archive_path) if f.startswith('history_')]
        if not history_files:
            return jsonify([])

        latest_history = sorted(history_files)[-1]
        history_file_path = os.path.join(archive_path, latest_history)

        with open(history_file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        response = jsonify(data)
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response

    except Exception as e:
        return jsonify({
            'error': 'Failed to load archive history',
            'message': str(e)
        }), 500

@app.route('/health')
def health_check():
    """Health check endpoint for monitoring

    Returns:
        JSON response with service status and data availability
    """
    data_exists = os.path.exists(CURRENT_DATA_FILE)

    last_update = None
    if data_exists:
        try:
            with open(CURRENT_DATA_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                last_update = data.get('timestamp')
        except:
            pass

    return jsonify({
        'status': 'healthy',
        'data_available': data_exists,
        'last_update': last_update,
        'timestamp': datetime.now().isoformat()
    })

if __name__ == '__main__':
    # Run Flask development server
    PORT = 5003  # Different port from bandwidth (5001) and performance (5002)

    print("=" * 80)
    print("JIRA Test Execution Monitor Dashboard")
    print("=" * 80)
    print("")
    print("Starting Flask server...")
    print(f"Dashboard will be available at: http://localhost:{PORT}")
    print(f"Network access: http://<your-ip>:{PORT}")
    print("")
    print("Press CTRL+C to stop the server")
    print("=" * 80)

    # Run on all interfaces (0.0.0.0) to allow network access
    # Debug mode enabled but reloader disabled to prevent subprocess issues
    app.run(host='0.0.0.0', port=PORT, debug=True, use_reloader=False, threaded=True)
