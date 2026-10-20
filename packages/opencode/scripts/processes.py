"""Bounded startup and shutdown helpers for the isolated smoke server."""
import json
from queue import Empty, Queue
import subprocess
from threading import Thread


def server_url(process, timeout=30):
    lines = Queue()

    def read():
        try:
            lines.put(process.stdout.readline())
        except Exception as error:
            lines.put(error)

    # A server that never writes its announcement must not block the smoke job.
    Thread(target=read, daemon=True).start()
    try:
        line = lines.get(timeout=timeout)
    except Empty as error:
        raise TimeoutError("OpenCode server did not announce its URL in time") from error
    if isinstance(line, Exception):
        raise line
    if not line:
        raise RuntimeError("OpenCode server exited before announcing its URL")
    return json.loads(line)["url"]


def stop_process(process, timeout=15, kill_timeout=5):
    try:
        if process.poll() is None:
            process.terminate()
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=kill_timeout)
