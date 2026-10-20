import io
import subprocess
from threading import Event
import unittest
from unittest.mock import Mock

from processes import server_url, stop_process


class ProcessTests(unittest.TestCase):
    def test_normal_exit_does_not_need_kill(self):
        process = Mock()
        process.poll.return_value = None
        stop_process(process)
        process.terminate.assert_called_once()
        process.wait.assert_called_once_with(timeout=15)
        process.kill.assert_not_called()

    def test_sigterm_timeout_escalates_to_bounded_kill(self):
        process = Mock()
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired("server", 15), 0]
        stop_process(process)
        process.kill.assert_called_once()
        process.wait.assert_any_call(timeout=5)

    def test_stuck_kill_fails_instead_of_waiting_without_a_timeout(self):
        process = Mock()
        process.poll.return_value = None
        process.wait.side_effect = subprocess.TimeoutExpired("server", 5)
        with self.assertRaises(subprocess.TimeoutExpired):
            stop_process(process)
        self.assertEqual(process.wait.call_count, 2)

    def test_url_announcement(self):
        self.assertEqual(server_url(Mock(stdout=io.StringIO('{"url":"http://localhost:1234"}\n'))), "http://localhost:1234")

    def test_missing_startup_announcement_is_bounded(self):
        release = Event()
        process = Mock()
        process.stdout.readline.side_effect = lambda: release.wait()
        try:
            with self.assertRaises(TimeoutError):
                server_url(process, timeout=0.01)
        finally:
            release.set()


if __name__ == "__main__":
    unittest.main()
